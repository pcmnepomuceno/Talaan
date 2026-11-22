import hashlib

import pytest

from app.applications import job_url

NORMALIZE = [
    ("HTTPS://Example.COM/Jobs", "https://example.com/Jobs"),
    ("https://example.com:443/a", "https://example.com/a"),
    ("http://example.com:80/a", "http://example.com/a"),
    ("https://example.com:8443/a", "https://example.com:8443/a"),
    ("http://example.com:443/a", "http://example.com:443/a"),
    ("https://example.com/a#frag", "https://example.com/a"),
    ("https://example.com/a?utm_source=x&id=1", "https://example.com/a?id=1"),
    ("https://example.com/a?UTM_Medium=x&id=1", "https://example.com/a?id=1"),
    ("https://example.com/a?fbclid=1&gclid=2&mc_cid=3&mc_eid=4&id=1", "https://example.com/a?id=1"),
    ("https://example.com/a?utm_source=x", "https://example.com/a"),
    ("https://example.com/a?b=2&a=1", "https://example.com/a?a=1&b=2"),
    ("https://example.com/a?&&a=1&", "https://example.com/a?a=1"),
    ("https://example.com/a/", "https://example.com/a"),
    ("https://example.com/", "https://example.com"),
    ("https://example.com", "https://example.com"),
    ("https://www.example.com/a", "https://www.example.com/a"),
    ("https://example.com/a%20b", "https://example.com/a%20b"),
    ("https://example.com/Path", "https://example.com/Path"),
    ("https://[::1]:443/a", "https://[::1]/a"),
    ("https://MÜNCHEN.de/a", "https://münchen.de/a"),
]


@pytest.mark.parametrize("raw, want", NORMALIZE)
def test_normalize(raw, want):
    assert job_url.normalize(raw) == want


def test_key_is_sha256_of_normalized():
    u = "https://Example.com/a/?utm_source=x"
    assert job_url.key(u) == hashlib.sha256(b"https://example.com/a").hexdigest()


def test_key_matches_and_differs():
    assert job_url.key("https://example.com/a?utm_source=x#f") == job_url.key("https://EXAMPLE.com/a/")
    assert job_url.key("https://www.example.com/a") != job_url.key("https://example.com/a")
    assert job_url.key("https://example.com/a?jobId=1") != job_url.key("https://example.com/a?jobId=2")


VALID = [
    "https://example.com/jobs/1",
    "https://example.com/\U0001F600",
    "https://münchen.de/a",
    "HTTPS://Example.com/A",
    "https://example.com/" + "a" * (2000 - len("https://example.com/")),
    "https://[::1]:8080/a",
]


@pytest.mark.parametrize("v", VALID)
def test_clean_valid(v):
    assert job_url.clean(v) == v


def test_clean_trims_and_empties():
    assert job_url.clean("  https://example.com/a  ") == "https://example.com/a"
    assert job_url.clean("") is None
    assert job_url.clean("   ") is None
    assert job_url.clean(None) is None


def test_emoji_counts_once():
    v = "https://example.com/" + "\U0001F600" * (2000 - len("https://example.com/"))
    assert job_url.clean(v) == v


INVALID = [
    "ftp://example.com/a",
    "javascript:alert(1)",
    "https://",
    "http:///x",
    "https://u:p@example.com",
    "https://u@example.com",
    "https://example.com:99999/a",
    "https://example.com:abc/a",
    "https://exa mple.com/a",
    "https://example.com/a b",
    "https://example.com/a\x00b",
    "https://example.com/a\tb",
    "https://example.com/a\nb",
    "https://example.com/a\x7fb",
    "https://example.com/a\x85b",
    "example.com/a",
]


@pytest.mark.parametrize("v", INVALID)
def test_clean_invalid(v):
    with pytest.raises(ValueError, match="Enter a full address starting with http:// or https://"):
        job_url.clean(v)


def test_clean_too_long():
    v = "https://example.com/" + "a" * (2001 - len("https://example.com/"))
    assert len(v) == 2001
    with pytest.raises(ValueError, match="2,000 characters or fewer"):
        job_url.clean(v)
