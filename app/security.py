"""CSRF defense for the whole API: reject cross-site state-changing browser requests.

Only POST/PUT/PATCH/DELETE are checked (login and signup included). A browser always sends
Origin on a cross-origin POST, so an Origin outside ALLOWED_ORIGINS is refused, and so is
Sec-Fetch-Site: cross-site. A request with no Origin is a non-browser client (curl, tests,
server-to-server): it has no ambient cookie to ride on, so it is allowed. SameSite=Lax on the
cookie is the second layer. There is deliberately no CORS middleware (DECISIONS.md, M10).
"""

from fastapi import Request
from fastapi.responses import JSONResponse

from app import config

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


async def origin_check(request: Request, call_next):
    if request.method in UNSAFE_METHODS:
        origin = request.headers.get("origin")
        cross_site = request.headers.get("sec-fetch-site", "").strip().lower() == "cross-site"
        if cross_site or (origin is not None and origin.strip().lower() not in config.ALLOWED_ORIGINS):
            return JSONResponse({"detail": "Cross-site request blocked."}, status_code=403)
    return await call_next(request)
