"""Admin CLI: `python -m app.admin {create-invite,list-invites,revoke-invite}`.

Runs against DATABASE_URL. There is deliberately no HTTP endpoint for this. The plaintext
code is printed once by create-invite; it is not stored, logged, or shown again.
"""

import argparse
import re
import sys
from datetime import timedelta

from sqlalchemy.orm import Session

import app.users.models  # noqa: F401  # registers `users`: the invite FK needs it in a bare CLI process
from app.auth import invites
from app.auth.models import InviteCode

DEFAULT_EXPIRES_IN = "14d"
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

    sub.add_parser("list-invites", help="list invites (never shows codes or hashes)")

    revoke = sub.add_parser("revoke-invite", help="delete an UNUSED invite")
    revoke.add_argument("id", type=int)
    return parser


def status(invite: InviteCode) -> str:
    if invite.used_at is not None:
        return "used"
    return "expired" if invite.expires_at <= invites.utcnow() else "unused"


def run(db: Session, argv: list[str]) -> int:
    """Do the work; return the exit code. Bad arguments exit 2 through argparse."""
    args = build_parser().parse_args(argv)

    if args.command == "create-invite":
        display, code_hash = invites.generate()
        now = invites.utcnow()
        invite = InviteCode(code_hash=code_hash, note=args.note, created_at=now, expires_at=now + args.expires_in)
        db.add(invite)
        db.commit()
        print(f"Invite {invite.id} created, expires {invite.expires_at.isoformat()}")
        print(f"Code (shown once, not stored): {display}")
        return 0

    if args.command == "list-invites":
        rows = db.query(InviteCode).order_by(InviteCode.id).all()
        print("id\tstatus\tcreated\texpires\tnote")
        for r in rows:
            print(f"{r.id}\t{status(r)}\t{r.created_at.isoformat()}\t{r.expires_at.isoformat()}\t{r.note or ''}")
        return 0

    # revoke-invite: the WHERE keeps the "unused only" rule atomic against a concurrent signup.
    deleted = db.query(InviteCode).filter(InviteCode.id == args.id, InviteCode.used_at.is_(None)).delete(
        synchronize_session=False
    )
    db.commit()
    if deleted:
        print(f"Invite {args.id} revoked")
        return 0
    exists = db.query(InviteCode.id).filter(InviteCode.id == args.id).first() is not None
    print(f"refusing: invite {args.id} is used" if exists else f"no invite with id {args.id}", file=sys.stderr)
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
