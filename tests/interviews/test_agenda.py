"""GET /interviews?when=upcoming|past: the caller's interviews across all applications."""

from datetime import datetime, timedelta, timezone

import pytest

from app.interviews import router as iv_router
from tests.conftest import as_user

APPS = "/api/v1/applications"
AGENDA = "/api/v1/interviews"
NOW = datetime(2026, 11, 10, 12, 0, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def fixed_now(monkeypatch):
    monkeypatch.setattr(iv_router, "_now", lambda: NOW, raising=False)


def new_app(client, company="Acme", job="Dev"):
    r = client.post(APPS, json={"company": company, "job_name": job, "status": "applied", "mode_of_work": "remote"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def new_iv(client, app_id, at, **over):
    body = {"scheduled_at": at.isoformat(), "mode": "online", **over}
    r = client.post(f"{APPS}/{app_id}/interviews", json=body)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def ids(r):
    assert r.status_code == 200, r.text
    return [i["id"] for i in r.json()["items"]]


def test_upcoming_ascending_past_descending(client, users):
    as_user(client, "tok-a")
    app = new_app(client)
    far = new_iv(client, app, NOW + timedelta(days=5))
    near = new_iv(client, app, NOW + timedelta(days=1))
    old = new_iv(client, app, NOW - timedelta(days=5))
    recent = new_iv(client, app, NOW - timedelta(days=1))
    assert ids(client.get(AGENDA, params={"when": "upcoming"})) == [near, far]
    assert ids(client.get(AGENDA, params={"when": "past"})) == [recent, old]


def test_boundary_exactly_now_is_upcoming(client, users):
    as_user(client, "tok-a")
    app = new_app(client)
    before = new_iv(client, app, NOW - timedelta(seconds=1))
    at = new_iv(client, app, NOW)
    after = new_iv(client, app, NOW + timedelta(seconds=1))
    assert ids(client.get(AGENDA, params={"when": "upcoming"})) == [at, after]
    assert ids(client.get(AGENDA, params={"when": "past"})) == [before]


def test_same_minute_tie_break_by_id(client, users):
    as_user(client, "tok-a")
    app = new_app(client)
    at = NOW + timedelta(days=1)
    first, second = new_iv(client, app, at), new_iv(client, app, at)
    assert ids(client.get(AGENDA, params={"when": "upcoming"})) == [first, second]
    past = NOW - timedelta(days=1)
    p1, p2 = new_iv(client, app, past), new_iv(client, app, past)
    assert ids(client.get(AGENDA, params={"when": "past"})) == [p2, p1]


def test_paging_and_total_are_stable(client, users):
    as_user(client, "tok-a")
    app = new_app(client)
    at = NOW + timedelta(days=1)
    made = [new_iv(client, app, at) for _ in range(5)]  # all tied: only the id tie-break orders them
    seen = []
    for offset in (0, 2, 4):
        r = client.get(AGENDA, params={"when": "upcoming", "limit": 2, "offset": offset})
        assert r.json()["total"] == 5 and r.json()["limit"] == 2 and r.json()["offset"] == offset
        seen += ids(r)
    assert seen == made
    assert ids(client.get(AGENDA, params={"when": "upcoming", "limit": 2, "offset": 6})) == []


def test_items_embed_application_and_interview_fields(client, users):
    as_user(client, "tok-a")
    app = new_app(client, company="Pinagsama Tech", job="Frontend Engineer")
    new_iv(client, app, NOW + timedelta(days=1), interviewer="Ana Santos", mode="on_site")
    item = client.get(AGENDA, params={"when": "upcoming"}).json()["items"][0]
    assert item["company"] == "Pinagsama Tech" and item["job_name"] == "Frontend Engineer"
    assert item["job_application_id"] == app and item["interviewer"] == "Ana Santos"
    assert item["mode"] == "on_site" and item["outcome"] == "pending"
    assert {"id", "scheduled_at", "remarks", "created_at", "updated_at"} <= item.keys()


def test_spans_all_applications(client, users):
    as_user(client, "tok-a")
    a1, a2 = new_app(client, "One"), new_app(client, "Two")
    i1 = new_iv(client, a1, NOW + timedelta(days=2))
    i2 = new_iv(client, a2, NOW + timedelta(days=1))
    assert ids(client.get(AGENDA, params={"when": "upcoming"})) == [i2, i1]


def test_isolation_between_users(client, users):
    as_user(client, "tok-a")
    mine = new_iv(client, new_app(client, "Mine"), NOW + timedelta(days=1))
    new_iv(client, new_app(client, "Mine"), NOW - timedelta(days=1))
    as_user(client, "tok-b")
    theirs = new_iv(client, new_app(client, "Theirs"), NOW + timedelta(days=1))
    r = client.get(AGENDA, params={"when": "upcoming"})
    assert ids(r) == [theirs] and r.json()["total"] == 1
    assert client.get(AGENDA, params={"when": "past"}).json()["total"] == 0
    assert ids(client.get(AGENDA, params={"when": "upcoming", "limit": 1, "offset": 1})) == []
    as_user(client, "tok-a")
    r = client.get(AGENDA, params={"when": "upcoming"})
    assert ids(r) == [mine] and r.json()["total"] == 1


def test_user_with_no_interviews(client, users):
    as_user(client, "tok-a")
    r = client.get(AGENDA, params={"when": "upcoming"})
    assert r.status_code == 200 and r.json() == {"items": [], "total": 0, "limit": 20, "offset": 0, "as_of": "2026-11-10T12:00:00Z"}


def test_unauthenticated_is_401(client):
    assert client.get(AGENDA, params={"when": "upcoming"}).status_code == 401


@pytest.mark.parametrize(
    "params",
    [
        {},
        {"when": "soon"},
        {"when": ""},
        {"when": "upcoming", "limit": 0},
        {"when": "upcoming", "limit": 101},
        {"when": "upcoming", "offset": -1},
        {"when": "upcoming", "offset": 2_147_483_648},
    ],
)
def test_bad_params_are_422(client, users, params):
    as_user(client, "tok-a")
    assert client.get(AGENDA, params=params).status_code == 422


def page(client, when, offset, limit=50, as_of=None):
    params = {"when": when, "limit": limit, "offset": offset}
    if as_of is not None:
        params["as_of"] = as_of
    r = client.get(AGENDA, params=params)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.mark.parametrize("when", ["upcoming", "past"])
def test_as_of_keeps_pages_contiguous_when_the_clock_moves(client, users, monkeypatch, when):
    """Finding 1 (review round 1): offset paging over a moving `now` skipped (upcoming) or
    repeated (past) rows. Page 2 sent with page 1's `as_of` sees the same set."""
    as_user(client, "tok-a")
    app = new_app(client)
    sign = 1 if when == "upcoming" else -1
    # 60 rows a minute apart on the tested side of NOW, plus 2 upcoming rows at NOW + 1 and + 2 min
    # for past. The clock then moves 2.5 min: without as_of, upcoming page 2 skips 2 rows and past
    # page 2 repeats 2 (the 2 upcoming rows join the head of past and shift it).
    made = [new_iv(client, app, NOW + timedelta(minutes=sign * (k + 1))) for k in range(60)]
    if when == "past":
        new_iv(client, app, NOW + timedelta(minutes=1))
        new_iv(client, app, NOW + timedelta(minutes=2))
    first = page(client, when, 0)
    assert first["total"] == 60 and first["as_of"] is not None
    monkeypatch.setattr(iv_router, "_now", lambda: NOW + timedelta(minutes=2, seconds=30), raising=False)
    second = page(client, when, 50, as_of=first["as_of"])
    seen = [i["id"] for i in first["items"]] + [i["id"] for i in second["items"]]
    assert seen == made and second["total"] == 60 and second["as_of"] == first["as_of"]


def test_without_as_of_the_server_clock_is_used(client, users):
    as_user(client, "tok-a")
    r = page(client, "upcoming", 0)
    assert datetime.fromisoformat(r["as_of"]) == NOW


def test_as_of_boundary_exactly_at_is_upcoming(client, users):
    as_user(client, "tok-a")
    app = new_app(client)
    t = NOW + timedelta(days=3)
    before = new_iv(client, app, t - timedelta(seconds=1))
    at = new_iv(client, app, t)
    assert ids(client.get(AGENDA, params={"when": "upcoming", "as_of": t.isoformat()})) == [at]
    assert ids(client.get(AGENDA, params={"when": "past", "as_of": t.isoformat()}))[0] == before


def test_as_of_z_and_plus_offset_survive_the_query_string(client, users):
    """`+` in a query string decodes to a space; the offset must arrive percent-encoded."""
    as_user(client, "tok-a")
    app = new_app(client)
    new_iv(client, app, NOW + timedelta(hours=1))
    want = new_iv(client, app, NOW + timedelta(hours=3))
    # Same instant two ways: NOW + 2 h in UTC (Z) and in +08:00.
    z = "2026-11-10T14:00:00Z"
    plus = "2026-11-10T22:00:00+08:00"
    r_z = client.get(f"{AGENDA}?when=upcoming&as_of={z}")
    r_plus = client.get(f"{AGENDA}?when=upcoming&as_of=2026-11-10T22%3A00%3A00%2B08%3A00")
    assert ids(r_z) == [want] and ids(r_plus) == [want]
    assert datetime.fromisoformat(r_z.json()["as_of"]) == datetime.fromisoformat(plus)
    # Unencoded `+` arrives as a space: not a valid offset, never silently misread.
    assert client.get(f"{AGENDA}?when=upcoming&as_of={plus}").status_code == 422


@pytest.mark.parametrize("bad", ["2026-11-10T12:00:00", "yesterday", "", "2026-13-01T00:00:00Z"])
def test_bad_as_of_is_422(client, users, bad):
    as_user(client, "tok-a")
    assert client.get(AGENDA, params={"when": "upcoming", "as_of": bad}).status_code == 422


def test_as_of_keeps_isolation(client, users):
    as_user(client, "tok-a")
    new_iv(client, new_app(client, "Mine"), NOW + timedelta(days=1))
    as_user(client, "tok-b")
    theirs = new_iv(client, new_app(client, "Theirs"), NOW + timedelta(days=1))
    r = client.get(AGENDA, params={"when": "upcoming", "as_of": NOW.isoformat()})
    assert ids(r) == [theirs] and r.json()["total"] == 1
    assert client.get(AGENDA, params={"when": "past", "as_of": (NOW + timedelta(days=9)).isoformat()}).json()["total"] == 1
