"""NUL and lone surrogates in text input are a 422 naming the field, never a 500 (app/text.py).
Verify-only passwords (login, account delete, invite create) accept NUL; surrogates stay 422.

Bodies are sent as raw JSON text so the escapes reach the server exactly as written.
"""

import json
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app import config
from app.applications.models import JobApplication
from app.auth.models import InviteCode, RateLimitEvent
from app.auth.security import hash_password
from app.database import get_db
from app.interviews.models import Interview
from app.main import app
from app.text import check
from app.users.models import User
from tests.conftest import USER_EMAIL, USER_PASSWORD, as_user, create_invite

V1 = "/api/v1"
APPS = f"{V1}/applications"
SIGNUP = f"{V1}/signup"
LOGIN = f"{V1}/login"
DELETE = f"{V1}/account/delete"
INVITES = f"{V1}/admin/invites"
APP_BODY = {
    "company": "Acme",
    "job_name": "Dev",
    "status": "applied",
    "mode_of_work": "remote",
}
IV_BODY = {"scheduled_at": "2026-11-03T14:00:00+08:00", "mode": "online"}
BAD = {"nul": "\u0000", "surrogate": "\ud800"}
# Newline, tab, emoji, right-to-left text and an astral character all stay valid.
VALID = "a\n\tb ✅ שלום \U0001f600 z"


@pytest.fixture
def raw(db, user, make_session, monkeypatch):
    """A client that turns a server crash into a 500, logged in as `user`, who is an admin."""
    monkeypatch.setattr(config, "ADMIN_EMAILS", frozenset({USER_EMAIL}))
    make_session("tok")
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app, raise_server_exceptions=False) as c:
        as_user(c, "tok")
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def ids(db, user):
    """One application and one interview owned by `user`, as path ids."""
    a = JobApplication(**APP_BODY, created_by=user.id)
    db.add(a)
    db.commit()
    i = Interview(
        job_application_id=a.id, scheduled_at=datetime.now(timezone.utc), mode="online"
    )
    db.add(i)
    db.commit()
    return {"app": a.id, "iv": i.id}


def send(client, method, url, body):
    content = body if isinstance(body, bytes) else json.dumps(body)
    return client.request(
        method, url, content=content, headers={"Content-Type": "application/json"}
    )


def snapshot(db):
    """Everything a rejected request could have written."""
    counts = [
        db.scalar(select(func.count()).select_from(m))
        for m in (User, JobApplication, Interview, InviteCode, RateLimitEvent)
    ]
    cols = (
        JobApplication.company,
        JobApplication.job_name,
        JobApplication.remarks,
        JobApplication.job_url,
    )
    return (
        counts,
        db.execute(select(*cols)).all(),
        db.execute(select(Interview.interviewer, Interview.remarks)).all(),
    )


def signup_body(db, **over):
    return {
        "email": "new@example.com",
        "password": "Str0ng!pass",
        "account_name": "New",
        "invite_code": create_invite(db),
        **over,
    }


def invite_body(**over):
    return {"expires_in_days": 7, "password": USER_PASSWORD, **over}


# --- the helper ---


@pytest.mark.parametrize("value", ["\x00ab", "a\x00b", "ab\x00"])
def test_check_rejects_nul(value):
    with pytest.raises(ValueError, match="Must not contain null characters."):
        check(value)


@pytest.mark.parametrize("value", ["\ud800", "a\udfffb"])
def test_check_rejects_lone_surrogates(value):
    with pytest.raises(
        ValueError, match="Must not contain invalid Unicode characters."
    ):
        check(value)


def test_check_passes_valid_text_and_none():
    assert check(None) is None
    assert check("") == ""
    assert check(VALID) == VALID


# --- every touched field ---


def _app_post(field, v, db, ids):
    return "POST", APPS, {**APP_BODY, field: v}


def _app_patch(field, v, db, ids):
    return "PATCH", f"{APPS}/{ids['app']}", {field: v}


def _lookup(field, v, db, ids):
    return "POST", f"{APPS}/lookup", {field: v}


def _iv_post(field, v, db, ids):
    return "POST", f"{APPS}/{ids['app']}/interviews", {**IV_BODY, field: v}


def _iv_patch(field, v, db, ids):
    return "PATCH", f"{V1}/interviews/{ids['iv']}", {field: v}


def _signup(field, v, db, ids):
    return "POST", SIGNUP, signup_body(db, **{field: v})


def _login(field, v, db, ids):
    return "POST", LOGIN, {"email": USER_EMAIL, field: v}


def _delete(field, v, db, ids):
    return "POST", DELETE, {field: v}


def _invite(field, v, db, ids):
    return "POST", INVITES, invite_body(**{field: v})


def _cases():
    groups = [
        (_app_post, ["company", "job_name", "remarks", "job_url"]),
        (_app_patch, ["company", "job_name", "remarks", "job_url"]),
        (_lookup, ["url"]),
        (_iv_post, ["interviewer", "remarks"]),
        (_iv_patch, ["interviewer", "remarks"]),
        (_signup, ["account_name", "password"]),
        (_login, ["password"]),
        (_delete, ["password"]),
        (_invite, ["password", "note"]),
    ]
    # Only checked, never stored: NUL is allowed.
    verify_only = {_login, _delete, _invite}
    return [
        pytest.param(build, field, bad, id=f"{build.__name__[1:]}-{field}-{bad}")
        for build, fields in groups
        for field in fields
        for bad in BAD
        if not (build in verify_only and field == "password" and bad == "nul")
    ]


def _value(field, bad):
    prefix = {
        "job_url": "https://example.com/a",
        "url": "https://example.com/a",
        "password": "Str0ng!pass",
    }
    return prefix.get(field, "ab") + BAD[bad] + "cd"


@pytest.mark.parametrize("build, field, bad", _cases())
def test_bad_character_is_422_on_the_field(raw, db, ids, build, field, bad):
    method, url, body = build(field, _value(field, bad), db, ids)
    before = snapshot(db)
    r = send(raw, method, url, body)
    assert r.status_code == 422, r.text
    assert r.json()["detail"][0]["loc"][-1] == field
    assert snapshot(db) == before


@pytest.mark.parametrize("password", ["Str0ng!pass\x00", "\x00", "\x00" * 3, ""])
@pytest.mark.parametrize(
    "build, status", [(_login, 401), (_delete, 403), (_invite, 403)]
)
def test_verify_only_password_accepts_nul(raw, db, ids, build, status, password):
    method, url, body = build("password", password, db, ids)
    r = send(raw, method, url, body)
    assert r.status_code == status, r.text


def test_nul_password_account_can_log_in_and_delete(raw, db, user):
    # An account made while signup still accepted NUL (bcrypt hashes it).
    nul_password = "Str0ng!pass\x00x"
    user.password_hash = hash_password(nul_password)
    db.commit()
    r = send(raw, "POST", LOGIN, {"email": USER_EMAIL, "password": nul_password})
    assert r.status_code == 200, r.text
    r = send(raw, "POST", DELETE, {"password": nul_password})
    assert r.status_code == 204, r.text


def test_invite_password_surrogate_422_input_null(raw):
    r = send(raw, "POST", INVITES, invite_body(password="ab\ud800cd"))
    assert r.status_code == 422, r.text
    [error] = r.json()["detail"]
    assert error["loc"][-1] == "password" and error["input"] is None


def test_raw_surrogate_bytes_are_422(raw):
    body = (
        json.dumps({**APP_BODY, "company": "X"})
        .encode()
        .replace(b'"X"', b'"\xed\xa0\x80"')
    )
    r = send(raw, "POST", APPS, body)
    assert r.status_code == 422, r.text
    assert r.json()["detail"][0]["loc"] == ["body", "company"]


@pytest.mark.parametrize("value", ["\u0000Acme", "Acme\u0000"])
def test_nul_at_either_end_of_a_stripped_name_is_422(raw, value):
    r = send(raw, "POST", APPS, {**APP_BODY, "company": value})
    assert r.status_code == 422, r.text


def test_too_long_remarks_with_nul_is_422(raw):
    r = send(raw, "POST", APPS, {**APP_BODY, "remarks": "a" * 5001 + "\u0000"})
    assert r.status_code == 422, r.text


def test_valid_unicode_round_trips(raw, db):
    r = send(raw, "POST", APPS, {**APP_BODY, "company": VALID, "remarks": VALID})
    assert r.status_code == 201, r.text
    assert r.json()["company"] == VALID and r.json()["remarks"] == VALID
    r = send(raw, "POST", SIGNUP, signup_body(db, account_name=VALID))
    assert r.status_code == 200, r.text
    assert r.json()["account_name"] == VALID


def test_null_still_clears_nullable_fields(raw, ids):
    for url in (f"{APPS}/{ids['app']}", f"{V1}/interviews/{ids['iv']}"):
        assert send(raw, "PATCH", url, {"remarks": None}).status_code == 200
    assert (
        send(
            raw, "PATCH", f"{V1}/interviews/{ids['iv']}", {"interviewer": None}
        ).status_code
        == 200
    )
    r = send(raw, "POST", INVITES, invite_body(note=None))
    assert r.status_code == 201 and r.json()["note"] is None


# --- fields left alone: already refused, never a 500 ---


@pytest.mark.parametrize("bad", BAD)
@pytest.mark.parametrize(
    "build, field, value, status",
    [
        (_signup, "email", "a{}@example.com", 422),
        (_login, "email", "a{}@example.com", 422),
        (_app_post, "contact_email", "a{}@example.com", 422),
        (_signup, "invite_code", "TLN-{}", 400),
    ],
    ids=["signup_email", "login_email", "contact_email", "invite_code"],
)
def test_other_fields_never_500(raw, db, ids, build, field, value, status, bad):
    method, url, body = build(field, value.format(BAD[bad]), db, ids)
    if build is _login:
        body["password"] = "x"
    r = send(raw, method, url, body)
    assert r.status_code == status, r.text


@pytest.mark.parametrize("bad, status", [("nul", 201), ("surrogate", 422)])
def test_contact_website_never_500(raw, bad, status):
    # HttpUrl percent-encodes NUL, so no raw NUL reaches the database.
    r = send(
        raw,
        "POST",
        APPS,
        {**APP_BODY, "contact_website": f"https://example.com/a{BAD[bad]}"},
    )
    assert r.status_code == status, r.text
    assert "\x00" not in r.text


@pytest.mark.parametrize(
    "path",
    [
        "applications?status=%00",
        "interviews?when=%00",
        "interviews/calendar?from=%00&to=2026-11-01",
    ],
)
def test_nul_in_query_is_422(raw, path):
    assert raw.get(f"{V1}/{path}").status_code == 422


# --- every existing limit still accepts its edge value ---


def padded(n, char="a"):
    return f"  {char * n}  "


@pytest.mark.parametrize("field", ["company", "job_name"])
def test_name_limit_is_200_after_stripping(raw, field):
    r = send(raw, "POST", APPS, {**APP_BODY, field: padded(200)})
    assert r.status_code == 201, r.text
    assert r.json()[field] == "a" * 200
    r = send(raw, "POST", APPS, {**APP_BODY, field: "a" * 201})
    assert r.status_code == 422 and r.json()["detail"][0]["type"] == "string_too_long"


def test_interviewer_limit_is_200_after_stripping(raw, ids):
    url = f"{APPS}/{ids['app']}/interviews"
    r = send(raw, "POST", url, {**IV_BODY, "interviewer": padded(200)})
    assert r.status_code == 201, r.text
    assert r.json()["interviewer"] == "a" * 200
    r = send(raw, "POST", url, {**IV_BODY, "interviewer": "a" * 201})
    assert r.status_code == 422 and r.json()["detail"][0]["type"] == "string_too_long"


@pytest.mark.parametrize("kind", ["app", "iv"])
def test_remarks_limit_is_5000(raw, ids, kind):
    url, body = {
        "app": (APPS, APP_BODY),
        "iv": (f"{APPS}/{ids['app']}/interviews", IV_BODY),
    }[kind]
    value = " " + "a\n" * 2499 + " "  # 5000, not stripped
    r = send(raw, "POST", url, {**body, "remarks": value})
    assert r.status_code == 201, r.text
    assert r.json()["remarks"] == value
    r = send(raw, "POST", url, {**body, "remarks": value + "a"})
    assert r.status_code == 422 and r.json()["detail"][0]["type"] == "string_too_long"


def url_of(n):
    base = "https://example.com/"
    return base + "a" * (n - len(base))


def test_job_url_limit_is_2000_after_trimming(raw):
    r = send(raw, "POST", APPS, {**APP_BODY, "job_url": f"  {url_of(2000)}  "})
    assert r.status_code == 201, r.text
    assert r.json()["job_url"] == url_of(2000)
    assert send(raw, "POST", f"{APPS}/lookup", {"url": url_of(2000)}).status_code == 200
    assert (
        send(raw, "POST", APPS, {**APP_BODY, "job_url": url_of(2001)}).status_code
        == 422
    )
    assert send(raw, "POST", f"{APPS}/lookup", {"url": url_of(2001)}).status_code == 422


def test_contact_website_limit_is_2000(raw):
    r = send(raw, "POST", APPS, {**APP_BODY, "contact_website": url_of(2000)})
    assert r.status_code == 201, r.text
    assert (
        send(
            raw, "POST", APPS, {**APP_BODY, "contact_website": url_of(2001)}
        ).status_code
        == 422
    )


@pytest.mark.parametrize("salary", [0, 2_147_483_647])
def test_salary_limits(raw, salary):
    assert send(raw, "POST", APPS, {**APP_BODY, "salary": salary}).status_code == 201


def test_invite_note_limit_is_200_code_points_after_stripping(raw):
    r = send(raw, "POST", INVITES, invite_body(note=padded(200, "\U0001f600")))
    assert r.status_code == 201, r.text
    assert r.json()["note"] == "\U0001f600" * 200
    r = send(raw, "POST", INVITES, invite_body(note="a" * 201))
    assert r.status_code == 422 and r.json()["detail"][0]["type"] == "string_too_long"


@pytest.mark.parametrize("url", [DELETE, INVITES])
def test_confirm_password_limit_is_1024(raw, url):
    body = invite_body() if url == INVITES else {}
    r = send(raw, "POST", url, {**body, "password": "a" * 1024})
    assert r.status_code == 403, r.text
    r = send(raw, "POST", url, {**body, "password": "a" * 1025})
    assert r.status_code == 422 and r.json()["detail"][0]["type"] == "string_too_long"


@pytest.mark.parametrize(
    "password, status",
    [
        ("Aa1!aaa", 422),
        ("Aa1!aaaa", 200),
        ("Aa1!" + "é" * 34, 200),
        ("Aa1!" + "é" * 34 + "a", 422),
    ],
    ids=["7_chars", "8_chars", "72_bytes", "73_bytes"],
)
def test_signup_password_limits(raw, db, password, status):
    r = send(raw, "POST", SIGNUP, signup_body(db, password=password))
    assert r.status_code == status, r.text


def test_invite_code_input_limit_is_64(raw, db):
    body = signup_body(db)
    body["invite_code"] = body["invite_code"].ljust(64)
    assert send(raw, "POST", SIGNUP, body).status_code == 200


def test_fields_without_a_max_length_stay_unbounded(raw, db):
    long = "a" * 10_000
    assert (
        send(raw, "POST", SIGNUP, signup_body(db, account_name=long)).status_code == 200
    )
    assert (
        send(raw, "POST", LOGIN, {"email": USER_EMAIL, "password": long}).status_code
        == 401
    )
