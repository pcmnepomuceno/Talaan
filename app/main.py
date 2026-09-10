"""FastAPI application entrypoint.

Run locally with:
    uvicorn app.main:app --reload
"""

from fastapi import FastAPI

from app.routes import health

app = FastAPI(title="ApplyFlow", description="Job Application Tracker")

app.include_router(health.router)
