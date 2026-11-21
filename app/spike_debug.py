# SPIKE ONLY: never merge to main
"""Debug echo for the S0 extension spike. Mounted only when SPIKE_DEBUG=1 (app/main.py)."""

import logging
import time

from fastapi import APIRouter, Request

router = APIRouter(prefix="/_spike")
log = logging.getLogger("uvicorn.error")


@router.api_route("/echo", methods=["GET", "POST"])
def echo(request: Request):
    h = request.headers
    names = sorted(c for c in request.cookies)  # names only, never values
    out = {
        "method": request.method,
        "origin": h.get("origin"),
        "sec_fetch_site": h.get("sec-fetch-site"),
        "sec_fetch_mode": h.get("sec-fetch-mode"),
        "sec_fetch_dest": h.get("sec-fetch-dest"),
        "cookie_names": names,
        "cookie_present": bool(names),
    }
    log.info("spike echo %s", out)
    return out


@router.get("/slow")
def slow(s: int = 1):
    time.sleep(min(max(s, 0), 120))
    return {"ok": True}
