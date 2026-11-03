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
        "TLN-ABCD-2345-EFGU",  # U has no alias
        "TLN-ABCD-2345-EFG\u017f",  # long s: uppercases to S
        "TLN-ABCD-2345-EFG\u212a",  # Kelvin sign, looks like K
        "TLN-ABCD-2345-EFGH\u00a0",  # non-ASCII whitespace
        "TLNTLN-ABCD-2345-EFGH",  # prefix stripped once only
        "ABC-2345-EFGH",  # 11 chars: no prefix to strip
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


@pytest.mark.parametrize(
    "raw",
    [
        "TLN-01AB-01CD-0110",  # canonical
        "TLN-OIAB-OLCD-OILO",
        "tln-oiab-olcd-oilo",
        "OIAB-0lCD-0Il0",  # no prefix
    ],
)
def test_crockford_aliases_give_the_canonical_hash(raw):
    assert invites.normalize(raw) == "01AB01CD0110"
    assert invites.hash_code(invites.normalize(raw)) == invites.hash_code("01AB01CD0110")


@pytest.mark.parametrize(
    "raw",
    [
        "TLN-T1NA-BCD2-3456",  # prefix + body
        "T1NA-BCD2-3456",  # body only
        "TLNA-BCD2-3456",  # body only, L alias: 12 chars, so not taken as the prefix
        "tlnt1nabcd23456",
    ],
)
def test_body_starting_with_t1n_works_with_and_without_prefix(raw):
    assert invites.normalize(raw) == "T1NABCD23456"
