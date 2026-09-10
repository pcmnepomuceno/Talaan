"""Health check route.

Left as a stub on purpose — implement this one yourself (CLAUDE.md rule 2).

Goal: a GET /health endpoint that confirms the service is up, and ideally
that the database connection works (use the `get_db` dependency from
app.database and run a trivial query like `SELECT 1`).
"""

from fastapi import APIRouter

router = APIRouter(tags=["health"])

@router.get("/health")
def health():
    return {"status":"ok"}