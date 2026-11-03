"""Limiter unit tests: keys, client IP rule, sliding window, fail-closed."""

from datetime import timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import OperationalError
from starlette.requests import Request

from app import config
from app.auth import rate_limit
from app.auth.models import RateLimitEvent


def _request(client=("203.0.113.9", 1234), xff=()):
    headers = [(b"x-forwarded-for", v.encode()) for v in xff]
    return Request({"type": "http", "headers": headers, "client": client})


def test_peer_used_and_xff_ignored_when_not_trusted(monkeypatch):
    monkeypatch.setattr(config, "TRUST_PROXY", False)
    assert rate_limit.client_ip(_request(xff=["1.1.1.1"])) == "203.0.113.9"


def test_rightmost_xff_used_when_trusted(monkeypatch):
    monkeypatch.setattr(config, "TRUST_PROXY", True)
    assert rate_limit.client_ip(_request(xff=["1.1.1.1, 2.2.2.2"])) == "2.2.2.2"
    # Several header lines count as one list, in order.
    assert rate_limit.client_ip(_request(xff=["1.1.1.1", "3.3.3.3"])) == "3.3.3.3"


@pytest.mark.parametrize("trust", [True, False])
def test_missing_or_junk_address_is_unknown(monkeypatch, trust):
    monkeypatch.setattr(config, "TRUST_PROXY", trust)
    assert rate_limit.client_ip(_request(client=None)) == "unknown"
    assert rate_limit.client_ip(_request(client=("testclient", 1))) == "unknown"
    if trust:
        assert rate_limit.client_ip(_request(xff=["1.1.1.1, not-an-ip"])) == "unknown"
        assert rate_limit.client_ip(_request(xff=[""])) == "unknown"
        assert rate_limit.client_ip(_request()) == "unknown"


def test_trusted_xff_strips_ports_and_keeps_rightmost(monkeypatch):
    monkeypatch.setattr(config, "TRUST_PROXY", True)
    assert rate_limit.client_ip(_request(xff=["9.9.9.9:1, 198.51.100.7:4711"])) == "198.51.100.7"
    assert rate_limit.client_ip(_request(xff=["9.9.9.9, [2001:db8:0:1::5]:4711"])) == "2001:db8:0:1::/64"
    assert rate_limit.client_ip(_request(xff=["2001:db8:0:1::5"])) == "2001:db8:0:1::/64"  # bare v6 kept


@pytest.fixture
def fresh_warnings(monkeypatch):
    monkeypatch.setattr(config, "TRUST_PROXY", True)
    monkeypatch.setattr(rate_limit, "_warned", set())
    # alembic's fileConfig (the in-process test migration) disables existing loggers.
    monkeypatch.setattr(rate_limit.logger, "disabled", False)


def test_trusted_xff_unusable_logs_once_per_reason(fresh_warnings, caplog):
    with caplog.at_level("WARNING", logger="app.auth.rate_limit"):
        for _ in range(3):
            assert rate_limit.client_ip(_request()) == "unknown"  # missing
            assert rate_limit.client_ip(_request(xff=["junk"])) == "unknown"  # invalid
            assert rate_limit.client_ip(_request(xff=["1.1.1.1, "])) == "unknown"  # missing
    assert [r.getMessage().split(" X-")[0] for r in caplog.records] == [
        "TRUST_PROXY: missing",
        "TRUST_PROXY: invalid",
    ]


def test_trusted_xff_unusable_logs_short_sample(fresh_warnings, caplog):
    with caplog.at_level("WARNING", logger="app.auth.rate_limit"):
        assert rate_limit.client_ip(_request(xff=["1.1.1.1, " + "x" * 500 + "\nforged"])) == "unknown"
        assert rate_limit.client_ip(_request()) == "unknown"
    assert len(caplog.records) == 2
    msg = caplog.records[0].getMessage()
    assert "x" * 40 in msg and "x" * 41 not in msg and "\n" not in msg and "1.1.1.1" not in msg


def test_ipv6_bucketed_to_slash_64_and_mapped_ipv4_unwrapped(monkeypatch):
    monkeypatch.setattr(config, "TRUST_PROXY", False)
    a = rate_limit.client_ip(_request(client=("2001:db8:0:1:aaaa::1", 1)))
    b = rate_limit.client_ip(_request(client=("2001:db8:0:1:bbbb::2", 1)))
    assert a == b == "2001:db8:0:1::/64"
    assert rate_limit.client_ip(_request(client=("::ffff:198.51.100.7", 1))) == "198.51.100.7"


def test_email_key_hides_and_has_fixed_length():
    # Normalization is the schema's job; the route-level test_table_never_holds_a_raw_email
    # checks that case and padding still map to one key.
    k = rate_limit.email_key("mixed@example.com")
    assert "@" not in k and "mixed" not in k
    assert len(rate_limit.email_key("a" * 100_000)) == len(k)


def test_limit_reached_at_n_plus_one(db):
    for _ in range(3):
        assert rate_limit.check(db, "k", 3, 60) is None
        rate_limit.record(db, "k")
    assert rate_limit.check(db, "k", 3, 60) is not None
    assert rate_limit.check(db, "other", 3, 60) is None


def test_window_expiry_and_prune_with_injected_clock(db, monkeypatch):
    t0 = rate_limit.utcnow()
    monkeypatch.setattr(rate_limit, "utcnow", lambda: t0)
    for _ in range(3):
        rate_limit.record(db, "k")
    assert rate_limit.check(db, "k", 3, 60) == 60
    monkeypatch.setattr(rate_limit, "utcnow", lambda: t0 + timedelta(seconds=45))
    assert rate_limit.check(db, "k", 3, 60) == 15
    monkeypatch.setattr(rate_limit, "utcnow", lambda: t0 + timedelta(seconds=61))
    assert rate_limit.check(db, "k", 3, 60) is None
    assert db.query(RateLimitEvent).filter_by(key="k").count() == 0  # pruned in the same check


def test_retry_after_over_the_limit_by_more_than_one_frees_a_slot(db, monkeypatch):
    t0 = rate_limit.utcnow()
    for i in range(5):  # 5 events at t0+0..4 against a limit of 3 (overshoot by 2)
        monkeypatch.setattr(rate_limit, "utcnow", lambda i=i: t0 + timedelta(seconds=i))
        rate_limit.record(db, "k")
    now = t0 + timedelta(seconds=10)
    monkeypatch.setattr(rate_limit, "utcnow", lambda: now)
    wait = rate_limit.check(db, "k", 3, 60)
    assert wait == 52  # the event at t0+2 must expire, not the oldest (t0+0 would say 50)
    monkeypatch.setattr(rate_limit, "utcnow", lambda: now + timedelta(seconds=wait - 1))
    assert rate_limit.check(db, "k", 3, 60) == 1
    monkeypatch.setattr(rate_limit, "utcnow", lambda: now + timedelta(seconds=wait))
    assert rate_limit.check(db, "k", 3, 60) is None


def test_delete_event_removes_only_that_row(db):
    first = rate_limit.record(db, "a")
    second = rate_limit.record(db, "a")
    third = rate_limit.record(db, "b")
    rate_limit.delete_event(db, first)
    assert sorted((e.id, e.key) for e in db.query(RateLimitEvent)) == [(second, "a"), (third, "b")]


def test_too_many_shape():
    e = rate_limit.too_many(42)
    assert (e.status_code, e.detail, e.headers) == (429, "Too many attempts. Try again later.", {"Retry-After": "42"})


def test_fail_closed_maps_db_error_to_503(db):
    with pytest.raises(HTTPException) as exc, rate_limit.fail_closed(db):
        raise OperationalError("select", {}, Exception("db down"))
    assert exc.value.status_code == 503
    with pytest.raises(HTTPException) as passthrough, rate_limit.fail_closed(db):  # 429 is not swallowed
        raise rate_limit.too_many(5)
    assert passthrough.value.status_code == 429


def test_fail_closed_still_503_when_rollback_fails(db, monkeypatch):
    def dead(*a, **k):
        raise OperationalError("rollback", {}, Exception("connection lost"))

    monkeypatch.setattr(db, "rollback", dead)
    with pytest.raises(HTTPException) as exc, rate_limit.fail_closed(db):
        raise OperationalError("select", {}, Exception("db down"))
    assert exc.value.status_code == 503


def test_lock_id_is_a_stable_signed_64_bit_int():
    ids = {rate_limit.lock_id(f"k{i}") for i in range(1000)}
    assert len(ids) == 1000
    assert all(-(2**63) <= i < 2**63 for i in ids)
    assert any(i < 0 for i in ids)  # signed: uses the whole bigint range
    assert rate_limit.lock_id("login:ip:unknown") == rate_limit.lock_id("login:ip:unknown")


def test_lock_ids_order_by_id_and_dedupe_collisions(monkeypatch):
    ids = {"a": 5, "b": 1, "c": 1, "d": 5}
    monkeypatch.setattr(rate_limit, "lock_id", ids.__getitem__)
    # Key order would give [5, 1] for (a, b) and [1, 5] for (c, d): a deadlock cycle.
    assert rate_limit.lock_ids(["a", "b"]) == rate_limit.lock_ids(["c", "d"]) == [1, 5]
    assert rate_limit.lock_ids(["b", "c"]) == [1]  # two keys, one lock taken once
