"""Interview routes. Ownership always goes through the parent application's `created_by`."""

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session as DBSession

from app.applications.dependencies import get_owned_application
from app.applications.models import JobApplication
from app.applications.schemas import INT4_MAX
from app.database import get_db
from app.interviews.dependencies import get_owned_interview
from app.interviews.models import Interview
from app.interviews.schemas import (
    InterviewCreate,
    InterviewPage,
    InterviewRead,
    InterviewUpdate,
)

router = APIRouter(tags=["interviews"])


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
