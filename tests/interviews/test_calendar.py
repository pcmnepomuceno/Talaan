"""GET /interviews/calendar?from=&to=: the caller's interviews in a PHT date range."""

from datetime import date, datetime, timedelta, timezone

import pytest

from tests.conftest import as_user

APPS = "/api/v1/applications"
CAL = "/api/v1/interviews/calendar"
PHT = timezone(timedelta(hours=8))


def new_app(client, company="Acme", job="Dev"):
    r = client.post(APPS, json={"company": company, "job_name": job, "status": "applied", "mode_of_work": "remote"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def new_iv(client, app_id, at, **over):
    body = {"scheduled_at": at.isoformat(), "mode": "online", **over}
    r = client.post(f"{APPS}/{app_id}/interviews", json=body)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def pht(y, m, d, hh=0, mm=0, ss=0):
    return datetime(y, m, d, hh, mm, ss, tzinfo=PHT)


def get(client, frm, to, **extra):
    return client.get(CAL, params={"from": frm, "to": to, **extra})


def ids(r):
    assert r.status_code == 200, r.text
    return [i["id"] for i in r.json()["items"]]


def test_late_evening_and_after_midnight_pht_are_on_different_days(client, users):
    as_user(client, "tok-a")
    app = new_app(client)
    late = new_iv(client, app, pht(2026, 11, 10, 23, 30))  # 15:30 UTC on the 10th
    early = new_iv(client, app, pht(2026, 11, 11, 0, 30))  # 16:30 UTC on the 10th: same UTC day
    assert ids(get(client, "2026-11-10", "2026-11-10")) == [late]
    assert ids(get(client, "2026-11-11", "2026-11-11")) == [early]


def test_from_and_to_are_inclusive_whole_days(client, users):
    as_user(client, "tok-a")
    app = new_app(client)
    new_iv(client, app, pht(2026, 11, 9, 23, 59, 59))  # the second before `from`
    first = new_iv(client, app, pht(2026, 11, 10, 0, 0))  # exactly 00:00 PHT of `from`
    last = new_iv(client, app, pht(2026, 11, 12, 23, 59, 59))  # last second of `to`
    new_iv(client, app, pht(2026, 11, 13, 0, 0))  # exactly 00:00 PHT after `to`
    r = get(client, "2026-11-10", "2026-11-12")
    assert ids(r) == [first, last] and r.json()["total"] == 2


def test_from_equal_to_is_one_day(client, users):
    as_user(client, "tok-a")
    only = new_iv(client, new_app(client), pht(2026, 11, 10, 9))
    assert ids(get(client, "2026-11-10", "2026-11-10")) == [only]


def test_order_is_time_then_id(client, users):
    as_user(client, "tok-a")
    app = new_app(client)
    late = new_iv(client, app, pht(2026, 11, 10, 15))
    at = pht(2026, 11, 10, 9)
    t1, t2 = new_iv(client, app, at), new_iv(client, app, at)  # same minute: id breaks the tie
    early = new_iv(client, app, pht(2026, 11, 9, 8))
    assert ids(get(client, "2026-11-09", "2026-11-10")) == [early, t1, t2, late]


def test_items_embed_application_fields_and_echo_range(client, users):
    as_user(client, "tok-a")
    app = new_app(client, company="Pinagsama Tech", job="Frontend Engineer")
    new_iv(client, app, pht(2026, 11, 10, 14), interviewer="Ana Santos", mode="on_site")
    body = get(client, "2026-11-01", "2026-11-30").json()
    item = body["items"][0]
    assert item["company"] == "Pinagsama Tech" and item["job_name"] == "Frontend Engineer"
    assert item["job_application_id"] == app and item["interviewer"] == "Ana Santos"
    assert item["mode"] == "on_site" and item["outcome"] == "pending"
    assert {"id", "scheduled_at", "remarks", "created_at", "updated_at"} <= item.keys()
    assert body["from"] == "2026-11-01" and body["to"] == "2026-11-30"


def test_empty_range(client, users):
    as_user(client, "tok-a")
    r = get(client, "2026-11-01", "2026-11-30")
    assert r.status_code == 200
    assert r.json() == {"items": [], "total": 0, "truncated": False, "from": "2026-11-01", "to": "2026-11-30"}


def bulk(client, n):
    app = new_app(client)
    return [new_iv(client, app, pht(2026, 11, 10, 9) + timedelta(minutes=k)) for k in range(n)]


def test_cap_200_is_not_truncated(client, users):
    as_user(client, "tok-a")
    made = bulk(client, 200)
    body = get(client, "2026-11-10", "2026-11-10").json()
    assert [i["id"] for i in body["items"]] == made and body["total"] == 200 and body["truncated"] is False


def test_201_rows_are_truncated_to_the_first_200(client, users):
    as_user(client, "tok-a")
    made = bulk(client, 201)
    body = get(client, "2026-11-10", "2026-11-10").json()
    assert [i["id"] for i in body["items"]] == made[:200]
    assert body["total"] == 201 and body["truncated"] is True


def test_span_limit_62_days_inclusive(client, users):
    as_user(client, "tok-a")
    start = date(2026, 11, 1)
    assert get(client, "2026-11-01", (start + timedelta(days=61)).isoformat()).status_code == 200  # 62 days
    assert get(client, "2026-11-01", (start + timedelta(days=62)).isoformat()).status_code == 422  # 63 days


def test_from_after_to_is_422(client, users):
    as_user(client, "tok-a")
    assert get(client, "2026-11-11", "2026-11-10").status_code == 422


@pytest.mark.parametrize(
    "bad",
    ["2026-13-01", "2026-02-30", "20261101", "2026-1-1", "abc", "", " 2026-11-01", "2026-11-01T00:00", "1899-12-31", "2201-01-01", "０２６-11-01"],
)
@pytest.mark.parametrize("which", ["from", "to"])
def test_bad_dates_are_422(client, users, which, bad):
    as_user(client, "tok-a")
    params = {"from": "2026-11-01", "to": "2026-11-02", which: bad}
    assert client.get(CAL, params=params).status_code == 422


def test_year_limits_are_accepted(client, users):
    as_user(client, "tok-a")
    assert get(client, "1900-01-01", "1900-01-31").status_code == 200
    assert get(client, "2200-12-01", "2200-12-31").status_code == 200


@pytest.mark.parametrize("extra", [{"when": "upcoming"}, {"limit": 10}, {"offset": 0}, {"as_of": "2026-11-10T12:00:00Z"}])
def test_mixing_with_agenda_params_is_422(client, users, extra):
    as_user(client, "tok-a")
    assert get(client, "2026-11-01", "2026-11-30", **extra).status_code == 422


@pytest.mark.parametrize("params", [{}, {"from": "2026-11-01"}, {"to": "2026-11-30"}])
def test_neither_or_one_bound_is_422(client, users, params):
    as_user(client, "tok-a")
    assert client.get(CAL, params=params).status_code == 422


def test_isolation_between_users(client, users):
    as_user(client, "tok-a")
    mine = new_iv(client, new_app(client, "Mine"), pht(2026, 11, 10, 9))
    as_user(client, "tok-b")
    theirs = new_iv(client, new_app(client, "Theirs"), pht(2026, 11, 10, 10))
    r = get(client, "2026-11-01", "2026-11-30")
    assert ids(r) == [theirs] and r.json()["total"] == 1
    as_user(client, "tok-a")
    r = get(client, "2026-11-01", "2026-11-30")
    assert ids(r) == [mine] and r.json()["total"] == 1


def test_unauthenticated_is_401(client):
    assert get(client, "2026-11-01", "2026-11-30").status_code == 401


def test_calendar_path_is_not_taken_by_the_interview_id_route(client, users):
    as_user(client, "tok-a")
    assert client.get(CAL).status_code == 422  # our validation, not "calendar is not an int"
    detail = client.get(CAL).json()["detail"]
    assert all("interview_id" not in e["loc"] for e in detail)
