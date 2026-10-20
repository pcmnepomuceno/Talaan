from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session as DBSession

from app.applications.models import JobApplication
from app.applications.schemas import INT4_MAX
from app.auth.dependencies import get_current_user
from app.database import get_db
from app.interviews.models import Interview
from app.users.models import User


def get_owned_interview(
    interview_id: int,
    user: User = Depends(get_current_user),
    db: DBSession = Depends(get_db),
) -> Interview:
    """Ownership runs through the parent application. Missing and not-owned give the same 404."""
    row = None
    if 0 < interview_id <= INT4_MAX:  # beyond int4 Postgres would raise -> 500
        row = (
            db.query(Interview)
            .join(JobApplication, Interview.job_application_id == JobApplication.id)
            .filter(Interview.id == interview_id, JobApplication.created_by == user.id)
            .first()
        )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Interview not found")
    return row
