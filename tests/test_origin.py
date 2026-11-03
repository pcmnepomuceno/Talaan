import os
import re
import subprocess
import sys

import pytest

from app import config
from app.main import app
from tests.conftest import USER_EMAIL, USER_PASSWORD, create_invite

ALLOWED = "http://localhost:3000"
EVIL = "https://evil.example"
LOGIN = {"email": USER_EMAIL, "password": USER_PASSWORD}


def test_allowed_origin_passes(client, user):
    assert client.post("/api/v1/login", json=LOGIN, headers={"Origin": ALLOWED}).status_code == 200


def test_origin_match_is_case_insensitive(client, user):
    assert client.post("/api/v1/login", json=LOGIN, headers={"Origin": ALLOWED.upper()}).status_code == 200


@pytest.mark.parametrize("origin", [EVIL, "null", "http://localhost:3001", "https://localhost:3000", ""])
def test_foreign_origin_blocked(client, user, origin):
    r = client.post("/api/v1/login", json=LOGIN, headers={"Origin": origin})
    assert r.status_code == 403
    assert r.json() == {"detail": "Cross-site request blocked."}
    assert r.headers["cache-control"] == "no-store"
    assert "set-cookie" not in r.headers


def test_absent_origin_passes(client, user):
    assert client.post("/api/v1/login", json=LOGIN).status_code == 200


def test_cross_site_fetch_metadata_blocked_even_without_origin(client, user):
    r = client.post("/api/v1/login", json=LOGIN, headers={"Sec-Fetch-Site": "cross-site"})
    assert r.status_code == 403


def test_cross_site_fetch_metadata_blocked_with_allowed_origin(client, user):
    r = client.post("/api/v1/login", json=LOGIN, headers={"Origin": ALLOWED, "Sec-Fetch-Site": "Cross-Site"})
    assert r.status_code == 403


@pytest.mark.parametrize("site", ["same-origin", "same-site", "none"])
def test_other_fetch_metadata_values_pass(client, user, site):
    assert client.post("/api/v1/login", json=LOGIN, headers={"Sec-Fetch-Site": site}).status_code == 200


def test_same_origin_skips_allow_list(client, user):
    # Swagger UI at http://localhost:8000/docs: its Origin is the API's own, not listed.
    headers = {"Origin": "http://localhost:8000", "Sec-Fetch-Site": "same-origin"}
    assert client.post("/api/v1/login", json=LOGIN, headers=headers).status_code == 200


def test_cross_site_with_unlisted_origin_blocked(client, user):
    headers = {"Origin": "http://localhost:8000", "Sec-Fetch-Site": "cross-site"}
    assert client.post("/api/v1/login", json=LOGIN, headers=headers).status_code == 403


def test_same_site_still_checks_allow_list(client, user):
    headers = {"Origin": EVIL, "Sec-Fetch-Site": "same-site"}
    assert client.post("/api/v1/login", json=LOGIN, headers=headers).status_code == 403


def test_signup_is_covered(client, db):
    body = {
        "email": "new@example.com", "password": USER_PASSWORD, "account_name": "N",
        "invite_code": create_invite(db),
    }
    assert client.post("/api/v1/signup", json=body, headers={"Origin": EVIL}).status_code == 403
    assert client.post("/api/v1/signup", json=body, headers={"Origin": ALLOWED}).status_code == 200


@pytest.mark.parametrize("method", ["put", "patch", "delete"])
def test_other_unsafe_methods_checked(client, method):
    r = getattr(client, method)("/api/v1/applications/1", headers={"Origin": EVIL})
    assert r.status_code == 403


def test_logout_is_checked(client):
    assert client.post("/api/v1/logout", headers={"Origin": EVIL}).status_code == 403


@pytest.mark.parametrize("path", ["/api/v1/me", "/api/v1/applications", "/health", "/ping"])
def test_safe_methods_never_checked(client, path):
    r = client.get(path, headers={"Origin": EVIL, "Sec-Fetch-Site": "cross-site"})
    assert r.status_code != 403


def test_no_cors_middleware():
    assert not [m for m in app.user_middleware if "cors" in m.cls.__name__.lower()]


def test_blocked_request_does_not_reach_the_route(client, db, make_session):
    make_session("tok")
    client.cookies.set("session_token", "tok")
    assert client.post("/api/v1/logout", headers={"Origin": EVIL}).status_code == 403
    assert client.get("/api/v1/me").status_code == 200  # session survived


def test_blocked_request_uses_patched_config(client, user, monkeypatch):
    monkeypatch.setattr(config, "ALLOWED_ORIGINS", frozenset({EVIL}))
    assert client.post("/api/v1/login", json=LOGIN, headers={"Origin": EVIL}).status_code == 200
    assert client.post("/api/v1/login", json=LOGIN, headers={"Origin": ALLOWED}).status_code == 403


# --- ALLOWED_ORIGINS parsing ---

D = frozenset({ALLOWED})


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (None, D),
        ("", D),
        ("   ", D),
        (" , ,", D),
        ("https://a.example", frozenset({"https://a.example"})),
        ("https://a.example/", frozenset({"https://a.example"})),
        (" https://a.example/ , https://B.example ", frozenset({"https://a.example", "https://b.example"})),
        ("https://a.example,https://a.example/", frozenset({"https://a.example"})),
        ("https://a.example,,", frozenset({"https://a.example"})),
        ("https://x.com:443", frozenset({"https://x.com"})),
        ("http://x.com:80", frozenset({"http://x.com"})),
        ("HTTPS://X.COM:8443", frozenset({"https://x.com:8443"})),
        ("http://x.com:443", frozenset({"http://x.com:443"})),
        ("http://[::1]:3000", frozenset({"http://[::1]:3000"})),
    ],
)
def test_parse_origins(raw, expected):
    assert config.parse_origins(raw) == expected


@pytest.mark.parametrize("raw", ["*", "https://a.example,*", "https://*.example"])
def test_wildcard_rejected(raw):
    with pytest.raises(ValueError, match="wildcard"):
        config.parse_origins(raw)


@pytest.mark.parametrize(
    "entry",
    [
        "example.com",
        "null",
        "ftp://x.com",
        "https://x.com/app",
        "https://x.com/?a=1",
        "https://x.com?a=1",
        "https://x.com#top",
        "https://user@x.com",
        "https://user:pw@x.com",
        "https://x.com:abc",
        "https://x.com:99999",
        "https://",
    ],
)
def test_malformed_origin_rejected_naming_the_entry(entry):
    with pytest.raises(ValueError, match=re.escape(f"ALLOWED_ORIGINS entry {entry!r}")):
        config.parse_origins(f"https://ok.example, {entry}")


def test_malformed_origin_fails_startup():
    r = subprocess.run(
        [sys.executable, "-c", "import app.config"],
        env={**os.environ, "ALLOWED_ORIGINS": "https://x.com/app"},
        capture_output=True, text=True, check=False,
    )
    assert r.returncode != 0
    assert "ValueError: ALLOWED_ORIGINS entry 'https://x.com/app'" in r.stderr


def test_wildcard_fails_startup():
    r = subprocess.run(
        [sys.executable, "-c", "import app.config"], env={**os.environ, "ALLOWED_ORIGINS": "*"},
        capture_output=True, text=True, check=False,
    )
    assert r.returncode != 0
    assert "wildcard" in r.stderr
