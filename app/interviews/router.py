"""Interview routes. Ownership always goes through the parent application's `created_by`."""

import re
from datetime import date, datetime, time, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request, status
from fastapi.exceptions import RequestValidationError
from pydantic import AwareDatetime
from sqlalchemy import func
from sqlalchemy.orm import Session as DBSession

from app.applications.dependencies import get_owned_application
from app.applications.models import JobApplication
from app.applications.router import MANILA
from app.applications.schemas import INT4_MAX
from app.auth.dependencies import get_current_user
from app.database import get_db
from app.interviews.dependencies import get_owned_interview
from app.interviews.models import Interview
from app.interviews.schemas import (
    AgendaItem,
    AgendaPage,
    CalendarRange,
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
    q = _owned_agenda(db, user)
    if when == "upcoming":
        q = q.filter(Interview.scheduled_at >= now)
        order = (Interview.scheduled_at.asc(), Interview.id.asc())
    else:
        q = q.filter(Interview.scheduled_at < now)
        order = (Interview.scheduled_at.desc(), Interview.id.desc())
    total = q.with_entities(func.count(Interview.id)).scalar()
    rows = q.order_by(*order).limit(limit).offset(offset).all()
    return AgendaPage(items=_items(rows), total=total, limit=limit, offset=offset, as_of=now)


CALENDAR_CAP = 200
CALENDAR_MAX_DAYS = 62
_DAY = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")  # ASCII only: \d would accept other scripts' digits


def _owned_agenda(db: DBSession, user: User):
    """Every interview under the caller's applications, with the application's names."""
    return (
        db.query(Interview, JobApplication.company, JobApplication.job_name)
        .join(JobApplication, Interview.job_application_id == JobApplication.id)
        .filter(JobApplication.created_by == user.id)
    )


def _items(rows) -> list[AgendaItem]:
    return [AgendaItem(**InterviewRead.model_validate(i).model_dump(), company=c, job_name=j) for i, c, j in rows]


def _bad(name: str, msg: str) -> RequestValidationError:
    return RequestValidationError([{"type": "value_error", "loc": ("query", name), "msg": msg, "input": None}])


def _pht_day(name: str, raw: str) -> date:
    """`YYYY-MM-DD` and nothing else, a real day, years 1900-2200 (like the interview form)."""
    if not _DAY.fullmatch(raw):
        raise _bad(name, f"{name} must be a date as YYYY-MM-DD")
    try:
        d = date.fromisoformat(raw)
    except ValueError:
        raise _bad(name, f"{name} must be a real calendar date") from None
    if not 1900 <= d.year <= 2200:
        raise _bad(name, f"{name} year must be between 1900 and 2200")
    return d


@router.get("/interviews/calendar", response_model=CalendarRange, response_model_by_alias=True)
def list_calendar(
    request: Request,
    frm: str = Query(alias="from"),
    to: str = Query(),
    user: User = Depends(get_current_user),
    db: DBSession = Depends(get_db),
):
    """The caller's interviews on the PHT days `from` to `to`, both included, oldest first (ties by
    id), at most 200. Not a mode of the agenda: paging and `as_of` have no meaning here, so passing
    any agenda parameter is 422. Must be declared before `/interviews/{interview_id}`."""
    for name in ("when", "limit", "offset", "as_of"):
        if name in request.query_params:
            raise _bad(name, f"{name} cannot be combined with from and to")
    start, end = _pht_day("from", frm), _pht_day("to", to)
    if start > end:
        raise _bad("from", "from must not be after to")
    if (end - start).days + 1 > CALENDAR_MAX_DAYS:
        raise _bad("to", f"the range can span at most {CALENDAR_MAX_DAYS} days")
    lo = datetime.combine(start, time.min, tzinfo=MANILA)
    hi = datetime.combine(end + timedelta(days=1), time.min, tzinfo=MANILA)
    q = _owned_agenda(db, user).filter(Interview.scheduled_at >= lo, Interview.scheduled_at < hi)
    total = q.with_entities(func.count(Interview.id)).scalar()
    rows = q.order_by(Interview.scheduled_at.asc(), Interview.id.asc()).limit(CALENDAR_CAP).all()
    return CalendarRange(items=_items(rows), total=total, truncated=total > CALENDAR_CAP, from_=start, to=end)


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
