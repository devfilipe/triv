"""triv.core.network_v2 — V2 network engine operating on NetworkDef objects.

This module provides high-level deploy / undeploy / host-join / internet
operations for first-class ``NetworkDef`` objects.  It **reuses** all
low-level primitives from ``triv.core.network`` (bridges, VLANs, Docker
networks, veth pairs) but orchestrates them from a single network
definition instead of per-link config.

Resource naming
---------------
Every host resource (Linux bridge, Docker network, VLAN interface) is
qualified with the ``network_id`` (8-char hex) to guarantee global
uniqueness across projects and networks.

    bridge name   → qualify_bridge("<logical>", project_id)
    docker net    → "<project_id>-<docker_name>"
    vlan iface    → "v<network_id[:4]>.<vlan>"
    iptables tag  → "triv-<network_id>"
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

from .models import NetworkDef
from . import network as net


# ---------------------------------------------------------------------------
# ID generation
# ---------------------------------------------------------------------------


def generate_network_id() -> str:
    """Return an 8-char hex string suitable as a network_id."""
    return uuid.uuid4().hex[:8]


# ---------------------------------------------------------------------------
# Resource name helpers
# ---------------------------------------------------------------------------


def qualified_bridge(nd: NetworkDef, project_id: str) -> str:
    """Return the host-level bridge name for a NetworkDef."""
    logical = nd.bridge or f"br-{nd.id}"
    return net.qualify_bridge(logical, project_id)


def qualified_docker_net(nd: NetworkDef, project_id: str) -> str:
    """Return the host-level Docker network name."""
    docker_name = nd.docker.get("network") or f"triv-{nd.id}"
    return net.qualify_docker_net(docker_name, project_id)


def qualified_vlan_iface(nd: NetworkDef) -> str:
    """Return the VLAN sub-interface name.

    Format: ``v<network_id[:4]>.<vlan>``  — fits within 15 chars
    for VLANs up to 4094.
    """
    nid = nd.network_id[:4] if nd.network_id else "0000"
    return f"v{nid}.{nd.vlan}"


def qualified_parent_bridge(
    nd: NetworkDef, project_id: str, all_nets: list[NetworkDef] | None = None
) -> str:
    """Resolve the parent bridge for a VLAN overlay network.

    Looks up ``nd.parent_network`` in *all_nets* to find the parent's
    bridge, then qualifies it.
    """
    if not nd.parent_network:
        return ""
    if all_nets:
        for other in all_nets:
            if other.id == nd.parent_network:
                return qualified_bridge(other, project_id)
    # Fallback: assume parent_network is already a bridge name
    return net.qualify_bridge(nd.parent_network, project_id)


# ---------------------------------------------------------------------------
# Deploy / Undeploy
# ---------------------------------------------------------------------------


def deploy_network(
    nd: NetworkDef,
    project_id: str,
    state_tracker: Any = None,
    all_nets: list[NetworkDef] | None = None,
) -> dict:
    """Provision all host resources for a network.

    Depending on ``nd.type``, creates:
      - Linux bridge (all types except 'docker')
      - VLAN sub-interface on parent bridge ('vlan-bridge', 'p2p')
      - Docker network ('docker', or when docker.enabled)
      - Veth pair bridge↔Docker (when docker.bridge_to_docker)

    Returns a report dict with 'created' and 'errors' lists.
    """
    report: dict[str, Any] = {
        "network_id": nd.network_id,
        "id": nd.id,
        "created": [],
        "errors": [],
    }

    try:
        if nd.type == "docker":
            _deploy_docker_only(nd, project_id, report)
        else:
            _deploy_bridge_based(nd, project_id, report, all_nets)
    except Exception as e:
        report["errors"].append(str(e))

    # Track in state
    if state_tracker and not report["errors"]:
        br = qualified_bridge(nd, project_id) if nd.type != "docker" else ""
        if hasattr(state_tracker, "track_bridge") and br:
            state_tracker.track_bridge(br, nd.id)

    return report


def _deploy_bridge_based(
    nd: NetworkDef, project_id: str, report: dict, all_nets: list[NetworkDef] | None
) -> None:
    """Deploy a bridge-based network (bridge, vlan-bridge, p2p, trunk)."""
    bridge = qualified_bridge(nd, project_id)

    # 1. Create the bridge
    stp = nd.stp
    net.ensure_bridge(bridge, stp=stp)
    # Enable VLAN filtering on trunk / explicit request
    vlan_filt = nd.vlan_filtering or nd.type == "trunk"
    if vlan_filt:
        net._sudo(f"ip link set {bridge} type bridge vlan_filtering 1", check=False)
    report["created"].append(f"bridge:{bridge}")

    # 2. VLAN sub-interface (for vlan-bridge / p2p)
    if nd.vlan is not None and nd.parent_network:
        parent_br = qualified_parent_bridge(nd, project_id, all_nets)
        if parent_br:
            vlan_iface = net.setup_vlan_iface(
                parent_br,
                nd.vlan,
                host_ip=None,  # host IP is applied in host_join, not here
                prefix=0,
                label=f"net:{nd.id}",
            )
            # Enslave the VLAN iface to the network bridge
            net._sudo(f"ip link set {vlan_iface} master {bridge}")
            net._sudo(f"ip link set {vlan_iface} up")
            report["created"].append(f"vlan:{vlan_iface}→{bridge}")

    # 3. Docker network (if enabled)
    if nd.docker_enabled:
        _deploy_docker_layer(nd, project_id, bridge, report)


def _deploy_docker_only(nd: NetworkDef, project_id: str, report: dict) -> None:
    """Deploy a Docker-only network (no Linux bridge)."""
    _deploy_docker_layer(nd, project_id, None, report)


def _deploy_docker_layer(nd: NetworkDef, project_id: str, bridge: str | None, report: dict) -> None:
    """Create Docker network and optionally veth to a Linux bridge."""
    docker_name = qualified_docker_net(nd, project_id)

    ok, err = net.ensure_docker_network(
        docker_name,
        subnet=nd.docker_subnet or nd.subnet,
        gateway=nd.docker_gateway or nd.gateway,
    )
    if ok:
        report["created"].append(f"docker:{docker_name}")
    elif err:
        report["errors"].append(f"docker-network:{docker_name}: {err}")

    # Veth pair: bridge ↔ Docker
    if bridge and nd.bridge_to_docker:
        net.provision_bridge_to_docker(bridge, docker_name)
        report["created"].append(f"veth:{bridge}↔{docker_name}")


def undeploy_network(
    nd: NetworkDef,
    project_id: str,
    state_tracker: Any = None,
    all_nets: list[NetworkDef] | None = None,
) -> dict:
    """Remove all host resources for a network.

    Returns a report dict with 'removed' and 'errors' lists.
    """
    report: dict[str, Any] = {
        "network_id": nd.network_id,
        "id": nd.id,
        "removed": [],
        "errors": [],
    }

    try:
        # Docker layer first (veth + docker net)
        if nd.docker_enabled or nd.type == "docker":
            docker_name = qualified_docker_net(nd, project_id)
            bridge = qualified_bridge(nd, project_id) if nd.type != "docker" else ""
            if bridge and nd.bridge_to_docker:
                try:
                    net.teardown_bridge_to_docker(bridge, docker_name)
                    report["removed"].append(f"veth:{bridge}↔{docker_name}")
                except Exception:
                    pass  # may not exist
            # Remove Docker network
            try:
                net._run(["docker", "network", "rm", docker_name], check=False)
                report["removed"].append(f"docker:{docker_name}")
            except Exception:
                pass

        if nd.type != "docker":
            bridge = qualified_bridge(nd, project_id)

            # VLAN sub-interface
            if nd.vlan is not None:
                vlan_iface = qualified_vlan_iface(nd)
                if net._iface_exists(vlan_iface):
                    net._sudo(f"ip link del {vlan_iface}", check=False)
                    report["removed"].append(f"vlan:{vlan_iface}")

            # Bridge
            net.remove_bridge(bridge)
            report["removed"].append(f"bridge:{bridge}")

    except Exception as e:
        report["errors"].append(str(e))

    # Untrack from state
    if state_tracker:
        br = qualified_bridge(nd, project_id) if nd.type != "docker" else ""
        if hasattr(state_tracker, "untrack_bridge") and br:
            state_tracker.untrack_bridge(br)

    return report


# ---------------------------------------------------------------------------
# Host join / leave
# ---------------------------------------------------------------------------


def host_join(nd: NetworkDef, project_id: str) -> dict:
    """Connect the host to a network (assign IP on the bridge).

    For VLAN-based networks, creates a VLAN sub-interface with the host IP.
    For bridge networks, assigns the IP directly on the bridge.
    """
    report: dict[str, Any] = {"network_id": nd.network_id, "created": [], "errors": []}

    if not nd.host_access:
        report["errors"].append("Network does not have host access enabled")
        return report

    host_ip = nd.host_ip
    prefix = nd.host_prefix
    if not host_ip:
        report["errors"].append("No host IP configured")
        return report

    bridge = qualified_bridge(nd, project_id)

    if nd.vlan is not None:
        # VLAN-based: create vchs.<vlan> on the bridge with IP
        vlan_iface = net.setup_vlan_iface(
            bridge,
            nd.vlan,
            host_ip=host_ip,
            prefix=prefix,
            label=f"host:{nd.id}",
        )
        report["created"].append(f"host-vlan:{vlan_iface}@{host_ip}/{prefix}")
    else:
        # Direct: IP on the bridge
        net._sudo(f"ip addr replace {host_ip}/{prefix} dev {bridge}")
        report["created"].append(f"host-ip:{host_ip}/{prefix}@{bridge}")

    return report


def host_leave(nd: NetworkDef, project_id: str) -> dict:
    """Disconnect the host from a network (remove IP / VLAN sub-iface)."""
    report: dict[str, Any] = {"network_id": nd.network_id, "removed": [], "errors": []}

    host_ip = nd.host_ip
    prefix = nd.host_prefix
    bridge = qualified_bridge(nd, project_id)

    if nd.vlan is not None:
        vlan_iface = f"vchs.{nd.vlan}"
        if net._iface_exists(vlan_iface):
            net._sudo(f"ip link del {vlan_iface}", check=False)
            report["removed"].append(f"host-vlan:{vlan_iface}")
    elif host_ip:
        net._sudo(f"ip addr del {host_ip}/{prefix} dev {bridge}", check=False)
        report["removed"].append(f"host-ip:{host_ip}/{prefix}@{bridge}")

    return report


# ---------------------------------------------------------------------------
# Internet connect / disconnect (NAT / masquerade)
# ---------------------------------------------------------------------------

_IPTABLES_COMMENT_PREFIX = "triv-net"


def internet_connect(nd: NetworkDef, project_id: str) -> dict:
    """Enable NAT/masquerade for a network's subnet.

    Creates iptables rules with a comment tag for clean removal.
    Also enables ip_forward if not already enabled.
    """
    report: dict[str, Any] = {"network_id": nd.network_id, "created": [], "errors": []}

    subnet = nd.subnet
    if not subnet:
        report["errors"].append("No subnet configured — cannot set up NAT")
        return report

    bridge = qualified_bridge(nd, project_id) if nd.type != "docker" else ""
    tag = f"{_IPTABLES_COMMENT_PREFIX}-{nd.network_id}"

    # 1. Enable ip_forward (use /proc directly — sysctl may not be installed)
    try:
        with open("/proc/sys/net/ipv4/ip_forward", "w") as f:
            f.write("1\n")
    except OSError:
        net._sudo("sysctl -w net.ipv4.ip_forward=1", check=False)
    report["created"].append("sysctl:ip_forward=1")

    # 2. MASQUERADE for the subnet
    net._sudo(
        f"iptables -t nat -A POSTROUTING -s {subnet} ! -d {subnet} "
        f"-j MASQUERADE -m comment --comment {tag}",
        check=False,
    )
    report["created"].append(f"nat:MASQUERADE {subnet} [{tag}]")

    # 3. FORWARD rules (if bridge-based)
    if bridge:
        # Detect default route interface for outbound
        out_iface = _detect_default_iface()
        net._sudo(
            f"iptables -A FORWARD -i {bridge} -o {out_iface} -j ACCEPT -m comment --comment {tag}",
            check=False,
        )
        net._sudo(
            f"iptables -A FORWARD -i {out_iface} -o {bridge} "
            f"-m state --state RELATED,ESTABLISHED "
            f"-j ACCEPT -m comment --comment {tag}",
            check=False,
        )
        report["created"].append(f"forward:{bridge}↔{out_iface} [{tag}]")

    return report


def internet_disconnect(nd: NetworkDef, project_id: str) -> dict:
    """Remove NAT/masquerade rules for a network.

    Removes all iptables rules tagged with the network's comment.
    """
    report: dict[str, Any] = {"network_id": nd.network_id, "removed": [], "errors": []}

    tag = f"{_IPTABLES_COMMENT_PREFIX}-{nd.network_id}"

    # Remove all rules with our comment tag
    for table in ("nat", "filter"):
        _remove_iptables_by_comment(table, tag)

    report["removed"].append(f"iptables:*[{tag}]")
    return report


def _remove_iptables_by_comment(table: str, comment: str) -> None:
    """Remove all iptables rules in *table* whose comment matches."""
    import subprocess

    # List rules with line numbers
    result = subprocess.run(
        ["iptables", "-t", table, "-L", "--line-numbers", "-n"],
        capture_output=True,
        text=True,
    )
    # Parse and collect lines to delete (in reverse order to keep indices stable)
    lines_to_delete: list[tuple[str, int]] = []  # (chain, line_num)
    current_chain = ""
    for line in result.stdout.splitlines():
        if line.startswith("Chain "):
            current_chain = line.split()[1]
        elif comment in line:
            parts = line.split()
            if parts and parts[0].isdigit():
                lines_to_delete.append((current_chain, int(parts[0])))

    # Delete in reverse order
    for chain, num in reversed(lines_to_delete):
        subprocess.run(
            ["iptables", "-t", table, "-D", chain, str(num)],
            capture_output=True,
            check=False,
        )


def _detect_default_iface() -> str:
    """Detect the default route interface (e.g. eth0, ens33)."""
    import subprocess

    try:
        result = subprocess.run(
            ["ip", "route", "show", "default"],
            capture_output=True,
            text=True,
        )
        # "default via 172.17.0.1 dev eth0"
        parts = result.stdout.split()
        if "dev" in parts:
            return parts[parts.index("dev") + 1]
    except Exception:
        pass
    return "eth0"  # fallback


# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------


def get_network_status(
    nd: NetworkDef, project_id: str, all_nets: list[NetworkDef] | None = None
) -> dict:
    """Check live status of a network's resources on the host.

    Returns a dict with:
      - deployed: bool (main bridge or docker net exists)
      - bridge_state: str
      - docker_exists: bool
      - host_joined: bool
      - internet_active: bool
    """
    status: dict[str, Any] = {
        "network_id": nd.network_id,
        "id": nd.id,
        "deployed": False,
        "bridge_state": "unknown",
        "docker_exists": False,
        "host_joined": False,
        "internet_active": False,
    }

    if nd.type == "docker":
        docker_name = qualified_docker_net(nd, project_id)
        status["docker_exists"] = net.docker_network_exists(docker_name)
        status["deployed"] = status["docker_exists"]
    else:
        bridge = qualified_bridge(nd, project_id)
        state = net.get_bridge_state(bridge)
        status["bridge_state"] = state
        status["deployed"] = state != "unknown"

        if nd.docker_enabled:
            docker_name = qualified_docker_net(nd, project_id)
            status["docker_exists"] = net.docker_network_exists(docker_name)

    # Host joined?
    if nd.host_access and nd.host_ip:
        if nd.vlan is not None:
            vlan_iface = f"vchs.{nd.vlan}"
            status["host_joined"] = net._iface_exists(vlan_iface)
        else:
            bridge = qualified_bridge(nd, project_id)
            # Check if bridge has the host IP
            status["host_joined"] = _bridge_has_ip(bridge, nd.host_ip)

    # Internet active?
    if nd.internet_access:
        tag = f"{_IPTABLES_COMMENT_PREFIX}-{nd.network_id}"
        status["internet_active"] = _has_iptables_rule(tag)

    return status


def _bridge_has_ip(bridge: str, ip: str) -> bool:
    """Check if a bridge interface has a specific IP assigned."""
    import subprocess

    try:
        result = subprocess.run(
            ["ip", "addr", "show", "dev", bridge],
            capture_output=True,
            text=True,
        )
        return ip in result.stdout
    except Exception:
        return False


def _has_iptables_rule(comment: str) -> bool:
    """Check if any iptables rule with this comment exists."""
    import subprocess

    try:
        result = subprocess.run(
            ["iptables", "-t", "nat", "-L", "-n"],
            capture_output=True,
            text=True,
        )
        return comment in result.stdout
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Ref resolution — load NetworkDef files from vendor dir
# ---------------------------------------------------------------------------


def resolve_network_refs(raw_list: list[dict], networks_dir: Path) -> list[NetworkDef]:
    """Resolve a list of network entries (possibly with $ref) into NetworkDefs.

    For each entry:
      - If it has ``$ref``, load the referenced file from *networks_dir*,
        then merge any inline overrides (network_id, etc.).
      - Otherwise, parse as an inline NetworkDef.

    Missing files are logged and skipped.
    """
    result: list[NetworkDef] = []
    for entry in raw_list:
        if not isinstance(entry, dict):
            continue
        ref = entry.get("$ref")
        if ref:
            # Load base from file
            ref_path = networks_dir / ref
            if not ref_path.is_file():
                print(f"[network_v2] Warning: $ref '{ref}' not found at {ref_path}")
                continue
            try:
                with open(ref_path) as f:
                    base = json.load(f)
            except Exception as e:
                print(f"[network_v2] Warning: failed to load '{ref}': {e}")
                continue

            # Merge inline overrides onto the base
            if "network_id" in entry:
                base["network_id"] = entry["network_id"]
            # Any other inline keys override the base
            for key, val in entry.items():
                if key not in ("$ref", "network_id"):
                    base[key] = val

            nd = NetworkDef.from_dict(base)
            nd._ref = ref
        else:
            nd = NetworkDef.from_dict(entry)

        # Ensure network_id
        if not nd.network_id:
            nd.network_id = generate_network_id()

        result.append(nd)
    return result


def networks_dir_for_project(project_dir: str, triv_home: Path) -> Path:
    """Return the networks directory for a project.

    If the project lives under ``vendors/<vendor>/projects/``,
    networks go to ``vendors/<vendor>/networks/``.
    Otherwise, falls back to a ``networks/`` dir inside the project.
    """
    parts = Path(project_dir).parts
    try:
        idx = parts.index("vendors")
        if len(parts) > idx + 3 and parts[idx + 2] == "projects":
            net_dir = Path(*parts[: idx + 2]) / "networks"
            net_dir.mkdir(parents=True, exist_ok=True)
            return net_dir
    except ValueError:
        pass
    # Fallback: project-local
    net_dir = Path(project_dir) / "networks"
    net_dir.mkdir(parents=True, exist_ok=True)
    return net_dir


def save_network_file(nd: NetworkDef, networks_dir: Path) -> Path:
    """Save a NetworkDef to a JSON file in the networks directory.

    Returns the path to the saved file.
    """
    filename = f"{nd.id}.json"
    filepath = networks_dir / filename
    # Write the full definition (network_id is per-instance, not in template)
    data = nd.to_dict()
    data.pop("network_id", None)
    with open(filepath, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
    return filepath
