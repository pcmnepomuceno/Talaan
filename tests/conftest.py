"""Test fixtures: isolated _test database, migrations once, rollback per test."""

import os
from datetime import datetime, timedelta, timezone

import pytest
from dotenv import load_dotenv
from sqlalchemy.engine import make_url

load_dotenv()

_url = make_url(os.getenv("TEST_DATABASE_URL") or os.getenv("DATABASE_URL", ""))
if os.getenv("TEST_DATABASE_URL") is None:
    _url = _url.set(database=f"{_url.database}_test")
if not (_url.database or "").endswith("_test"):
    pytest.exit(f"Refusing to run: test database {_url.database!r} must end in _test", 2)

# Must be set before any `app` import: app.config reads it at import time, and
# app.database.engine / alembic/env.py both use it.
os.environ["DATABASE_URL"] = _url.render_as_string(hide_password=False)

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.database import engine, get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Session as SessionModel  # noqa: E402
from app.models import User  # noqa: E402
from app.security import hash_password  # noqa: E402

USER_EMAIL = "user@example.com"
USER_PASSWORD = "Str0ng!pass"


@pytest.fixture(scope="session", autouse=True)
def _migrated():
    command.upgrade(Config("alembic.ini"), "head")


@pytest.fixture
def db():
    conn = engine.connect()
    trans = conn.begin()
    session = Session(bind=conn, join_transaction_mode="create_savepoint")
    yield session
    session.close()
    trans.rollback()
    conn.close()


@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def user(db):
    u = User(
        email=USER_EMAIL,
        password_hash=hash_password(USER_PASSWORD),
        account_name="Test User",
    )
    db.add(u)
    db.commit()
    return u


@pytest.fixture
def make_session(db, user):
    def _make(token="tok-valid", expires_in=timedelta(days=1)):
        now = datetime.now(timezone.utc)
        s = SessionModel(
            token=token, user_id=user.id, created_at=now, expires_at=now + expires_in
        )
        db.add(s)
        db.commit()
        return s

    return _make
