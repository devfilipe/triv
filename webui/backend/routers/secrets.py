"""
routers/secrets.py — HTTP CRUD for the triv centralized secret store.

Secret *values* are never returned by the list endpoint — only name, type
and a masked hint are exposed. Callers must explicitly POST /resolve to get
a value, which is intended for internal driver use only.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from triv.core.secrets import list_secrets, set_secret, delete_secret

router = APIRouter(prefix="/api/secrets", tags=["secrets"])


class SecretIn(BaseModel):
    name: str
    type: str = "api-key"  # api-key | bearer | url | token
    value: str


@router.get("")
def get_secrets():
    """List all secrets (names + masked hints — no values)."""
    return list_secrets()


@router.put("/{name}")
def upsert_secret(name: str, body: SecretIn):
    """Create or update a secret."""
    if not name.strip():
        raise HTTPException(400, "Secret name cannot be empty")
    if not body.value.strip():
        raise HTTPException(400, "Secret value cannot be empty")
    set_secret(name, body.type, body.value)
    return {"ok": True, "name": name}


@router.delete("/{name}")
def remove_secret(name: str):
    """Delete a secret."""
    if not delete_secret(name):
        raise HTTPException(404, f"Secret '{name}' not found")
    return {"ok": True, "name": name}
