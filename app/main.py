"""FastAPI application entrypoint.

Run locally with:
    uvicorn app.main:app --reload
"""

from fastapi import FastAPI, Request

from app import config, health, security
from app.applications import router as applications
from app.auth import router as auth
from app.interviews import router as interviews
from app.users import router as users

if config.PRODUCTION and (problems := config.production_problems()):
    # Fail fast at import (uvicorn exits) instead of serving with a dev-grade config.
    raise RuntimeError("Refusing to start in production: " + "; ".join(problems))

# Production serves no API docs: the Origin check trusts `Sec-Fetch-Site: same-origin`, so Swagger
# at /docs on the API's own origin could call every write route.
_docs_off = {"docs_url": None, "redoc_url": None, "openapi_url": None} if config.PRODUCTION else {}
app = FastAPI(title="Talaan", description="Job application tracker", **_docs_off)

# Registered before no_store so it sits inside it: its 403s still get Cache-Control: no-store.
app.middleware("http")(security.origin_check)


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
