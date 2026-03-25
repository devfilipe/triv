"""
routers/wizard.py — REST API for the triv Wizard feature.

Endpoints:
    GET  /api/wizard/status  — enabled/loaded state, provider, model
    GET  /api/wizard/config  — full wizard configuration
    POST /api/wizard/config  — save wizard configuration
    POST /api/wizard/task    — run a wizard agent task

    GET  /api/wizard/nodes                             — list wizard nodes
    GET  /api/wizard/nodes/{node_id}/capabilities      — read wizard node caps
    PUT  /api/wizard/nodes/{node_id}/capabilities      — save wizard node caps
    GET  /api/wizard/nodes/{node_id}/actions            — resolved action list
    POST /api/wizard/nodes/{node_id}/actions/{action_id} — execute a node action
    GET  /api/wizard/nodes/{node_id}/agent/tools        — tool list
"""

import json
from pathlib import Path
from fastapi import APIRouter, HTTPException, Body

router = APIRouter(prefix="/api/wizard", tags=["wizard"])


# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------

@router.get("/status")
def get_wizard_status():
    """Return enabled/loaded state — used by the floating panel on open."""
    from wizard_manager import WizardManager
    return WizardManager.get_status()


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

@router.get("/config")
def get_wizard_config():
    """Return wizard configuration (enabled, instructions, capability_groups)."""
    from wizard_manager import WizardManager
    cfg = WizardManager.get_config()
    return {k: cfg[k] for k in ("enabled", "instructions", "capability_groups") if k in cfg}


@router.post("/config")
def save_wizard_config(body: dict = Body(...)):
    """Save wizard configuration.  Re-applies to in-memory topology immediately."""
    from wizard_manager import WizardManager
    WizardManager.save_config(body)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Task
# ---------------------------------------------------------------------------

@router.post("/task")
def run_wizard_task(body: dict = Body(...)):
    """
    Run a wizard agent task.

    Body:
        task              (str)        — natural-language task from the user
        context           (str)        — JSON string representing the active screen state
        confirmed_actions (list[str])  — action IDs the user has confirmed for
                                         this request (destructive ops gate)
    """
    from wizard_manager import WizardManager

    task = (body.get("task") or "").strip()
    context = body.get("context") or ""
    confirmed_actions = body.get("confirmed_actions") or None

    if not task:
        raise HTTPException(400, "task is required")

    result = WizardManager.run_task(task, context, confirmed_actions=confirmed_actions)
    return result


# ---------------------------------------------------------------------------
# Topology AI Tools listing
# ---------------------------------------------------------------------------

@router.get("/topology-tools")
def list_topology_tools():
    """Return AI-tool-enabled actions from the user topology, grouped by node and driver."""
    from wizard_manager import WizardManager
    return WizardManager.get_topology_tools()


# ---------------------------------------------------------------------------
# Wizard nodes (used by WizardConfig canvas + CapabilitiesModal)
# ---------------------------------------------------------------------------

def _caps_file(node_id: str) -> Path:
    import shared
    return shared.WIZARD_CAPS_DIR / f"capabilities-node-{node_id}.json"


@router.get("/nodes")
def list_wizard_nodes():
    """Return wizard nodes in the same shape as GET /api/nodes."""
    import shared
    topo = shared.wizard_topology
    if topo is None:
        return []
    nodes = []
    for node in topo.nodes:
        props = getattr(node, "properties", {}) or {}
        nodes.append({
            "id": node.id,
            "label": props.get("label") or node.id,
            "runtime": getattr(node, "runtime", ""),
            "status": "running",
            "internal": bool(props.get("internal", False)),
            "locked_drivers": bool(props.get("locked_drivers", False)),
        })
    return nodes


@router.get("/nodes/{node_id}/capabilities")
def get_wizard_node_capabilities(node_id: str):
    """Return capabilities for a wizard node."""
    cf = _caps_file(node_id)
    if not cf.exists():
        raise HTTPException(404, f"Capabilities file not found for {node_id}")
    data = json.loads(cf.read_text())
    # For the LLM node, merge wizard_config values so the UI reflects the
    # effective settings even when the JSON template on disk was reset.
    if node_id == "triv-wizard-llm":
        import shared
        cfg = shared.wizard_config
        _llm_ids = {"generic-driver-llm", "generic-driver-ollama"}
        for drv in data.get("drivers", []):
            cid = drv.get("driver") or drv.get("id") or ""
            if cid in _llm_ids:
                da = drv.setdefault("driver_args", {})
                for key in ("provider", "model", "base_url", "api_key", "credential"):
                    val = cfg.get(key)
                    if val and not da.get(key):
                        da[key] = val
                break
    return {
        "node_id": node_id,
        "env_file": str(cf),
        "file_exists": True,
        "drivers": data.get("drivers", []),
        "actions": data.get("actions", []),
        "health": data.get("health"),
        "raw": data,
    }


@router.put("/nodes/{node_id}/capabilities")
def save_wizard_node_capabilities(node_id: str, body: dict = Body(...)):
    """Save capabilities for a wizard node."""
    cf = _caps_file(node_id)
    if not cf.exists():
        raise HTTPException(404, f"Capabilities file not found for {node_id}")
    existing = json.loads(cf.read_text())
    if "drivers" in body:
        existing["drivers"] = body["drivers"]
    if "actions" in body:
        existing["actions"] = body["actions"]
    if "health" in body:
        existing["health"] = body["health"]
    cf.write_text(json.dumps(existing, indent=2))
    # For the LLM node: sync connection fields into wizard_config so they
    # survive rebuilds.  Must happen BEFORE init() so the reloaded config
    # already contains the latest values.
    from wizard_manager import WizardManager
    if node_id == "triv-wizard-llm":
        _llm_ids = {"generic-driver-llm", "generic-driver-ollama"}
        for drv in existing.get("drivers", []):
            cid = drv.get("driver") or drv.get("id") or ""
            if cid in _llm_ids:
                da = drv.get("driver_args", {})
                patch = {k: da[k] for k in ("provider", "model", "base_url", "api_key", "credential") if da.get(k)}
                if patch:
                    WizardManager.save_config(patch)
                break
    # Re-init so WizardManager picks up changes (now with up-to-date config)
    WizardManager.init()
    return {"ok": True, "env_file": str(cf)}


@router.get("/nodes/{node_id}/actions")
def list_wizard_node_actions(node_id: str):
    """Return resolved actions for a wizard node."""
    import shared
    from node_helpers import load_node_env, resolve_vm_name, resolve_node_actions

    if not shared.wizard_topology:
        return []
    node = shared.wizard_topology.get_node(node_id)
    if not node:
        raise HTTPException(404, f"Node '{node_id}' not found")
    nd = node.to_dict()
    drv = shared.registry.get_or_default(node.driver)
    from wizard_manager import WizardManager
    if node_id == "triv-wizard-llm":
        env_data = WizardManager._get_llm_env()
    else:
        env_data = load_node_env(nd)
    vm_name = resolve_vm_name(nd, drv, env_data) or nd["id"]
    actions = resolve_node_actions(nd, drv, vm_name, env_data)
    return [
        {"id": a.get("id"), "label": a.get("label", a.get("id")), "icon": a.get("icon", ""), "type": a.get("type", "")}
        for a in actions
        if a.get("type") == "driver-command"
    ]


@router.post("/nodes/{node_id}/actions/{action_id}")
def run_wizard_node_action(node_id: str, action_id: str, payload: dict | None = Body(None)):
    """Execute an action on a wizard node."""
    import shared
    from node_helpers import load_node_env, resolve_vm_name, resolve_node_actions

    if not shared.wizard_topology:
        raise HTTPException(404, "Wizard topology not loaded")
    node = shared.wizard_topology.get_node(node_id)
    if not node:
        raise HTTPException(404, f"Node '{node_id}' not found")

    nd = node.to_dict()
    drv = shared.registry.get_or_default(node.driver)

    # For the LLM node use WizardManager env so wizard config overrides (model, provider…) apply
    from wizard_manager import WizardManager
    if node_id == "triv-wizard-llm":
        env_data = WizardManager._get_llm_env()
    else:
        env_data = load_node_env(nd)

    vm_name = resolve_vm_name(nd, drv, env_data) or nd["id"]
    actions = resolve_node_actions(nd, drv, vm_name, env_data)

    action = next((a for a in actions if a.get("id") == action_id), None)
    if not action:
        raise HTTPException(404, f"Action '{action_id}' not found for node '{node_id}'")

    atype = action.get("type", "exec")
    if atype in ("console", "ssh", "link", "webui"):
        raise HTTPException(400, f"Action type '{atype}' is not executable here")

    if atype == "driver-command":
        target_drv = drv
        act_driver = action.get("driver", "")
        if act_driver and act_driver not in shared.registry:
            _py = f"{act_driver}-python"
            if _py in shared.registry:
                act_driver = _py
        if act_driver and act_driver in shared.registry:
            target_drv = shared.registry.get(act_driver)
        # Merge per-driver args
        if act_driver:
            for _cap in env_data.get("drivers", []):
                _cid = _cap.get("driver") or _cap.get("id") or ""
                if _cid == act_driver or f"{_cid}-python" == act_driver:
                    _per = _cap.get("driver_args", {})
                    if _per:
                        env_data = {
                            **env_data,
                            "driver_args": {**env_data.get("driver_args", {}), **_per},
                        }
                    break
        return target_drv.run_command(
            action_id,
            nd,
            env_data,
            project_dir=str(shared.PROJECT_DIR),
            payload=payload,
            topology=shared.wizard_topology,
            registry=shared.registry,
        )

    return {"ok": False, "error": f"Unsupported action type '{atype}'"}


@router.get("/nodes/{node_id}/agent/tools")
def get_wizard_node_tools(node_id: str):
    """Return tools discoverable by a wizard agent node."""
    import shared
    if not shared.wizard_topology:
        return {"ok": True, "tools": []}
    try:
        from triv.drivers.generic_driver_agent import GenericAgentDriver

        drv = GenericAgentDriver()
        tools = drv._discover_tools(shared.wizard_topology, None, node_id)
        return {
            "ok": True,
            "tools": [
                {
                    "name": t["name"],
                    "description": t["description"],
                    "node_id": t["_node_id"],
                    "action_id": t["_action_id"],
                }
                for t in tools
            ],
        }
    except Exception as exc:
        return {"ok": False, "tools": [], "error": str(exc)}
