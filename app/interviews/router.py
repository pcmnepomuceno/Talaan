"""Interview routes. Ownership always goes through the parent application's `created_by`."""

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, Query, status
from pydantic import AwareDatetime
from sqlalchemy import func
from sqlalchemy.orm import Session as DBSession

from app.applications.dependencies import get_owned_application
from app.applications.models import JobApplication
from app.applications.schemas import INT4_MAX
from app.auth.dependencies import get_current_user
from app.database import get_db
from app.interviews.dependencies import get_owned_interview
from app.interviews.models import Interview
from app.interviews.schemas import (
    AgendaItem,
    AgendaPage,
    InterviewCreate,
    InterviewPage,
    InterviewRead,
    InterviewUpdate,
)
from app.users.models import User

router = APIRouter(tags=["interviews"])


def _now() -> datetime:
    """The agenda's clock (a function so tests can pin it)."""
    return datetime.now(timezone.utc)


@router.post(
    "/applications/{application_id}/interviews",
    response_model=InterviewRead,
    status_code=status.HTTP_201_CREATED,
)
def create_interview(
    body: InterviewCreate,
    parent: JobApplication = Depends(get_owned_application),
    db: DBSession = Depends(get_db),
):
    row = Interview(**body.model_dump(), job_application_id=parent.id)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.get("/applications/{application_id}/interviews", response_model=InterviewPage)
def list_interviews(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0, le=INT4_MAX),
    parent: JobApplication = Depends(get_owned_application),
    db: DBSession = Depends(get_db),
):
    q = db.query(Interview).filter(Interview.job_application_id == parent.id)
    total = q.with_entities(func.count(Interview.id)).scalar()
    items = q.order_by(Interview.scheduled_at.asc(), Interview.id.asc()).limit(limit).offset(offset).all()
    return InterviewPage(items=items, total=total, limit=limit, offset=offset)


@router.get("/interviews", response_model=AgendaPage)
def list_agenda(
    when: Literal["upcoming", "past"],
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0, le=INT4_MAX),
    as_of: AwareDatetime | None = None,
    user: User = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    """The caller's interviews across all applications. Upcoming is `scheduled_at >= now` (an
    interview exactly at now is still upcoming), oldest first; past is the rest, newest first.
    Ties break on id in the same direction so paging is stable.

    `now` is `as_of` when given, else the server clock; the response echoes it. The client sends
    page 1's `as_of` with every later page, so a row crossing the boundary between pages cannot
    shift the offsets (DECISIONS.md 2026-11-11, review round 1)."""
    now = as_of or _now()
    q = (
        db.query(Interview, JobApplication.company, JobApplication.job_name)
        .join(JobApplication, Interview.job_application_id == JobApplication.id)
        .filter(JobApplication.created_by == user.id)
    )
    if when == "upcoming":
        q = q.filter(Interview.scheduled_at >= now)
        order = (Interview.scheduled_at.asc(), Interview.id.asc())
    else:
        q = q.filter(Interview.scheduled_at < now)
        order = (Interview.scheduled_at.desc(), Interview.id.desc())
    total = q.with_entities(func.count(Interview.id)).scalar()
    rows = q.order_by(*order).limit(limit).offset(offset).all()
    items = [AgendaItem(**InterviewRead.model_validate(i).model_dump(), company=c, job_name=j) for i, c, j in rows]
    return AgendaPage(items=items, total=total, limit=limit, offset=offset, as_of=now)


@router.get("/interviews/{interview_id}", response_model=InterviewRead)
def read_interview(row: Interview = Depends(get_owned_interview)):
    return row


@router.patch("/interviews/{interview_id}", response_model=InterviewRead)
def update_interview(
    body: InterviewUpdate,
    row: Interview = Depends(get_owned_interview),
    db: DBSession = Depends(get_db),
):
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/interviews/{interview_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_interview(
    row: Interview = Depends(get_owned_interview),
    db: DBSession = Depends(get_db),
):
    db.delete(row)
    db.commit()
