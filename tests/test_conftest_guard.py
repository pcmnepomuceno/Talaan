"""The test-DB guard in tests/conftest.py. Every subprocess URL points at the unreachable
127.0.0.1:1, so no real database can be reached."""

import os
import subprocess
import sys
from pathlib import Path

import pytest

from tests.conftest import require_test_db

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
