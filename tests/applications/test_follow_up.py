"""GET /applications?follow_up=true: applied rows gone quiet, oldest activity first."""

from datetime import date, datetime, timedelta, timezone

import pytest

from app.applications import router as app_router
from app.applications.models import ApplicationStatus, JobApplication
from app.applications.schemas import ApplicationRead
from tests.conftest import as_user

APPS = "/api/v1/applications"
NOW = datetime(2026, 11, 10, 12, 0, tzinfo=timezone.utc)  # 20:00 PHT on 2026-11-10
TODAY = date(2026, 11, 10)
READ_KEYS = set(ApplicationRead.model_fields)
FU_KEYS = READ_KEYS | {"idle_days", "last_activity"}


@pytest.fixture(autouse=True)
def fixed_now(monkeypatch):
    monkeypatch.setattr(app_router, "_now", lambda: NOW, raising=False)


def pin(monkeypatch, at):
    monkeypatch.setattr(app_router, "_now", lambda: at, raising=False)


def new_app(client, ago=10, status="applied", company="Acme"):
    body = {"company": company, "job_name": "Dev", "status": status, "mode_of_work": "remote"}
    if ago is not None:
        body["date_applied"] = (TODAY - timedelta(days=ago)).isoformat()
    r = client.post(APPS, json=body)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def new_iv(client, app_id, at):
    r = client.post(f"{APPS}/{app_id}/interviews", json={"scheduled_at": at.isoformat(), "mode": "online"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def fu(client, **params):
    r = client.get(APPS, params={"follow_up": "true", **params})
    assert r.status_code == 200, r.text
    return r.json()


def ids(body):
    return [i["id"] for i in body["items"]]


@pytest.fixture
def a(client, users):
    as_user(client, "tok-a")
    return users[0]


@pytest.mark.parametrize("st", [s.value for s in ApplicationStatus if s != ApplicationStatus.APPLIED])
def test_only_applied_qualifies(client, a, st):
    new_app(client, ago=30, status=st, company="Other")
    keep = new_app(client, ago=30)
    body = fu(client)
    assert ids(body) == [keep] and body["total"] == 1


def test_upcoming_interview_excludes(client, a):
    exact, later, future = new_app(client, 20), new_app(client, 20), new_app(client, 20)
    new_iv(client, exact, NOW)  # exactly now is still upcoming
    new_iv(client, later, NOW + timedelta(hours=3))  # later today
    new_iv(client, future, NOW + timedelta(days=5))
    body = fu(client)
    assert body["items"] == [] and body["total"] == 0


def test_past_interview_recent_excludes_old_includes(client, a):
    recent, old = new_app(client, 30, company="Recent"), new_app(client, 30, company="Old")
    new_iv(client, recent, NOW - timedelta(days=1))
    new_iv(client, old, NOW - timedelta(days=10))
    new_iv(client, old, NOW - timedelta(days=20))  # only the latest past interview counts
    body = fu(client)
    assert ids(body) == [old]
    assert body["items"][0]["idle_days"] == 10 and body["items"][0]["last_activity"] == "interview"


def test_applied_activity_and_idle_days(client, a):
    row = new_app(client, 12)
    item = fu(client)["items"][0]
    assert item["id"] == row and item["idle_days"] == 12 and item["last_activity"] == "applied"


def test_same_day_apply_and_interview_is_interview(client, a):
    row = new_app(client, 10)  # 2026-10-31
    new_iv(client, row, datetime(2026, 10, 31, 1, 0, tzinfo=timezone.utc))  # 09:00 PHT the same day
    item = fu(client)["items"][0]
    assert item["idle_days"] == 10 and item["last_activity"] == "interview"


def test_interview_older_than_apply_stays_applied(client, a):
    row = new_app(client, 10)
    new_iv(client, row, NOW - timedelta(days=15))
    item = fu(client)["items"][0]
    assert item["id"] == row and item["idle_days"] == 10 and item["last_activity"] == "applied"


def _raw(db, user, created_at, date_applied=None, status=ApplicationStatus.APPLIED):
    row = JobApplication(
        company="Raw", job_name="Dev", status=status, mode_of_work="remote",
        date_applied=date_applied, created_at=created_at, created_by=user.id,
    )
    db.add(row)
    db.commit()
    return row.id


def test_null_date_falls_back_to_pht_day_of_created_at(client, a, db):
    # 16:30Z on Nov 2 is 00:30 PHT on Nov 3: idle 7 at today = Nov 10
    in_ = _raw(db, a, datetime(2026, 11, 2, 16, 30, tzinfo=timezone.utc))
    # 16:30Z on Nov 3 is Nov 4 PHT: idle 6, out
    _raw(db, a, datetime(2026, 11, 3, 16, 30, tzinfo=timezone.utc))
    body = fu(client)
    assert ids(body) == [in_] and body["total"] == 1
    assert body["items"][0]["idle_days"] == 7 and body["items"][0]["last_activity"] == "applied"


def test_future_date_applied_excluded(client, a, db):
    _raw(db, a, NOW - timedelta(days=30), date_applied=TODAY + timedelta(days=5))
    body = fu(client)
    assert body["items"] == [] and body["total"] == 0


def test_day_boundary_flips_at_pht_midnight(client, a, monkeypatch):
    seven, six = new_app(client, 7, company="Seven"), new_app(client, 6, company="Six")  # Nov 3, Nov 4
    pin(monkeypatch, datetime(2026, 11, 10, 15, 59, 59, tzinfo=timezone.utc))  # 23:59:59 PHT
    assert ids(fu(client)) == [seven]
    pin(monkeypatch, datetime(2026, 11, 10, 16, 0, 0, tzinfo=timezone.utc))  # 00:00 PHT, Nov 11
    body = fu(client)
    assert ids(body) == [seven, six]
    assert [i["idle_days"] for i in body["items"]] == [8, 7]


def test_days_param(client, a):
    old, mid = new_app(client, 30, company="Old"), new_app(client, 10, company="Mid")
    assert ids(fu(client, days=1)) == [old, mid]
    assert ids(fu(client, days=11)) == [old]
    assert ids(fu(client, days=30)) == [old]
    assert ids(fu(client, days=90)) == []


@pytest.mark.parametrize("days", ["0", "91", "-1", "abc", "7.5", ""])
def test_days_out_of_range_is_422(client, a, days):
    new_app(client, 100)
    r = client.get(APPS, params={"follow_up": "true", "days": days})
    assert r.status_code == 422
    assert r.json()["detail"][0]["loc"][-1] == "days"


def test_days_without_follow_up_is_422(client, a):
    for params in ({"days": 7}, {"days": 7, "follow_up": "false"}):
        r = client.get(APPS, params=params)
        assert r.status_code == 422
        assert r.json()["detail"][0]["loc"] == ["query", "days"]


def test_follow_up_with_status_is_422(client, a):
    r = client.get(APPS, params={"follow_up": "true", "status": "applied"})
    assert r.status_code == 422
    assert r.json()["detail"][0]["loc"] == ["query", "status"]


def test_follow_up_false_matches_plain_list_and_keys(client, a):
    for ago in (30, 3, 12):
        new_app(client, ago)
    new_app(client, 5, status="saved")
    plain = client.get(APPS)
    off = client.get(APPS, params={"follow_up": "false"})
    assert plain.status_code == off.status_code == 200
    assert off.json() == plain.json()
    assert len(plain.json()["items"]) == 4
    for resp in (plain, off):
        assert set(resp.json()) == {"items", "total", "limit", "offset"}
        for item in resp.json()["items"]:
            assert set(item) == READ_KEYS  # no idle_days, no last_activity


def test_follow_up_items_have_exact_keys(client, a):
    new_app(client, 30)
    new_app(client, 12)
    body = fu(client)
    assert set(body) == {"items", "total", "limit", "offset"}
    assert len(body["items"]) == 2
    for item in body["items"]:
        assert set(item) == FU_KEYS
        assert isinstance(item["idle_days"], int)


def test_other_users_rows_never_appear(client, users):
    as_user(client, "tok-b")
    new_app(client, 30, company="Theirs")
    as_user(client, "tok-a")
    mine = new_app(client, 20, company="Mine")
    body = fu(client)
    assert ids(body) == [mine] and body["total"] == 1
    as_user(client, "tok-b")
    assert fu(client)["total"] == 1


def test_order_by_last_activity_then_id(client, a):
    young = new_app(client, 8, company="Young")
    old1 = new_app(client, 20, company="Old1")
    old2 = new_app(client, 20, company="Old2")
    mid = new_app(client, 30, company="Mid")
    new_iv(client, mid, NOW - timedelta(days=12))  # last activity 12 days ago
    assert ids(fu(client)) == [old1, old2, mid, young]


def test_paging_is_contiguous_with_stable_total(client, a):
    made = [new_app(client, 10 + i, company=f"C{i}") for i in range(5)]
    expected = list(reversed(made))  # oldest activity first
    seen = []
    for offset in (0, 2, 4):
        body = fu(client, limit=2, offset=offset)
        assert body["total"] == 5 and body["limit"] == 2 and body["offset"] == offset
        seen += ids(body)
    assert seen == expected
    assert fu(client, limit=2, offset=6)["items"] == []


def test_patch_remarks_keeps_row_and_idle_days(client, a):
    row = new_app(client, 12)
    before = fu(client)["items"][0]
    r = client.patch(f"{APPS}/{row}", json={"remarks": "typo fix"})
    assert r.status_code == 200
    after = fu(client)["items"][0]
    assert after["id"] == row and after["idle_days"] == before["idle_days"] == 12
    assert after["updated_at"] != before["updated_at"]
