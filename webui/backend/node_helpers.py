"""
Shared node resolution helpers used by multiple routers.
"""

import json
import os
import subprocess
from pathlib import Path

from triv.core import env as env_mod

import shared


def capabilities_dir() -> Path:
    """Return the directory for capabilities files.

    Uses TRIV_HOME as base so that inside a container the path always goes
    through the read-write mount (``/root/.triv``) instead of the host home
    directory which may be mounted read-only.
    """
    p = Path(shared.PROJECT_DIR)
    parts = p.parts
    try:
        idx = parts.index("vendors")
        if len(parts) > idx + 3 and parts[idx + 2] == "projects":
            vendor_name = parts[idx + 1]
            cap_dir = shared.TRIV_HOME / "vendors" / vendor_name / "capabilities"
            cap_dir.mkdir(parents=True, exist_ok=True)
            return cap_dir
    except ValueError:
        pass
    return p


def capabilities_path(node) -> Path:
    """Return the path to the capabilities (env) file for a node."""
    if node.env:
        if os.path.isabs(node.env):
            return Path(node.env)
        cap_dir = capabilities_dir()
        if (cap_dir / node.env).is_file():
            return cap_dir / node.env
        if (Path(shared.PROJECT_DIR) / node.env).is_file():
            return Path(shared.PROJECT_DIR) / node.env
        return cap_dir / node.env
    short_id = getattr(node, "properties", {}).get("short_id") or node.id
    return capabilities_dir() / f"capabilities-node-{short_id}.json"


def load_node_env(node_dict: dict) -> dict:
    """Load and normalise the env sidecar for a node."""
    env_filename = node_dict.get("env")
    if not env_filename:
        return {"driver_args": {}, "actions": []}

    if os.path.isabs(env_filename):
        return env_mod.load_env(env_filename, str(shared.PROJECT_DIR))

    cap_dir = capabilities_dir()
    cap_path = cap_dir / env_filename
    if cap_path.is_file():
        return env_mod.load_env(env_filename, str(cap_dir))

    return env_mod.load_env(env_filename, str(shared.PROJECT_DIR))


def resolve_vm_name(node_dict: dict, drv, env_data: dict | None = None) -> str:
    """Return the effective VM / container name for a node."""
    if node_dict.get("runtime") in ("docker", "podman"):
        args = (env_data or {}).get("driver_args", {})
        container_name = args.get("container-name")
        if container_name:
            return container_name
    return drv.vm_name(node_dict, env_data)


def resolve_node_actions(node_dict: dict, drv, vm_name: str, env_data: dict) -> list[dict]:
    """Merge driver static commands + env actions, resolve templates."""
    env_actions: list[dict] = env_data.get("actions", [])

    # Resolve any leftover $ref entries
    _resolved_ea: list[dict] = []
    for ea in env_actions:
        if isinstance(ea, dict) and "$ref" in ea and "id" not in ea:
            ref_id = ea["$ref"]
            drv_id = ea.get("driver", "")
            _resolved = False
            if drv_id:
                _all_drvs = shared.registry.all()
                _ref_drv = _all_drvs.get(drv_id)
                if _ref_drv:
                    for _cmd in _ref_drv.commands():
                        if _cmd.name == ref_id:
                            _meta = _ref_drv.metadata()
                            _vn = _meta.vendor_name if _meta.vendor_name else ""
                            merged = {
                                "id": _cmd.name,
                                "label": _cmd.label,
                                "icon": _cmd.icon,
                                "type": "driver-command",
                                "description": _cmd.description,
                                "driver": _ref_drv.name,
                                "origin": ea.get(
                                    "origin",
                                    f"vendor:{_vn.lower()}"
                                    if _vn and _vn.lower() not in ("unknown", "")
                                    else "native",
                                ),
                            }
                            for k, v in ea.items():
                                if k not in ("$ref",) and k not in merged:
                                    merged[k] = v
                            _resolved_ea.append(merged)
                            _resolved = True
                            break
            if not _resolved:
                _resolved_ea.append(ea)
        else:
            _resolved_ea.append(ea)
    env_actions = _resolved_ea

    env_action_ids = {a.get("id") for a in env_actions}

    # Always inject runtime-native lifecycle actions from the json-driver
    # file so that container/libvirt lifecycle (create, start, stop, …)
    # is available even when a capabilities file only adds vendor drivers.
    rt = node_dict.get("runtime")
    if rt:
        default_driver_map = {
            "docker": "generic-driver-container",
            "podman": "generic-driver-container",
            "libvirt": "generic-driver-libvirt",
            "app": "generic-driver-app",
            "remote": "generic-driver-remote",
        }
        default_drv_id = default_driver_map.get(rt, "")
        if default_drv_id:
            drv_json_path = shared.TOOLS_DIR / "triv" / "drivers" / f"{default_drv_id}.json"
            if drv_json_path.is_file():
                try:
                    with open(drv_json_path) as _f:
                        drv_data = json.load(_f)
                    for act_id, act_def in drv_data.get("actions", {}).items():
                        if act_id.startswith("_"):
                            continue
                        if act_def.get("id") not in env_action_ids:
                            a = dict(act_def)
                            a.setdefault("driver", default_drv_id)
                            a.setdefault("origin", "native")
                            env_actions.append(a)
                            env_action_ids.add(act_def.get("id"))
                except (json.JSONDecodeError, OSError):
                    pass

    # Always inject runtime-native actions
    env_action_ids = {a.get("id") for a in env_actions}
    if rt in ("docker", "podman") and "connect-network" not in env_action_ids:
        env_actions.append(
            {
                "id": "connect-network",
                "label": "Connect",
                "icon": "cable",
                "type": "driver-command",
                "driver": "generic-driver-container-python",
                "command": "docker network connect --ip <ip> triv-<bridge> ${vm_name}",
                "origin": "native",
            }
        )
        env_action_ids.add("connect-network")
    if rt in ("docker", "podman") and "disconnect-network" not in env_action_ids:
        env_actions.append(
            {
                "id": "disconnect-network",
                "label": "Disconnect",
                "icon": "unplug",
                "type": "driver-command",
                "driver": "generic-driver-container-python",
                "command": "docker network disconnect triv-<bridge> ${vm_name}",
                "origin": "native",
            }
        )
        env_action_ids.add("disconnect-network")

    # Inject actions from JSON drivers listed in the capabilities file.
    # This covers drivers whose actions live in a JSON file (not Python
    # commands()), e.g. generic-driver-llm, generic-driver-ollama,
    # generic-driver-agent and any vendor JSON driver.
    env_action_ids = {a.get("id") for a in env_actions}
    for _cap_entry in env_data.get("drivers", []):
        _cap_drv_id = (
            _cap_entry.get("driver") or _cap_entry.get("name") or _cap_entry.get("id") or ""
        )
        if not _cap_drv_id:
            continue
        _cap_json = shared.TOOLS_DIR / "triv" / "drivers" / f"{_cap_drv_id}.json"
        if not _cap_json.is_file():
            continue
        try:
            with open(_cap_json) as _f:
                _cap_data = json.load(_f)
            for _act_id, _act_def in _cap_data.get("actions", {}).items():
                if _act_id.startswith("_"):
                    continue
                _aid = _act_def.get("id")
                if not _aid or _aid in env_action_ids:
                    continue
                _a = dict(_act_def)
                _a.setdefault("driver", _cap_drv_id)
                _a.setdefault("origin", "native")
                env_actions.append(_a)
                env_action_ids.add(_aid)
        except (json.JSONDecodeError, OSError):
            pass

    # Convert driver DeviceCommands into action format.
    # Covers two cases:
    #   a) No capabilities file → inject node's main driver commands.
    #   b) Capabilities file lists a Python driver by name → inject its commands.
    #      Also resolves "<id>-python" variant so JSON driver IDs work too.
    cap_driver_ids = {
        d.get("driver") or d.get("name") or d.get("id") or "" for d in env_data.get("drivers", [])
    }
    has_caps = bool(node_dict.get("env"))
    cat = node_dict.get("category", "generic")
    # Build the set of Python drivers to inject commands from.
    # Always include the node's main driver when there is no caps file.
    _py_drivers_to_inject: list = []
    if not has_caps:
        _py_drivers_to_inject.append(drv)
    else:
        for _cap_drv_id in cap_driver_ids:
            if not _cap_drv_id:
                continue
            # Try exact match first, then the "-python" variant
            _py_drv = None
            if _cap_drv_id in shared.registry:
                _py_drv = shared.registry.get(_cap_drv_id)
            elif f"{_cap_drv_id}-python" in shared.registry:
                _py_drv = shared.registry.get(f"{_cap_drv_id}-python")
            if _py_drv:
                _py_drivers_to_inject.append(_py_drv)

    env_action_ids = {a.get("id") for a in env_actions}
    for _inj_drv in _py_drivers_to_inject:
        _inj_meta = _inj_drv.metadata()
        _inj_vendor = _inj_meta.vendor_name if _inj_meta.vendor_name else ""
        _inj_origin = (
            f"vendor:{_inj_vendor.lower()}"
            if _inj_vendor and _inj_vendor.lower() not in ("unknown", "")
            else "native"
        )
        for cmd in _inj_drv.commands():
            if cmd.name in env_action_ids:
                continue
            if cmd.applicable_categories and cat not in cmd.applicable_categories:
                continue
            entry: dict = {
                "id": cmd.name,
                "label": cmd.label,
                "icon": cmd.icon,
                "type": "driver-command",
                "description": cmd.description,
                "driver": _inj_drv.name,
                "origin": _inj_origin,
            }
            if cmd.tool_args is not None:
                entry["tool_args"] = cmd.tool_args
            env_actions.append(entry)
            env_action_ids.add(cmd.name)

    # Get extra template vars from the driver
    extra_vars = {}
    try:
        extra_vars = drv.resolve_action_vars(node_dict, env_data)
    except Exception:
        pass

    # Resolve all templates
    pid = shared.topology.project_id if shared.topology else ""
    return env_mod.resolve_actions(
        actions=env_actions,
        node_dict=node_dict,
        vm_name=vm_name,
        env_data=env_data,
        project_dir=str(shared.PROJECT_DIR),
        project_id=pid,
        extra_vars=extra_vars,
        node_category=cat,
    )


def node_runtime_state(node_dict: dict, drv, env_data: dict | None = None) -> str:
    """Get runtime state for a node."""
    rt = node_dict.get("runtime")
    if not rt:
        return "logical"

    if env_data is None:
        env_data = load_node_env(node_dict)
    vm_name = resolve_vm_name(node_dict, drv, env_data)

    if rt == "libvirt":
        try:
            result = subprocess.run(
                ["virsh", "-c", shared.LIBVIRT_URI, "domstate", vm_name],
                capture_output=True,
                text=True,
                env=shared.C_ENV,
            )
            return result.stdout.strip() if result.returncode == 0 else "undefined"
        except FileNotFoundError:
            return "unavailable"

    if rt in ("docker", "podman"):
        try:
            result = subprocess.run(
                [rt, "inspect", "-f", "{{.State.Status}}", vm_name],
                capture_output=True,
                text=True,
            )
            return result.stdout.strip() if result.returncode == 0 else "undefined"
        except FileNotFoundError:
            return "unavailable"

    if rt == "physical":
        rc = subprocess.run(
            ["ping", "-c1", "-W1", node_dict.get("interfaces", [{}])[0].get("ip", "0.0.0.0")],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        ).returncode
        return "online" if rc == 0 else "offline"

    if rt in ("llm", "agent"):
        return "logical"

    return "unknown"
