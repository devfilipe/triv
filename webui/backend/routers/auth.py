"""
routers/auth.py — Authentication endpoints.

POST /api/auth/login    — obtain a JWT
POST /api/auth/refresh  — renew a JWT
GET  /api/auth/me       — return authenticated user info
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

import auth
import shared

router = APIRouter(prefix="/api/auth", tags=["auth"])

_bearer = HTTPBearer(auto_error=False)


# ---------------------------------------------------------------------------
# Reusable dependency — import this in other routers that need auth
# ---------------------------------------------------------------------------


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> auth.User:
    token = credentials.credentials if credentials else None
    if not token:
        raise HTTPException(401, "Authentication required")
    payload = auth.verify_token(token)
    if not payload:
        raise HTTPException(401, "Invalid or expired token")
    user = auth.get_user_by_id(payload["id"])
    if not user or not user.active:
        raise HTTPException(401, "User inactive or not found")
    return user


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/login")
def login(body: dict):
    username = (body.get("username") or "").strip()
    password = body.get("password") or ""
    if not username or not password:
        raise HTTPException(400, "username and password are required")
    user = auth.get_user_by_username(username)
    if not user or not user.active or not auth.verify_password(password, user.password_hash):
        raise HTTPException(401, "Invalid credentials")
    auth.update_user(user.id, last_login=datetime.now(timezone.utc).isoformat())
    token = auth.create_access_token(user.id)
    return {
        "access_token": token,
        "token_type": "bearer",
        "expires_in": shared.TOKEN_EXPIRE_HOURS * 3600,
        "user": {"id": user.id, "username": user.username, "role": user.role},
    }


@router.post("/refresh")
def refresh(credentials: HTTPAuthorizationCredentials = Depends(_bearer)):
    token = credentials.credentials if credentials else None
    if not token:
        raise HTTPException(401, "Authentication required")
    payload = auth.verify_token(token)
    if not payload:
        raise HTTPException(401, "Invalid or expired token")
    new_token = auth.create_access_token(payload["id"])
    return {"access_token": new_token, "expires_in": shared.TOKEN_EXPIRE_HOURS * 3600}


@router.get("/me")
def me(current_user: auth.User = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "username": current_user.username,
        "email": current_user.email,
        "role": current_user.role,
        "last_login": current_user.last_login,
    }
