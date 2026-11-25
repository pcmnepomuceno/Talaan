"""The test-DB guard in tests/conftest.py. Every subprocess URL points at the unreachable
127.0.0.1:1, so no real database can be reached."""

import os
import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine

import app.config as app_config
import app.database as app_database
from tests.conftest import require_test_db, run_alembic

ROOT = Path(__file__).resolve().parent.parent
UNREACHABLE = "postgresql+psycopg2://u:p@127.0.0.1:1/talaan"
PYTEST_ARGS = ["-q", "-p", "no:cacheprovider", "tests/test_health.py::test_ping"]


def _run(args, **env_overrides):
    # Empty, not popped: CI sets it, and load_dotenv would refill a missing one from .env.
    env = {**os.environ, "TEST_DATABASE_URL": "", **env_overrides}
    done = subprocess.run(
        [sys.executable, *args],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    return done.returncode, done.stdout + done.stderr


def _assert_refused(code, out):
    # 4, not the 2 passed to pytest.exit: pytest wraps an exception raised at conftest import as a usage error.
    assert code == 4, out
    assert "Refusing to run" in out, out
    assert "Connection refused" not in out, out


def test_aborts_when_app_config_imported_first():
    script = f"import app.config, sys, pytest; sys.exit(pytest.main({PYTEST_ARGS!r}))"
    code, out = _run(["-c", script], DATABASE_URL=UNREACHABLE)
    _assert_refused(code, out)
    assert "app.config was imported before" in out, out


def test_aborts_on_empty_database_url():
    # Empty, not unset: load_dotenv would refill an unset variable from .env.
    _assert_refused(*_run(["-m", "pytest", *PYTEST_ARGS], DATABASE_URL=""))


def test_aborts_on_non_test_TEST_DATABASE_URL():
    _assert_refused(
        *_run(
            ["-m", "pytest", *PYTEST_ARGS],
            DATABASE_URL=UNREACHABLE,
            TEST_DATABASE_URL=UNREACHABLE,
        )
    )


def test_aborts_on_dbname_query_override():
    url = "postgresql+psycopg2://u:p@127.0.0.1:1/x_test?dbname=talaan"
    _assert_refused(*_run(["-m", "pytest", *PYTEST_ARGS], DATABASE_URL=UNREACHABLE, TEST_DATABASE_URL=url))


@pytest.mark.parametrize(
    "url",
    [
        "postgresql://u:p@127.0.0.1:1/talaan_test",
        "postgresql+psycopg2://u:p@127.0.0.1:1/x_test?sslmode=require",
        "postgresql+psycopg://u:p@127.0.0.1:1/talaan_ci_test",
    ],
)
def test_require_test_db_accepts(url):
    assert require_test_db(url, "unit").database.endswith("_test")


@pytest.mark.parametrize(
    "url",
    [
        UNREACHABLE,
        "postgresql://u:p@127.0.0.1:1/TALAAN_TEST",
        "postgresql://u:p@127.0.0.1:1/talaan_test_old",
        "",
        "not a url",
        "postgresql://u:p@127.0.0.1:1",
        "postgresql://u:p@127.0.0.1:1/x_test?dbname=talaan",
        "postgresql://u:p@127.0.0.1:1/x_test?dbname=a_test&dbname=b_test",
        "postgresql+psycopg://u:p@127.0.0.1:1/x_test?dbname=talaan",
    ],
)
def test_require_test_db_rejects(url):
    with pytest.raises(pytest.exit.Exception):
        require_test_db(url, "unit")


def test_refusal_does_not_show_a_query_string_password():
    with pytest.raises(pytest.exit.Exception) as excinfo:
        require_test_db("postgresql+psycopg2://u@127.0.0.1:1/talaan?password=QUERYSECRET", "unit")
    assert "QUERYSECRET" not in str(excinfo.value)


@pytest.mark.parametrize(
    ("url", "forbidden", "driver"),
    [
        ("postgresql+psycopg2://u:pa@SECRETTAIL@127.0.0.1:1/talaan", ["SECRETTAIL", "pa@", "127.0.0.1"], "postgresql+psycopg2"),
        ("postgresql://u:p%40ss@[::1]:1/talaan", ["p%40ss", "p@ss", "::1"], "postgresql"),
        # make_url puts password text in the database name here, so the name must show as <hidden>
        ("postgresql://u:pa@SE/CRET@127.0.0.1:1/talaan", ["SE", "CRET", "127.0.0.1"], "postgresql"),
    ],
)
def test_refusal_redacts_host_and_credentials(url, forbidden, driver):
    with pytest.raises(pytest.exit.Exception) as excinfo:
        require_test_db(url, "unit")
    msg = str(excinfo.value)
    assert driver in msg
    for bad in forbidden:
        assert bad not in msg, msg
    if "SE/CRET" in url:
        assert "<hidden>" in msg


def test_refusal_redacts_imported_first_message():
    script = f"import app.config, sys, pytest; sys.exit(pytest.main({PYTEST_ARGS!r}))"
    code, out = _run(["-c", script], DATABASE_URL="postgresql+psycopg2://u:pa@SECRETTAIL@127.0.0.1:1/talaan")
    _assert_refused(code, out)
    assert "app.config was imported before" in out, out
    for bad in ("SECRETTAIL", "pa@", "127.0.0.1"):
        assert bad not in out, out


@pytest.mark.parametrize("patched", ["engine", "config_url"])
def test_run_alembic_checks_both_urls_at_call_time(monkeypatch, patched):
    calls = []
    if patched == "engine":
        monkeypatch.setattr(app_database, "engine", create_engine(UNREACHABLE))  # lazy: never connects
    else:
        monkeypatch.setattr(app_config, "DATABASE_URL", UNREACHABLE)
    try:
        run_alembic(lambda *a: calls.append(a), "head")
        exited = None
    except pytest.exit.Exception as e:
        exited = e
    assert calls == [], "run_alembic ran the alembic command"
    assert exited is not None


def test_child_pytest_keeps_one_test_suffix():
    grandchild = "import tests.conftest as c; print(c._url.database)"
    script = (
        "import os, subprocess, sys, tests.conftest; "
        f"r = subprocess.run([sys.executable, '-c', {grandchild!r}], env=os.environ, "
        "capture_output=True, text=True, timeout=30); print(r.stdout + r.stderr)"
    )
    code, out = _run(["-c", script], DATABASE_URL=UNREACHABLE)
    assert code == 0, out
    assert "talaan_test" in out.splitlines(), out
    assert "talaan_test_test" not in out, out
