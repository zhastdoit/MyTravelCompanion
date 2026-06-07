"""Unit tests for the Supabase JWT verifier dependency.

Two configurations exercised: auth disabled (no secret -> anonymous) and
auth required (HS256 with the test secret). Tokens are minted locally with
``PyJWT`` so no Supabase server is needed.
"""
from __future__ import annotations

import time
import uuid

import jwt
import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

import auth


SECRET = "test-secret-must-be-at-least-32-bytes-long"  # noqa: S105


def _mint(sub: str = "user-1", *, secret: str = SECRET, exp: int | None = None,
          aud: str = "authenticated") -> str:
    payload = {
        "sub": sub,
        "email": f"{sub}@example.com",
        "aud": aud,
        "exp": exp if exp is not None else int(time.time()) + 600,
        "iat": int(time.time()),
    }
    return jwt.encode(payload, secret, algorithm="HS256")


@pytest.fixture
def app() -> FastAPI:
    application = FastAPI()

    @application.get("/me")
    def me(user: auth.AuthUser = Depends(auth.require_user)):
        return {"sub": user.user_auth_id, "anonymous": user.is_anonymous}

    return application


def test_disabled_auth_yields_anonymous(monkeypatch, app: FastAPI):
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    res = TestClient(app).get("/me")
    assert res.status_code == 200
    assert res.json() == {"sub": "", "anonymous": True}


def test_required_auth_rejects_missing_token(monkeypatch, app: FastAPI):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", SECRET)
    res = TestClient(app).get("/me")
    assert res.status_code == 401


def test_required_auth_accepts_valid_token(monkeypatch, app: FastAPI):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", SECRET)
    sub = uuid.uuid4().hex
    res = TestClient(app).get("/me", headers={"authorization": f"Bearer {_mint(sub)}"})
    assert res.status_code == 200
    body = res.json()
    assert body["sub"] == sub
    assert body["anonymous"] is False


def test_required_auth_rejects_expired_token(monkeypatch, app: FastAPI):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", SECRET)
    expired = _mint("user-1", exp=int(time.time()) - 60)
    res = TestClient(app).get("/me", headers={"authorization": f"Bearer {expired}"})
    assert res.status_code == 401


def test_required_auth_rejects_wrong_signature(monkeypatch, app: FastAPI):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", SECRET)
    bad = _mint("user-1", secret="other-secret-also-32-bytes-of-entropy-here")
    res = TestClient(app).get("/me", headers={"authorization": f"Bearer {bad}"})
    assert res.status_code == 401


def test_required_auth_rejects_wrong_audience(monkeypatch, app: FastAPI):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", SECRET)
    bad = _mint("user-1", aud="anon")
    res = TestClient(app).get("/me", headers={"authorization": f"Bearer {bad}"})
    assert res.status_code == 401


def test_es256_path_verifies_via_mocked_jwks(monkeypatch, app: FastAPI):
    """Modern Supabase projects sign with ES256; we should accept it after
    fetching the public key from the project JWKS endpoint."""
    from cryptography.hazmat.primitives.asymmetric import ec
    from types import SimpleNamespace

    private_key = ec.generate_private_key(ec.SECP256R1())
    public_key = private_key.public_key()

    sub = "es256-user"
    payload = {
        "sub": sub,
        "email": f"{sub}@example.com",
        "aud": "authenticated",
        "exp": int(time.time()) + 600,
        "iat": int(time.time()),
    }
    token = jwt.encode(payload, private_key, algorithm="ES256",
                       headers={"kid": "test-key", "alg": "ES256"})

    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    auth._jwks_client = None  # reset cached client between tests

    fake_signing_key = SimpleNamespace(key=public_key)
    fake_jwks_client = SimpleNamespace(
        get_signing_key_from_jwt=lambda _t: fake_signing_key,
    )
    monkeypatch.setattr(auth, "_get_jwks_client", lambda: fake_jwks_client)

    res = TestClient(app).get("/me", headers={"authorization": f"Bearer {token}"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["sub"] == sub
    assert body["anonymous"] is False


def test_disabled_auth_extracts_unverified_sub_when_token_present(
    monkeypatch, app: FastAPI,
):
    """Demo mode without a secret still surfaces the user id from a passed
    token (best effort, not trusted) so the orchestrator can scope state."""
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    token = _mint("user-demo")
    res = TestClient(app).get(
        "/me", headers={"authorization": f"Bearer {token}"})
    assert res.status_code == 200
    body = res.json()
    assert body["sub"] == "user-demo"
    assert body["anonymous"] is True
