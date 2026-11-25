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
