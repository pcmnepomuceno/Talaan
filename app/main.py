"""FastAPI application entrypoint.

Run locally with:
    uvicorn app.main:app --reload
"""

from fastapi import FastAPI

from app import health
from app.auth import router as auth
from app.users import router as users

app = FastAPI(title="Talaan", description="Job application tracker")

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(users.router)
