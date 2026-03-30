"""
webui/backend/auth.py — JWT authentication and user management.

Provides:
  - Password hashing/verification (bcrypt via passlib)
  - JWT creation/validation (HS256 via python-jose)
  - User CRUD backed by $TRIV_HOME/users.json
  - Bootstrap of the initial admin user on first run
"""

import json
import uuid
from dataclasses import dataclass, asdict
from datetime import datetime, timezone, timedelta
from typing import Optional

import bcrypt as _bcrypt
from jose import JWTError, jwt

import shared

# ---------------------------------------------------------------------------
# Password hashing
# ---------------------------------------------------------------------------


def hash_password(plain: str) -> str:
    return _bcrypt.hashpw(plain.encode(), _bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _bcrypt.checkpw(plain.encode(), hashed.encode())
    except Exception:
        return False


# ---------------------------------------------------------------------------
# JWT
# ---------------------------------------------------------------------------

ALGORITHM = "HS256"


def create_access_token(user_id: str, expires_delta: Optional[timedelta] = None) -> str:
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(hours=shared.TOKEN_EXPIRE_HOURS)
    )
    payload = {"sub": user_id, "exp": expire}
    return jwt.encode(payload, shared.SECRET_KEY, algorithm=ALGORITHM)


def verify_token(token: str) -> Optional[dict]:
    """Return token payload dict or None if invalid/expired."""
    try:
        payload = jwt.decode(token, shared.SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if not user_id:
            return None
        user = get_user_by_id(user_id)
        if not user or not user.active:
            return None
        return {"id": user.id, "username": user.username, "role": user.role}
    except JWTError:
        return None


# ---------------------------------------------------------------------------
# User model
# ---------------------------------------------------------------------------


@dataclass
class User:
    id: str
    username: str
    email: str
    password_hash: str
    role: str  # "admin" | "editor" | "viewer"
    created_at: str  # ISO 8601
    active: bool
    created_by: str  # id of the user who created this one
    last_login: Optional[str] = None
    must_change_password: bool = False


# ---------------------------------------------------------------------------
# User store (file-backed)
# ---------------------------------------------------------------------------

_USERS_FILE = shared.TRIV_HOME / "users.json"


def _load_raw() -> list[dict]:
    if not _USERS_FILE.exists():
        return []
    try:
        return json.loads(_USERS_FILE.read_text())
    except Exception:
        return []


def _save_raw(users: list[dict]) -> None:
    _USERS_FILE.write_text(json.dumps(users, indent=2))


def _to_user(d: dict) -> User:
    return User(
        id=d["id"],
        username=d["username"],
        email=d.get("email", ""),
        password_hash=d["password_hash"],
        role=d.get("role", "viewer"),
        created_at=d.get("created_at", ""),
        active=d.get("active", True),
        created_by=d.get("created_by", ""),
        last_login=d.get("last_login"),
        must_change_password=d.get("must_change_password", False),
    )


def load_users() -> list[User]:
    return [_to_user(d) for d in _load_raw()]


def save_users(users: list[User]) -> None:
    _save_raw([asdict(u) for u in users])


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------


def get_user_by_id(user_id: str) -> Optional[User]:
    return next((u for u in load_users() if u.id == user_id), None)


def get_user_by_username(username: str) -> Optional[User]:
    return next((u for u in load_users() if u.username == username), None)


def create_user(
    username: str,
    email: str,
    password: str,
    role: str,
    created_by: str,
) -> User:
    users = load_users()
    if any(u.username == username for u in users):
        raise ValueError(f"Username '{username}' already exists")
    if len(password) < 8:
        raise ValueError("Password must be at least 8 characters")
    # Enforce MAX_USERS limit (Community tier)
    active_count = sum(1 for u in users if u.active)
    if active_count >= shared.MAX_USERS:
        raise ValueError("User limit reached for current license tier")
    user = User(
        id=str(uuid.uuid4()),
        username=username,
        email=email,
        password_hash=hash_password(password),
        role=role,
        created_at=datetime.now(timezone.utc).isoformat(),
        active=True,
        created_by=created_by,
    )
    users.append(user)
    save_users(users)
    return user


def update_user(user_id: str, **fields) -> User:
    users = load_users()
    user = next((u for u in users if u.id == user_id), None)
    if not user:
        raise ValueError(f"User '{user_id}' not found")
    allowed = {"email", "role", "active", "must_change_password", "last_login"}
    for k, v in fields.items():
        if k in allowed:
            setattr(user, k, v)
    save_users(users)
    return user


def deactivate_user(user_id: str) -> User:
    return update_user(user_id, active=False)


def list_users() -> list[User]:
    return load_users()


def change_password(user_id: str, new_password: str) -> None:
    if len(new_password) < 8:
        raise ValueError("Password must be at least 8 characters")
    users = load_users()
    user = next((u for u in users if u.id == user_id), None)
    if not user:
        raise ValueError(f"User '{user_id}' not found")
    user.password_hash = hash_password(new_password)
    user.must_change_password = False
    save_users(users)


# ---------------------------------------------------------------------------
# Bootstrap
# ---------------------------------------------------------------------------


def bootstrap_admin() -> None:
    """Create the initial admin user if users.json doesn't exist yet."""
    if _USERS_FILE.exists():
        return
    username = shared.ADMIN_USER
    password = shared.ADMIN_PASSWORD
    if not password:
        raise RuntimeError(
            "\n\n"
            "  ERROR: TRIV_ADMIN_PASSWORD must be set on first run.\n"
            "  Copy docker/.env.example to docker/.env and fill in the required values.\n"
            "  Then restart the container.\n"
        )
    user = User(
        id=str(uuid.uuid4()),
        username=username,
        email="",
        password_hash=hash_password(password),
        role="admin",
        created_at=datetime.now(timezone.utc).isoformat(),
        active=True,
        created_by="system",
    )
    save_users([user])
    print(f"[auth] Bootstrap: created admin user '{username}'")
