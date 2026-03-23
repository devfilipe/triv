"""
Router: topology — CRUD, reload, source, topology-level actions.
"""

import json
import subprocess
import threading

from fastapi import APIRouter, HTTPException, Body

from triv.core import topology as topo_mod
from triv.core import network_v2 as netv2
from triv.core import env as env_mod
from triv.core.models import Node, Link

import shared

router = APIRouter(prefix="/api", tags=["topology"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _resolve_network_refs_in_topology() -> None:
    """Resolve $ref entries in topology.network_defs using vendor network files.

    Only entries with a ``_ref`` (loaded from a ``$ref`` JSON pointer) are
    re-resolved from their source file.  Inline entries (no ``_ref``) are
    kept as-is to avoid data loss.
    """
    if not shared.topology or not shared.topology.network_defs:
        return
    try:
        net_dir = netv2.networks_dir_for_project(str(shared.PROJECT_DIR), shared.TRIV_HOME)
        result: list = []
        refs_batch: list[dict] = []
        # Track insertion points so ordering is preserved
        order: list[tuple[str, int]] = []  # ("ref"|"inline", index)
        for nd in shared.topology.network_defs:
            if nd._ref:
                order.append(("ref", len(refs_batch)))
                refs_batch.append(nd.to_ref_dict())
            else:
                order.append(("inline", len(result)))
                result.append(nd)
        resolved = netv2.resolve_network_refs(refs_batch, net_dir) if refs_batch else []
        # Merge back in original order
        final: list = []
        ri = 0
        ii = 0
        for kind, _ in order:
            if kind == "ref":
                if ri < len(resolved):
                    final.append(resolved[ri])
                    ri += 1
            else:
                final.append(result[ii])
                ii += 1
        shared.topology.network_defs = final
    except Exception as e:
        print(f"[network_v2] Warning: failed to resolve network refs: {e}")


def reload_topology() -> None:
    """Re-read the topology JSON from disk into memory."""
    if shared.TOPOLOGY_FILE.exists():
        try:
            shared.topology = topo_mod.load(str(shared.TOPOLOGY_FILE))
            _resolve_network_refs_in_topology()
            print(f"[reload] Topology reloaded: {shared.topology.name}")
        except Exception as e:
            print(f"[reload] Failed: {e}")


def save_and_reload() -> None:
    """Persist current topology to disk, then reload."""
    if shared.topology:
        from routers.networks_v2 import save_topology_with_network_refs

        save_topology_with_network_refs(shared.TOPOLOGY_FILE)
    reload_topology()


def save_topology() -> None:
    """Persist the current topology back to disk."""
    save_and_reload()


def run_auto_topology_actions() -> None:
    """Run topology-level actions marked with ``"auto": true`` in a background thread."""
    if not shared.topology:
        return
    auto_actions = [a for a in (shared.topology.actions or []) if a.get("auto")]
    if not auto_actions:
        return

    vars_: dict = {
        "project_dir": str(shared.PROJECT_DIR),
        "project_id": shared.topology.project_id,
        "topology.name": shared.topology.name,
    }

    def _run() -> None:
        for action in auto_actions:
            cmd_tpl = action.get("command", "")
            if not cmd_tpl:
                continue
            cmd = env_mod.expand_template(cmd_tpl, vars_)
            print(f"[auto] {action.get('id', '?')}: {cmd}")
            try:
                r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=300)
                if r.returncode != 0:
                    print(f"[auto] '{action.get('id')}' failed: {r.stderr.strip()[:200]}")
                else:
                    print(f"[auto] '{action.get('id')}' OK")
            except Exception as exc:
                print(f"[auto] '{action.get('id')}' error: {exc}")

    threading.Thread(target=_run, daemon=True).start()


# ---------------------------------------------------------------------------
# REST — Topology read / actions
# ---------------------------------------------------------------------------


@router.get("/topology")
def get_topology():
    if not shared.topology:
        return {"name": "", "nodes": [], "links": [], "segments": [], "networks": [], "actions": []}
    d = shared.topology.to_dict()
    network_statuses: dict[str, dict] = {}
    pid = shared.topology.project_id
    for nd in shared.topology.network_defs:
        try:
            status = netv2.get_network_status(nd, pid, all_nets=shared.topology.network_defs)
            if nd.type != "docker":
                status["bridge_name"] = netv2.qualified_bridge(nd, pid)
            network_statuses[nd.network_id] = status
        except Exception:
            network_statuses[nd.network_id] = {"deployed": False, "bridge_state": "unknown"}
    d["network_statuses"] = network_statuses
    return d


@router.get("/topology/actions")
def get_topology_actions():
    if not shared.topology:
        return []
    vars_: dict = {
        "project_dir": str(shared.PROJECT_DIR),
        "project_id": shared.topology.project_id,
        "topology.name": shared.topology.name,
    }
    resolved = []
    for raw_act in shared.topology.actions:
        act: dict = {}
        for k, v in raw_act.items():
            act[k] = env_mod.expand_template(v, vars_) if isinstance(v, str) else v
        act.setdefault("icon", "zap")
        act.setdefault("type", "exec")
        resolved.append(act)
    return resolved


@router.post("/topology/action/{action_id}")
def execute_topology_action(action_id: str, payload: dict | None = Body(None)):
    if not shared.topology:
        raise HTTPException(404, "Topology not loaded")

    vars_: dict = {
        "project_dir": str(shared.PROJECT_DIR),
        "project_id": shared.topology.project_id,
        "topology.name": shared.topology.name,
    }
    action = next((a for a in shared.topology.actions if a.get("id") == action_id), None)
    if not action:
        raise HTTPException(404, f"Topology action '{action_id}' not found")

    cmd = env_mod.expand_template(action.get("command", ""), vars_)
    if not cmd:
        return {"ok": False, "error": "Action has no command"}

    try:
        result = subprocess.run(
            cmd,
            shell=True,
            capture_output=True,
            text=True,
            timeout=300,
            env=shared.C_ENV,
            cwd=str(shared.PROJECT_DIR),
        )
        return {
            "ok": result.returncode == 0,
            "action": action,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "returncode": result.returncode,
        }
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "Command timed out (300s)", "action": action}
    except Exception as e:
        return {"ok": False, "error": str(e), "action": action}


# ---------------------------------------------------------------------------
# REST — Topology CRUD
# ---------------------------------------------------------------------------


@router.post("/topology/reload")
def api_reload_topology():
    reload_topology()
    if not shared.topology:
        raise HTTPException(404, "Topology not loaded after reload")
    return {
        "ok": True,
        "name": shared.topology.name,
        "nodes": len(shared.topology.nodes),
        "links": len(shared.topology.links),
    }


@router.get("/topology/source")
def get_topology_source():
    if not shared.TOPOLOGY_FILE.exists():
        raise HTTPException(404, "No topology file found")
    return {
        "ok": True,
        "filename": shared.TOPOLOGY_FILE.name,
        "path": str(shared.TOPOLOGY_FILE),
        "content": shared.TOPOLOGY_FILE.read_text(encoding="utf-8"),
    }


@router.put("/topology/source")
def put_topology_source(body: dict = Body(...)):
    content = body.get("content", "")
    if not content:
        raise HTTPException(400, "Missing 'content' field")
    try:
        json.loads(content)
    except json.JSONDecodeError as e:
        return {"ok": False, "error": f"Invalid JSON: {e}"}
    shared.TOPOLOGY_FILE.write_text(content, encoding="utf-8")
    reload_topology()
    return {
        "ok": True,
        "filename": shared.TOPOLOGY_FILE.name,
        "reloaded": shared.topology is not None,
        "name": shared.topology.name if shared.topology else None,
        "nodes": len(shared.topology.nodes) if shared.topology else 0,
        "links": len(shared.topology.links) if shared.topology else 0,
    }


@router.put("/topology")
def update_topology(body: dict = Body(...)):
    if not shared.topology:
        raise HTTPException(404, "Topology not loaded")
    if "name" in body:
        shared.topology.name = body["name"]
    if "networks" in body:
        shared.topology.networks = body["networks"]
    save_topology()
    return {"ok": True}


# ---------------------------------------------------------------------------
# REST — Node CRUD (topology-level, not runtime)
# ---------------------------------------------------------------------------


@router.post("/topology/nodes")
def create_node(body: dict = Body(...)):
    import uuid as _uuid

    if not shared.topology:
        raise HTTPException(404, "Topology not loaded")

    short_uuid = _uuid.uuid4().hex[:8]
    full_uuid = _uuid.uuid4().hex

    node_id = body.get("id")
    if not node_id:
        node_id = f"node-{short_uuid}"
        body["id"] = node_id

    if shared.topology.get_node(node_id):
        raise HTTPException(409, f"Node '{node_id}' already exists")

    props = body.get("properties", {})
    if "uuid" not in props:
        props["uuid"] = full_uuid
        props["short_id"] = short_uuid
    body["properties"] = props

    node = Node.from_dict(body)
    shared.topology.nodes.append(node)
    save_topology()

    skip_cap = body.get("skip_capabilities", False)
    if not skip_cap and node.runtime:
        try:
            from routers.capabilities import init_node_capabilities

            init_node_capabilities(node_id)
        except Exception:
            pass

    return {"ok": True, "id": node_id, "short_id": short_uuid, "uuid": full_uuid}


@router.put("/topology/nodes/{node_id}")
def update_node(node_id: str, body: dict = Body(...)):
    if not shared.topology:
        raise HTTPException(404, "Topology not loaded")

    idx = next((i for i, n in enumerate(shared.topology.nodes) if n.id == node_id), None)
    if idx is None:
        raise HTTPException(404, f"Node '{node_id}' not found")

    old_node = shared.topology.nodes[idx]
    new_ifaces = body.get("interfaces", [])
    iface_renames: dict[str, str] = {}
    for old_iface, new_iface in zip(old_node.interfaces, new_ifaces):
        if old_iface.id != new_iface.get("id", old_iface.id):
            iface_renames[old_iface.id] = new_iface["id"]

    body["id"] = node_id
    shared.topology.nodes[idx] = Node.from_dict(body)

    if iface_renames:
        for link in shared.topology.links:
            if link.source.node == node_id and link.source.interface in iface_renames:
                link.source.interface = iface_renames[link.source.interface]
            if link.target.node == node_id and link.target.interface in iface_renames:
                link.target.interface = iface_renames[link.target.interface]

    save_topology()
    return {"ok": True, "id": node_id, "iface_renames": iface_renames}


@router.delete("/topology/nodes/{node_id}")
def delete_node(node_id: str):
    if not shared.topology:
        raise HTTPException(404, "Topology not loaded")

    idx = next((i for i, n in enumerate(shared.topology.nodes) if n.id == node_id), None)
    if idx is None:
        raise HTTPException(404, f"Node '{node_id}' not found")

    shared.topology.links = [
        lk
        for lk in shared.topology.links
        if lk.source.node != node_id and lk.target.node != node_id
    ]
    shared.topology.nodes.pop(idx)
    save_topology()
    return {"ok": True, "id": node_id}


@router.patch("/topology/nodes/positions")
def update_node_positions(body: dict = Body(...)):
    if not shared.topology:
        raise HTTPException(404, "Topology not loaded")
    positions = body.get("positions", {})
    updated = []
    for node in shared.topology.nodes:
        if node.id in positions:
            node.position = positions[node.id]
            updated.append(node.id)
    if updated:
        save_topology()
    return {"ok": True, "updated": updated}


# ---------------------------------------------------------------------------
# REST — Link CRUD
# ---------------------------------------------------------------------------


@router.post("/topology/links")
def create_link(body: dict = Body(...)):
    if not shared.topology:
        raise HTTPException(404, "Topology not loaded")

    link_id = body.get("id")
    if not link_id:
        raise HTTPException(400, "Field 'id' is required")
    if any(lk.id == link_id for lk in shared.topology.links):
        raise HTTPException(409, f"Link '{link_id}' already exists")

    link = Link.from_dict(body)
    shared.topology.links.append(link)
    save_topology()
    return {"ok": True, "id": link_id}


@router.delete("/topology/links/{link_id}")
def delete_link(link_id: str):
    if not shared.topology:
        raise HTTPException(404, "Topology not loaded")

    idx = next((i for i, lk in enumerate(shared.topology.links) if lk.id == link_id), None)
    if idx is None:
        raise HTTPException(404, f"Link '{link_id}' not found")

    shared.topology.links.pop(idx)
    save_topology()
    return {"ok": True, "id": link_id}


# ---------------------------------------------------------------------------
# REST — ne-actions reference (deprecated)
# ---------------------------------------------------------------------------


@router.get("/ne-actions")
def get_ne_actions():
    action_types = [
        {"type": "console", "label": "Console/Terminal", "fields": ["command"]},
        {"type": "exec", "label": "Execute Command", "fields": ["command", "confirm"]},
        {"type": "exec-output", "label": "Exec + Show Output", "fields": ["command", "confirm"]},
        {
            "type": "exec-with-data",
            "label": "Exec + Data",
            "fields": ["command", "confirm", "data_source", "data", "data_prompt", "file_filter"],
        },
        {"type": "ssh", "label": "SSH Connection", "fields": ["host", "user", "port"]},
        {"type": "link", "label": "Open URL", "fields": ["url"]},
        {"type": "webui", "label": "Embedded WebUI", "fields": ["url"]},
        {"type": "define-vm", "label": "Define VM (libvirt)", "fields": ["confirm"]},
        {"type": "define-container", "label": "Create Container", "fields": ["confirm"]},
        {"type": "driver-command", "label": "Driver Command", "fields": ["description"]},
    ]
    return {
        "actions": {},
        "runtime_defaults": {},
        "action_types": action_types,
    }
