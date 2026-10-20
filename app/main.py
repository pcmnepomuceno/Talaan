"""FastAPI application entrypoint.

Run locally with:
    uvicorn app.main:app --reload
"""

from fastapi import FastAPI, Request

from app import health
from app.applications import router as applications
from app.auth import router as auth
from app.interviews import router as interviews
from app.users import router as users

app = FastAPI(title="Talaan", description="Job application tracker")



@app.middleware("http")
async def no_store(request: Request, call_next):
    """Every /api/v1 response (errors and /me included) must not be cached."""
    response = await call_next(request)
    if request.url.path.startswith("/api/v1"):
        response.headers["Cache-Control"] = "no-store"
    return response


app.include_router(health.router)
app.include_router(auth.router, prefix="/api/v1")
app.include_router(users.router, prefix="/api/v1")
app.include_router(interviews.router, prefix="/api/v1")
app.include_router(applications.router, prefix="/api/v1")
