from datetime import datetime, timezone

import pytest
from sqlalchemy import event, text

from app.applications.router import MANILA
from app.database import engine
from app.interviews.models import Interview, InterviewMode
from tests.conftest import as_user

URL = "/api/v1/applications"
BODY = {"company": "Acme", "job_name": "Dev", "status": "applied", "mode_of_work": "remote"}


@pytest.fixture
def a(client, users):
    as_user(client, "tok-a")
    return client


def create(client, **over):
    r = client.post(URL, json={**BODY, **over})
    assert r.status_code == 201, r.text
    return r.json()


def test_end_to_end_scenario(client, users):
    as_user(client, "tok-a")
    row = create(client, status="saved")
    assert row["date_applied"] is None
    as_user(client, "tok-b")
    assert client.get(f"{URL}/{row['id']}").status_code == 404
    as_user(client, "tok-a")
    page = client.get(URL, params={"status": "saved", "limit": 10}).json()
    assert page["total"] == 1 and page["limit"] == 10
    as_user(client, "tok-b")
    assert client.get(URL).json()["items"] == []


def test_responses_are_no_store(a):
    assert a.get(URL).headers["cache-control"] == "no-store"


# --- list ---

@pytest.mark.parametrize("params", [{"limit": 0}, {"limit": 101}, {"offset": -1}, {"status": "bogus"}])
def test_list_bad_params(a, params):
    assert a.get(URL, params=params).status_code == 422


def test_list_offset_beyond_total(a):
    create(a)
    page = a.get(URL, params={"offset": 50}).json()
    assert page["items"] == [] and page["total"] == 1


def test_list_newest_first(a):
    ids = [create(a, company=f"c{i}")["id"] for i in range(3)]
    assert [i["id"] for i in a.get(URL).json()["items"]] == ids[::-1]


# --- by id ---

def test_id_not_int_422(a):
    assert a.get(f"{URL}/abc").status_code == 422


def test_id_huge_404(a):
    assert a.get(f"{URL}/99999999999").status_code == 404


def test_other_users_row_is_404_and_untouched(client, users):
    as_user(client, "tok-a")
    row = create(client)
    as_user(client, "tok-b")
    url = f"{URL}/{row['id']}"
    assert client.get(url).status_code == 404
    assert client.patch(url, json={"company": "Hacked"}).status_code == 404
    assert client.delete(url).status_code == 404
    as_user(client, "tok-a")
    assert client.get(url).json()["company"] == "Acme"


def test_deleted_row_404(a):
    url = f"{URL}/{create(a)['id']}"
    assert a.delete(url).status_code == 204
    assert a.get(url).status_code == 404


# --- patch ---

def test_patch_empty_body_no_change(a):
    row = create(a, salary=100)
    r = a.patch(f"{URL}/{row['id']}", json={})
    assert r.status_code == 200
    assert {k: v for k, v in r.json().items() if k != "updated_at"} == {
        k: v for k, v in row.items() if k != "updated_at"
    }


@pytest.mark.parametrize("field", ["company", "job_name", "status", "mode_of_work"])
def test_patch_null_on_required_422(a, field):
    assert a.patch(f"{URL}/{create(a)['id']}", json={field: None}).status_code == 422


def test_patch_null_clears_salary(a):
    row = create(a, salary=100)
    assert a.patch(f"{URL}/{row['id']}", json={"salary": None}).json()["salary"] is None


def test_patch_saved_to_applied_fills_manila_today(a):
    row = create(a, status="saved")
    r = a.patch(f"{URL}/{row['id']}", json={"status": "applied"}).json()
    assert r["date_applied"] == datetime.now(MANILA).date().isoformat()


def test_create_non_saved_fills_manila_today(a):
    assert create(a)["date_applied"] == datetime.now(MANILA).date().isoformat()


def test_client_date_wins(a):
    assert create(a, date_applied="2026-01-02")["date_applied"] == "2026-01-02"


@pytest.mark.parametrize("extra", [{"created_by": 2}, {"id": 5}, {"created_at": "2020-01-01T00:00:00Z"}])
def test_patch_and_create_forbid_mass_assignment(a, extra):
    assert a.patch(f"{URL}/{create(a)['id']}", json=extra).status_code == 422
    assert a.post(URL, json={**BODY, **extra}).status_code == 422


def test_patch_back_to_saved_keeps_date(a):
    row = create(a)
    r = a.patch(f"{URL}/{row['id']}", json={"status": "saved"}).json()
    assert r["date_applied"] == row["date_applied"]


def test_patch_bumps_updated_at(a):
    row = create(a)
    r = a.patch(f"{URL}/{row['id']}", json={"remarks": "x"}).json()
    assert r["updated_at"] > row["updated_at"]


# --- create validation ---

@pytest.mark.parametrize(
    "over",
    [
        {"company": "   "},
        {"salary": -1},
        {"salary": 2_147_483_648},
        {"contact_website": "javascript:alert(1)"},
        {"contact_email": "not-an-email"},
        {"remarks": "x" * 5001},
    ],
)
def test_create_invalid_422(a, over):
    assert a.post(URL, json={**BODY, **over}).status_code == 422


def test_create_salary_zero_ok_and_website_stored(a):
    row = create(a, salary=0, contact_website="https://acme.example/jobs")
    assert row["salary"] == 0 and row["contact_website"].startswith("https://acme.example")


def test_duplicate_company_allowed_and_users_separate(client, users):
    as_user(client, "tok-a")
    create(client)
    create(client)
    as_user(client, "tok-b")
    create(client)
    assert client.get(URL).json()["total"] == 1
    as_user(client, "tok-a")
    assert client.get(URL).json()["total"] == 2


# --- cascade, auth, N+1 ---

def test_delete_cascades_to_interviews(a, db):
    row = create(a)
    db.add(Interview(job_application_id=row["id"], scheduled_at=datetime.now(timezone.utc),
                     mode=InterviewMode.ONLINE))
    db.commit()
    assert a.delete(f"{URL}/{row['id']}").status_code == 204
    assert db.execute(text("SELECT count(*) FROM interviews")).scalar() == 0


@pytest.mark.parametrize(
    "method,path",
    [("post", ""), ("get", ""), ("get", "/1"), ("patch", "/1"), ("delete", "/1")],
)
def test_unauthenticated_401(client, method, path):
    kwargs = {"json": BODY} if method in ("post", "patch") else {}
    assert getattr(client, method)(URL + path, **kwargs).status_code == 401


def test_list_has_no_n_plus_one(a):
    count = []

    def _count(*_):
        count.append(1)

    event.listen(engine, "before_cursor_execute", _count)
    try:
        create(a)
        count.clear()
        a.get(URL)
        one = len(count)
        for _ in range(4):
            create(a)
        count.clear()
        a.get(URL)
        five = len(count)
    finally:
        event.remove(engine, "before_cursor_execute", _count)
    assert one == five >= 4  # auth 2 + count 1 + page 1
