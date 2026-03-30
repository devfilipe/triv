#!/usr/bin/env python3
"""
triv Wizard App — REST API client for the Wizard agent tools.

Each subcommand maps to one tool action exposed to the Wizard agent via
generic-driver-ai-tool. Calls triv's own local REST API to manipulate
the active user project topology.

Usage:
    python3 wizard_app.py <action> [json-payload]

The payload is a JSON string passed as the second argument. Actions that
don't require input ignore it.
"""

import json
import os
import sys
import urllib.request
import urllib.error

TRIV_API_BASE = os.environ.get("TRIV_API_URL", "http://localhost:8481")


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------


def _get(path: str) -> dict:
    url = f"{TRIV_API_BASE}{path}"
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        return {"ok": False, "error": f"HTTP {e.code}: {body[:400]}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def _post(path: str, body: dict) -> dict:
    url = f"{TRIV_API_BASE}{path}"
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        url, data=data, method="POST", headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        body_txt = e.read().decode("utf-8", errors="replace")
        return {"ok": False, "error": f"HTTP {e.code}: {body_txt[:400]}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def _put(path: str, body: dict) -> dict:
    url = f"{TRIV_API_BASE}{path}"
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        url, data=data, method="PUT", headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        body_txt = e.read().decode("utf-8", errors="replace")
        return {"ok": False, "error": f"HTTP {e.code}: {body_txt[:400]}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def _delete(path: str) -> dict:
    url = f"{TRIV_API_BASE}{path}"
    req = urllib.request.Request(url, method="DELETE")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        return {"ok": False, "error": f"HTTP {e.code}: {body[:400]}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ---------------------------------------------------------------------------
# Topology — read
# ---------------------------------------------------------------------------


def list_nodes(_payload: dict) -> dict:
    result = _get("/api/nodes")
    if isinstance(result, list):
        nodes = [
            {
                "id": n.get("id"),
                "label": n.get("label", n.get("id")),
                "runtime": n.get("runtime"),
                "category": n.get("category"),
            }
            for n in result
        ]
        return {"ok": True, "nodes": nodes, "count": len(nodes)}
    return result


def get_topology_summary(_payload: dict) -> dict:
    result = _get("/api/topology")
    if "nodes" not in result and "ok" in result and not result["ok"]:
        return result
    nodes = [
        {
            "id": n.get("id"),
            "label": (n.get("properties") or {}).get("label", n.get("id")),
            "runtime": n.get("runtime"),
            "category": n.get("category"),
        }
        for n in (result.get("nodes") or [])
    ]
    links = [
        {"id": lk.get("id"), "source": lk.get("source"), "target": lk.get("target")}
        for lk in (result.get("links") or [])
    ]
    networks = result.get("network_defs") or []
    return {"ok": True, "nodes": nodes, "links": links, "networks": networks}


# ---------------------------------------------------------------------------
# Topology — nodes
# ---------------------------------------------------------------------------


def create_node(payload: dict) -> dict:
    label = payload.get("label", "")
    node_id = payload.get("id", "")
    runtime = payload.get("runtime") or None
    category = payload.get("category") or "generic"
    driver = payload.get("driver") or "generic"

    body: dict = {
        "driver": driver,
        "category": category,
        "properties": {"label": label},
    }
    if node_id:
        body["id"] = node_id
    if runtime:
        body["runtime"] = runtime

    return _post("/api/topology/nodes", body)


def update_node(payload: dict) -> dict:
    """Full node update: label, runtime, driver, category, interfaces, properties."""
    node_id = payload.get("node_id", "")
    if not node_id:
        return {"ok": False, "error": "node_id is required"}

    topo = _get("/api/topology")
    if "nodes" not in topo:
        return {"ok": False, "error": "Could not fetch topology"}
    node = next((n for n in topo.get("nodes", []) if n.get("id") == node_id), None)
    if not node:
        return {"ok": False, "error": f"Node '{node_id}' not found"}

    body = dict(node)
    props = dict(body.get("properties") or {})

    if "label" in payload:
        props["label"] = payload["label"]
    if "runtime" in payload:
        body["runtime"] = payload["runtime"]
    if "driver" in payload:
        body["driver"] = payload["driver"]
    if "category" in payload:
        body["category"] = payload["category"]
    if "interfaces" in payload:
        body["interfaces"] = payload["interfaces"]
    body["properties"] = props

    return _put(f"/api/topology/nodes/{node_id}", body)


def update_node_label(payload: dict) -> dict:
    node_id = payload.get("node_id", "")
    new_label = payload.get("new_label", "")
    if not node_id:
        return {"ok": False, "error": "node_id is required"}
    return update_node({"node_id": node_id, "label": new_label})


def delete_node(payload: dict) -> dict:
    node_id = payload.get("node_id", "")
    if not node_id:
        return {"ok": False, "error": "node_id is required"}
    return _delete(f"/api/topology/nodes/{node_id}")


# ---------------------------------------------------------------------------
# Topology — links
# ---------------------------------------------------------------------------


def add_link(payload: dict) -> dict:
    body = {
        "source": payload.get("source_node", ""),
        "source_interface": payload.get("source_iface", ""),
        "target": payload.get("target_node", ""),
        "target_interface": payload.get("target_iface", ""),
    }
    return _post("/api/topology/links", body)


def remove_link(payload: dict) -> dict:
    link_id = payload.get("link_id", "")
    if not link_id:
        return {"ok": False, "error": "link_id is required"}
    return _delete(f"/api/topology/links/{link_id}")


# ---------------------------------------------------------------------------
# Capabilities
# ---------------------------------------------------------------------------


def get_node_capabilities(payload: dict) -> dict:
    node_id = payload.get("node_id", "")
    if not node_id:
        return {"ok": False, "error": "node_id is required"}
    result = _get(f"/api/nodes/{node_id}/capabilities")
    if isinstance(result, dict) and "drivers" in result:
        return {"ok": True, "capabilities": result}
    return result


def set_node_capabilities(payload: dict) -> dict:
    node_id = payload.get("node_id", "")
    caps_json = payload.get("capabilities_json", "")
    if not node_id:
        return {"ok": False, "error": "node_id is required"}
    if not caps_json:
        return {"ok": False, "error": "capabilities_json is required"}
    try:
        caps = json.loads(caps_json)
    except json.JSONDecodeError as e:
        return {"ok": False, "error": f"Invalid JSON in capabilities_json: {e}"}
    return _put(f"/api/nodes/{node_id}/capabilities", caps)


# ---------------------------------------------------------------------------
# Node actions
# ---------------------------------------------------------------------------


def get_node_actions(payload: dict) -> dict:
    """List executable actions available on a node."""
    node_id = payload.get("node_id", "")
    if not node_id:
        return {"ok": False, "error": "node_id is required"}
    result = _get("/api/nodes")
    if not isinstance(result, list):
        return result
    node = next((n for n in result if n.get("id") == node_id), None)
    if not node:
        return {"ok": False, "error": f"Node '{node_id}' not found"}
    actions = [
        {"id": a.get("id"), "label": a.get("label", a.get("id")), "type": a.get("type")}
        for a in (node.get("actions") or [])
        if a.get("type") not in ("console", "ssh", "link", "webui")
    ]
    return {"ok": True, "node_id": node_id, "actions": actions}


def run_node_action(payload: dict) -> dict:
    """Execute an action on a node."""
    node_id = payload.get("node_id", "")
    action_id = payload.get("action_id", "")
    if not node_id:
        return {"ok": False, "error": "node_id is required"}
    if not action_id:
        return {"ok": False, "error": "action_id is required"}
    body = {k: v for k, v in payload.items() if k not in ("node_id", "action_id")}
    return _post(f"/api/nodes/{node_id}/action/{action_id}", body)


# ---------------------------------------------------------------------------
# Networks
# ---------------------------------------------------------------------------


def list_networks(_payload: dict) -> dict:
    result = _get("/api/v2/networks")
    if isinstance(result, list):
        return {"ok": True, "networks": result, "count": len(result)}
    if isinstance(result, dict) and "networks" in result:
        return {"ok": True, **result}
    return result


def create_network(payload: dict) -> dict:
    body = {
        "id": payload.get("id", ""),
        "type": payload.get("type", "bridge"),
        "label": payload.get("label", payload.get("id", "")),
    }
    return _post("/api/v2/networks", body)


def assign_node_to_network(payload: dict) -> dict:
    body = {
        "node_id": payload.get("node_id", ""),
        "iface_id": payload.get("iface_id", ""),
        "network_id": payload.get("network_id", ""),
    }
    return _post("/api/v2/networks/assign", body)


# ---------------------------------------------------------------------------
# Node lifecycle
# ---------------------------------------------------------------------------


def start_node(payload: dict) -> dict:
    node_id = payload.get("node_id", "")
    if not node_id:
        return {"ok": False, "error": "node_id is required"}
    return _post(f"/api/nodes/{node_id}/start", {})


def stop_node(payload: dict) -> dict:
    node_id = payload.get("node_id", "")
    if not node_id:
        return {"ok": False, "error": "node_id is required"}
    return _post(f"/api/nodes/{node_id}/stop", {})


def restart_node(payload: dict) -> dict:
    node_id = payload.get("node_id", "")
    if not node_id:
        return {"ok": False, "error": "node_id is required"}
    return _post(f"/api/nodes/{node_id}/restart", {})


# ---------------------------------------------------------------------------
# Secrets
# ---------------------------------------------------------------------------


def list_secrets(_payload: dict) -> dict:
    """List all secret names (values are never returned)."""
    result = _get("/api/secrets")
    if isinstance(result, list):
        secrets = [{"name": s.get("name"), "type": s.get("type", "")} for s in result]
        return {"ok": True, "secrets": secrets, "count": len(secrets)}
    return result


def set_secret(payload: dict) -> dict:
    """Create or update a named secret."""
    name = payload.get("name", "").strip()
    value = payload.get("value", "").strip()
    secret_type = payload.get("type", "api-key").strip()
    if not name:
        return {"ok": False, "error": "name is required"}
    if not value:
        return {"ok": False, "error": "value is required"}
    return _put(f"/api/secrets/{name}", {"name": name, "type": secret_type, "value": value})


def delete_secret(payload: dict) -> dict:
    """Delete a named secret."""
    name = payload.get("name", "").strip()
    if not name:
        return {"ok": False, "error": "name is required"}
    return _delete(f"/api/secrets/{name}")


# ---------------------------------------------------------------------------
# Networks (extended)
# ---------------------------------------------------------------------------


def delete_network(payload: dict) -> dict:
    network_id = payload.get("network_id", "")
    if not network_id:
        return {"ok": False, "error": "network_id is required"}
    return _delete(f"/api/v2/networks/{network_id}")


def deploy_network(payload: dict) -> dict:
    network_id = payload.get("network_id", "")
    if not network_id:
        return {"ok": False, "error": "network_id is required"}
    return _post(f"/api/v2/networks/{network_id}/deploy", {})


def undeploy_network(payload: dict) -> dict:
    network_id = payload.get("network_id", "")
    if not network_id:
        return {"ok": False, "error": "network_id is required"}
    return _post(f"/api/v2/networks/{network_id}/undeploy", {})


# ---------------------------------------------------------------------------
# Orgs
# ---------------------------------------------------------------------------


def list_orgs(_payload: dict) -> dict:
    """List all organizations."""
    result = _get("/api/orgs")
    if isinstance(result, list):
        return {"ok": True, "orgs": result, "count": len(result)}
    if isinstance(result, dict) and "orgs" in result:
        return {"ok": True, **result}
    return result


# ---------------------------------------------------------------------------
# Drivers
# ---------------------------------------------------------------------------


def list_drivers(_payload: dict) -> dict:
    """List all available drivers (built-in and vendor)."""
    result = _get("/api/drivers/catalog")
    if isinstance(result, list):
        drivers = [
            {
                "id": d.get("id"),
                "label": d.get("label", d.get("id")),
                "type": d.get("type"),
                "vendor": d.get("vendor"),
            }
            for d in result
        ]
        return {"ok": True, "drivers": drivers, "count": len(drivers)}
    return result


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------


def list_projects(_payload: dict) -> dict:
    """List all registered triv projects."""
    result = _get("/api/projects")
    if "projects" not in result:
        return result
    projects = [
        {
            "id": p.get("id"),
            "name": p.get("name"),
            "path": p.get("path"),
            "active": p.get("active", False),
            "has_topology": p.get("has_topology", False),
        }
        for p in result.get("projects", [])
    ]
    return {"ok": True, "active": result.get("active", ""), "projects": projects}


def create_project(payload: dict) -> dict:
    """Create a new triv project.

    If 'vendor' is provided, the project is created under ~/.triv/vendors/<vendor>/.
    If 'parent' is provided directly, it is used as-is.
    Otherwise defaults to ~/.triv/vendors/ (TRIV_PROJECTS_ROOT).
    """
    name = payload.get("name", "").strip()
    if not name:
        return {"ok": False, "error": "name is required"}

    body: dict = {
        "name": name,
        "dir_name": payload.get("dir_name", ""),
        "description": payload.get("description", ""),
    }

    vendor = payload.get("vendor", "").strip()
    if vendor:
        # Resolve TRIV_HOME from the defaults endpoint
        defaults = _get("/api/projects/defaults")
        triv_home = defaults.get("projects_root", "")
        if triv_home.endswith("/vendors"):
            triv_home = triv_home[: -len("/vendors")]
        body["parent"] = f"{triv_home}/vendors/{vendor}"
    elif "parent" in payload:
        body["parent"] = payload["parent"]
    # else: omit parent → backend uses TRIV_PROJECTS_ROOT (~/.triv/vendors)

    return _post("/api/projects/create", body)


def activate_project(payload: dict) -> dict:
    """Activate a project by ID, making it the current working topology."""
    project_id = payload.get("project_id", "")
    if not project_id:
        return {"ok": False, "error": "project_id is required"}
    return _post(f"/api/projects/{project_id}/activate", {})


def reload_topology(_payload: dict) -> dict:
    """Reload the topology from disk for the active project."""
    return _post("/api/topology/reload", {})


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

ACTIONS = {
    # Topology — read
    "list-nodes": list_nodes,
    "get-topology-summary": get_topology_summary,
    # Topology — nodes
    "create-node": create_node,
    "update-node": update_node,
    "update-node-label": update_node_label,
    "delete-node": delete_node,
    # Topology — links
    "add-link": add_link,
    "remove-link": remove_link,
    # Capabilities
    "get-node-capabilities": get_node_capabilities,
    "set-node-capabilities": set_node_capabilities,
    # Node actions
    "get-node-actions": get_node_actions,
    "run-node-action": run_node_action,
    # Node lifecycle
    "start-node": start_node,
    "stop-node": stop_node,
    "restart-node": restart_node,
    # Secrets
    "list-secrets": list_secrets,
    "set-secret": set_secret,
    "delete-secret": delete_secret,
    # Networks
    "list-networks": list_networks,
    "create-network": create_network,
    "assign-node-to-network": assign_node_to_network,
    "delete-network": delete_network,
    "deploy-network": deploy_network,
    "undeploy-network": undeploy_network,
    # Orgs
    "list-orgs": list_orgs,
    # Drivers
    "list-drivers": list_drivers,
    # Projects
    "list-projects": list_projects,
    "create-project": create_project,
    "activate-project": activate_project,
    "reload-topology": reload_topology,
}


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "Usage: wizard_app.py <action> [json-payload]"}))
        sys.exit(1)

    action = sys.argv[1]
    payload: dict = {}
    if len(sys.argv) >= 3:
        try:
            payload = json.loads(sys.argv[2])
        except json.JSONDecodeError:
            print(json.dumps({"ok": False, "error": f"Invalid JSON payload: {sys.argv[2][:100]}"}))
            sys.exit(1)

    fn = ACTIONS.get(action)
    if not fn:
        print(
            json.dumps(
                {"ok": False, "error": f"Unknown action: {action}. Available: {list(ACTIONS)}"}
            )
        )
        sys.exit(1)

    result = fn(payload)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
