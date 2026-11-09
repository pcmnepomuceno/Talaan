import os
import subprocess
import sys

import pytest

from tests.conftest import USER_EMAIL, USER_PASSWORD


@pytest.fixture
def logged_in(client, user):
    r = client.post("/api/v1/login", json={"email": USER_EMAIL, "password": USER_PASSWORD})
    assert r.status_code == 200
    return client


def test_no_store_on_auth_route(client, user):
    r = client.post("/api/v1/login", json={"email": USER_EMAIL, "password": USER_PASSWORD})
    assert r.status_code == 200
    assert r.headers["cache-control"] == "no-store"


def test_no_store_on_me(logged_in):
    r = logged_in.get("/api/v1/me")
    assert r.status_code == 200
    assert r.headers["cache-control"] == "no-store"


def test_no_store_on_401(client):
    r = client.get("/api/v1/me")
    assert r.status_code == 401
    assert r.headers["cache-control"] == "no-store"


def test_no_store_on_404(logged_in):
    r = logged_in.get("/api/v1/applications/999999")
    assert r.status_code == 404
    assert r.headers["cache-control"] == "no-store"


def test_no_store_on_422(client):
    r = client.post("/api/v1/login", json={})
    assert r.status_code == 422
    assert r.headers["cache-control"] == "no-store"


def test_root_routes_not_touched(client):
    assert "cache-control" not in client.get("/ping").headers


# --- ENVIRONMENT=production: docs off, insecure config refuses to start ---

PROD_OK = {
    "ENVIRONMENT": "production",
    "COOKIE_SECURE": "true",
    "ALLOWED_ORIGINS": "https://talaan.vercel.app",
    "PROXY_SECRET": "p" * 32,
    "BCRYPT_ROUNDS": "12",
}
PROBE = (
    "from starlette.testclient import TestClient\n"
    "from app.main import app\n"
    "c = TestClient(app)\n"
    "print([c.get(p).status_code for p in ('/docs', '/redoc', '/openapi.json', '/ping')])\n"
)


def boot(**env):
    """Import app.main in a fresh process (so config is read from env) and hit the doc URLs."""
    return subprocess.run(
        [sys.executable, "-c", PROBE], env={**os.environ, **env}, capture_output=True, text=True, check=False,
    )


def test_production_with_good_config_starts_and_hides_docs():
    r = boot(**PROD_OK)
    assert r.returncode == 0, r.stderr
    assert r.stdout.strip() == "[404, 404, 404, 200]"


@pytest.mark.parametrize("env", [{}, {"ENVIRONMENT": ""}, {"ENVIRONMENT": "development"}])
def test_development_keeps_docs(env):
    r = boot(**{**PROD_OK, "COOKIE_SECURE": "false", "PROXY_SECRET": "", "ENVIRONMENT": "development", **env})
    assert r.returncode == 0, r.stderr
    assert r.stdout.strip() == "[200, 200, 200, 200]"


@pytest.mark.parametrize(
    "override, message",
    [
        ({"COOKIE_SECURE": "false"}, "COOKIE_SECURE"),
        ({"COOKIE_SECURE": ""}, None),  # blank = default true: allowed
        ({"ALLOWED_ORIGINS": ""}, "ALLOWED_ORIGINS"),
        ({"ALLOWED_ORIGINS": "http://localhost:3000"}, "ALLOWED_ORIGINS"),
        ({"ALLOWED_ORIGINS": "https://talaan.vercel.app, http://127.0.0.1:3000"}, "ALLOWED_ORIGINS"),
        ({"ALLOWED_ORIGINS": "https://app.localhost"}, "ALLOWED_ORIGINS"),
        ({"ALLOWED_ORIGINS": "https://127.0.0.2"}, "ALLOWED_ORIGINS"),
        ({"ALLOWED_ORIGINS": "https://0.0.0.0"}, "ALLOWED_ORIGINS"),
        ({"ALLOWED_ORIGINS": "https://[::ffff:127.0.0.1]"}, "ALLOWED_ORIGINS"),
        ({"ALLOWED_ORIGINS": "https://[::]"}, "ALLOWED_ORIGINS"),
        ({"ALLOWED_ORIGINS": "https://203.0.113.5"}, None),  # a public IP is not local
        ({"ALLOWED_ORIGINS": "http://talaan.vercel.app"}, "ALLOWED_ORIGINS"),
        ({"PROXY_SECRET": ""}, "PROXY_SECRET"),
        ({"BCRYPT_ROUNDS": "11"}, "BCRYPT_ROUNDS"),
        ({"ENVIRONMENT": "prod"}, "ENVIRONMENT"),
    ],
)
def test_production_refuses_one_insecure_setting(override, message):
    r = boot(**{**PROD_OK, **override})
    if message is None:
        assert r.returncode == 0, r.stderr
        return
    assert r.returncode != 0
    assert message in r.stderr
    if override.get("ENVIRONMENT") != "prod":
        assert "Refusing to start in production" in r.stderr


def test_production_lists_every_problem_at_once():
    r = boot(**{**PROD_OK, "COOKIE_SECURE": "false", "PROXY_SECRET": "", "BCRYPT_ROUNDS": "4"})
    assert r.returncode != 0
    for name in ("COOKIE_SECURE", "PROXY_SECRET", "BCRYPT_ROUNDS"):
        assert name in r.stderr


def test_admin_cli_and_config_import_do_not_apply_the_production_check():
    # The purge workflow runs `python -m app.admin` with only DATABASE_URL; production env must not block it.
    r = subprocess.run(
        [sys.executable, "-c", "import app.admin, app.config"],
        env={**os.environ, "ENVIRONMENT": "production", "COOKIE_SECURE": "false", "PROXY_SECRET": ""},
        capture_output=True, text=True, check=False,
    )
    assert r.returncode == 0, r.stderr
