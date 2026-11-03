from datetime import datetime, timedelta, timezone

from sqlalchemy import text

from app.auth.models import Session as SessionModel
from app.auth.security import hash_session_token
from app.users.models import User


def test_deleting_user_deletes_only_its_sessions(db, users):
    a_id, b_id = (u.id for u in users)
    db.query(User).filter(User.id == a_id).delete(synchronize_session=False)
    db.commit()
    assert db.query(SessionModel).filter_by(user_id=a_id).count() == 0
    assert db.query(SessionModel).filter_by(user_id=b_id).count() == 1


def test_sessions_user_id_is_indexed(db):
    names = db.execute(text("SELECT indexname FROM pg_indexes WHERE tablename='sessions'")).scalars().all()
    assert "ix_sessions_user_id" in names


def test_many_sessions_cascade(db, user):
    now = datetime.now(timezone.utc)
    db.add_all(
        SessionModel(token_hash=hash_session_token(f"t{i}"), user_id=user.id, created_at=now, expires_at=now + timedelta(days=1))
        for i in range(50)
    )
    db.commit()
    db.query(User).filter(User.id == user.id).delete(synchronize_session=False)
    db.commit()
    assert db.query(SessionModel).count() == 0
