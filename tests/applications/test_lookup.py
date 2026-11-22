import logging

import pytest

from tests.conftest import as_user

URL = "/api/v1/applications"
LOOKUP = f"{URL}/lookup"
POSTING = "https://example.com/jobs/1"
BODY = {"company": "Acme", "job_name": "Dev", "status": "applied", "mode_of_work": "remote"}


@pytest.fixture
def a(client, users):
    as_user(client, "tok-a")
    return client


def create(client, job_url=POSTING, **over):
    r = client.post(URL, json={**BODY, "job_url": job_url, **over})
    assert r.status_code == 201, r.text
    return r.json()


def look(client, url=POSTING, **extra):
    return client.post(LOOKUP, json={"url": url, **extra})


def test_match_after_create(a):
    row = create(a)
    r = look(a)
    assert r.status_code == 200
    assert r.json() == {"match": {"id": row["id"], "job_name": "Dev", "company": "Acme"}}


def test_match_ignores_tracking_and_fragment(a):
    row = create(a)
    assert look(a, "https://EXAMPLE.com/jobs/1/?utm_source=x#top").json()["match"]["id"] == row["id"]


def test_no_match_for_other_job(a):
    create(a)
    assert look(a, "https://example.com/jobs/2").json() == {"match": None}


def test_null_when_none_saved(a):
    assert look(a).json() == {"match": None}


def test_other_user_never_matches(a, client):
    create(a)
    as_user(client, "tok-b")
    assert look(client).json() == {"match": None}


def test_newest_wins(a):
    create(a, job_name="Old")
    new = create(a, job_name="New", job_url=POSTING + "?utm_source=y")
    assert look(a).json()["match"]["id"] == new["id"]


def test_exclude_id_skips_the_edited_row_and_returns_the_older_match(a):
    old = create(a, job_name="Old")
    new = create(a, job_name="New")
    assert look(a, exclude_id=new["id"]).json()["match"]["id"] == old["id"]


def test_exclude_id_alone_leaves_no_match(a):
    row = create(a)
    assert look(a, exclude_id=row["id"]).json() == {"match": None}


def test_exclude_id_null_is_the_same_as_omitted(a):
    row = create(a)
    assert look(a, exclude_id=None).json()["match"]["id"] == row["id"]


def test_exclude_id_of_another_users_row_changes_nothing(a, client):
    mine = create(a)
    as_user(client, "tok-b")
    theirs = create(client)
    as_user(client, "tok-a")
    assert look(client, exclude_id=theirs["id"]).json()["match"]["id"] == mine["id"]


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"url": ""},
        {"url": None},
        {"url": "   "},
        {"url": "ftp://example.com/a"},
        {"url": "https://example.com/" + "a" * 2000},
        {"url": "https://example.com/a\x00b"},
        {"url": "https://user:pw@example.com/a"},
        {"url": 5},
        {"url": POSTING, "extra": 1},
    ],
)
def test_bad_url_is_422(a, body):
    r = a.post(LOOKUP, json=body)
    assert r.status_code == 422
    loc = r.json()["detail"][0]["loc"]
    assert loc[-1] == ("extra" if "extra" in body else "url")


@pytest.mark.parametrize("bad", ["5", 5.5, 5.0, True, [], {}])
def test_bad_exclude_id_is_422(a, bad):
    r = look(a, exclude_id=bad)
    assert r.status_code == 422
    assert r.json()["detail"][0]["loc"][-1] == "exclude_id"


@pytest.mark.parametrize("raw", ['"https://example.com/jobs/1"', '["https://example.com/jobs/1"]', "not json"])
def test_non_object_body_is_422_without_the_url(a, raw):
    r = a.post(LOOKUP, content=raw, headers={"Content-Type": "application/json"})
    assert r.status_code == 422
    assert "example.com" not in r.text


def test_get_no_longer_looks_up(a):
    # GET /lookup falls through to GET /{application_id}, which rejects "lookup" as an id.
    r = a.get(LOOKUP, params={"url": POSTING})
    assert r.status_code == 422
    assert r.json()["detail"][0]["loc"] == ["path", "application_id"]
    assert "example.com" not in r.text


def test_route_is_not_shadowed_by_id(a):
    assert look(a).status_code == 200
    assert a.get(f"{URL}/abc").status_code == 422


def test_requires_login(client):
    assert look(client).status_code == 401


def test_no_store(a):
    assert look(a).headers["cache-control"] == "no-store"
    assert look(a, "ftp://x").headers["cache-control"] == "no-store"


def test_same_origin_browser_post_passes_the_origin_check(a):
    headers = {"Origin": "http://localhost:3000", "Sec-Fetch-Site": "same-origin"}
    assert a.post(LOOKUP, json={"url": POSTING}, headers=headers).status_code == 200


def test_cross_site_post_is_blocked(a):
    assert a.post(LOOKUP, json={"url": POSTING}, headers={"Sec-Fetch-Site": "cross-site"}).status_code == 403


def test_the_url_never_reaches_logs_or_error_bodies(a, caplog):
    secret = "https://secret-host.example/jobs/42?token=abc123"
    create(a, job_url=secret)
    caplog.clear()
    with caplog.at_level(logging.DEBUG):
        for name in ("", "uvicorn", "uvicorn.access", "uvicorn.error", "app", "fastapi", "starlette"):
            logging.getLogger(name).setLevel(logging.DEBUG)
        ok = look(a, secret)
        bad = a.post(LOOKUP, json={"url": secret + " bad", "exclude_id": "x"})
        bad2 = a.post(LOOKUP, json={"url": "ftp://secret-host.example/jobs/42?token=abc123"})
        bad3 = a.post(LOOKUP, content='"' + secret + '"', headers={"Content-Type": "application/json"})
    assert ok.status_code == 200 and ok.json()["match"]
    assert bad.status_code == bad2.status_code == bad3.status_code == 422
    for text in (bad.text, bad2.text, bad3.text, caplog.text):
        assert "secret-host" not in text and "abc123" not in text
