"""Job Application routes. Every route is scoped to the caller (`created_by`)."""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session as DBSession

from app.applications.dependencies import get_owned_application
from app.applications.models import ApplicationStatus, JobApplication
from app.applications.schemas import (
    INT4_MAX,
    ApplicationCreate,
    ApplicationPage,
    ApplicationRead,
    ApplicationUpdate,
)
from app.auth.dependencies import get_current_user
from app.database import get_db
from app.users.models import User

# Manila has no DST, so a fixed +08:00 offset needs no tzdata.
MANILA = timezone(timedelta(hours=8))


router = APIRouter(prefix="/applications", tags=["applications"])


def _fill_date(row: JobApplication) -> None:
    """Non-saved rows always have a date; a client-sent date wins over this default."""
    if row.status != ApplicationStatus.SAVED and row.date_applied is None:
        row.date_applied = datetime.now(MANILA).date()


def _to_columns(data: dict) -> dict:
    if data.get("contact_website") is not None:
        data["contact_website"] = str(data["contact_website"])
    return data


@router.post("", response_model=ApplicationRead, status_code=status.HTTP_201_CREATED)
def create_application(
    body: ApplicationCreate,
    user: User = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    row = JobApplication(**_to_columns(body.model_dump()), created_by=user.id)
    _fill_date(row)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.get("", response_model=ApplicationPage)
def list_applications(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0, le=INT4_MAX),
    status: ApplicationStatus | None = None,
    user: User = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    q = db.query(JobApplication).filter(JobApplication.created_by == user.id)
    if status is not None:
        q = q.filter(JobApplication.status == status)
    total = q.with_entities(func.count(JobApplication.id)).scalar()
    items = (
        q.order_by(JobApplication.created_at.desc(), JobApplication.id.desc())
        .limit(limit)
        .offset(offset)
        .all()
    )
    return ApplicationPage(items=items, total=total, limit=limit, offset=offset)


@router.get("/{application_id}", response_model=ApplicationRead)
def read_application(row: JobApplication = Depends(get_owned_application)):
    return row


@router.patch("/{application_id}", response_model=ApplicationRead)
def update_application(
    body: ApplicationUpdate,
    row: JobApplication = Depends(get_owned_application),
    db: DBSession = Depends(get_db),
):
    for field, value in _to_columns(body.model_dump(exclude_unset=True)).items():
        setattr(row, field, value)
    _fill_date(row)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{application_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_application(
    row: JobApplication = Depends(get_owned_application),
    db: DBSession = Depends(get_db),
):
    db.delete(row)
    db.commit()
