"""
Shared mutable state and path constants for the triv WebUI backend.

Every router and helper module imports from here to access/mutate
global state (topology, registry, project paths, health cache, etc.).
"""

import os
import secrets as _secrets_mod
import threading
from pathlib import Path
from typing import Any

from triv.core.events import EventBus
from triv.core.state import StateTracker
from triv.drivers import DriverRegistry

# ---------------------------------------------------------------------------
# Path constants
# ---------------------------------------------------------------------------

TRIV_HOME = Path(os.environ.get("TRIV_HOME", Path.home() / ".triv"))
TRIV_HOME.mkdir(parents=True, exist_ok=True)

PROJECT_DIR: str = os.environ.get("TOPO_PROJECT_DIR", "")
TOOLS_DIR: Path = Path(__file__).resolve().parent.parent.parent  # triv/
PROJECTS_ROOT_DEFAULT: str = str(TRIV_HOME / "vendors")
TOPOLOGY_FILE: Path = Path(PROJECT_DIR) / "topology.json" if PROJECT_DIR else Path("/dev/null")
ADHOC_FILE: Path = Path(PROJECT_DIR) / "adhoc-devices.json"

LIBVIRT_URI: str = "qemu:///system"
C_ENV: dict[str, str] = {**os.environ, "LANG": "C", "LC_ALL": "C"}

PROJECTS_CONFIG = Path(os.environ.get("TRIV_PROJECTS_FILE", str(TRIV_HOME / "projects.json")))

# ---------------------------------------------------------------------------
# Core singletons
# ---------------------------------------------------------------------------

event_bus = EventBus()
registry = DriverRegistry()

# These are set by bootstrap.bootstrap()
topology: Any = None
plugin_mgr: Any = None
ctx: Any = None

state_tracker = StateTracker()

# ---------------------------------------------------------------------------
# Wizard state
# ---------------------------------------------------------------------------

wizard_topology: Any = None  # loaded by WizardManager at startup
wizard_config: dict = {}  # persisted config (provider, model, enabled, instructions)
WIZARD_DIR: Path = TOOLS_DIR / "triv" / "wizard"
WIZARD_TOPOLOGY_FILE: Path = WIZARD_DIR / "projects" / "wizard" / "topology.json"
WIZARD_CAPS_DIR: Path = WIZARD_DIR / "capabilities"
WIZARD_APP_SCRIPT: Path = WIZARD_DIR / "wizard_app.py"
WIZARD_CONFIG_FILE: Path = TRIV_HOME / "wizard_config.json"
ORGS_DIR: Path = TRIV_HOME / "orgs"
ORGS_DIR.mkdir(parents=True, exist_ok=True)
WIZARD_SYSTEM_PROMPT_FILE: Path = WIZARD_DIR / ".system_prompt"
WIZARD_RULES_FILE: Path = WIZARD_DIR / ".rules"

# URL the backend is reachable at — used by wizard_app.py subprocess
SERVER_URL: str = os.environ.get("TRIV_API_URL", "http://localhost:8481")

# ---------------------------------------------------------------------------
# Auth configuration
# ---------------------------------------------------------------------------

SECRET_KEY: str = os.environ.get("TRIV_SECRET_KEY", "")
if not SECRET_KEY:
    SECRET_KEY = _secrets_mod.token_hex(32)
    print(
        "[auth] WARNING: TRIV_SECRET_KEY not set — using a random key. "
        "All tokens will be invalidated on restart. "
        "Set TRIV_SECRET_KEY in your .env file for persistent sessions."
    )

ADMIN_USER: str = os.environ.get("TRIV_ADMIN_USER", "admin")
ADMIN_PASSWORD: str = os.environ.get("TRIV_ADMIN_PASSWORD", "")
TOKEN_EXPIRE_HOURS: int = int(os.environ.get("TRIV_TOKEN_EXPIRE_HOURS", "8"))
MAX_USERS: int = int(os.environ.get("TRIV_MAX_USERS", "3"))

# ---------------------------------------------------------------------------
# Health check cache
# ---------------------------------------------------------------------------

_health_cache: dict[str, dict] = {}
_health_lock = threading.Lock()

# ---------------------------------------------------------------------------
# Interaction history (in-memory, per-node, capped at 200 entries each)
# ---------------------------------------------------------------------------

_history: dict[str, list[dict]] = {}  # node_id → [entry, ...]
_history_lock = threading.Lock()
HISTORY_CAP = 200


def append_history(node_id: str, entry: dict) -> None:
    with _history_lock:
        if node_id not in _history:
            _history[node_id] = []
        _history[node_id].append(entry)
        if len(_history[node_id]) > HISTORY_CAP:
            _history[node_id] = _history[node_id][-HISTORY_CAP:]


def get_history(node_id: str, limit: int = 50) -> list[dict]:
    with _history_lock:
        entries = _history.get(node_id, [])
        return list(entries[-limit:]) if limit else list(entries)
