"""
webui/backend/app.py — Slim entry-point for the decomposed triv WebUI backend.

Bootstraps core state, registers all API routers, starts background
threads, and serves the built frontend.

Launch:
    uvicorn webui.backend.app:app --host 0.0.0.0 --port 8080
"""

import sys
import threading
from pathlib import Path

# Ensure that local modules (shared, bootstrap, routers, …) are importable
# regardless of whether uvicorn is invoked from the repo root
# (webui.backend.app:app) or from the backend directory (app:app).
_backend_dir = str(Path(__file__).resolve().parent)
if _backend_dir not in sys.path:
    sys.path.insert(0, _backend_dir)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# ---------------------------------------------------------------------------
# 1. Bootstrap core (drivers, topology, plugins, state reconciliation)
# ---------------------------------------------------------------------------

import bootstrap  # noqa: F401  — populates ``shared`` module globals

bootstrap.bootstrap()

# ---------------------------------------------------------------------------
# 2. Create FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(title="triv WebUI", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# 3. Register routers
# ---------------------------------------------------------------------------

from routers.topology import router as topology_router
from routers.capabilities import router as capabilities_router
from routers.drivers import router as drivers_router
from routers.nodes import router as nodes_router
from routers.adhoc import router as adhoc_router
from routers.networks_v2 import router as networks_v2_router
from routers.connectivity import router as connectivity_router
from routers.status import router as status_router
from routers.projects import router as projects_router
from routers.cleanup import router as cleanup_router
from routers.plugins import router as plugins_router
from routers.websockets import router as websockets_router
from routers.netstats import router as netstats_router
from routers.ai import router as ai_router
from routers.secrets import router as secrets_router
from routers.wizard import router as wizard_router
from routers.orgs import router as orgs_router

app.include_router(topology_router)
app.include_router(capabilities_router)
app.include_router(drivers_router)
app.include_router(nodes_router)
app.include_router(adhoc_router)
app.include_router(networks_v2_router)
app.include_router(connectivity_router)
app.include_router(status_router)
app.include_router(projects_router)
app.include_router(cleanup_router)
app.include_router(plugins_router)
app.include_router(websockets_router)
app.include_router(netstats_router)
app.include_router(ai_router)
app.include_router(secrets_router)
app.include_router(wizard_router)
app.include_router(orgs_router)

# ---------------------------------------------------------------------------
# 4. Startup event
# ---------------------------------------------------------------------------

import shared
from health import health_check_loop
from routers.projects import _load_projects, _save_projects, _switch_project


@app.on_event("startup")
def _on_startup():
    """Start background health-check polling and restore last active project."""

    # Health check thread
    t = threading.Thread(target=health_check_loop, daemon=True)
    t.start()

    # Initialise wizard topology
    from wizard_manager import WizardManager
    WizardManager.init()

    # Restore last active project
    saved = _load_projects()
    active_id = saved.get("active", "")
    if not active_id:
        shared.topology = None
        print("[startup] No active project — waiting for user selection")
        return

    active_proj = next((p for p in saved.get("projects", []) if p["id"] == active_id), None)
    if active_proj:
        if active_proj["path"] != str(shared.PROJECT_DIR):
            _switch_project(active_proj["path"], run_auto=False)
        print(f"[startup] Restored active project: {active_id}")
    else:
        shared.topology = None
        saved["active"] = ""
        _save_projects(saved)
        print(f"[startup] Active project '{active_id}' not found — cleared")


# ---------------------------------------------------------------------------
# 5. Serve built frontend (must be last — catch-all mount)
# ---------------------------------------------------------------------------

_frontend_dist = Path(__file__).parent.parent / "frontend" / "dist"
if _frontend_dist.exists():
    app.mount("/", StaticFiles(directory=str(_frontend_dist), html=True), name="frontend")

# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="0.0.0.0", port=8080, reload=True)
