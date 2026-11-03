from app import config
from app.auth.security import hash_password


def test_bcrypt_rounds_default_is_12():
    assert config.DEFAULT_BCRYPT_ROUNDS == 12


def test_hash_password_reads_rounds_at_call_time(monkeypatch):
    monkeypatch.setattr(config, "BCRYPT_ROUNDS", 5)
    assert hash_password("x").startswith("$2b$05$")
