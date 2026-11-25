import asyncio
import json
import os
import subprocess
import sys

import pytest
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient

from app.main import app, validation_error
from tests.conftest import USER_EMAIL, USER_PASSWORD, as_user


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
    """Import app.main in a fresh process (so config is read from env) and hit the doc URLs.
    A value of None removes that variable, even if the parent process has it."""
    merged = {k: v for k, v in {**os.environ, **env}.items() if v is not None}
    return subprocess.run([sys.executable, "-c", PROBE], env=merged, capture_output=True, text=True, check=False)


def test_production_with_good_config_starts_and_hides_docs():
    r = boot(**PROD_OK)
    assert r.returncode == 0, r.stderr
    assert r.stdout.strip() == "[404, 404, 404, 200]"


@pytest.mark.parametrize("env", [{"ENVIRONMENT": None}, {"ENVIRONMENT": ""}, {"ENVIRONMENT": "development"}])
def test_development_keeps_docs(env):
    # ENVIRONMENT=None really unsets it (not inherited from PROD_OK or the shell): the default must
    # be development. .env has no ENVIRONMENT line, so load_dotenv cannot refill it.
    r = boot(**{**PROD_OK, "COOKIE_SECURE": "false", "PROXY_SECRET": "", **env})
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


# --- a body with a lone surrogate is a 422, never a 500 ---

ECHO_APP = (
    '"company": "Co", "job_name": "Dev", "status": "applied", "mode_of_work": "remote"'
)


@pytest.mark.parametrize(
    "body, loc",
    [
        (
            "{" + ECHO_APP + r', "contact_email": "a\ud800@b.com"}',
            ["body", "contact_email"],
        ),
        (
            r'{"company": {"x": "\ud800"}, "job_name": "Dev", "status": "applied", "mode_of_work": "remote"}',
            ["body", "company"],
        ),
        # pydantic cannot name a surrogate key, so its error sits on the body itself
        ("{" + ECHO_APP + r', "\ud800": 1}', ["body"]),
    ],
    ids=["contact_email", "nested_object", "extra_key"],
)
def test_422_for_a_lone_surrogate(client, users, body, loc):
    as_user(client, "tok-a")
    # No context manager: `client` already ran the app's lifespan and set the get_db override.
    raw = TestClient(app, raise_server_exceptions=False, cookies=client.cookies)
    r = raw.post(
        "/api/v1/applications",
        content=body,
        headers={"Content-Type": "application/json"},
    )
    assert r.status_code == 422, r.text
    assert r.headers["cache-control"] == "no-store"
    assert r.json()["detail"][0]["loc"] == loc


# --- a 422 never echoes what was submitted ---


def test_422_never_echoes_invite_code_or_password(client):
    code, password = "TLN-SECR-ETCO-DE12", "Secr3t!Passw0rd"
    # account_name is missing, so FastAPI's default error would echo the whole body.
    r = client.post(
        "/api/v1/signup",
        json={"email": "new@example.com", "password": password, "invite_code": code},
    )
    assert r.status_code == 422, r.text
    assert code not in r.text and password not in r.text
    assert [e["input"] for e in r.json()["detail"]] == [None]


def test_422_never_echoes_a_rejected_password(client):
    # Raw JSON: httpx cannot encode a lone surrogate itself; json.dumps writes it as an escape.
    body = json.dumps({"email": "new@example.com", "password": "Secr3t\ud800pw"})
    r = client.post(
        "/api/v1/login", content=body, headers={"Content-Type": "application/json"}
    )
    assert r.status_code == 422, r.text
    assert "Secr3t" not in r.text


def test_422_blanks_input_and_keeps_loc_and_msg(client, users):
    as_user(client, "tok-a")
    body = {
        "company": "a" * 201,
        "job_name": "Dev",
        "status": "applied",
        "mode_of_work": "remote",
    }
    r = client.post("/api/v1/applications", json=body)
    assert r.status_code == 422, r.text
    [error] = r.json()["detail"]
    assert error["input"] is None
    assert error["loc"] == ["body", "company"]
    assert error["msg"] == "String should have at most 200 characters"


def test_422_escapes_a_surrogate_left_in_loc_or_msg():
    # Called directly: with `input` blanked, no request body above reaches this fallback.
    error = {
        "type": "value_error",
        "loc": ("body", "\ud800"),
        "msg": "bad \udfff",
        "input": "\ud800",
    }
    r = asyncio.run(validation_error(None, RequestValidationError([error])))
    assert r.status_code == 422
    assert r.media_type == "application/json"
    assert json.loads(r.body) == {
        "detail": [{**error, "loc": ["body", "\ud800"], "input": None}]
    }
