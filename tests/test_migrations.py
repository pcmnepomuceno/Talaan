"""Round-trip the job_url migration with a committed row. The _test guard and the stray-row
check live in tests/conftest.py; this test commits, so it deletes its rows in `finally`."""

from sqlalchemy import inspect, text

from alembic import command
from app.database import engine
from tests.conftest import run_alembic

BEFORE = "d4e8a2c61f07"
REV = "e1a7c5d93b28"
INDEX = "ix_job_applications_created_by_job_url_key"


def _cols():
    return {c["name"] for c in inspect(engine).get_columns("job_applications")}


def _indexes():
    return {i["name"] for i in inspect(engine).get_indexes("job_applications")}


def test_job_url_migration_round_trip():
    print("migration test database:", engine.url.render_as_string(hide_password=True))
    try:
        run_alembic(command.downgrade, BEFORE)
        assert not {"job_url", "job_url_key"} & _cols()
        with engine.begin() as conn:
            uid = conn.execute(
                text("INSERT INTO users (email, password_hash, account_name) VALUES ('mig@example.com', 'x', 'mig') RETURNING id")
            ).scalar()
            conn.execute(
                text(
                    "INSERT INTO job_applications (company, job_name, status, mode_of_work, created_by)"
                    " VALUES ('Acme', 'Dev', 'applied', 'remote', :u)"
                ),
                {"u": uid},
            )

        run_alembic(command.upgrade, REV)
        assert {"job_url", "job_url_key"} <= _cols()
        assert INDEX in _indexes()
        with engine.connect() as conn:
            row = conn.execute(text("SELECT company, job_url, job_url_key FROM job_applications")).one()
        assert tuple(row) == ("Acme", None, None)

        run_alembic(command.downgrade, BEFORE)
        assert not {"job_url", "job_url_key"} & _cols()
        assert INDEX not in _indexes()
        with engine.connect() as conn:
            assert conn.execute(text("SELECT count(*) FROM job_applications")).scalar() == 1
    finally:
        run_alembic(command.upgrade, "head")
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM users WHERE email = 'mig@example.com'"))
    assert {"job_url", "job_url_key"} <= _cols()


def test_cascade_migration_drops_orphaned_null_creator_links():
    """Under f3a9c6d41b85 a deleted admin's links became created_by NULL, which looks like a CLI
    link. Upgrading drops every unused NULL link (expired or not) and keeps the rest."""
    print("migration test database:", engine.url.render_as_string(hide_password=True))
    before, rev = "f3a9c6d41b85", "a7c2e9d05b14"
    insert = (
        "INSERT INTO password_reset_tokens (user_id, token_hash, created_at, expires_at, created_by)"
        " VALUES (:t, :h, now(), now() + :exp * interval '1 hour', :c)"
    )
    try:
        run_alembic(command.downgrade, before)
        with engine.begin() as conn:
            admin, target = (
                conn.execute(text(
                    "INSERT INTO users (email, password_hash, account_name) VALUES (:e, 'x', 'mig') RETURNING id"
                ), {"e": e}).scalar()
                for e in ("mig-admin@example.com", "mig-target@example.com")
            )
            conn.execute(text(insert), {"t": target, "h": "mig-null", "c": None, "exp": 1})
            conn.execute(text(insert), {"t": target, "h": "mig-admin", "c": admin, "exp": 1})
            conn.execute(text(insert), {"t": target, "h": "mig-null-expired", "c": None, "exp": -1})
            conn.execute(text(insert), {"t": target, "h": "mig-null-used", "c": None, "exp": 1})
            conn.execute(text("UPDATE password_reset_tokens SET used_at = now() WHERE token_hash = 'mig-null-used'"))

        run_alembic(command.upgrade, rev)
        with engine.connect() as conn:
            kept = conn.execute(text("SELECT token_hash FROM password_reset_tokens WHERE token_hash LIKE 'mig-%'")).scalars().all()
        assert sorted(kept) == ["mig-admin", "mig-null-used"]
        fks = [f for f in inspect(engine).get_foreign_keys("password_reset_tokens") if f["constrained_columns"] == ["created_by"]]
        assert [f["options"].get("ondelete") for f in fks] == ["CASCADE"]

        run_alembic(command.downgrade, before)
        fks = [f for f in inspect(engine).get_foreign_keys("password_reset_tokens") if f["constrained_columns"] == ["created_by"]]
        assert [f["options"].get("ondelete") for f in fks] == ["SET NULL"]
    finally:
        run_alembic(command.upgrade, "head")
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM users WHERE email IN ('mig-admin@example.com', 'mig-target@example.com')"))
