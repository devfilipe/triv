"""
Router: networks_v2 — links, bridges, discovered links,
first-class NetworkDef CRUD, deploy/undeploy, host, internet.
"""

import json
import subprocess
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Body

from triv.core import network as netmod
from triv.core import network_v2 as netv2

import shared
from shared import TRIV_HOME, C_ENV

router = APIRouter(prefix="/api", tags=["networks-v2"])


# ── Helpers ──────────────────────────────────────────────────────


def _networks_dir() -> Path:
    return netv2.networks_dir_for_project(str(shared.PROJECT_DIR), TRIV_HOME)


def _resolve_topology_networks() -> list:
    if not shared.topology:
        return []
    return shared.topology.network_defs or []


def save_topology_with_network_refs(topo_path: Path) -> None:
    """Save topology, writing network_defs as $ref entries."""
    if not shared.topology:
        return
    d = shared.topology.to_dict()
    if shared.topology.network_defs:
        ref_list = []
        for nd in shared.topology.network_defs:
            entry: dict[str, Any] = {}
            if nd._ref:
                entry["$ref"] = nd._ref
            else:
                entry = nd.to_dict()
            if nd.network_id:
                entry["network_id"] = nd.network_id
            if nd.position:
                entry["position"] = nd.position
            ref_list.append(entry)
        d["network_defs"] = ref_list
    with open(topo_path, "w") as f:
        json.dump(d, f, indent=4)
        f.write("\n")


_BUILTIN_NETWORK_TEMPLATES = [
    {
        "id": "tmpl-bridge",
        "label": "Bridge",
        "type": "bridge",
        "description": "Linux L2 bridge — virtual switch connecting multiple nodes to a shared broadcast domain.",
        "color": "#89b4fa",
        "stp": False,
    },
    {
        "id": "tmpl-docker",
        "label": "Docker",
        "type": "docker",
        "description": "Docker-managed network with built-in gateway. Ideal for containers needing NAT or DNS.",
        "color": "#94e2d5",
    },
    {
        "id": "tmpl-trunk",
        "label": "Trunk",
        "type": "trunk",
        "description": "802.1Q trunk bridge with VLAN filtering. Carries tagged traffic for multiple VLANs.",
        "color": "#cba6f7",
        "vlan_filtering": True,
    },
    {
        "id": "tmpl-vlan-bridge",
        "label": "VLAN Bridge",
        "type": "vlan-bridge",
        "description": "VLAN sub-interface on a parent trunk. Isolates one VLAN into a dedicated broadcast domain.",
        "color": "#fab387",
    },
    {
        "id": "tmpl-p2p",
        "label": "Point-to-Point",
        "type": "p2p",
        "description": "Dedicated /30–/31 link between two nodes. Minimal footprint, no broadcast.",
        "color": "#a6e3a1",
    },
]


# ── Links / Bridges / Discovery ──────────────────────────────────


@router.get("/links")
def get_links():
    if not shared.topology:
        return []
    return [netmod.enrich_link(lk, shared.topology) for lk in shared.topology.links]


@router.get("/networks")
def get_networks_status():
    pid = shared.topology.project_id if shared.topology else ""
    bridges_map: dict[str, dict] = {}

    st = shared.state_tracker.state
    for br_name, info in st.bridges.items():
        bridges_map[br_name] = {
            "name": br_name,
            "link": info.get("link"),
            "source": "tracked",
            "state": netmod.get_bridge_state(br_name),
            "stp": netmod.get_stp_state(br_name),
            "attached": info.get("attached", []),
            "stats": netmod.get_bridge_stats(br_name),
        }

    if shared.topology:
        for link in shared.topology.links:
            br_logical = link.bridge_name
            br_name = netmod.qualify_bridge(br_logical, pid)
            if br_name and br_name not in bridges_map:
                bridges_map[br_name] = {
                    "name": br_name,
                    "logical": br_logical,
                    "link": link.id,
                    "source": "topology",
                    "state": netmod.get_bridge_state(br_name),
                    "stp": netmod.get_stp_state(br_name),
                    "attached": [],
                    "stats": netmod.get_bridge_stats(br_name),
                }

    try:
        from triv.core.state import _is_triv_bridge

        out = subprocess.run(
            ["ip", "-br", "link", "show", "type", "bridge"],
            capture_output=True,
            text=True,
            env=C_ENV,
        ).stdout
        for line in out.splitlines():
            parts = line.split()
            if not parts:
                continue
            name = parts[0]
            if _is_triv_bridge(name) and name not in bridges_map:
                bridges_map[name] = {
                    "name": name,
                    "link": None,
                    "source": "live",
                    "state": netmod.get_bridge_state(name),
                    "stp": netmod.get_stp_state(name),
                    "attached": [],
                    "stats": netmod.get_bridge_stats(name),
                }
    except Exception:
        pass

    return {"bridges": list(bridges_map.values())}


@router.get("/links/discovered")
def get_discovered_links():
    if not shared.topology:
        return {"nodes": [], "edges": []}
    nodes_dicts = [n.to_dict() for n in shared.topology.nodes if n.runtime is not None]
    discovered = netmod.discover_container_networks(nodes_dicts)

    container_to_node: dict[str, str] = {}
    for node in shared.topology.nodes:
        props = node.properties or {}
        cname = props.get("container-name") or node.id
        container_to_node[cname] = node.id

    virtual_nodes: list[dict] = []
    virtual_edges: list[dict] = []

    for entry in discovered:
        net_name = entry["network"]
        containers = entry.get("containers", {})
        connected: list[dict] = []
        for cname, info in containers.items():
            nid = container_to_node.get(cname, cname)
            connected.append({"node_id": nid, "ip": info.get("ip")})

        if len(connected) < 2:
            continue

        if len(connected) == 2:
            virtual_edges.append(
                {
                    "id": f"disc-{net_name}",
                    "source": {
                        "node": connected[0]["node_id"],
                        "interface": connected[0].get("ip", ""),
                    },
                    "target": {
                        "node": connected[1]["node_id"],
                        "interface": connected[1].get("ip", ""),
                    },
                    "type": "logical",
                    "label": net_name,
                    "network": {"docker_network": net_name},
                    "medium_group": "logical",
                    "discovered": True,
                }
            )
        else:
            hub_id = f"disc-hub-{net_name}"
            subnet = entry.get("subnet", "")
            virtual_nodes.append(
                {
                    "id": hub_id,
                    "category": "network",
                    "driver": "discovered",
                    "label": net_name,
                    "vm_name": hub_id,
                    "properties": {"label": net_name, "subnet": subnet},
                    "discovered": True,
                }
            )
            for idx, conn in enumerate(connected):
                virtual_edges.append(
                    {
                        "id": f"disc-{net_name}-{idx}",
                        "source": {"node": conn["node_id"], "interface": conn.get("ip", "")},
                        "target": {"node": hub_id, "interface": ""},
                        "type": "logical",
                        "label": conn.get("ip", ""),
                        "network": {"docker_network": net_name},
                        "medium_group": "logical",
                        "discovered": True,
                    }
                )

    return {"nodes": virtual_nodes, "edges": virtual_edges}


# ── V2 Endpoints ─────────────────────────────────────────────────


@router.get("/v2/networks/templates")
def get_v2_network_templates():
    return _BUILTIN_NETWORK_TEMPLATES


@router.get("/v2/networks")
def get_v2_networks():
    if not shared.topology:
        return []
    pid = shared.topology.project_id
    nets = _resolve_topology_networks()
    result = []
    for nd in nets:
        status = netv2.get_network_status(nd, pid, all_nets=nets)
        d = nd.to_dict()
        d["status"] = status
        result.append(d)
    return result


@router.get("/v2/networks/catalog")
def get_v2_network_catalog():
    net_dir = _networks_dir()
    assigned_ids: set[str] = set()
    if shared.topology:
        assigned_ids = {nd.id for nd in shared.topology.network_defs}
    catalog = []
    for fpath in sorted(net_dir.glob("*.json")):
        try:
            with open(fpath) as f:
                data = json.load(f)
            net_id = data.get("id", fpath.stem)
            data["_file"] = fpath.name
            data["assigned"] = net_id in assigned_ids
            if net_id in assigned_ids and shared.topology:
                nd = next((n for n in shared.topology.network_defs if n.id == net_id), None)
                if nd:
                    data["network_id"] = nd.network_id
            catalog.append(data)
        except Exception as e:
            print(f"[catalog] Warning: failed to load {fpath.name}: {e}")
    return catalog


@router.post("/v2/networks/assign")
def assign_v2_network(body: dict = Body(...)):
    if not shared.topology:
        raise HTTPException(404, "Topology not loaded")
    net_id = body.get("id", "").strip()
    if not net_id:
        raise HTTPException(400, "Missing 'id'")
    if any(nd.id == net_id for nd in shared.topology.network_defs):
        raise HTTPException(409, f"Network '{net_id}' is already assigned")

    net_dir = _networks_dir()
    fpath = net_dir / f"{net_id}.json"
    if not fpath.is_file():
        raise HTTPException(404, f"Catalog file '{net_id}.json' not found")
    try:
        with open(fpath) as f:
            data = json.load(f)
    except Exception as e:
        raise HTTPException(500, f"Failed to load catalog file: {e}")

    from triv.core.models import NetworkDef

    nd = NetworkDef.from_dict(data)
    nd._ref = fpath.name
    nd.network_id = netv2.generate_network_id()
    shared.topology.network_defs.append(nd)

    topo_path = Path(shared.PROJECT_DIR) / "topology.json"
    save_topology_with_network_refs(topo_path)
    return {"ok": True, "network_id": nd.network_id, "id": nd.id}


@router.post("/v2/networks/unassign")
def unassign_v2_network(body: dict = Body(...)):
    if not shared.topology:
        raise HTTPException(404, "Topology not loaded")
    network_id = body.get("network_id", "").strip()
    if not network_id:
        raise HTTPException(400, "Missing 'network_id'")
    nd = shared.topology.get_network_def(network_id)
    if not nd:
        raise HTTPException(404, f"Network '{network_id}' not found in topology")

    pid = shared.topology.project_id
    status = netv2.get_network_status(nd, pid)
    undeploy_report = None
    if status.get("deployed"):
        undeploy_report = netv2.undeploy_network(
            nd, pid, shared.state_tracker, all_nets=shared.topology.network_defs
        )
    shared.topology.network_defs = [
        n for n in shared.topology.network_defs if n.network_id != network_id
    ]
    topo_path = Path(shared.PROJECT_DIR) / "topology.json"
    save_topology_with_network_refs(topo_path)
    return {"ok": True, "network_id": network_id, "undeploy": undeploy_report}


@router.get("/v2/networks/{network_id}")
def get_v2_network(network_id: str):
    if not shared.topology:
        raise HTTPException(404, "Topology not loaded")
    nd = shared.topology.get_network_def(network_id)
    if not nd:
        raise HTTPException(404, f"Network '{network_id}' not found")
    status = netv2.get_network_status(
        nd, shared.topology.project_id, all_nets=shared.topology.network_defs
    )
    d = nd.to_dict()
    d["status"] = status
    return d


@router.post("/v2/networks")
def create_v2_network(body: dict = Body(...)):
    if not shared.topology:
        raise HTTPException(404, "Topology not loaded")
    from triv.core.models import NetworkDef as NDef

    nd = NDef.from_dict(body)
    if not nd.id:
        raise HTTPException(400, "Network 'id' is required")
    if not nd.network_id:
        nd.network_id = netv2.generate_network_id()
    existing = shared.topology.get_network_def(nd.id)
    if existing:
        raise HTTPException(409, f"Network '{nd.id}' already exists")
    existing_nid = shared.topology.get_network_def(nd.network_id)
    if existing_nid:
        raise HTTPException(409, f"network_id '{nd.network_id}' already in use")

    net_dir = _networks_dir()
    filepath = netv2.save_network_file(nd, net_dir)
    shared.topology.network_defs.append(nd)
    nd._ref = f"{nd.id}.json"

    topo_path = Path(shared.PROJECT_DIR) / "topology.json"
    save_topology_with_network_refs(topo_path)
    return {"ok": True, "network_id": nd.network_id, "id": nd.id, "file": str(filepath)}


@router.put("/v2/networks/{network_id}")
def update_v2_network(network_id: str, body: dict = Body(...)):
    if not shared.topology:
        raise HTTPException(404, "Topology not loaded")
    nd = shared.topology.get_network_def(network_id)
    if not nd:
        raise HTTPException(404, f"Network '{network_id}' not found")
    for key in (
        "label",
        "description",
        "type",
        "bridge",
        "vlan",
        "parent_network",
        "stp",
        "vlan_filtering",
        "vlans",
        "subnet",
        "gateway",
        "docker",
        "host",
        "internet",
    ):
        if key in body:
            setattr(nd, key, body[key])
    net_dir = _networks_dir()
    netv2.save_network_file(nd, net_dir)
    topo_path = Path(shared.PROJECT_DIR) / "topology.json"
    save_topology_with_network_refs(topo_path)
    return {"ok": True, "network_id": nd.network_id}


@router.delete("/v2/networks/{network_id}")
def delete_v2_network(network_id: str):
    if not shared.topology:
        raise HTTPException(404, "Topology not loaded")
    nd = shared.topology.get_network_def(network_id)
    if not nd:
        raise HTTPException(404, f"Network '{network_id}' not found")
    pid = shared.topology.project_id
    status = netv2.get_network_status(nd, pid)
    undeploy_report = None
    if status.get("deployed"):
        undeploy_report = netv2.undeploy_network(
            nd, pid, shared.state_tracker, all_nets=shared.topology.network_defs
        )
    shared.topology.network_defs = [
        n for n in shared.topology.network_defs if n.network_id != nd.network_id
    ]
    topo_path = Path(shared.PROJECT_DIR) / "topology.json"
    save_topology_with_network_refs(topo_path)
    return {"ok": True, "network_id": nd.network_id, "undeploy": undeploy_report}


@router.post("/v2/networks/{network_id}/deploy")
def deploy_v2_network(network_id: str):
    if not shared.topology:
        raise HTTPException(404, "Topology not loaded")
    nd = shared.topology.get_network_def(network_id)
    if not nd:
        raise HTTPException(404, f"Network '{network_id}' not found")
    report = netv2.deploy_network(
        nd, shared.topology.project_id, shared.state_tracker, all_nets=shared.topology.network_defs
    )
    ok = len(report.get("errors", [])) == 0
    return {"ok": ok, "report": report}


@router.post("/v2/networks/{network_id}/undeploy")
def undeploy_v2_network(network_id: str):
    if not shared.topology:
        raise HTTPException(404, "Topology not loaded")
    nd = shared.topology.get_network_def(network_id)
    if not nd:
        raise HTTPException(404, f"Network '{network_id}' not found")
    report = netv2.undeploy_network(
        nd, shared.topology.project_id, shared.state_tracker, all_nets=shared.topology.network_defs
    )
    ok = len(report.get("errors", [])) == 0
    return {"ok": ok, "report": report}


@router.post("/v2/networks/{network_id}/host-join")
def host_join_v2_network(network_id: str):
    if not shared.topology:
        raise HTTPException(404, "Topology not loaded")
    nd = shared.topology.get_network_def(network_id)
    if not nd:
        raise HTTPException(404, f"Network '{network_id}' not found")
    report = netv2.host_join(nd, shared.topology.project_id)
    ok = len(report.get("errors", [])) == 0
    return {"ok": ok, "report": report}


@router.post("/v2/networks/{network_id}/host-leave")
def host_leave_v2_network(network_id: str):
    if not shared.topology:
        raise HTTPException(404, "Topology not loaded")
    nd = shared.topology.get_network_def(network_id)
    if not nd:
        raise HTTPException(404, f"Network '{network_id}' not found")
    report = netv2.host_leave(nd, shared.topology.project_id)
    ok = len(report.get("errors", [])) == 0
    return {"ok": ok, "report": report}


@router.post("/v2/networks/{network_id}/internet-connect")
def internet_connect_v2_network(network_id: str):
    if not shared.topology:
        raise HTTPException(404, "Topology not loaded")
    nd = shared.topology.get_network_def(network_id)
    if not nd:
        raise HTTPException(404, f"Network '{network_id}' not found")
    try:
        report = netv2.internet_connect(nd, shared.topology.project_id)
    except Exception as e:
        return {"ok": False, "error": str(e)}
    ok = len(report.get("errors", [])) == 0
    return {"ok": ok, "report": report}


@router.post("/v2/networks/{network_id}/internet-disconnect")
def internet_disconnect_v2_network(network_id: str):
    if not shared.topology:
        raise HTTPException(404, "Topology not loaded")
    nd = shared.topology.get_network_def(network_id)
    if not nd:
        raise HTTPException(404, f"Network '{network_id}' not found")
    report = netv2.internet_disconnect(nd, shared.topology.project_id)
    ok = len(report.get("errors", [])) == 0
    return {"ok": ok, "report": report}


@router.patch("/v2/networks/{network_id}/position")
def patch_v2_network_position(network_id: str, body: dict = Body(...)):
    if not shared.topology:
        raise HTTPException(404, "Topology not loaded")
    nd = shared.topology.get_network_def(network_id)
    if not nd:
        raise HTTPException(404, f"Network '{network_id}' not found")
    nd.position = {"x": float(body.get("x", 0)), "y": float(body.get("y", 0))}
    topo_path = Path(shared.PROJECT_DIR) / "topology.json"
    save_topology_with_network_refs(topo_path)
    return {"ok": True}
