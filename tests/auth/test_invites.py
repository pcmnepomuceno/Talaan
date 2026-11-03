import re

import pytest

from app.auth import invites

BODY = "ABCD2345EFGH"
GOOD_HASH = invites.hash_code(BODY)


@pytest.mark.parametrize(
    "raw",
    [
        "TLN-ABCD-2345-EFGH",
        "tln-abcd-2345-efgh",
        "TLNABCD2345EFGH",
        "ABCD-2345-EFGH",  # no prefix
        "abcd2345efgh",
        "  TLN-ABCD-2345-EFGH  ",
        "TLN ABCD 2345 EFGH",
        "TLN-ABCD-2345-EFGH\r\n",  # pasted from Windows
        "\tTLN-ABCD-2345-EFGH\n",
    ],
)
def test_normalize_equivalent_inputs_give_one_hash(raw):
    assert invites.normalize(raw) == BODY
    assert invites.hash_code(invites.normalize(raw)) == GOOD_HASH


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "TLN-ABCD-2345-EFG",  # too short
        "TLN-ABCD-2345-EFGHJ",  # too long
        "TLN-ABCD-2345-EFGI",  # I
        "TLN-ABCD-2345-EFGL",  # L
        "TLN-ABCD-2345-EFGO",  # O
        "TLN-ABCD-2345-EFGU",  # U
        "TLN-ABCD-2345-EF!H",
        "A" * 65,
        "TLN-" + "A" * 10_000,
    ],
)
def test_normalize_rejects_malformed(raw):
    assert invites.normalize(raw) is None


def test_generate_format_and_hash():
    display, h = invites.generate()
    assert re.fullmatch(r"TLN-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}", display)
    assert h == invites.hash_code(invites.normalize(display))
    assert len(h) == 64


def test_generate_codes_are_distinct():
    assert len({invites.generate()[0] for _ in range(1000)}) == 1000
