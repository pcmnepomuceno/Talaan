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


def test_blank_numeric_setting_uses_the_default(monkeypatch):
    monkeypatch.setenv("LOGIN_IP_LIMIT", "")
    assert config._int("LOGIN_IP_LIMIT", 10, minimum=1) == 10
    # And at startup, for every numeric setting at once.
    r = import_config(**dict.fromkeys([*LIMIT_VARS, "BCRYPT_ROUNDS"], ""))
    assert r.returncode == 0, r.stderr


def test_non_integer_setting_fails_startup_naming_the_variable():
    r = import_config(LOGIN_IP_LIMIT="ten")
    assert r.returncode != 0
    assert "ValueError: LOGIN_IP_LIMIT must be an integer, got 'ten'" in r.stderr


def test_bcrypt_rounds_default_is_12():
    assert config.DEFAULT_BCRYPT_ROUNDS == 12


def test_hash_password_reads_rounds_at_call_time(monkeypatch):
    monkeypatch.setattr(config, "BCRYPT_ROUNDS", 5)
    assert hash_password("x").startswith("$2b$05$")


@pytest.mark.parametrize(("value", "message"), [("3", ">= 4, got 3"), ("32", "<= 31, got 32")])
def test_bcrypt_rounds_outside_4_to_31_fails_startup_naming_the_variable(value, message):
    r = import_config(BCRYPT_ROUNDS=value)
    assert r.returncode != 0
    assert f"ValueError: BCRYPT_ROUNDS must be {message}" in r.stderr


@pytest.mark.parametrize(("value", "warns"), [("4", True), ("11", True), ("12", False), ("31", False)])
def test_bcrypt_rounds_below_12_warns_at_startup(value, warns):
    r = import_config(BCRYPT_ROUNDS=value)
    assert r.returncode == 0, r.stderr
    assert ("BCRYPT_ROUNDS=" in r.stderr) is warns


@pytest.mark.parametrize("value", ["maybe", "2"])
def test_cookie_secure_rejects_garbage(value):
    r = import_config(COOKIE_SECURE=value)
    assert r.returncode != 0
    assert "COOKIE_SECURE must be true or false" in r.stderr


@pytest.mark.parametrize(
    ("value", "expected"), [("", "True"), ("true", "True"), (" FALSE ", "False"), ("0", "False")]
)
def test_cookie_secure_parsing(value, expected):
    r = subprocess.run(
        [sys.executable, "-c", "from app import config; print(config.COOKIE_SECURE)"],
        env={**os.environ, "COOKIE_SECURE": value}, capture_output=True, text=True, check=False,
    )
    assert r.stdout.strip() == expected



@pytest.mark.parametrize("value", ["ture", "maybe", "2"])
def test_trust_proxy_typo_fails_startup_naming_the_variable(value):
    r = import_config(TRUST_PROXY=value)
    assert r.returncode != 0
    assert f"ValueError: TRUST_PROXY must be true or false, got {value!r}" in r.stderr


@pytest.mark.parametrize(
    ("value", "expected"), [("", "False"), ("true", "True"), (" YES ", "True"), ("false", "False"), ("0", "False")]
)
def test_trust_proxy_parsing(value, expected):
    r = subprocess.run(
        [sys.executable, "-c", "from app import config; print(config.TRUST_PROXY)"],
        env={**os.environ, "TRUST_PROXY": value}, capture_output=True, text=True, check=False,
    )
    assert r.stdout.strip() == expected, r.stderr


def test_proxy_secret_shorter_than_32_fails_startup_naming_the_variable():
    r = import_config(PROXY_SECRET="x" * 31)
    assert r.returncode != 0
    assert "PROXY_SECRET" in r.stderr


@pytest.mark.parametrize("value", ["", "   "])
def test_proxy_secret_blank_means_unset(value):
    r = subprocess.run(
        [sys.executable, "-c", "from app import config; print(config.PROXY_SECRET)"],
        env={**os.environ, "PROXY_SECRET": value}, capture_output=True, text=True, check=False,
    )
    assert r.returncode == 0 and r.stdout.strip() == "None"


def test_proxy_secret_of_32_is_accepted_and_stripped():
    r = subprocess.run(
        [sys.executable, "-c", "from app import config; print(len(config.PROXY_SECRET))"],
        env={**os.environ, "PROXY_SECRET": " " + "x" * 32 + " "}, capture_output=True, text=True, check=False,
    )
    assert r.returncode == 0 and r.stdout.strip() == "32"


WINDOW_VARS = [
    "LOGIN_IP_WINDOW_SECONDS",
    "LOGIN_EMAIL_WINDOW_SECONDS",
    "SIGNUP_IP_WINDOW_SECONDS",
    "ACCOUNT_DELETE_USER_WINDOW_SECONDS",
    "ACCOUNT_DELETE_IP_WINDOW_SECONDS",
]


@pytest.mark.parametrize("name", WINDOW_VARS)
def test_window_above_the_seven_day_ceiling_fails_startup_naming_the_variable(name):
    # purge keeps rate-limit events for 7 days only; a longer window would count too few attempts.
    r = import_config(**{name: "604801"})
    assert r.returncode != 0
    assert f"ValueError: {name} must be <= 604800, got 604801" in r.stderr


def test_windows_at_the_ceiling_are_accepted():
    assert import_config(**dict.fromkeys(WINDOW_VARS, "604800")).returncode == 0
