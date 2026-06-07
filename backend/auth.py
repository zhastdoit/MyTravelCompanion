"""Supabase JWT verification — used as a FastAPI dependency on protected routes.

Supabase issues access tokens audienced ``authenticated``. We verify the
signature + expiry locally (no upstream call per request) and surface
``user.id`` (= ``jwt.sub``) to the route handler. Two signing schemes are
supported:

* **Asymmetric (ES256/RS256)** — default for new projects (2024+). The
  public key is fetched once from
  ``${SUPABASE_URL}/auth/v1/.well-known/jwks.json`` and cached.
* **Legacy symmetric (HS256)** — shared secret in ``SUPABASE_JWT_SECRET``.
  Still works on old projects.

If neither is configured, the dependency yields an "anonymous" user with
``user_auth_id=""`` so demo + offline dev keep working.
"""
from __future__ import annotations
import logging
import os
from dataclasses import dataclass
from typing import Optional

import jwt
from fastapi import Header, HTTPException, status

log = logging.getLogger(__name__)

_BEARER_PREFIX = "Bearer "
_ALLOWED_ALGS = ("ES256", "RS256", "HS256")
_jwks_client: jwt.PyJWKClient | None = None


@dataclass(frozen=True)
class AuthUser:
    """Minimal user identity carried through to the orchestrator."""
    user_auth_id: str
    email: str = ""
    is_anonymous: bool = False


def _secret() -> str | None:
    return os.getenv("SUPABASE_JWT_SECRET")


def _supabase_url() -> str | None:
    url = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
    return url or None


def auth_enabled() -> bool:
    """True if either an asymmetric (URL) or symmetric (secret) verifier is configured."""
    return bool(_supabase_url() or _secret())


def _get_jwks_client() -> jwt.PyJWKClient | None:
    global _jwks_client
    url = _supabase_url()
    if not url:
        return None
    if _jwks_client is None:
        _jwks_client = jwt.PyJWKClient(
            f"{url}/auth/v1/.well-known/jwks.json",
            cache_keys=True,
            lifespan=3600,  # rotate-tolerant; Supabase signs with stable kids
        )
    return _jwks_client


def _decode(token: str) -> dict:
    """Verify + decode a Supabase JWT, preferring asymmetric over symmetric.

    The token's `alg` header dictates which path we take. We accept any of
    ES256/RS256/HS256 and let PyJWT match against the supplied key.
    """
    common_kwargs = dict(
        algorithms=list(_ALLOWED_ALGS),
        audience="authenticated",
        options={"require": ["sub", "exp"]},
    )

    # Inspect the header so we can pick the right key without retrying.
    try:
        header = jwt.get_unverified_header(token)
    except jwt.InvalidTokenError as err:
        raise jwt.InvalidTokenError(f"malformed JWT: {err}") from err
    alg = (header.get("alg") or "").upper()

    if alg in ("ES256", "RS256"):
        client = _get_jwks_client()
        if not client:
            raise RuntimeError(
                "asymmetric JWT received but SUPABASE_URL is not set; cannot fetch JWKS")
        signing_key = client.get_signing_key_from_jwt(token).key
        return jwt.decode(token, signing_key, **common_kwargs)

    secret = _secret()
    if not secret:
        raise RuntimeError(
            "HS256 JWT received but SUPABASE_JWT_SECRET is not set")
    return jwt.decode(token, secret, **common_kwargs)


def _parse_bearer(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    if not authorization.startswith(_BEARER_PREFIX):
        return None
    token = authorization[len(_BEARER_PREFIX):].strip()
    return token or None


def _from_token(token: str) -> AuthUser:
    try:
        claims = _decode(token)
    except jwt.ExpiredSignatureError as err:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="token expired") from err
    except jwt.InvalidTokenError as err:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail=f"invalid token: {err}") from err
    except jwt.PyJWKClientError as err:
        # JWKS fetch / parse failed (bad SUPABASE_URL, network blip, key
        # rotation race). Convert to 401 + log so the route handler doesn't
        # 500 on otherwise valid tokens.
        log.warning("[auth] JWKS verification failed: %s", err)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail=f"jwks unavailable: {err}") from err
    except Exception as err:  # noqa: BLE001 — last-resort fence
        log.exception("[auth] unexpected verifier failure")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail=f"auth backend unavailable: {err}") from err
    return AuthUser(
        user_auth_id=str(claims["sub"]),
        email=str(claims.get("email", "")),
    )


def require_user(authorization: Optional[str] = Header(default=None)) -> AuthUser:
    """FastAPI dependency: return the authenticated user.

    If Supabase is configured, a missing / invalid token => 401. If it's
    *not* configured (dev demo), the dependency degrades to an anonymous
    identity so `/api/chat` & friends still work.
    """
    token = _parse_bearer(authorization)
    if not auth_enabled():
        if token:
            # Offline/dev mode: no Supabase verifier is configured, but the
            # frontend forwarded a real Supabase token. We can't verify the
            # signature, so trust its `sub` as a stable per-user key — enough to
            # scope local trip-saving to this user. Configure SUPABASE_URL /
            # SUPABASE_JWT_SECRET for *verified* auth in production.
            try:
                claims = jwt.decode(token, options={"verify_signature": False})
                sub = str(claims.get("sub", ""))
                if sub:
                    return AuthUser(
                        user_auth_id=sub,
                        email=str(claims.get("email", "")),
                        is_anonymous=False,
                    )
            except Exception:  # noqa: BLE001
                pass
        return AuthUser(user_auth_id="", is_anonymous=True)

    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="missing Authorization header")
    return _from_token(token)


def optional_user(authorization: Optional[str] = Header(default=None)) -> AuthUser:
    """Like ``require_user``, but never 401s — invalid tokens become anonymous.

    Used for endpoints that benefit from identity if present (telemetry pings)
    but don't strictly need it.
    """
    token = _parse_bearer(authorization)
    if not token:
        return AuthUser(user_auth_id="", is_anonymous=True)
    if not auth_enabled():
        return AuthUser(user_auth_id="", is_anonymous=True)
    try:
        return _from_token(token)
    except HTTPException:
        return AuthUser(user_auth_id="", is_anonymous=True)
