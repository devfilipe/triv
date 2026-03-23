"""
Router: netstats — comprehensive view of all network infrastructure elements.

Collects live state from Linux bridges, Docker networks, libvirt networks,
veth pairs, VLAN sub-interfaces and tap devices — giving an operator-friendly
picture of everything triv has provisioned on the host.
"""

import json
import shutil
import subprocess
from pathlib import Path

from fastapi import APIRouter

from triv.core import network as netmod
from triv.core import network_v2 as netv2
from triv.core.state import _is_triv_bridge

import shared

router = APIRouter(prefix="/api", tags=["netstats"])

C_ENV = shared.C_ENV


# ── helpers ──────────────────────────────────────────────────────────


def _run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, env=C_ENV, **kw)


def _bridge_members(bridge: str) -> list[dict]:
    """List interfaces enslaved to a Linux bridge."""
    r = _run(["ip", "-j", "link", "show", "master", bridge])
    if r.returncode != 0:
        return []
    try:
        items = json.loads(r.stdout)
    except (json.JSONDecodeError, TypeError):
        return []
    members = []
    for iface in items:
        name = iface.get("ifname", "")
        state = iface.get("operstate", "UNKNOWN")
        kind = (
            "tap"
            if name.startswith("vnet")
            else "veth"
            if name.startswith("nv") or name.startswith("veth")
            else "vlan"
            if "." in name
            else "other"
        )
        members.append(
            {
                "name": name,
                "state": state,
                "kind": kind,
                "mtu": iface.get("mtu"),
                "mac": iface.get("address"),
            }
        )
    return members


def _collect_bridges() -> list[dict]:
    """All Linux bridges relevant to triv."""
    pid = shared.topology.project_id if shared.topology else ""
    seen: dict[str, dict] = {}

    # Build set of bridge names currently required by topology
    topo_bridges: set[str] = set()
    if shared.topology:
        for link in shared.topology.links:
            br_logical = link.bridge_name
            br_name = netmod.qualify_bridge(br_logical, pid)
            if br_name:
                topo_bridges.add(br_name)
        # Also include bridges from v2 network definitions (used by
        # container driver Connect even when no topology link exists).
        for nd in shared.topology.network_defs:
            br_name = netv2.qualified_bridge(nd, pid)
            if br_name:
                topo_bridges.add(br_name)

    # 1. tracked bridges
    st = shared.state_tracker.state
    for br_name, info in st.bridges.items():
        seen[br_name] = {
            "name": br_name,
            "source": "tracked",
            "link": info.get("link"),
            "state": netmod.get_bridge_state(br_name),
            "stp": netmod.get_stp_state(br_name),
            "stats": netmod.get_bridge_stats(br_name),
            "members": _bridge_members(br_name),
            "stale": br_name not in topo_bridges,
        }

    # 2. topology bridges
    if shared.topology:
        for link in shared.topology.links:
            br_logical = link.bridge_name
            br_name = netmod.qualify_bridge(br_logical, pid)
            if br_name and br_name not in seen:
                seen[br_name] = {
                    "name": br_name,
                    "logical": br_logical,
                    "source": "topology",
                    "link": link.id,
                    "state": netmod.get_bridge_state(br_name),
                    "stp": netmod.get_stp_state(br_name),
                    "stats": netmod.get_bridge_stats(br_name),
                    "members": _bridge_members(br_name),
                    "stale": False,
                }

    # 3. live discovery — any triv bridge not yet tracked
    try:
        out = _run(["ip", "-br", "link", "show", "type", "bridge"]).stdout
        for line in out.splitlines():
            parts = line.split()
            if not parts:
                continue
            name = parts[0]
            if _is_triv_bridge(name) and name not in seen:
                seen[name] = {
                    "name": name,
                    "source": "live",
                    "state": netmod.get_bridge_state(name),
                    "stp": netmod.get_stp_state(name),
                    "stats": netmod.get_bridge_stats(name),
                    "members": _bridge_members(name),
                    "stale": name not in topo_bridges,
                }
    except Exception:
        pass

    return list(seen.values())


def _collect_docker_networks() -> list[dict]:
    """Docker networks managed by triv (triv-* prefix)."""
    r = _run(["docker", "network", "ls", "--format", "{{json .}}"])
    if r.returncode != 0:
        return []
    nets: list[dict] = []
    for line in r.stdout.strip().splitlines():
        try:
            info = json.loads(line)
        except (json.JSONDecodeError, TypeError):
            continue
        name = info.get("Name", "")
        if not name.startswith("triv-"):
            continue

        # Inspect for details
        detail: dict = {
            "name": name,
            "driver": info.get("Driver", ""),
            "scope": info.get("Scope", ""),
            "id": info.get("ID", ""),
        }
        r2 = _run(["docker", "network", "inspect", name])
        if r2.returncode == 0:
            try:
                insp = json.loads(r2.stdout)
                if isinstance(insp, list) and insp:
                    insp = insp[0]
                ipam = (insp.get("IPAM") or {}).get("Config") or []
                if ipam:
                    detail["subnet"] = ipam[0].get("Subnet", "")
                    detail["gateway"] = ipam[0].get("Gateway", "")
                opts = insp.get("Options") or {}
                detail["bridge_name"] = opts.get("com.docker.network.bridge.name", "")
                # containers connected to this network
                containers_map = insp.get("Containers") or {}
                clist = []
                for cid, cinfo in containers_map.items():
                    clist.append(
                        {
                            "name": cinfo.get("Name", cid[:12]),
                            "ipv4": cinfo.get("IPv4Address", ""),
                            "mac": cinfo.get("MacAddress", ""),
                        }
                    )
                detail["containers"] = clist
            except (json.JSONDecodeError, TypeError):
                pass
        nets.append(detail)
    return nets


def _collect_veths() -> list[dict]:
    """Veth pairs managed by triv (nv* naming convention)."""
    r = _run(["ip", "-j", "link", "show", "type", "veth"])
    if r.returncode != 0:
        return []
    try:
        items = json.loads(r.stdout)
    except (json.JSONDecodeError, TypeError):
        return []
    veths = []
    for iface in items:
        name = iface.get("ifname", "")
        # triv veth naming: nv<hash>-vh (host end) / nv<hash>-vd (docker end)
        if not name.startswith("nv"):
            continue
        master = iface.get("master", "")
        state = iface.get("operstate", "UNKNOWN")
        link = iface.get("link", "")
        veths.append(
            {
                "name": name,
                "state": state,
                "master": master,
                "peer": link if link else None,
                "mtu": iface.get("mtu"),
                "mac": iface.get("address"),
            }
        )
    return veths


def _collect_vlans() -> list[dict]:
    """Host-level VLAN sub-interfaces managed by triv."""
    r = _run(["ip", "-j", "link", "show", "type", "vlan"])
    if r.returncode != 0:
        return []
    try:
        items = json.loads(r.stdout)
    except (json.JSONDecodeError, TypeError):
        return []
    vlans = []
    for iface in items:
        name = iface.get("ifname", "")
        # triv VLAN naming: vchs.<vlan>, v<hex>.<vlan>, or br*.<vlan>
        if not ("." in name and (name.startswith("v") or name.startswith("br"))):
            continue
        state = iface.get("operstate", "UNKNOWN")
        master = iface.get("master", "")
        linkinfo = iface.get("linkinfo", {}).get("info_data", {})
        vlan_id = linkinfo.get("id")
        # Get IP address
        ip_addr = None
        r2 = _run(["ip", "-j", "addr", "show", "dev", name])
        if r2.returncode == 0:
            try:
                addr_info = json.loads(r2.stdout)
                if addr_info:
                    for ai in addr_info[0].get("addr_info", []):
                        if ai.get("family") == "inet":
                            ip_addr = f"{ai['local']}/{ai.get('prefixlen', '')}"
                            break
            except (json.JSONDecodeError, TypeError):
                pass
        vlans.append(
            {
                "name": name,
                "state": state,
                "vlan_id": vlan_id,
                "master": master,
                "ip": ip_addr,
                "mtu": iface.get("mtu"),
            }
        )
    return vlans


def _collect_libvirt() -> list[dict]:
    """Libvirt virtual networks."""
    r = _run(["virsh", "-c", "qemu:///system", "net-list", "--all"])
    if r.returncode != 0:
        return []
    nets = []
    for line in r.stdout.strip().splitlines()[2:]:  # skip header lines
        parts = line.split()
        if len(parts) < 2:
            continue
        name = parts[0]
        active = parts[1] if len(parts) > 1 else ""
        autostart = parts[2] if len(parts) > 2 else ""
        persistent = parts[3] if len(parts) > 3 else ""
        # Get bridge name from XML
        bridge_name = None
        r2 = _run(["virsh", "-c", "qemu:///system", "net-dumpxml", name])
        if r2.returncode == 0:
            import re

            m = re.search(r"<bridge\s+name=['\"]([^'\"]+)", r2.stdout)
            if m:
                bridge_name = m.group(1)
        nets.append(
            {
                "name": name,
                "active": active.lower() == "active",
                "autostart": autostart.lower() == "yes",
                "persistent": persistent.lower() == "yes",
                "bridge": bridge_name,
            }
        )
    return nets


def _collect_taps() -> list[dict]:
    """Tap devices (from libvirt VMs) that are enslaved to triv bridges."""
    r = _run(["ip", "-j", "link", "show", "type", "tun"])
    if r.returncode != 0:
        return []
    try:
        items = json.loads(r.stdout)
    except (json.JSONDecodeError, TypeError):
        return []
    taps = []
    for iface in items:
        name = iface.get("ifname", "")
        master = iface.get("master", "")
        if not name.startswith("vnet"):
            continue
        state = iface.get("operstate", "UNKNOWN")
        taps.append(
            {
                "name": name,
                "state": state,
                "master": master,
                "mtu": iface.get("mtu"),
                "mac": iface.get("address"),
            }
        )
    return taps


# Prefer iptables-legacy when available (Docker uses legacy tables).
_IPT = "iptables-legacy" if shutil.which("iptables-legacy") else "iptables"


def _collect_iptables() -> list[dict]:
    """iptables rules managed by triv (with triv comment tags)."""
    rules: list[dict] = []
    for table in ("nat", "filter"):
        r = _run([_IPT, "-t", table, "-L", "-n", "-v", "--line-numbers"])
        if r.returncode != 0:
            continue
        chain = ""
        for line in r.stdout.splitlines():
            if line.startswith("Chain "):
                chain = line.split()[1]
                continue
            if "triv-" in line or "/* triv" in line.lower():
                rules.append(
                    {
                        "table": table,
                        "chain": chain,
                        "rule": line.strip(),
                    }
                )
    return rules


# ── API endpoint ─────────────────────────────────────────────────────


@router.get("/netstats")
def get_netstats():
    """Comprehensive snapshot of all triv-managed network infrastructure."""
    return {
        "bridges": _collect_bridges(),
        "docker_networks": _collect_docker_networks(),
        "veths": _collect_veths(),
        "vlans": _collect_vlans(),
        "taps": _collect_taps(),
        "libvirt_networks": _collect_libvirt(),
        "iptables_rules": _collect_iptables(),
    }


@router.delete("/netstats/bridges/{name}")
def remove_bridge(name: str):
    """Remove a single Linux bridge and untrack it."""
    if not netmod._iface_exists(name):
        # Still untrack if it's in state
        shared.state_tracker.untrack_bridge(name)
        return {"ok": True, "detail": f"{name} did not exist on host (untracked)"}
    ok = netmod.remove_bridge(name)
    if ok:
        shared.state_tracker.untrack_bridge(name)
        return {"ok": True, "detail": f"Removed bridge {name}"}
    return {"ok": False, "error": f"Failed to remove bridge {name}"}


@router.post("/netstats/cleanup-stale")
def cleanup_stale():
    """Remove all stale bridges (tracked but no longer in topology)."""
    bridges = _collect_bridges()
    removed = []
    errors = []
    for br in bridges:
        if not br.get("stale"):
            continue
        name = br["name"]
        if netmod._iface_exists(name):
            ok = netmod.remove_bridge(name)
            if ok:
                shared.state_tracker.untrack_bridge(name)
                removed.append(name)
            else:
                errors.append(name)
        else:
            shared.state_tracker.untrack_bridge(name)
            removed.append(name)
    return {"ok": len(errors) == 0, "removed": removed, "errors": errors}


@router.get("/netstats/bridge-diag/{name}")
def bridge_diag(name: str):
    """Full diagnostic dump for a single Linux bridge.

    Returns VLAN configuration, iptables state, STP port states,
    nf_call_iptables, and member details — everything needed to debug
    connectivity issues.
    """
    diag: dict = {"bridge": name, "exists": False}

    if not netmod._iface_exists(name):
        return diag

    diag["exists"] = True

    # Basic state
    diag["state"] = netmod.get_bridge_state(name)
    diag["stp"] = netmod.get_stp_state(name)
    diag["stats"] = netmod.get_bridge_stats(name)
    diag["members"] = _bridge_members(name)

    # vlan_filtering flag
    try:
        vf = Path(f"/sys/devices/virtual/net/{name}/bridge/vlan_filtering").read_text().strip()
        diag["vlan_filtering"] = int(vf)
    except Exception:
        diag["vlan_filtering"] = None

    # nf_call_iptables
    try:
        nf = Path(f"/sys/devices/virtual/net/{name}/bridge/nf_call_iptables").read_text().strip()
        diag["nf_call_iptables"] = int(nf)
    except Exception:
        diag["nf_call_iptables"] = None

    # bridge vlan show
    r = _run(["bridge", "vlan", "show"])
    if r.returncode == 0:
        diag["bridge_vlan_show"] = r.stdout
    else:
        diag["bridge_vlan_show"] = r.stderr

    # STP port state for each member
    port_states = []
    r = _run(["bridge", "-j", "link", "show"])
    if r.returncode == 0:
        try:
            entries = json.loads(r.stdout)
            for e in entries:
                if e.get("master") == name:
                    port_states.append(
                        {
                            "port": e.get("ifname"),
                            "state": e.get("state"),
                            "cost": e.get("cost"),
                            "priority": e.get("priority"),
                        }
                    )
        except (json.JSONDecodeError, TypeError):
            pass
    diag["port_states"] = port_states

    # IP addresses on the bridge device itself
    r = _run(["ip", "-o", "addr", "show", "dev", name])
    diag["bridge_addrs"] = r.stdout.strip() if r.returncode == 0 else ""

    # iptables DOCKER-USER chain
    r = _run([_IPT, "-L", "DOCKER-USER", "-n", "-v", "--line-numbers"])
    diag["docker_user_chain"] = r.stdout.strip() if r.returncode == 0 else r.stderr.strip()

    return diag
