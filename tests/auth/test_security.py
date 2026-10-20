import re

from app.auth.security import generate_session_token, hash_session_token


def test_hash_is_deterministic_hex64():
    h = hash_session_token("abc")
    assert h == hash_session_token("abc")
    assert re.fullmatch(r"[0-9a-f]{64}", h)


def test_hash_known_vector():
    assert hash_session_token("abc") == (
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    )


def test_different_tokens_different_hashes():
    assert hash_session_token("abc") != hash_session_token("abd")


def test_generated_tokens_differ():
    assert generate_session_token() != generate_session_token()


def test_hash_handles_huge_and_unicode_input():
    assert len(hash_session_token("x" * 100_000)) == 64
    assert len(hash_session_token("éÿ日本")) == 64
