from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session as DBSession

from app.applications.models import JobApplication
from app.applications.schemas import INT4_MAX
from app.auth.dependencies import get_current_user
from app.database import get_db
from app.users.models import User


def get_owned_application(
    application_id: int,
    user: User = Depends(get_current_user),
    db: DBSession = Depends(get_db),
) -> JobApplication:
    """Missing and not-owned give the same 404, so ids of other users do not leak."""
    app_row = None
    if 0 < application_id <= INT4_MAX:  # beyond int4 Postgres would raise -> 500
        app_row = (
            db.query(JobApplication)
            .filter(JobApplication.id == application_id, JobApplication.created_by == user.id)
            .first()
        )
    if app_row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found")
    return app_row
