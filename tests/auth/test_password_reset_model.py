"""The password_reset_tokens table: present after migrations, CASCADE with its account, SET NULL
when the admin who made the link is deleted."""

from datetime import datetime, timedelta, timezone

from sqlalchemy import inspect

from app.auth import models
from app.database import engine
from app.users.models import User


def _token(db, user_id, created_by, token_hash="h1"):
    now = datetime.now(timezone.utc)
    row = models.PasswordResetToken(
        user_id=user_id,
        token_hash=token_hash,
        created_at=now,
        expires_at=now + timedelta(hours=24),
        created_by=created_by,
    )
    db.add(row)
    db.commit()
    return row


def _delete(db, user):
    db.query(User).filter(User.id == user.id).delete(synchronize_session=False)
    db.commit()
    db.expire_all()


def test_table_exists_with_its_indexes():
    insp = inspect(engine)
    assert insp.has_table("password_reset_tokens")
    indexed = {tuple(i["column_names"]) for i in insp.get_indexes("password_reset_tokens")}
    assert {("user_id",), ("created_by",)} <= indexed
    uniques = {tuple(u["column_names"]) for u in insp.get_unique_constraints("password_reset_tokens")}
    assert ("token_hash",) in uniques


def test_deleting_the_account_removes_its_tokens(db, users):
    target, admin = users
    _token(db, target.id, admin.id)
    _delete(db, target)
    assert db.query(models.PasswordResetToken).count() == 0


def test_deleting_the_creator_keeps_the_token_and_nulls_created_by(db, users):
    target, admin = users
    _token(db, target.id, admin.id)
    _delete(db, admin)
    row = db.query(models.PasswordResetToken).one()
    assert row.created_by is None and row.user_id == target.id
