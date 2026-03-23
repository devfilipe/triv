"""triv.core.secrets — Centralized secret resolution.

Secrets are stored in $TRIV_HOME/secrets.json (default ~/.triv/secrets.json)
with restrictive file permissions (owner r/w only).

Values can also be overridden at runtime via environment variables:
    TRIV_SECRET_<NAME>   (name uppercased, - and . replaced with _)

This module lives in triv.core so it can be imported by drivers without
pulling in any web-layer dependency.
"""

from __future__ import annotations

import json
import os
import stat
from pathlib import Path


def _secrets_path() -> Path:
    triv_home = os.environ.get("TRIV_HOME") or str(Path.home() / ".triv")
    return Path(triv_home) / "secrets.json"


def _env_key(name: str) -> str:
    return "TRIV_SECRET_" + name.upper().replace("-", "_").replace(".", "_")


def _mask(value: str) -> str:
    if not value:
        return "—"
    if len(value) <= 8:
        return "***"
    return value[:4] + "·····" + value[-2:]


def _load_raw() -> dict:
    p = _secrets_path()
    try:
        return json.loads(p.read_text())
    except (OSError, json.JSONDecodeError):
        return {}


def _save_raw(data: dict) -> None:
    p = _secrets_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, indent=2))
    try:
        os.chmod(p, stat.S_IRUSR | stat.S_IWUSR)
    except OSError:
        pass


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def resolve(name: str) -> str | None:
    """Return the secret value for *name*, or None if not found.

    Env var (``TRIV_SECRET_<NAME>``) takes priority over the file store.
    """
    env_val = os.environ.get(_env_key(name))
    if env_val:
        return env_val
    entry = _load_raw().get(name)
    if entry:
        return entry.get("value")
    return None


def list_secrets() -> dict[str, dict]:
    """Return all secrets as ``{name: {type, hint}}`` — values are masked."""
    data = _load_raw()
    result: dict[str, dict] = {}
    for name, entry in data.items():
        val = entry.get("value", "")
        env_override = bool(os.environ.get(_env_key(name)))
        result[name] = {
            "type": entry.get("type", "api-key"),
            "hint": _mask(val),
            "env_override": env_override,
        }
    return result


def set_secret(name: str, type_: str, value: str) -> None:
    """Create or update a secret."""
    data = _load_raw()
    data[name] = {"type": type_, "value": value}
    _save_raw(data)


def delete_secret(name: str) -> bool:
    """Delete a secret. Returns True if it existed."""
    data = _load_raw()
    if name not in data:
        return False
    del data[name]
    _save_raw(data)
    return True
