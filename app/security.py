"""CSRF defense for the whole API: reject cross-site state-changing browser requests.

Only POST/PUT/PATCH/DELETE are checked (login and signup included). Sec-Fetch-Site decides
first when present: `cross-site` is refused, `same-origin` is allowed without the allow-list
(the browser vouches that the page is on the API's own origin, e.g. Swagger at /docs).
Otherwise a browser always sends Origin on a cross-origin POST, so an Origin outside
ALLOWED_ORIGINS is refused. A request with no Origin is a non-browser client (curl, tests,
server-to-server): it has no ambient cookie to ride on, so it is allowed. SameSite=Lax on the
cookie is the second layer. One pinned exception: a write whose raw Origin is exactly one of
EXTENSION_ORIGINS and whose Sec-Fetch-Site is exactly `none` (the extension popup, docs/AUTH.md).
There is deliberately no CORS middleware (DECISIONS.md, M10).
"""

from fastapi import Request
from fastapi.responses import JSONResponse

from app import config

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


async def origin_check(request: Request, call_next):
    if request.method in UNSAFE_METHODS:
        origin = request.headers.get("origin")
        if origin in config.EXTENSION_ORIGINS and request.headers.get("sec-fetch-site") == "none":
            return await call_next(request)  # pinned extension popup (docs/AUTH.md)
        site = request.headers.get("sec-fetch-site", "").strip().lower()
        if site == "cross-site" or (
            site != "same-origin"
            and origin is not None
            and origin.strip().lower() not in config.ALLOWED_ORIGINS
        ):
            return JSONResponse({"detail": "Cross-site request blocked."}, status_code=403)
    return await call_next(request)
