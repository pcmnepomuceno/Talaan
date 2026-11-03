"""Helpers for real-thread tests, so a stuck lock fails the test in seconds instead of hanging.

Rules every such test follows:
- threads are daemon (a stuck one cannot keep the interpreter alive) and are joined through
  `join_all`, which fails the test if any is still running after the timeout;
- every connection the test opens itself is closed in `finally` (an open transaction holding
  a row lock blocks other connections, and the fixture teardown after it);
- cleanup runs in `finally` on a fresh session (`purge`), one statement at a time.
conftest.py also sets lock_timeout/statement_timeout on every connection (PGOPTIONS), so a
lock wait that never ends raises after 5 seconds.
"""

import threading
import time

import pytest
from sqlalchemy import text

from app.database import SessionLocal


def spawn(target, *args) -> threading.Thread:
    t = threading.Thread(target=target, args=args, daemon=True)
    t.start()
    return t


def join_all(threads, timeout: float = 30) -> None:
    deadline = time.monotonic() + timeout
    for t in threads:
        t.join(max(0.0, deadline - time.monotonic()))
    stuck = [t.name for t in threads if t.is_alive()]
    if stuck:
        pytest.fail(f"{len(stuck)} thread(s) still running after {timeout}s (stuck on a lock?): {stuck}")


def purge(*statements: tuple[str, dict]) -> None:
    """Run cleanup statements on a fresh session, each in its own transaction, so one failure
    (a lock timeout, say) does not stop the others. Raises at the end if any failed."""
    errors = []
    for sql, params in statements:
        db = SessionLocal()
        try:
            db.execute(text(sql), params)
            db.commit()
        except Exception as e:  # noqa: BLE001 - keep cleaning, report below
            errors.append(f"{sql!r}: {e}")
        finally:
            db.close()
    if errors:
        raise RuntimeError("cleanup failed (stray rows may remain; see tests/conftest.py): " + "; ".join(errors))
