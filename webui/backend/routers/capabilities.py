"""
Router: capabilities — node env/capabilities file CRUD + init.
"""

import json

from fastapi import APIRouter, HTTPException, Body

from triv.core import env as env_mod

import shared
from node_helpers import capabilities_path

router = APIRouter(prefix="/api", tags=["capabilities"])


@router.get("/nodes/{node_id}/capabilities")
def get_node_capabilities(node_id: str):
    if not shared.topology:
        raise HTTPException(404, "Topology not loaded")
    node = shared.topology.get_node(node_id)
    if not node:
        raise HTTPException(404, f"Node '{node_id}' not found")

    cap_file = capabilities_path(node)
    file_exists = cap_file.is_file()

    raw_content: dict = {}
    if file_exists:
        try:
            with open(cap_file) as f:
                raw_content = json.load(f)
        except (json.JSONDecodeError, OSError):
            pass

    raw_driver_args = raw_content.get("driver_args", {})

    drivers_list = raw_content.get("drivers", [])
    for d in drivers_list:
        if "driver" not in d and "name" in d:
            d["driver"] = d.pop("name")
    if not drivers_list and raw_driver_args:
        drivers_list = [
            {
                "driver": "default",
                "driver_args": raw_driver_args,
            }
        ]

    actions_raw = raw_content.get("actions", [])

    return {
        "node_id": node_id,
        "env_file": node.env or f"capabilities-{node.id}.json",
        "file_exists": file_exists,
        "drivers": drivers_list,
        "driver_args": raw_driver_args,
        "actions": actions_raw,
        "health": raw_content.get("health"),
        "raw": raw_content if file_exists else None,
    }


@router.put("/nodes/{node_id}/capabilities")
def update_node_capabilities(node_id: str, body: dict = Body(...)):
    if not shared.topology:
        raise HTTPException(404, "Topology not loaded")
    node = shared.topology.get_node(node_id)
    if not node:
        raise HTTPException(404, f"Node '{node_id}' not found")

    cap_file = capabilities_path(node)

    existing: dict = {}
    if cap_file.is_file():
        try:
            with open(cap_file) as f:
                existing = json.load(f)
        except (json.JSONDecodeError, OSError):
            pass

    cap_data: dict = {}
    if "uuid" in existing:
        cap_data["uuid"] = existing["uuid"]

    drivers_list = body.get("drivers", [])
    driver_args = body.get("driver_args", {})
    actions = body.get("actions", [])
    health = body.get("health")

    if drivers_list:
        cap_data["drivers"] = drivers_list
        if drivers_list:
            cap_data["driver_args"] = drivers_list[0].get("driver_args", {})
    elif driver_args:
        cap_data["driver_args"] = driver_args

    if actions:
        cap_data["actions"] = actions

    if health:
        cap_data["health"] = health

    _managed_keys = {"uuid", "drivers", "driver_args", "actions", "health"}
    for k, v in existing.items():
        if k not in _managed_keys and k not in cap_data:
            cap_data[k] = v

    try:
        with open(cap_file, "w") as f:
            json.dump(cap_data, f, indent=2, ensure_ascii=False)
            f.write("\n")
    except OSError as e:
        raise HTTPException(500, f"Failed to write capabilities file: {e}")

    filename = cap_file.name
    if node.env != filename:
        node.env = filename
        from routers.topology import save_topology

        save_topology()

    env_mod.clear_actions_cache()

    return {"ok": True, "env_file": filename, "path": str(cap_file)}


@router.post("/nodes/{node_id}/capabilities/init")
def init_node_capabilities(node_id: str):
    if not shared.topology:
        raise HTTPException(404, "Topology not loaded")
    node = shared.topology.get_node(node_id)
    if not node:
        raise HTTPException(404, f"Node '{node_id}' not found")

    cap_file = capabilities_path(node)

    if cap_file.is_file():
        return {
            "ok": True,
            "created": False,
            "env_file": cap_file.name,
            "detail": "Capabilities file already exists",
        }

    rt = node.runtime.value if node.runtime else None
    default_driver: str = ""
    default_action_refs: list = []
    if rt == "libvirt":
        default_driver = "generic-driver-libvirt"
        default_action_refs = [
            {"$ref": "vm-console", "driver": "generic-driver-libvirt", "origin": "native"},
            {"$ref": "vm-define", "driver": "generic-driver-libvirt", "origin": "native"},
            {"$ref": "vm-start", "driver": "generic-driver-libvirt", "origin": "native"},
            {"$ref": "vm-shutdown", "driver": "generic-driver-libvirt", "origin": "native"},
            {"$ref": "vm-reboot", "driver": "generic-driver-libvirt", "origin": "native"},
            {"$ref": "vm-destroy", "driver": "generic-driver-libvirt", "origin": "native"},
            {"$ref": "vm-info", "driver": "generic-driver-libvirt", "origin": "native"},
        ]
    elif rt in ("docker", "podman"):
        default_driver = "generic-driver-container"
        default_action_refs = [
            {"$ref": "container-create", "driver": "generic-driver-container", "origin": "native"},
            {"$ref": "console-sh", "driver": "generic-driver-container", "origin": "native"},
            {"$ref": "logs", "driver": "generic-driver-container", "origin": "native"},
            {"$ref": "container-status", "driver": "generic-driver-container", "origin": "native"},
            {"$ref": "container-start", "driver": "generic-driver-container", "origin": "native"},
            {"$ref": "container-stop", "driver": "generic-driver-container", "origin": "native"},
            {"$ref": "container-restart", "driver": "generic-driver-container", "origin": "native"},
            {"$ref": "container-rm", "driver": "generic-driver-container", "origin": "native"},
            {"$ref": "network-connect", "driver": "generic-driver-container", "origin": "native"},
            {
                "$ref": "network-disconnect",
                "driver": "generic-driver-container",
                "origin": "native",
            },
        ]
    elif rt == "app":
        default_driver = "generic-driver-app"
        default_action_refs = [
            {"$ref": "app-start", "driver": "generic-driver-app", "origin": "native"},
            {"$ref": "app-stop", "driver": "generic-driver-app", "origin": "native"},
            {"$ref": "app-status", "driver": "generic-driver-app", "origin": "native"},
            {"$ref": "app-logs", "driver": "generic-driver-app", "origin": "native"},
        ]
    elif rt == "remote":
        default_driver = "generic-driver-remote"
        default_action_refs = [
            {"$ref": "remote-ssh", "driver": "generic-driver-remote", "origin": "native"},
            {"$ref": "remote-ping", "driver": "generic-driver-remote", "origin": "native"},
            {"$ref": "remote-status", "driver": "generic-driver-remote", "origin": "native"},
        ]

    cap_data: dict = {"drivers": [], "actions": default_action_refs}
    if default_driver:
        cap_data["drivers"] = [{"driver": default_driver, "driver_args": {}}]

    try:
        with open(cap_file, "w") as f:
            json.dump(cap_data, f, indent=2, ensure_ascii=False)
            f.write("\n")
    except OSError as e:
        raise HTTPException(500, f"Failed to write capabilities file: {e}")

    filename = cap_file.name
    if node.env != filename:
        node.env = filename
        from routers.topology import save_topology

        save_topology()

    env_mod.clear_actions_cache()

    return {"ok": True, "created": True, "env_file": filename, "path": str(cap_file)}
