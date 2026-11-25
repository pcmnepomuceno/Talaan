"""Job posting URL: validate (`clean`), normalize, and hash (`key`). Stdlib only; never fetches."""

import hashlib
import unicodedata
from urllib.parse import urlsplit

MAX_LEN = 2000
_BAD = "Enter a full address starting with http:// or https://"
_TOO_LONG = "Job posting URL must be 2,000 characters or fewer."
_DEFAULT_PORT = {"http": 80, "https": 443}
_DROP_PARAMS = {"fbclid", "gclid", "mc_cid", "mc_eid"}


def clean(v: str | None) -> str | None:
    """Trim; empty means None; raise ValueError for anything that is not a plain http(s) URL."""
    if v is None:
        return None
    v = v.strip()
    if not v:
        return None
    if len(v) > MAX_LEN:
        raise ValueError(_TOO_LONG)
    if any(c.isspace() or unicodedata.category(c) in ("Cc", "Cs") for c in v):
        raise ValueError(_BAD)
    try:
        p = urlsplit(v)
        if p.scheme.lower() not in _DEFAULT_PORT or not p.hostname or "@" in p.netloc:
            raise ValueError(_BAD)
        _ = p.port  # raises ValueError on a bad port
    except ValueError:
        raise ValueError(_BAD) from None
    return v


def normalize(url: str) -> str:
    """Canonical text for duplicate matching. Percent-encoding is never touched."""
    p = urlsplit(url)
    scheme = p.scheme.lower()
    host = p.hostname.lower()
    if ":" in host:
        host = f"[{host}]"
    port = p.port
    netloc = host if port is None or port == _DEFAULT_PORT.get(scheme) else f"{host}:{port}"
    path = p.path.removesuffix("/")
    params = [
        q for q in p.query.split("&")
        if q and not (n := q.split("=", 1)[0].lower()).startswith("utm_") and n not in _DROP_PARAMS
    ]
    query = f"?{'&'.join(sorted(params))}" if params else ""
    return f"{scheme}://{netloc}{path}{query}"


def key(url: str) -> str:
    return hashlib.sha256(normalize(url).encode()).hexdigest()
