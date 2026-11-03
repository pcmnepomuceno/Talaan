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
