"""
Router: projects — register, switch, browse, create, delete projects.
"""

import json
import os
import shutil
from pathlib import Path

from fastapi import APIRouter, HTTPException, Body

from triv.core.state import Cleanup
import triv.core.env as env_mod
import triv.core.network as netmod

import shared
from shared import state_tracker

router = APIRouter(prefix="/api", tags=["projects"])


# ── Helpers ──────────────────────────────────────────────────────


def _remap_triv_path(path_str: str) -> str:
    """Remap any ``…/.triv/…`` path to the current TRIV_HOME.

    When projects.json is shared between host and container the stored
    absolute paths may use a different ``.triv`` prefix (e.g.
    ``/home/user/.triv`` on the host vs ``/root/.triv`` inside Docker).
    This helper detects the ``.triv`` component and re-roots the
    remainder under the running process's TRIV_HOME.
    """
    parts = Path(path_str).parts
    for i, part in enumerate(parts):
        if part == ".triv":
            rel = Path(*parts[i + 1 :]) if i + 1 < len(parts) else Path(".")
            return str(shared.TRIV_HOME / rel)
    return path_str


def _normalise_project_paths(data: dict) -> dict:
    changed = False
    for proj in data.get("projects", []):
        p = proj.get("path", "")
        remapped = _remap_triv_path(p)
        if remapped != p:
            proj["path"] = remapped
            changed = True
    if changed:
        _save_projects(data)
    return data


def _load_projects() -> dict:
    if shared.PROJECTS_CONFIG.exists():
        try:
            with open(shared.PROJECTS_CONFIG) as f:
                data = json.load(f)
            return _normalise_project_paths(data)
        except Exception:
            pass
    return {"active": "", "projects": []}


def _save_projects(data: dict) -> None:
    shared.PROJECTS_CONFIG.parent.mkdir(parents=True, exist_ok=True)
    with open(shared.PROJECTS_CONFIG, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")


def _find_topology_files(directory: str) -> list[str]:
    p = Path(directory)
    candidates = []
    for pattern in ("topology.json", "*topology*.json"):
        for f in p.glob(pattern):
            if f.is_file() and str(f) not in candidates:
                candidates.append(str(f))
    return sorted(set(candidates))


def _switch_project(project_path: str, run_auto: bool = False) -> None:
    from routers.topology import reload_topology, run_auto_topology_actions
    from reconcile import reconcile_state

    project_path = _remap_triv_path(project_path)

    shared.PROJECT_DIR = project_path
    os.environ["TOPO_PROJECT_DIR"] = project_path
    shared.TOPOLOGY_FILE = Path(project_path) / "topology.json"

    if shared.TOPOLOGY_FILE.exists():
        try:
            reload_topology()
            print(
                f"[project] Switched to: {shared.topology.name} ({project_path})"
                + (" [auto-init]" if run_auto else "")
            )
        except Exception as e:
            shared.topology = None
            print(f"[project] Failed to load topology from {shared.TOPOLOGY_FILE}: {e}")
    else:
        shared.topology = None
        print(f"[project] No topology file found in {project_path}")

    env_mod.clear_actions_cache()

    if shared.ctx:
        shared.ctx.topology = shared.topology
        shared.ctx.project_dir = str(shared.PROJECT_DIR)

    reconcile_state()

    if run_auto:
        run_auto_topology_actions()


# ── Endpoints ────────────────────────────────────────────────────


@router.get("/projects")
def get_projects():
    data = _load_projects()
    active = data.get("active", "")
    last_active = data.get("last_active", "")
    projects = data.get("projects", [])
    for p in projects:
        p["active"] = p["id"] == active
        p["has_topology"] = bool(_find_topology_files(p["path"]))
    return {"active": active, "last_active": last_active, "projects": projects}


@router.post("/projects")
def add_project(body: dict = Body(...)):
    path = body.get("path", "").strip()
    name = body.get("name", "").strip()
    description = body.get("description", "").strip()

    if not path:
        raise HTTPException(400, "Missing 'path'")
    p = Path(path)
    if not p.is_dir():
        raise HTTPException(400, f"Directory does not exist: {path}")

    topo_files = _find_topology_files(path)
    if not topo_files:
        raise HTTPException(400, f"No topology JSON found in {path}")

    data = _load_projects()
    for existing in data["projects"]:
        if existing["path"] == str(p):
            raise HTTPException(409, f"Project already registered: {existing['id']}")

    if not name:
        try:
            with open(topo_files[0]) as f:
                td = json.load(f)
                name = td.get("name", p.name)
        except Exception:
            name = p.name

    project_id = name.lower().replace(" ", "-").replace("/", "-")
    existing_ids = {pr["id"] for pr in data["projects"]}
    base_id = project_id
    counter = 1
    while project_id in existing_ids:
        project_id = f"{base_id}-{counter}"
        counter += 1

    entry = {"id": project_id, "name": name, "path": str(p), "description": description}
    data["projects"].append(entry)
    _save_projects(data)
    return {"ok": True, "project": entry, "topology_files": topo_files}


@router.post("/projects/{project_id}/activate")
def activate_project(project_id: str):
    data = _load_projects()
    proj = next((p for p in data["projects"] if p["id"] == project_id), None)
    if not proj:
        raise HTTPException(404, f"Project '{project_id}' not found")

    current_active = data.get("active", "")
    if current_active and current_active != project_id:
        active_name = next(
            (p["name"] for p in data["projects"] if p["id"] == current_active),
            current_active,
        )
        raise HTTPException(
            409,
            f"Project '{active_name}' is currently active. "
            f"Run cleanup before activating a different project.",
        )

    initialized = set(data.get("initialized", []))
    first_time = project_id not in initialized

    _switch_project(proj["path"], run_auto=first_time)

    data["active"] = project_id
    data["last_active"] = project_id
    if first_time:
        initialized.add(project_id)
        data["initialized"] = list(initialized)
    _save_projects(data)

    return {
        "ok": True,
        "project": proj,
        "topology_loaded": shared.topology is not None,
        "topology_name": shared.topology.name if shared.topology else None,
        "node_count": len(shared.topology.nodes) if shared.topology else 0,
        "link_count": len(shared.topology.links) if shared.topology else 0,
        "auto_init": first_time,
    }


@router.delete("/projects/{project_id}")
def remove_project(project_id: str):
    data = _load_projects()
    idx = next((i for i, p in enumerate(data["projects"]) if p["id"] == project_id), None)
    if idx is None:
        raise HTTPException(404, f"Project '{project_id}' not found")

    removed = data["projects"].pop(idx)
    if data["active"] == project_id:
        data["active"] = ""
        shared.topology = None

    _save_projects(data)
    return {"ok": True, "removed": removed}


@router.post("/projects/{project_id}/cleanup")
def cleanup_project(project_id: str):
    from routers.segments import _disconnect_host_from_segment

    data = _load_projects()
    proj = next((p for p in data["projects"] if p["id"] == project_id), None)
    if not proj:
        raise HTTPException(404, f"Project '{project_id}' not found")

    current_path = str(shared.PROJECT_DIR)
    was_different = proj["path"] != current_path

    all_errors: list[str] = []
    seg_reports: list[dict] = []

    try:
        if was_different:
            _switch_project(proj["path"])

        if shared.topology and shared.topology.segments:
            pid = shared.topology.project_id
            for seg in shared.topology.segments:
                if seg.host_access and seg.host_network:
                    try:
                        _disconnect_host_from_segment(seg, pid)
                    except Exception as e:
                        all_errors.append(f"host-disconnect {seg.id}: {e}")
                for link_id in seg.links:
                    link = next((lk for lk in shared.topology.links if lk.id == link_id), None)
                    if link:
                        try:
                            r = netmod.teardown_link(link, state_tracker, project_id=pid)
                            seg_reports.append(r)
                        except Exception as e:
                            all_errors.append(f"teardown link {link_id}: {e}")

        if shared.topology:
            pid = shared.topology.project_id
            for link in shared.topology.links:
                try:
                    netmod.teardown_link(link, state_tracker, project_id=pid)
                except Exception:
                    pass

        c = Cleanup()
        try:
            state_errors = c.teardown_all(dry_run=False)
            all_errors.extend(state_errors)
        except Exception as e:
            all_errors.append(f"state-cleanup: {e}")

        shared.topology = None
        data = _load_projects()
        data["active"] = ""
        _save_projects(data)

        if was_different:
            try:
                _switch_project(current_path)
            except Exception as e:
                all_errors.append(f"restore-project: {e}")

    except Exception as e:
        all_errors.append(f"cleanup: {e}")
        print(f"[cleanup] Unexpected error for project {project_id}: {e}")

    return {
        "ok": len(all_errors) == 0,
        "errors": all_errors,
        "project": proj["id"],
        "deactivated": True,
        "segment_reports": seg_reports,
    }


@router.post("/projects/scan")
def scan_directory(body: dict = Body(...)):
    path = body.get("path", "").strip()
    if not path:
        raise HTTPException(400, "Missing 'path'")
    p = Path(path)
    if not p.is_dir():
        raise HTTPException(400, f"Not a directory: {path}")

    topo_files = _find_topology_files(path)
    auto_name = ""
    if topo_files:
        try:
            with open(topo_files[0]) as f:
                td = json.load(f)
                auto_name = td.get("name", p.name)
        except Exception:
            auto_name = p.name

    return {
        "path": str(p),
        "topology_files": topo_files,
        "auto_name": auto_name,
        "valid": len(topo_files) > 0,
    }


@router.post("/projects/browse")
def browse_directory(body: dict = Body(...)):
    path = body.get("path", "").strip() or "/"
    p = Path(path)
    if not p.is_dir():
        raise HTTPException(400, f"Not a directory: {path}")

    subdirs: list[dict] = []
    try:
        for entry in sorted(p.iterdir()):
            if entry.is_dir() and not entry.name.startswith("."):
                has_topo = bool(_find_topology_files(str(entry)))
                subdirs.append(
                    {
                        "name": entry.name,
                        "path": str(entry),
                        "has_topology": has_topo,
                    }
                )
    except PermissionError:
        pass

    parent = str(p.parent) if str(p) != "/" else None
    return {"current": str(p), "parent": parent, "directories": subdirs}


@router.get("/projects/defaults")
def get_project_defaults():
    projects_root = os.environ.get("TRIV_PROJECTS_ROOT", shared.PROJECTS_ROOT_DEFAULT)
    return {
        "projects_root": projects_root,
        "current_project": str(shared.PROJECT_DIR),
    }


@router.post("/projects/create")
def create_project(body: dict = Body(...)):
    name = body.get("name", "").strip()
    dir_name = body.get("dir_name", "").strip()
    parent = body.get("parent", "").strip()
    description = body.get("description", "").strip()

    if not name:
        raise HTTPException(400, "Project name is required")

    if not dir_name:
        dir_name = (
            name.lower().replace(" ", "-").replace("/", "-").replace("\\", "-").replace(".", "-")
        )
        dir_name = "".join(c for c in dir_name if c.isalnum() or c in "-_")
        dir_name = dir_name.strip("-_") or "new-project"

    if not all(c.isalnum() or c in "-_" for c in dir_name):
        raise HTTPException(
            400, "Directory name must contain only letters, digits, hyphens, underscores"
        )

    if not parent:
        parent = os.environ.get("TRIV_PROJECTS_ROOT", shared.PROJECTS_ROOT_DEFAULT)

    parent_path = Path(parent)
    if not parent_path.is_dir():
        raise HTTPException(400, f"Parent directory does not exist: {parent}")

    project_path = parent_path / dir_name
    if project_path.exists():
        raise HTTPException(409, f"Directory already exists: {project_path}")

    data = _load_projects()
    for existing in data["projects"]:
        if existing["path"] == str(project_path):
            raise HTTPException(409, f"Project path already registered: {existing['id']}")

    try:
        project_path.mkdir(parents=True, exist_ok=False)
    except OSError as e:
        raise HTTPException(500, f"Failed to create directory: {e}")

    skeleton_topology = {
        "version": "1.1",
        "name": name,
        "nodes": [],
        "links": [],
        "segments": [],
        "networks": [],
        "actions": [],
    }

    topo_file = project_path / "topology.json"
    try:
        with open(topo_file, "w") as f:
            json.dump(skeleton_topology, f, indent=2, ensure_ascii=False)
            f.write("\n")
    except OSError as e:
        shutil.rmtree(project_path, ignore_errors=True)
        raise HTTPException(500, f"Failed to write topology file: {e}")

    project_id = dir_name
    existing_ids = {pr["id"] for pr in data["projects"]}
    base_id = project_id
    counter = 1
    while project_id in existing_ids:
        project_id = f"{base_id}-{counter}"
        counter += 1

    entry = {
        "id": project_id,
        "name": name,
        "path": str(project_path),
        "description": description,
    }
    data["projects"].append(entry)
    _save_projects(data)

    return {
        "ok": True,
        "project": entry,
        "path": str(project_path),
        "topology_file": str(topo_file),
    }
