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


def test_match_after_create(a):
    row = create(a)
    r = a.get(LOOKUP, params={"url": POSTING})
    assert r.status_code == 200
    assert r.json() == {"match": {"id": row["id"], "job_name": "Dev", "company": "Acme"}}


def test_match_ignores_tracking_and_fragment(a):
    row = create(a)
    r = a.get(LOOKUP, params={"url": "https://EXAMPLE.com/jobs/1/?utm_source=x#top"})
    assert r.json()["match"]["id"] == row["id"]


def test_no_match_for_other_job(a):
    create(a)
    assert a.get(LOOKUP, params={"url": "https://example.com/jobs/2"}).json() == {"match": None}


def test_null_when_none_saved(a):
    assert a.get(LOOKUP, params={"url": POSTING}).json() == {"match": None}


def test_other_user_never_matches(a, client):
    create(a)
    as_user(client, "tok-b")
    assert client.get(LOOKUP, params={"url": POSTING}).json() == {"match": None}


@pytest.mark.parametrize(
    "params", [{}, {"url": ""}, {"url": "   "}, {"url": "ftp://example.com/a"}, {"url": "https://example.com/" + "a" * 2000}]
)
def test_bad_url_is_422(a, params):
    r = a.get(LOOKUP, params=params)
    assert r.status_code == 422
    assert r.json()["detail"][0]["loc"][-1] == "url"


def test_route_is_not_shadowed_by_id(a):
    assert a.get(LOOKUP, params={"url": POSTING}).status_code == 200
    assert a.get(f"{URL}/abc").status_code == 422


def test_requires_login(client):
    assert client.get(LOOKUP, params={"url": POSTING}).status_code == 401


def test_no_store(a):
    assert a.get(LOOKUP, params={"url": POSTING}).headers["cache-control"] == "no-store"


def test_newest_wins(a):
    create(a, job_name="Old")
    new = create(a, job_name="New", job_url=POSTING + "?utm_source=y")
    assert a.get(LOOKUP, params={"url": POSTING}).json()["match"]["id"] == new["id"]
