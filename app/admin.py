"""Admin CLI: `python -m app.admin {create-invite,list-invites,revoke-invite,create-reset-link,purge}`.

Runs against DATABASE_URL. An admin-gated HTTP endpoint (app/auth/admin_invites.py) shares the
invite logic in app/auth/invites.py. The plaintext code is printed once by create-invite; it is
not stored, logged, or shown again.

`create-reset-link EMAIL` works for any account, admins included (the HTTP endpoint refuses them).
It prints the link's path, token included, once.
"""

import argparse
import re
import sys
from datetime import timedelta

from sqlalchemy import text
from sqlalchemy.orm import Session

from app import config
from app.auth import invites, password_resets, rate_limit
from app.auth.models import InviteCode
from app.users.models import User  # registers `users` for the invite FK

BATCH_SIZE = 1000  # rows per DELETE; tests patch it
DEFAULT_EXPIRES_IN = "14d"
RESET_TOKEN_RETENTION = timedelta(days=7)  # after creation, for used and expired links
MAX_HOURS = 365 * 24


def parse_expires_in(value: str) -> timedelta:
    """`Nd` or `Nh`, between 1 hour and 365 days."""
    match = re.fullmatch(r"(\d{1,6})([dh])", value.strip().lower())
    if not match:
        raise argparse.ArgumentTypeError(f"invalid duration {value!r}: use Nd or Nh, for example 14d or 48h")
    amount, unit = int(match.group(1)), match.group(2)
    hours = amount * 24 if unit == "d" else amount
    if hours < 1:
        raise argparse.ArgumentTypeError("duration must be at least 1h")
    if hours > MAX_HOURS:
        raise argparse.ArgumentTypeError("duration must be at most 365d (8760h)")
    return timedelta(hours=hours)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m app.admin", description="Talaan admin tasks.")
    sub = parser.add_subparsers(dest="command", required=True)

    create = sub.add_parser("create-invite", help="create a single-use invite code")
    create.add_argument("--note", help="free text to remember who the code is for")
    create.add_argument("--expires-in", type=parse_expires_in, default=parse_expires_in(DEFAULT_EXPIRES_IN),
                        metavar="Nd|Nh", help="lifetime, default 14d (1h to 365d)")

    sub.add_parser("purge", help="delete old rate-limit events, expired sessions and old reset links")

    sub.add_parser("list-invites", help="list invites (never shows codes or hashes)")

    revoke = sub.add_parser("revoke-invite", help="delete an UNUSED invite")
    revoke.add_argument("id", type=int)

    reset = sub.add_parser("create-reset-link", help="create a 24-hour password reset link")
    reset.add_argument("email")
    return parser


def _delete_in_batches(db: Session, table: str, condition: str, params: dict) -> int:
    """Delete rows matching `condition` (fixed SQL, never user input), BATCH_SIZE at a time, one
    short transaction per batch. FOR UPDATE SKIP LOCKED leaves any row another transaction holds
    (a login pruning its key, a logout) for the next run, so purge itself never waits. The other
    direction is not free: an API write to a row this batch has locked (the limiter's prune of an
    old event, a logout or get_current_user deleting an expired session) waits until the batch
    commits. Each batch is a sequential scan (no index on created_at / expires_at), so that wait
    grows with table size. No table or advisory locks."""
    total = 0
    while True:
        deleted = db.execute(
            text(
                f"DELETE FROM {table} WHERE id IN "
                f"(SELECT id FROM {table} WHERE {condition} ORDER BY id LIMIT :n FOR UPDATE SKIP LOCKED)"
            ),
            {**params, "n": BATCH_SIZE},
        ).rowcount
        db.commit()
        total += deleted
        if deleted < BATCH_SIZE:
            return total


def purge(db: Session) -> tuple[int, int, int]:
    """(events deleted, sessions deleted, reset tokens deleted). Reset tokens go when used or
    expired and created at least RESET_TOKEN_RETENTION ago. Events older than config.MAX_WINDOW_SECONDS (7 days) are
    outside every key's window (config refuses any longer window), so removing them cannot change
    any limiter count. The cutoff is that fixed ceiling, not the API's own *_WINDOW_SECONDS: this
    runs from GitHub Actions with only DATABASE_URL and never sees the API's env. Sessions use the same
    `expires_at <= now` rule as get_current_user. The cutoff column has no index of its own, so each
    batch scans the table (fine at this size).
    ponytail: add an index on created_at / expires_at if purge gets slow."""
    now = rate_limit.utcnow()
    cutoff = now - timedelta(seconds=config.MAX_WINDOW_SECONDS)
    events = _delete_in_batches(db, "rate_limit_events", "created_at <= :cutoff", {"cutoff": cutoff})
    sessions = _delete_in_batches(db, "sessions", "expires_at <= :now", {"now": now})
    resets = _delete_in_batches(
        db, "password_reset_tokens", "(used_at IS NOT NULL OR expires_at <= :now) AND created_at <= :cutoff",
        {"now": now, "cutoff": now - RESET_TOKEN_RETENTION},
    )
    return events, sessions, resets


def run(db: Session, argv: list[str]) -> int:
    """Do the work; return the exit code. Bad arguments exit 2 through argparse."""
    args = build_parser().parse_args(argv)

    if args.command == "create-invite":
        invite, display = invites.create(db, args.note, args.expires_in)
        print(f"Invite {invite.id} created, expires {invite.expires_at.isoformat()}")
        print(f"Code (shown once, not stored): {display}")
        return 0

    if args.command == "purge":
        events, sessions, resets = purge(db)
        print(f"Purged {events} rate_limit_events, {sessions} sessions, {resets} password_reset_tokens")
        return 0

    if args.command == "create-reset-link":
        target = (
            db.query(User.id, User.account_name).filter(User.email == args.email.strip().lower()).first()
        )
        created = password_resets.create(db, target.id, None) if target else None
        if created is None:
            print("no account with that email", file=sys.stderr)
            return 1
        db.commit()
        token, expires_at = created
        print(f"Reset link for {target.account_name} expires {expires_at.isoformat()}")
        print(f"Path (shown once, not stored): /reset#{token}")
        return 0

    if args.command == "list-invites":
        rows = (
            db.query(InviteCode, User.account_name)
            .outerjoin(User, User.id == InviteCode.used_by_user_id)
            .order_by(InviteCode.id)
            .all()
        )
        print("id\tstatus\tcreated\texpires\tused\taccount\tnote")
        for r, account in rows:
            used = r.used_at.isoformat() if r.used_at else ""
            if r.used_at and account is None:
                account = "(deleted)"  # the user row is gone (FK SET NULL)
            print(f"{r.id}\t{invites.status(r)}\t{r.created_at.isoformat()}\t{r.expires_at.isoformat()}\t{used}\t{account or ''}\t{r.note or ''}")
        return 0

    # revoke-invite
    result = invites.revoke(db, args.id)
    if result == "revoked":
        print(f"Invite {args.id} revoked")
        return 0
    print(f"refusing: invite {args.id} is used" if result == "used" else f"no invite with id {args.id}", file=sys.stderr)
    return 1


def main() -> int:
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        return run(db, sys.argv[1:])
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
