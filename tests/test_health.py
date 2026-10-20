from sqlalchemy.exc import OperationalError

from app.database import get_db


def test_ping(client):
    r = client.get("/ping")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_health_ok(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_health_db_down(client):
    class BrokenDB:
        def execute(self, *_):
            raise OperationalError("SELECT 1", {}, Exception("db down"))

    client.app.dependency_overrides[get_db] = lambda: BrokenDB()
    r = client.get("/health")
    assert r.status_code == 503
    assert r.json() == {"detail": "Database unavailable"}
    assert client.get("/ping").status_code == 200
