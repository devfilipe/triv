"""
Router: nodes — list, status, health, stop/start/restart, action execution.
"""

import json
import queue
import subprocess
import threading
import time

from fastapi import APIRouter, HTTPException, Body
from fastapi.responses import StreamingResponse

from triv.core.enums import RuntimeBackend
from triv.core import network as netmod

import shared
from node_helpers import (
    load_node_env,
    resolve_vm_name,
    resolve_node_actions,
    node_runtime_state,
)
from runtime import (
    define_vm,
    resolve_bridge_for_iface,
    cleanup_orphaned_bridges,
)
from health import run_health_check

router = APIRouter(prefix="/api", tags=["nodes"])


def _make_tool_executor():
    """Return a callable (node_id, action_id, payload) -> dict for agent drivers."""

    def _execute(node_id: str, action_id: str, payload: dict | None = None) -> dict:
        if not shared.topology:
            return {"ok": False, "error": "Topology not loaded"}
        node = shared.topology.get_node(node_id)
        if not node:
            return {"ok": False, "error": f"Node '{node_id}' not found"}
        nd = node.to_dict()
        drv = shared.registry.get_or_default(node.driver)
        env_d = load_node_env(nd)
        vm_name = resolve_vm_name(nd, drv, env_d) or nd["id"]
        actions = resolve_node_actions(nd, drv, vm_name, env_d)
        action = next((a for a in actions if a.get("id") == action_id), None)
        if not action:
            return {"ok": False, "error": f"Action '{action_id}' not found on node '{node_id}'"}
        atype = action.get("type", "exec")
        if atype in ("console", "ssh", "link", "webui"):
            return {"ok": False, "error": f"Action type '{atype}' is not executable by agents"}
        if atype == "driver-command":
            target_drv = drv
            act_driver = action.get("driver", "")
            # Same -python fallback as execute_action
            if act_driver and act_driver not in shared.registry:
                _py = f"{act_driver}-python"
                if _py in shared.registry:
                    act_driver = _py
            if act_driver and act_driver in shared.registry:
                target_drv = shared.registry.get(act_driver)
            # Merge per-driver args so the driver reads the right credentials
            if act_driver:
                for _cap in env_d.get("drivers", []):
                    _cid = _cap.get("driver") or _cap.get("id") or ""
                    if _cid == act_driver or f"{_cid}-python" == act_driver:
                        _per = _cap.get("driver_args", {})
                        if _per:
                            env_d = {
                                **env_d,
                                "driver_args": {**env_d.get("driver_args", {}), **_per},
                            }
                        break
            return target_drv.run_command(
                action_id,
                nd,
                env_d,
                project_dir=str(shared.PROJECT_DIR),
                payload=payload,
                topology=shared.topology,
                registry=shared.registry,
                tool_executor=_execute,
            )
        # exec / exec-output / exec-with-data
        cmd = action.get("command", "")
        if not cmd:
            return {"ok": False, "error": "Action has no command"}
        if atype == "exec-with-data" and payload:
            for key, val in payload.items():
                val_str = json.dumps(val) if not isinstance(val, str) else val
                cmd = cmd.replace(f"${{json:{key}}}", val_str)
                cmd = cmd.replace(f"${{{key}}}", val_str)
        result = subprocess.run(
            cmd, shell=True, capture_output=True, text=True, timeout=60, env=shared.C_ENV
        )
        return {"ok": result.returncode == 0, "output": (result.stdout + result.stderr).strip()}

    return _execute


@router.get("/nodes")
def get_nodes():
    if not shared.topology:
        return []
    result = []
    for node in shared.topology.nodes:
        nd = node.to_dict()
        drv = shared.registry.get_or_default(node.driver)
        env_data = load_node_env(nd)
        vm_name = resolve_vm_name(nd, drv, env_data) if node.runtime else None
        state = node_runtime_state(nd, drv, env_data)

        actions = resolve_node_actions(nd, drv, vm_name or nd["id"], env_data)

        with shared._health_lock:
            cached_health = shared._health_cache.get(node.id)

        props = nd.get("properties") or {}

        # Collect all driver types assigned to this node (primary + overlays).
        # Used by the frontend to semantically filter nodes (e.g. LLM Node picker).
        _driver_types: list[str] = []
        _primary_meta = shared.registry.get_or_default(node.driver).metadata()
        if _primary_meta:
            pass  # primary type is on the JSON descriptor, not in metadata
        # Look up type from registry JSON descriptors for each assigned driver.
        # Driver IDs use hyphens (generic-driver-ollama) but files use underscores.
        _drv_dir = shared.TOOLS_DIR / "triv" / "drivers"
        for _entry in [{"driver": node.driver}] + env_data.get("drivers", []):
            _did = _entry.get("driver") or _entry.get("name") or _entry.get("id") or ""
            if not _did:
                continue
            _json_path = _drv_dir / f"{_did.replace('-', '_')}.json"
            if _json_path.is_file():
                try:
                    _dtype = json.loads(_json_path.read_text()).get("type", "")
                    if _dtype and _dtype not in _driver_types:
                        _driver_types.append(_dtype)
                except Exception:
                    pass

        result.append(
            {
                **nd,
                "vm_name": vm_name,
                "label": props.get("label") or None,
                "state": state,
                "driver_meta": {
                    "vendor": drv.metadata().vendor_name,
                    "accent_color": drv.metadata().accent_color,
                    "logo_url": drv.metadata().logo_url,
                },
                "driver_args": env_data.get("driver_args", {}),
                "driver_types": _driver_types,
                "actions": actions,
                "health": cached_health,
            }
        )
    return result


@router.get("/nodes/{node_id}/status")
def get_node_status(node_id: str):
    if not shared.topology:
        raise HTTPException(404, "Topology not loaded")
    node = shared.topology.get_node(node_id)
    if not node:
        raise HTTPException(404, f"Node '{node_id}' not found")
    nd = node.to_dict()
    drv = shared.registry.get_or_default(node.driver)
    env_data = load_node_env(nd)
    return {
        "id": node_id,
        "vm_name": resolve_vm_name(nd, drv, env_data) if node.runtime else None,
        "state": node_runtime_state(nd, drv, env_data),
    }


@router.get("/nodes/{node_id}/health")
def get_node_health(node_id: str, force: bool = False):
    if not shared.topology:
        raise HTTPException(404, "Topology not loaded")
    node = shared.topology.get_node(node_id)
    if not node:
        raise HTTPException(404, f"Node '{node_id}' not found")

    nd = node.to_dict()
    env_data = load_node_env(nd)
    health_cfg = env_data.get("health")
    if not health_cfg:
        return {"node_id": node_id, "configured": False, "status": "none"}

    if force:
        drv = shared.registry.get_or_default(node.driver)
        vm_name = resolve_vm_name(nd, drv, env_data) or nd["id"]
        result = run_health_check(node_id, health_cfg, vm_name)
        result["last_check"] = time.time()
        with shared._health_lock:
            shared._health_cache[node_id] = result
        return {"node_id": node_id, "configured": True, **result}

    with shared._health_lock:
        cached = shared._health_cache.get(node_id)
    if cached:
        return {"node_id": node_id, "configured": True, **cached}
    return {
        "node_id": node_id,
        "configured": True,
        "status": "unknown",
        "error": "No check run yet",
        "last_check": None,
    }


@router.post("/nodes/{node_id}/stop")
def stop_node(node_id: str):
    if not shared.topology:
        raise HTTPException(404, "Topology not loaded")
    node = shared.topology.get_node(node_id)
    if not node or not node.runtime:
        raise HTTPException(400, f"Node '{node_id}' is not runnable")
    nd = node.to_dict()
    drv = shared.registry.get_or_default(node.driver)
    vm_name = resolve_vm_name(nd, drv)

    if node.runtime == RuntimeBackend.LIBVIRT:
        subprocess.run(
            ["virsh", "-c", shared.LIBVIRT_URI, "destroy", vm_name],
            check=False,
            env=shared.C_ENV,
        )
    elif node.runtime in (RuntimeBackend.DOCKER, RuntimeBackend.PODMAN):
        subprocess.run([node.runtime.value, "rm", "-f", vm_name], check=False)

    return {"ok": True, "vm_name": vm_name}


@router.post("/nodes/{node_id}/start")
def start_node(node_id: str):
    if not shared.topology:
        raise HTTPException(404, "Topology not loaded")
    node = shared.topology.get_node(node_id)
    if not node or not node.runtime:
        raise HTTPException(400, f"Node '{node_id}' is not runnable")
    nd = node.to_dict()
    drv = shared.registry.get_or_default(node.driver)
    vm_name = resolve_vm_name(nd, drv)

    if node.runtime == RuntimeBackend.LIBVIRT:
        for iface in node.interfaces:
            bridge = resolve_bridge_for_iface(node_id, iface.id)
            netmod.ensure_bridge(bridge, stp=False)

        result = subprocess.run(
            ["virsh", "-c", shared.LIBVIRT_URI, "start", vm_name],
            capture_output=True,
            text=True,
            env=shared.C_ENV,
        )
        if result.returncode != 0:
            return {"ok": False, "vm_name": vm_name, "error": result.stderr.strip()}
    elif node.runtime in (RuntimeBackend.DOCKER, RuntimeBackend.PODMAN):
        result = subprocess.run(
            [node.runtime.value, "start", vm_name],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            return {"ok": False, "vm_name": vm_name, "error": result.stderr.strip()}

    return {"ok": True, "vm_name": vm_name}


@router.post("/nodes/{node_id}/restart")
def restart_node(node_id: str):
    if not shared.topology:
        raise HTTPException(404, "Topology not loaded")
    node = shared.topology.get_node(node_id)
    if not node or not node.runtime:
        raise HTTPException(400, f"Node '{node_id}' is not runnable")
    nd = node.to_dict()
    drv = shared.registry.get_or_default(node.driver)
    vm_name = resolve_vm_name(nd, drv)

    if node.runtime == RuntimeBackend.LIBVIRT:
        result = subprocess.run(
            ["virsh", "-c", shared.LIBVIRT_URI, "reboot", vm_name],
            capture_output=True,
            text=True,
            env=shared.C_ENV,
        )
        if result.returncode != 0:
            subprocess.run(
                ["virsh", "-c", shared.LIBVIRT_URI, "destroy", vm_name],
                check=False,
                env=shared.C_ENV,
            )
            for iface in node.interfaces:
                bridge = resolve_bridge_for_iface(node_id, iface.id)
                netmod.ensure_bridge(bridge, stp=False)
            result = subprocess.run(
                ["virsh", "-c", shared.LIBVIRT_URI, "start", vm_name],
                capture_output=True,
                text=True,
                env=shared.C_ENV,
            )
            if result.returncode != 0:
                return {"ok": False, "vm_name": vm_name, "error": result.stderr.strip()}
    elif node.runtime in (RuntimeBackend.DOCKER, RuntimeBackend.PODMAN):
        subprocess.run([node.runtime.value, "restart", vm_name], check=False)

    return {"ok": True, "vm_name": vm_name}


# ---------------------------------------------------------------------------
# REST — Action execution
# ---------------------------------------------------------------------------


@router.post("/nodes/{node_id}/action/pull-model/stream")
def stream_pull_model(node_id: str, payload: dict | None = Body(None)):
    """Stream pull-model execution as Server-Sent Events."""
    if not shared.topology:
        raise HTTPException(404, "Topology not loaded")
    node_obj = shared.topology.get_node(node_id)
    if not node_obj:
        raise HTTPException(404, f"Node '{node_id}' not found")

    nd = node_obj.to_dict()
    drv = shared.registry.get_or_default(node_obj.driver)
    env_data = load_node_env(nd)

    q: queue.Queue = queue.Queue()

    def _run() -> None:
        try:
            result = drv.run_command(
                "pull-model",
                nd,
                env_data,
                project_dir=str(shared.PROJECT_DIR),
                payload=payload,
                topology=shared.topology,
                registry=shared.registry,
                tool_executor=_make_tool_executor(),
                output_cb=lambda line: q.put(("line", line)),
            )
            if result.get("ok"):
                q.put(("done", f"ok:{result.get('output', 'done')}"))
            else:
                q.put(("done", f"error:{result.get('error', 'Unknown error')}"))
        except Exception as exc:
            q.put(("done", f"error:{exc}"))

    threading.Thread(target=_run, daemon=True).start()

    def _sse():
        while True:
            try:
                kind, value = q.get(timeout=600)
                yield f"data: {value}\n\n"
                if kind == "done":
                    break
            except queue.Empty:
                yield "data: error:timeout\n\n"
                break

    return StreamingResponse(
        _sse(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/nodes/{node_id}/action/create-container/stream")
def stream_create_container(node_id: str, payload: dict | None = Body(None)):
    """Stream create-container execution as Server-Sent Events."""
    if not shared.topology:
        raise HTTPException(404, "Topology not loaded")
    node_obj = shared.topology.get_node(node_id)
    if not node_obj:
        raise HTTPException(404, f"Node '{node_id}' not found")

    nd = node_obj.to_dict()
    drv = shared.registry.get_or_default(node_obj.driver)
    env_data = load_node_env(nd)
    vm_name = resolve_vm_name(nd, drv, env_data) or nd["id"]

    target_drv = shared.registry.get("generic-driver-container-python") or drv

    q: queue.Queue = queue.Queue()

    def _run() -> None:
        try:
            result = target_drv.run_command(
                "create-container",
                nd,
                env_data,
                project_dir=str(shared.PROJECT_DIR),
                payload=payload,
                topology=shared.topology,
                registry=shared.registry,
                tool_executor=_make_tool_executor(),
                output_cb=lambda line: q.put(("line", line)),
            )
            if result.get("ok"):
                rt_val = node_obj.runtime.value if node_obj.runtime else "docker"
                created_name = result.get("vm_name", vm_name)
                shared.state_tracker.track_container(created_name, node_id, rt_val)
                q.put(("done", f"ok:{created_name}"))
            else:
                q.put(("done", f"error:{result.get('error', 'Unknown error')}"))
        except Exception as exc:
            q.put(("done", f"error:{exc}"))

    threading.Thread(target=_run, daemon=True).start()

    def _sse():
        while True:
            try:
                kind, value = q.get(timeout=300)
                yield f"data: {value}\n\n"
                if kind == "done":
                    break
            except queue.Empty:
                yield "data: error:timeout\n\n"
                break

    return StreamingResponse(
        _sse(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/nodes/{node_id}/action/{action_id}")
def execute_action(node_id: str, action_id: str, payload: dict | None = Body(None)):
    if not shared.topology:
        raise HTTPException(404, "Topology not loaded")
    node = shared.topology.get_node(node_id)
    if not node:
        raise HTTPException(404, f"Node '{node_id}' not found")

    nd = node.to_dict()
    drv = shared.registry.get_or_default(node.driver)
    env_data = load_node_env(nd)
    vm_name = resolve_vm_name(nd, drv, env_data) or nd["id"]
    actions = resolve_node_actions(nd, drv, vm_name, env_data)

    action = next((a for a in actions if a.get("id") == action_id), None)
    if not action:
        raise HTTPException(404, f"Action '{action_id}' not found for node '{node_id}'")

    # Merge per-driver args for the action's driver so _args() picks up the
    # node's configured provider, model, api_key, etc.  The capabilities file
    # stores driver-specific args inside drivers[i].driver_args, not at the
    # top-level driver_args.
    act_driver_id = action.get("driver", "")
    if act_driver_id:
        for _cap in env_data.get("drivers", []):
            _cid = _cap.get("driver") or _cap.get("id") or ""
            if _cid == act_driver_id or f"{_cid}-python" == act_driver_id:
                _per = _cap.get("driver_args", {})
                if _per:
                    env_data = {
                        **env_data,
                        "driver_args": {**env_data.get("driver_args", {}), **_per},
                    }
                break

    atype = action.get("type", "exec")

    if atype in ("console", "ssh"):
        return {"ok": True, "action": action, "client_side": True}

    if atype == "define-vm":
        result = define_vm(node_id)
        result["action"] = action
        return result

    # --- Container lifecycle types → delegate to driver command ----------
    _CONTAINER_TYPE_TO_CMD = {
        "define-container": "create-container",
        "network-connect": "connect-network",
        "container-remove": "remove-container",
    }
    if atype in _CONTAINER_TYPE_TO_CMD:
        atype = "driver-command"
        action_id = _CONTAINER_TYPE_TO_CMD[action.get("type")]

    if atype == "vm-destroy-clean":
        br_list = []
        for iface in node.interfaces:
            try:
                br_list.append(resolve_bridge_for_iface(node_id, iface.id))
            except ValueError:
                pass
        r = subprocess.run(
            ["virsh", "-c", shared.LIBVIRT_URI, "destroy", vm_name],
            capture_output=True,
            text=True,
            check=False,
        )
        if r.returncode != 0:
            err = r.stderr.strip() or r.stdout.strip()
            return {"ok": False, "error": f"virsh destroy failed: {err}", "action": action}
        cleanup = cleanup_orphaned_bridges(br_list)
        detail_lines = [f"Force powered off: {vm_name}"]
        if cleanup["removed_bridges"]:
            detail_lines.append(f"Cleaned up bridges: {', '.join(cleanup['removed_bridges'])}")
        return {"ok": True, "detail": "\n".join(detail_lines), "action": action}

    if atype == "driver-command":
        # Resolve driver: prefer action-level driver override, then node drv
        target_drv = drv
        act_driver = action.get("driver", "")
        # JSON driver IDs (e.g. "generic-driver-llm") are not Python driver
        # names — try the "-python" variant as a fallback so that capabilities
        # files that store the JSON driver ID still work.
        if act_driver and act_driver not in shared.registry:
            _python_variant = f"{act_driver}-python"
            if _python_variant in shared.registry:
                act_driver = _python_variant
        if act_driver and act_driver in shared.registry:
            target_drv = shared.registry.get(act_driver)
        elif action_id in (
            "create-container",
            "remove-container",
            "connect-network",
            "apply-network",
            "disconnect-network",
        ):
            # Legacy compat: old action types didn't carry a driver field
            target_drv = shared.registry.get("generic-driver-container-python")

        # Pre-resolve bridges for container commands that need topology data
        kwargs: dict = {
            "project_dir": str(shared.PROJECT_DIR),
            "payload": payload,
            "topology": shared.topology,
            "registry": shared.registry,
            "tool_executor": _make_tool_executor(),
        }
        if action_id in (
            "connect-network",
            "apply-network",
            "disconnect-network",
            "remove-container",
        ):
            bridges: dict[str, str] = {}
            for iface in node.interfaces:
                try:
                    bridges[iface.id] = resolve_bridge_for_iface(node_id, iface.id)
                except ValueError:
                    pass
            kwargs["bridges"] = bridges

        result = target_drv.run_command(action_id, nd, env_data, **kwargs)

        # Post-processing: state tracking
        if result.get("ok"):
            if action_id == "create-container":
                rt_val = node.runtime.value if node.runtime else "docker"
                created_name = result.get("vm_name", vm_name)
                shared.state_tracker.track_container(created_name, node_id, rt_val)
            elif action_id == "remove-container":
                # Clean up orphaned bridges after container removal
                bridge_list = list((kwargs.get("bridges") or {}).values())
                if bridge_list:
                    bc = cleanup_orphaned_bridges(bridge_list)
                    if bc["removed_bridges"]:
                        detail = result.get("detail", "")
                        detail += f"\nCleaned up bridges: {', '.join(bc['removed_bridges'])}"
                        result["detail"] = detail.strip()

        result["action"] = action
        return {"ok": result.get("ok", False), **result}

    cmd = action.get("command", "")
    if not cmd:
        return {"ok": False, "error": "Action has no command"}

    if atype == "exec-with-data" and payload:
        for key, val in payload.items():
            val_str = json.dumps(val) if not isinstance(val, str) else val
            cmd = cmd.replace(f"${{json:{key}}}", val_str)
            cmd = cmd.replace(f"${{{key}}}", val_str)
        # Legacy compat
        cmd = cmd.replace("${data_file}", payload.get("data_file", ""))

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
        resp = {
            "ok": result.returncode == 0,
            "action": action,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "returncode": result.returncode,
        }
        if atype == "exec-output":
            resp["output_type"] = "panel"
        return resp
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "Command timed out (300s)", "action": action}
    except Exception as e:
        return {"ok": False, "error": str(e), "action": action}


# ---------------------------------------------------------------------------
# REST — Interactive LLM chat
# ---------------------------------------------------------------------------

_LLM_PYTHON_DRIVERS = {"generic-driver-llm-python", "generic-driver-ollama-python"}


@router.post("/nodes/{node_id}/chat")
def node_llm_chat(node_id: str, body: dict = Body(...)):
    """Multi-turn chat for LLM/Ollama nodes.

    Body: { messages: [{role, content}, ...], system?: str }
    """
    if not shared.topology:
        raise HTTPException(404, "Topology not loaded")
    node = shared.topology.get_node(node_id)
    if not node:
        raise HTTPException(404, f"Node '{node_id}' not found")

    messages: list[dict] = body.get("messages", [])
    system: str = body.get("system", "")

    nd = node.to_dict()
    env_data = load_node_env(nd)

    # Find the first LLM-capable Python driver from the capabilities file.
    # Also merge the per-driver driver_args into env_data so _args() picks
    # up the node's configured provider, model, api_key, etc.
    target_drv = None
    for cap_entry in env_data.get("drivers", []):
        drv_id = cap_entry.get("driver") or cap_entry.get("id") or ""
        matched_id = None
        if drv_id in _LLM_PYTHON_DRIVERS:
            matched_id = drv_id
        else:
            py_variant = f"{drv_id}-python"
            if py_variant in _LLM_PYTHON_DRIVERS and py_variant in shared.registry:
                matched_id = py_variant
        if matched_id:
            target_drv = shared.registry.get(matched_id)
            # Merge per-driver args so the driver reads the right credentials
            per_args = cap_entry.get("driver_args", {})
            if per_args:
                env_data = {
                    **env_data,
                    "driver_args": {**env_data.get("driver_args", {}), **per_args},
                }
            break

    if not target_drv:
        raise HTTPException(400, "Node has no LLM driver configured")
    if not hasattr(target_drv, "multi_turn_chat"):
        raise HTTPException(400, f"Driver '{target_drv.name}' does not support multi-turn chat")

    return target_drv.multi_turn_chat(env_data, messages, system)


# ---------------------------------------------------------------------------
# REST — Node env data
# ---------------------------------------------------------------------------


@router.get("/nodes/{node_id}/env")
def get_node_env(node_id: str):
    if not shared.topology:
        raise HTTPException(404, "Topology not loaded")
    node = shared.topology.get_node(node_id)
    if not node:
        raise HTTPException(404, f"Node '{node_id}' not found")
    nd = node.to_dict()
    env_data = load_node_env(nd)
    return {"node_id": node_id, "env_file": nd.get("env"), **env_data}


@router.get("/nodes/{node_id}/agent/tools")
def get_agent_tools(node_id: str):
    """Return all tools discoverable by an AI Agent node."""
    if not shared.topology:
        raise HTTPException(404, "Topology not loaded")
    node = shared.topology.get_node(node_id)
    if not node:
        raise HTTPException(404, f"Node '{node_id}' not found")
    try:
        from triv.drivers.generic_driver_agent import GenericAgentDriver

        drv = GenericAgentDriver()
        tools = drv._discover_tools(shared.topology, None, node_id)
        # Strip internal keys before returning
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


# ---------------------------------------------------------------------------
# REST — Interaction history
# ---------------------------------------------------------------------------


@router.get("/nodes/{node_id}/history")
def get_node_history(node_id: str, limit: int = 50):
    entries = shared.get_history(node_id, limit=limit)
    return {"node_id": node_id, "count": len(entries), "entries": entries}


@router.delete("/nodes/{node_id}/history")
def clear_node_history(node_id: str):
    with shared._history_lock:
        shared._history.pop(node_id, None)
    return {"ok": True}


@router.get("/nodes/{node_id}/history/export")
def export_node_history(node_id: str):
    from fastapi.responses import Response

    entries = shared.get_history(node_id, limit=0)
    lines = "\n".join(json.dumps(e, ensure_ascii=False) for e in entries)
    filename = f"history-{node_id}.jsonl"
    return Response(
        content=lines,
        media_type="application/x-ndjson",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------------------------------------------------------------------------
# REST — Legacy /api/vms
# ---------------------------------------------------------------------------


@router.get("/vms")
def get_vms_legacy():
    out = subprocess.run(
        ["virsh", "-c", shared.LIBVIRT_URI, "list", "--all"],
        capture_output=True,
        text=True,
        env=shared.C_ENV,
    ).stdout
    vms = []
    for line in out.splitlines()[2:]:
        parts = line.split()
        if len(parts) >= 3:
            vms.append({"name": parts[1], "state": " ".join(parts[2:])})
    return vms


@router.post("/vms/{vm_name}/stop")
def stop_vm_legacy(vm_name: str):
    subprocess.run(
        ["virsh", "-c", shared.LIBVIRT_URI, "destroy", vm_name], check=False, env=shared.C_ENV
    )
    return {"ok": True}
