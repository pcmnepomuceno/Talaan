import os
import subprocess
import sys

import pytest

from app import config
from app.auth.security import hash_password

LIMIT_VARS = [
    "LOGIN_IP_LIMIT",
    "LOGIN_IP_WINDOW_SECONDS",
    "LOGIN_EMAIL_LIMIT",
    "LOGIN_EMAIL_WINDOW_SECONDS",
    "SIGNUP_IP_LIMIT",
    "SIGNUP_IP_WINDOW_SECONDS",
]


def import_config(**env):
    """Import app.config in a fresh interpreter (as at startup) with extra env vars."""
    return subprocess.run(
        [sys.executable, "-c", "import app.config"], env={**os.environ, **env}, capture_output=True,
        text=True,
        check=False,
    )


@pytest.mark.parametrize("name", LIMIT_VARS)
@pytest.mark.parametrize("value", ["0", "-1"])
def test_limit_below_one_fails_startup_naming_the_variable(name, value):
    r = import_config(**{name: value})
    assert r.returncode != 0
    assert f"ValueError: {name} must be >= 1, got {value}" in r.stderr


def test_limits_of_one_are_accepted():
    assert import_config(**dict.fromkeys(LIMIT_VARS, "1")).returncode == 0


def test_bcrypt_rounds_default_is_12():
    assert config.DEFAULT_BCRYPT_ROUNDS == 12


def test_hash_password_reads_rounds_at_call_time(monkeypatch):
    monkeypatch.setattr(config, "BCRYPT_ROUNDS", 5)
    assert hash_password("x").startswith("$2b$05$")
