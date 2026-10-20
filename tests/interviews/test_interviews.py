from datetime import datetime

import pytest
from sqlalchemy import event, text

from app.database import engine
from tests.conftest import as_user

APPS = "/api/v1/applications"
IV = "/api/v1/interviews"
APP_BODY = {"company": "Acme", "job_name": "Dev", "status": "applied", "mode_of_work": "remote"}
BODY = {"scheduled_at": "2026-11-03T14:00:00+08:00", "mode": "online"}


@pytest.fixture
def a(client, users):
    as_user(client, "tok-a")
    return client


def new_app(client):
    r = client.post(APPS, json=APP_BODY)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def new_iv(client, app_id, **over):
    r = client.post(f"{APPS}/{app_id}/interviews", json={**BODY, **over})
    assert r.status_code == 201, r.text
    return r.json()


def same_instant(x, y):
    return datetime.fromisoformat(x) == datetime.fromisoformat(y)


def test_end_to_end_scenario(client, users):
    as_user(client, "tok-a")
    app_id = new_app(client)
    iv = new_iv(client, app_id)
    assert iv["outcome"] == "pending" and iv["job_application_id"] == app_id
    assert iv["scheduled_at"].endswith(("Z", "+00:00", "+08:00"))
    assert same_instant(iv["scheduled_at"], BODY["scheduled_at"])
    as_user(client, "tok-b")
    assert client.get(f"{IV}/{iv['id']}").status_code == 404
    assert client.post(f"{APPS}/{app_id}/interviews", json=BODY).status_code == 404
    as_user(client, "tok-a")
    page = client.get(f"{APPS}/{app_id}/interviews").json()
    assert page["total"] == 1 and page["items"][0]["id"] == iv["id"]


# --- create ---

def test_create_naive_datetime_422(a):
    r = a.post(f"{APPS}/{new_app(a)}/interviews", json={**BODY, "scheduled_at": "2026-11-03T14:00:00"})
    assert r.status_code == 422


def test_create_other_offset_same_instant(a):
    iv = new_iv(a, new_app(a), scheduled_at="2026-11-03T09:00:00-05:00")
    assert same_instant(iv["scheduled_at"], "2026-11-03T14:00:00+00:00")
    got = a.get(f"{IV}/{iv['id']}").json()
    assert got["scheduled_at"] == iv["scheduled_at"]


@pytest.mark.parametrize("ts", [
    "0001-01-01T00:00:00+08:00", "9999-12-31T23:59:59-08:00", "1899-12-31T00:00:00+00:00",
])
def test_create_out_of_range_year_422(a, ts):
    r = a.post(f"{APPS}/{new_app(a)}/interviews", json={**BODY, "scheduled_at": ts})
    assert r.status_code == 422


def test_patch_out_of_range_year_422(a):
    iv = new_iv(a, new_app(a))
    r = a.patch(f"{IV}/{iv['id']}", json={"scheduled_at": "0001-01-01T00:00:00+08:00"})
    assert r.status_code == 422


def test_create_past_date_ok(a):
    new_iv(a, new_app(a), scheduled_at="2001-01-01T00:00:00+00:00")


@pytest.mark.parametrize("over", [{"mode": "bogus"}, {"outcome": "bogus"}, {"mode": None}, {"scheduled_at": None}])
def test_create_invalid_422(a, over):
    r = a.post(f"{APPS}/{new_app(a)}/interviews", json={**BODY, **over})
    assert r.status_code == 422


def test_create_interviewer_trimmed(a):
    assert new_iv(a, new_app(a), interviewer="  Jane  ")["interviewer"] == "Jane"


@pytest.mark.parametrize("val", ["   ", "", "x" * 201])
def test_create_interviewer_bad_422(a, val):
    r = a.post(f"{APPS}/{new_app(a)}/interviews", json={**BODY, "interviewer": val})
    assert r.status_code == 422


def test_create_interviewer_and_remarks_null_ok(a):
    iv = new_iv(a, new_app(a), interviewer=None, remarks=None)
    assert iv["interviewer"] is None and iv["remarks"] is None


def test_create_remarks_limits(a):
    app_id = new_app(a)
    new_iv(a, app_id, remarks="x" * 5000)
    r = a.post(f"{APPS}/{app_id}/interviews", json={**BODY, "remarks": "x" * 5001})
    assert r.status_code == 422


def test_create_same_time_allowed(a):
    app_id = new_app(a)
    assert new_iv(a, app_id)["id"] != new_iv(a, app_id)["id"]


@pytest.mark.parametrize("extra", [
    {"job_application_id": 1}, {"id": 1}, {"created_at": "2026-01-01T00:00:00Z"},
    {"updated_at": "2026-01-01T00:00:00Z"},
])
def test_create_forbids_server_fields(a, extra):
    r = a.post(f"{APPS}/{new_app(a)}/interviews", json={**BODY, **extra})
    assert r.status_code == 422


# --- ownership ---

def test_other_users_application_404_on_create_and_list(client, users):
    as_user(client, "tok-a")
    app_id = new_app(client)
    new_iv(client, app_id)
    as_user(client, "tok-b")
    assert client.post(f"{APPS}/{app_id}/interviews", json=BODY).status_code == 404
    assert client.get(f"{APPS}/{app_id}/interviews").status_code == 404


def test_other_users_interview_404_and_untouched(client, users, db):
    as_user(client, "tok-a")
    iv = new_iv(client, new_app(client), interviewer="Jane")
    as_user(client, "tok-b")
    url = f"{IV}/{iv['id']}"
    assert client.get(url).status_code == 404
    assert client.patch(url, json={"outcome": "bad", "interviewer": "Evil"}).status_code == 404
    assert client.delete(url).status_code == 404
    row = db.execute(
        text("SELECT interviewer, outcome FROM interviews WHERE id = :i"), {"i": iv["id"]}
    ).one()
    assert tuple(row) == ("Jane", "pending")
    as_user(client, "tok-a")
    assert client.get(url).json()["interviewer"] == "Jane"


def test_missing_application_404(a):
    assert a.post(f"{APPS}/99999/interviews", json=BODY).status_code == 404
    assert a.get(f"{APPS}/99999/interviews").status_code == 404


def test_missing_interview_404(a):
    for call in (a.get, a.delete):
        assert call(f"{IV}/99999").status_code == 404
    assert a.patch(f"{IV}/99999", json={}).status_code == 404


def test_non_integer_ids_422(a):
    assert a.get(f"{IV}/abc").status_code == 422
    assert a.get(f"{APPS}/abc/interviews").status_code == 422
    assert a.post(f"{APPS}/abc/interviews", json=BODY).status_code == 422


def test_huge_ids_404(a):
    assert a.get(f"{IV}/99999999999").status_code == 404
    assert a.patch(f"{IV}/99999999999", json={}).status_code == 404
    assert a.delete(f"{IV}/99999999999").status_code == 404
    assert a.get(f"{APPS}/99999999999/interviews").status_code == 404
    assert a.post(f"{APPS}/99999999999/interviews", json=BODY).status_code == 404


# --- patch ---

def test_patch_empty_body_no_change(a):
    iv = new_iv(a, new_app(a), interviewer="Jane", remarks="r")
    r = a.patch(f"{IV}/{iv['id']}", json={})
    assert r.status_code == 200 and r.json() == iv


@pytest.mark.parametrize("field", ["scheduled_at", "mode", "outcome"])
def test_patch_null_on_required_422(a, field):
    iv = new_iv(a, new_app(a))
    assert a.patch(f"{IV}/{iv['id']}", json={field: None}).status_code == 422
    assert a.get(f"{IV}/{iv['id']}").json() == iv


def test_patch_null_clears_interviewer_and_remarks(a):
    iv = new_iv(a, new_app(a), interviewer="Jane", remarks="r")
    r = a.patch(f"{IV}/{iv['id']}", json={"interviewer": None, "remarks": None})
    assert r.status_code == 200
    assert r.json()["interviewer"] is None and r.json()["remarks"] is None


@pytest.mark.parametrize("extra", [
    {"job_application_id": 1}, {"id": 1}, {"created_at": "2026-01-01T00:00:00Z"},
    {"updated_at": "2026-01-01T00:00:00Z"},
])
def test_patch_forbids_server_fields(a, extra):
    iv = new_iv(a, new_app(a))
    assert a.patch(f"{IV}/{iv['id']}", json=extra).status_code == 422


def test_patch_cannot_move_to_other_application(a):
    app1, app2 = new_app(a), new_app(a)
    iv = new_iv(a, app1)
    assert a.patch(f"{IV}/{iv['id']}", json={"job_application_id": app2}).status_code == 422
    assert a.get(f"{IV}/{iv['id']}").json()["job_application_id"] == app1


def test_patch_outcome_transitions(a):
    iv = new_iv(a, new_app(a))
    for outcome in ("good", "bad", "pending"):
        r = a.patch(f"{IV}/{iv['id']}", json={"outcome": outcome})
        assert r.status_code == 200 and r.json()["outcome"] == outcome


def test_patch_naive_datetime_422(a):
    iv = new_iv(a, new_app(a))
    assert a.patch(f"{IV}/{iv['id']}", json={"scheduled_at": "2026-11-03T14:00:00"}).status_code == 422


def test_patch_bumps_updated_at(a):
    iv = new_iv(a, new_app(a))
    r = a.patch(f"{IV}/{iv['id']}", json={"outcome": "good"}).json()
    assert datetime.fromisoformat(r["updated_at"]) > datetime.fromisoformat(iv["updated_at"])
    assert r["created_at"] == iv["created_at"]


# --- list ---

@pytest.mark.parametrize("params", [{"limit": 0}, {"limit": 101}, {"offset": -1}])
def test_list_bad_params(a, params):
    assert a.get(f"{APPS}/{new_app(a)}/interviews", params=params).status_code == 422


def test_list_offset_beyond_total(a):
    app_id = new_app(a)
    new_iv(a, app_id)
    page = a.get(f"{APPS}/{app_id}/interviews", params={"offset": 50}).json()
    assert page["items"] == [] and page["total"] == 1 and page["offset"] == 50


def test_list_pagination(a):
    app_id = new_app(a)
    ids = [new_iv(a, app_id, scheduled_at=f"2026-11-0{d}T10:00:00+00:00")["id"] for d in (1, 2, 3)]
    page = a.get(f"{APPS}/{app_id}/interviews", params={"limit": 2, "offset": 1}).json()
    assert [i["id"] for i in page["items"]] == ids[1:] and page["total"] == 3 and page["limit"] == 2


def test_list_order_scheduled_asc_then_id(a):
    app_id = new_app(a)
    late = new_iv(a, app_id, scheduled_at="2026-12-01T10:00:00+00:00")["id"]
    t1 = new_iv(a, app_id, scheduled_at="2026-11-01T10:00:00+00:00")["id"]
    t2 = new_iv(a, app_id, scheduled_at="2026-11-01T18:00:00+08:00")["id"]  # same instant as t1
    ids = [i["id"] for i in a.get(f"{APPS}/{app_id}/interviews").json()["items"]]
    assert ids == [t1, t2, late]


def test_list_only_this_application(a):
    app1, app2 = new_app(a), new_app(a)
    new_iv(a, app1)
    new_iv(a, app2)
    new_iv(a, app2)
    assert a.get(f"{APPS}/{app1}/interviews").json()["total"] == 1
    assert a.get(f"{APPS}/{app2}/interviews").json()["total"] == 2


def test_list_has_no_n_plus_one(a):
    app_id = new_app(a)
    count = []

    def _count(*_):
        count.append(1)

    event.listen(engine, "before_cursor_execute", _count)
    try:
        new_iv(a, app_id)
        count.clear()
        a.get(f"{APPS}/{app_id}/interviews")
        one = len(count)
        for _ in range(4):
            new_iv(a, app_id)
        count.clear()
        a.get(f"{APPS}/{app_id}/interviews")
        five = len(count)
    finally:
        event.remove(engine, "before_cursor_execute", _count)
    assert one == five >= 4  # auth 2 + owned application 1 + count 1 + page 1


# --- delete and cascade ---

def test_delete_one_leaves_others(a, db):
    app_id = new_app(a)
    keep, gone = new_iv(a, app_id), new_iv(a, app_id)
    assert a.delete(f"{IV}/{gone['id']}").status_code == 204
    assert a.get(f"{IV}/{gone['id']}").status_code == 404
    assert a.get(f"{IV}/{keep['id']}").status_code == 200
    assert db.execute(text("SELECT count(*) FROM interviews")).scalar() == 1


def test_delete_application_cascades(a, db):
    app_id, other = new_app(a), new_app(a)
    new_iv(a, app_id)
    new_iv(a, app_id)
    new_iv(a, other)
    assert a.delete(f"{APPS}/{app_id}").status_code == 204
    n = db.execute(
        text("SELECT count(*) FROM interviews WHERE job_application_id = :i"), {"i": app_id}
    ).scalar()
    assert n == 0
    assert db.execute(text("SELECT count(*) FROM interviews")).scalar() == 1


# --- auth ---

@pytest.mark.parametrize("method,path", [
    ("post", f"{APPS}/1/interviews"), ("get", f"{APPS}/1/interviews"),
    ("get", f"{IV}/1"), ("patch", f"{IV}/1"), ("delete", f"{IV}/1"),
])
def test_unauthenticated_401(client, method, path):
    kwargs = {"json": BODY} if method in ("post", "patch") else {}
    assert getattr(client, method)(path, **kwargs).status_code == 401
