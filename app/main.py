"""FastAPI application entrypoint.

Run locally with:
    uvicorn app.main:app --reload
"""

from fastapi import FastAPI

from app.routes import auth, health

app = FastAPI(title="ApplyFlow", description="Job Application Tracker")

app.include_router(health.router)
app.include_router(auth.router)
