"""Job Application routes. Every route is scoped to the caller (`created_by`)."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query, status
from fastapi.exceptions import RequestValidationError
from sqlalchemy import (
    Date,
    Integer,
    case,
    cast,
    exists,
    func,
    literal,
    select,
    type_coerce,
)
from sqlalchemy.orm import Session as DBSession

from app.applications.dependencies import get_owned_application
from app.applications.models import ApplicationStatus, JobApplication
from app.applications.schemas import (
    INT4_MAX,
    ApplicationCreate,
    ApplicationPage,
    ApplicationRead,
    ApplicationUpdate,
    FollowUpItem,
    FollowUpPage,
)
from app.auth.dependencies import get_current_user
from app.config import MANILA
from app.database import get_db
from app.interviews.models import Interview
from app.users.models import User

router = APIRouter(prefix="/applications", tags=["applications"])


def _now() -> datetime:
    """The follow-up list's clock (a function so tests can pin it)."""
    return datetime.now(timezone.utc)


def _bad(name: str, msg: str) -> RequestValidationError:
    return RequestValidationError([{"type": "value_error", "loc": ("query", name), "msg": msg, "input": None}])


def _pht_day(col):
    return cast(func.timezone("Asia/Manila", col), Date)


def _follow_up(db: DBSession, user: User, days: int):
    """Applied rows with no upcoming interview whose last activity (apply date or latest past
    interview, in PHT days) is at least `days` days before today (PHT, computed here)."""
    now = _now()
    today = now.astimezone(MANILA).date()
    applied_day = func.coalesce(JobApplication.date_applied, _pht_day(JobApplication.created_at))
    interview_day = (
        select(_pht_day(func.max(Interview.scheduled_at)))
        .where(Interview.job_application_id == JobApplication.id, Interview.scheduled_at < now)
        .correlate(JobApplication)
        .scalar_subquery()
    )
    last_day = func.greatest(applied_day, interview_day)  # GREATEST ignores NULL
    idle = type_coerce(literal(today, Date) - last_day, Integer)
    upcoming = exists().where(Interview.job_application_id == JobApplication.id, Interview.scheduled_at >= now)
    q = (
        db.query(JobApplication, idle, case((interview_day >= applied_day, "interview"), else_="applied"))
        .filter(
            JobApplication.created_by == user.id,
            JobApplication.status == ApplicationStatus.APPLIED,
            ~upcoming,
            idle >= days,
        )
    )
    return q, last_day


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


@router.get("", response_model=ApplicationPage | FollowUpPage)
def list_applications(
    follow_up: bool = False,
    days: int | None = Query(None, ge=1, le=90),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0, le=INT4_MAX),
    status: ApplicationStatus | None = None,
    user: User = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    if follow_up:
        if status is not None:
            raise _bad("status", "status cannot be combined with follow_up")
        q, last_day = _follow_up(db, user, 7 if days is None else days)
        total = q.with_entities(func.count(JobApplication.id)).scalar()
        rows = q.order_by(last_day.asc(), JobApplication.id.asc()).limit(limit).offset(offset).all()
        items = [
            FollowUpItem(**ApplicationRead.model_validate(r).model_dump(), idle_days=i, last_activity=a)
            for r, i, a in rows
        ]
        return FollowUpPage(items=items, total=total, limit=limit, offset=offset)
    if days is not None:
        raise _bad("days", "days needs follow_up=true")
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
