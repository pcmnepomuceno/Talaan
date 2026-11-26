"""The race-test helper itself: it must fail loudly rather than let a race test pass unreached."""

import threading

import pytest

from tests.concurrency import wait_for_lock_waiter


def test_wait_for_lock_waiter_raises_when_nothing_waits_and_nothing_is_done():
    with pytest.raises(AssertionError, match="no lock waiter"):
        wait_for_lock_waiter(timeout=0.2)


def test_wait_for_lock_waiter_returns_when_done_is_set():
    done = threading.Event()
    done.set()
    wait_for_lock_waiter(timeout=0.2, done=done)
