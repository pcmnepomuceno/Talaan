import re
from datetime import timedelta

import pytest

from app import admin
from app.auth import invites
from app.auth.models import InviteCode
from tests.conftest import create_invite

CODE_RE = r"TLN-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}"


def code_from(out):
    found = re.findall(CODE_RE, out)
    assert len(found) == 1, out  # printed exactly once
    return found[0]


def test_create_prints_one_code_and_stores_only_its_hash(db, capsys):
    assert admin.run(db, ["create-invite", "--note", "for Ana"]) == 0
    out = capsys.readouterr().out
    code = code_from(out)
    row = db.query(InviteCode).one()
    assert row.code_hash == invites.hash_code(invites.normalize(code))
    assert row.note == "for Ana"
    assert row.used_at is None
    assert code not in str(row.__dict__)
    assert timedelta(days=13, hours=23) < row.expires_at - row.created_at <= timedelta(days=14)


def test_create_respects_expires_in(db, capsys):
    assert admin.run(db, ["create-invite", "--expires-in", "2h"]) == 0
    row = db.query(InviteCode).one()
    assert row.expires_at - row.created_at == timedelta(hours=2)


def test_list_shows_status_and_no_secrets(db, user, capsys):
    unused = create_invite(db, note="n-unused")
    used = create_invite(db, note="n-used", used_by=user)
    expired = create_invite(db, expires_in=timedelta(seconds=-1), note="n-expired")
    assert admin.run(db, ["list-invites"]) == 0
    out = capsys.readouterr().out
    lines = {line.split("\t")[-1]: line.split("\t")[1] for line in out.splitlines()[1:]}
    assert lines == {"n-unused": "unused", "n-used": "used", "n-expired": "expired"}
    for code in (unused, used, expired):
        assert code not in out and invites.normalize(code) not in out
    for row in db.query(InviteCode):
        assert row.code_hash not in out


def test_revoke_deletes_unused(db, capsys):
    create_invite(db)
    row = db.query(InviteCode).one()
    assert admin.run(db, ["revoke-invite", str(row.id)]) == 0
    assert db.query(InviteCode).count() == 0


def test_revoke_refuses_used(db, user, capsys):
    create_invite(db, used_by=user)
    row = db.query(InviteCode).one()
    assert admin.run(db, ["revoke-invite", str(row.id)]) == 1
    assert "refusing" in capsys.readouterr().err
    assert db.query(InviteCode).count() == 1


def test_revoke_unknown_id_fails(db, capsys):
    assert admin.run(db, ["revoke-invite", "999999"]) == 1
    assert "no invite" in capsys.readouterr().err


@pytest.mark.parametrize("value", ["0d", "0h", "-1d", "5m", "abc", "", "366d", "9000h", "99999999999999d"])
def test_bad_expires_in_fails_cleanly(db, capsys, value):
    with pytest.raises(SystemExit) as exc:
        admin.run(db, ["create-invite", "--expires-in", value])
    assert exc.value.code == 2
    assert capsys.readouterr().err.strip()
    assert db.query(InviteCode).count() == 0


@pytest.mark.parametrize("value", ["1h", "365d", "8760h"])
def test_expires_in_bounds_accepted(value):
    assert admin.parse_expires_in(value) <= timedelta(days=365)


def test_cli_runs_as_a_real_process_and_creates_a_code(db):
    """Unlike run(), a fresh interpreter imports only what app.admin imports: a missing
    model import (the FK to users) only shows up here."""
    import os
    import subprocess
    import sys

    from app.database import SessionLocal

    env = {**os.environ}
    note = "subprocess-test"
    row = None
    revoked = None
    try:
        out = subprocess.run(
            [sys.executable, "-m", "app.admin", "create-invite", "--note", note],
            capture_output=True, text=True, env=env, check=False,
        )
        assert out.returncode == 0, out.stderr
        code = code_from(out.stdout)
        db.expire_all()
        row = db.query(InviteCode).filter_by(note=note).one()
        assert row.code_hash == invites.hash_code(invites.normalize(code))
    finally:
        if row is not None:
            revoked = subprocess.run(
                [sys.executable, "-m", "app.admin", "revoke-invite", str(row.id)],
                capture_output=True, text=True, env=env, check=False,
            )
        # The subprocess committed for real, outside the test's rolled-back transaction.
        # Remove anything left (failed revoke, or a failure before row was set) so later
        # tests that expect an empty invite_codes table are not broken.
        cleanup = SessionLocal()
        try:
            cleanup.query(InviteCode).filter_by(note=note).delete()
            cleanup.commit()
        finally:
            cleanup.close()
    # Outside finally, so a failure above is reported instead of masked.
    assert revoked.returncode == 0, revoked.stderr


# --- purge: old rate_limit_events and expired sessions ---

from datetime import datetime, timezone

from sqlalchemy import text

from app import config
from app.auth import rate_limit
from app.auth.models import RateLimitEvent
from app.auth.models import Session as SessionModel

NOW = datetime(2026, 11, 9, 12, 0, tzinfo=timezone.utc)
LONGEST = config.MAX_WINDOW_SECONDS  # the fixed purge cutoff (7 days), not the env windows


@pytest.fixture
def clock(monkeypatch):
    monkeypatch.setattr(rate_limit, "utcnow", lambda: NOW)
    return NOW


def add_events(db, *ages_seconds):
    for age in ages_seconds:
        db.add(RateLimitEvent(key="k", created_at=NOW - timedelta(seconds=age)))
    db.commit()


def event_ages(db):
    return sorted(int((NOW - r.created_at).total_seconds()) for r in db.query(RateLimitEvent))


def test_purge_on_empty_tables(db, clock, capsys):
    assert admin.run(db, ["purge"]) == 0
    assert capsys.readouterr().out.strip() == "Purged 0 rate_limit_events, 0 sessions"


def test_purge_removes_events_older_than_the_longest_window_only(db, clock, capsys):
    # LONGEST is exactly the edge: the limiter's own prune uses <=, so purge does too.
    add_events(db, 10, LONGEST - 1, LONGEST, LONGEST + 1, LONGEST * 2)
    assert admin.run(db, ["purge"]) == 0
    assert "Purged 3 rate_limit_events" in capsys.readouterr().out
    assert event_ages(db) == [10, LONGEST - 1]


def test_purge_keeps_six_days_deletes_older_than_seven(db, clock):
    day = 24 * 3600
    add_events(db, 6 * day, 7 * day, 7 * day + 1)
    admin.run(db, ["purge"])
    assert event_ages(db) == [6 * day]


def test_purge_ignores_the_env_windows(db, clock, monkeypatch):
    # The purge workflow does not see the API's env; its cutoff must not depend on it.
    monkeypatch.setattr(config, "LOGIN_EMAIL_WINDOW_SECONDS", 7200)
    add_events(db, 7201)
    admin.run(db, ["purge"])
    assert event_ages(db) == [7201]


def test_purge_removes_expired_sessions_only(db, clock, user, capsys):
    for token, delta in [("live", timedelta(days=1)), ("edge", timedelta(0)),
                         ("dead-1", timedelta(seconds=-1)), ("dead-2", timedelta(days=-30))]:
        db.add(SessionModel(token_hash=token, user_id=user.id, created_at=NOW - timedelta(days=31), expires_at=NOW + delta))
    db.commit()
    assert admin.run(db, ["purge"]) == 0
    # expires_at <= now is expired, as get_current_user treats it
    assert "Purged 0 rate_limit_events, 3 sessions" in capsys.readouterr().out
    assert [r.token_hash for r in db.query(SessionModel)] == ["live"]


def test_purge_larger_than_one_batch_commits_per_batch(db, clock, monkeypatch, capsys):
    monkeypatch.setattr(admin, "BATCH_SIZE", 2)
    add_events(db, *([LONGEST + 5] * 5), 10)
    commits = []
    real_commit = db.commit
    monkeypatch.setattr(db, "commit", lambda: (commits.append(1), real_commit())[1])
    assert admin.run(db, ["purge"]) == 0
    assert "Purged 5 rate_limit_events" in capsys.readouterr().out
    assert event_ages(db) == [10]
    assert len(commits) >= 3  # 2 + 2 + 1, not one big transaction


def test_purge_exact_multiple_of_batch_size_terminates(db, clock, monkeypatch, capsys):
    monkeypatch.setattr(admin, "BATCH_SIZE", 2)
    add_events(db, LONGEST + 5, LONGEST + 5, LONGEST + 5, LONGEST + 5)
    assert admin.run(db, ["purge"]) == 0
    assert "Purged 4 rate_limit_events" in capsys.readouterr().out


def test_purge_skips_a_row_another_transaction_holds_and_does_not_wait(monkeypatch, capsys):
    """Real connections: a locked row is left for the next run; purge never blocks on it."""
    from app.database import SessionLocal, engine

    monkeypatch.setattr(rate_limit, "utcnow", lambda: datetime.now(timezone.utc))
    holder = engine.connect()
    cleanup = SessionLocal()
    try:
        old = datetime.now(timezone.utc) - timedelta(seconds=LONGEST + 60)
        cleanup.add_all([RateLimitEvent(key="purge-lock-test", created_at=old) for _ in range(3)])
        cleanup.commit()
        tx = holder.begin()
        holder.execute(text(
            "SELECT id FROM rate_limit_events WHERE key = 'purge-lock-test' ORDER BY id LIMIT 1 FOR UPDATE"
        ))
        worker = SessionLocal()
        try:
            assert admin.run(worker, ["purge"]) == 0  # conftest sets a 5s lock_timeout: a wait would raise
        finally:
            worker.close()
        assert "Purged 2 rate_limit_events" in capsys.readouterr().out
        tx.rollback()
        left = cleanup.query(RateLimitEvent).filter_by(key="purge-lock-test").count()
        assert left == 1
    finally:
        holder.close()
        cleanup.rollback()
        cleanup.query(RateLimitEvent).filter_by(key="purge-lock-test").delete()
        cleanup.commit()
        cleanup.close()


def test_purge_runs_as_a_real_process():
    import os
    import subprocess
    import sys

    from app.database import SessionLocal

    cleanup = SessionLocal()
    try:
        old = datetime.now(timezone.utc) - timedelta(seconds=LONGEST + 60)
        cleanup.add(RateLimitEvent(key="purge-proc-test", created_at=old))
        cleanup.commit()
        out = subprocess.run(
            [sys.executable, "-m", "app.admin", "purge"], capture_output=True, text=True, env={**os.environ}, check=False,
        )
        assert out.returncode == 0, out.stderr
        assert re.fullmatch(r"Purged \d+ rate_limit_events, \d+ sessions", out.stdout.strip()), out.stdout
        assert cleanup.query(RateLimitEvent).filter_by(key="purge-proc-test").count() == 0
    finally:
        cleanup.rollback()
        cleanup.query(RateLimitEvent).filter_by(key="purge-proc-test").delete()
        cleanup.commit()
        cleanup.close()
