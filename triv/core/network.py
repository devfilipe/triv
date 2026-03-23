"""triv.core.network — Host-side networking management (bridges, VLANs,
Docker networks, container connectivity).

The module is **driver-agnostic**: it reads the topology links and their
``network`` config to decide what to create.

Link ``network`` schema (inside the topology JSON)::

    "network": {
        // -- Linux bridge (libvirt VMs, tap devices) --
        "bridge": "br-link-r1-r2",         // explicit bridge name (optional)
        "stp": true,                       // enable STP  (default true)

        // -- VLAN tagging (optional) --
        "vlan": 100,
        "vlan_host_ip": "192.168.254.1",
        "vlan_prefix": 24,

        // -- Docker/Podman network (container nodes) --
        "docker_network": "my-net",         // name of docker network to use/create
        "docker_subnet": "192.168.254.0/24",
        "docker_gateway": "192.168.254.1",
        "docker_driver": "bridge",         // default "bridge"

        // -- Container attachment (IPs assigned to containers) --
        "container_ips": {
            "<node_id>": "192.168.254.10"  // static IP when connecting
        },

        // -- Host bridge ↔ Docker bridge interconnection --
        "bridge_to_docker": true           // veth pair between Linux bridge
                                           //  and the Docker bridge
    }

All fields are optional.  The provisioner inspects ``link.network`` and
creates only the pieces that are declared.

**Network-name namespacing**:

Every Linux bridge and Docker network created by triv is **prefixed**
with the project-id so that multiple projects can coexist on the same
host without name collisions.  The topology JSON keeps short *logical*
names (``br-link-r1-r2``, ``triv-my-net``); the physical name on the
host becomes ``<project_id>-<logical>``.

Special bridges managed by libvirt (e.g. ``virbr-chassis``) are
**never** prefixed — they are shared infrastructure.
"""

from __future__ import annotations

import json
import os as _os
import re
import shutil
import subprocess
from dataclasses import dataclass, field
from typing import Any

from .enums import RuntimeBackend
from .models import Link, Topology

MGMT_BRIDGE = "virbr-chassis"
HOST_VLAN_PREFIX = "vchs"

C_ENV = {"LANG": "C", "LC_ALL": "C"}


# ---------------------------------------------------------------------------
# Network-name namespace helpers
# ---------------------------------------------------------------------------


def qualify_name(logical: str, project_id: str) -> str:
    """Return the host-level resource name: ``<project_id>-<logical>``.

    If *project_id* is empty or *logical* already starts with the prefix,
    the name is returned as-is.

    >>> qualify_name("br-mgmt", "my-lab")
    'my-lab-br-mgmt'
    >>> qualify_name("virbr-core", "my-lab")  # called only when appropriate
    'my-lab-virbr-core'
    """
    if not project_id:
        return logical
    if logical.startswith(f"{project_id}-"):
        return logical  # already qualified
    return f"{project_id}-{logical}"


def _should_qualify(name: str) -> bool:
    """Return True if this bridge/network name should be project-qualified.

    Managed / shared bridges (MGMT_BRIDGE, libvirt defaults) are never
    qualified because they are shared across all projects.
    """
    # Never qualify the chassis management bridge or docker's built-ins
    _SHARED = {MGMT_BRIDGE, "bridge", "host", "none"}
    return name not in _SHARED


_LINUX_IFNAME_MAX = 15  # IFNAMSIZ - 1


def qualify_bridge(logical: str, project_id: str) -> str:
    """Qualify a bridge name, keeping it within the 15-char Linux limit.

    * Shared bridges (``virbr-chassis``, etc.) are never qualified.
    * If ``<project_id>-<logical>`` fits in 15 characters it is returned
      as-is (human readable).
    * Otherwise a deterministic hash-based name ``br<hash9>`` (11 chars)
      is produced so it always fits.

    A reverse-lookup table ``_bridge_alias`` is maintained so that log
    messages / state can show the original logical name.
    """
    if not _should_qualify(logical):
        return logical
    full = qualify_name(logical, project_id)
    if len(full) <= _LINUX_IFNAME_MAX:
        return full
    # --- Hash-based short name ---
    import hashlib

    raw = f"{project_id}:{logical}"
    h = hashlib.md5(raw.encode()).hexdigest()[:9]
    short = f"br{h}"  # 2 + 9 = 11 chars — always fits
    _bridge_alias[short] = full  # keep mapping for debugging
    return short


# Reverse lookup: short hash name → original long qualified name
_bridge_alias: dict[str, str] = {}


def bridge_display_name(name: str) -> str:
    """Return the original qualified name if *name* is a hash alias."""
    return _bridge_alias.get(name, name)


def qualify_docker_net(logical: str, project_id: str) -> str:
    """Qualify a Docker network name."""
    if not project_id:
        return logical
    if logical.startswith(f"{project_id}-"):
        return logical
    return f"{project_id}-{logical}"


def _run(cmd: list[str], check: bool = True, **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=check, capture_output=True, text=True, **kw)


def _sudo(cmd: str, check: bool = True) -> subprocess.CompletedProcess:
    parts = cmd.split()
    # Running as root (e.g. inside privileged container) — skip sudo
    if _os.geteuid() == 0:
        argv = parts
    else:
        argv = ["sudo"] + parts
    return subprocess.run(
        argv,
        check=check,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def _iface_exists(name: str) -> bool:
    return (
        subprocess.run(
            ["ip", "link", "show", name],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        ).returncode
        == 0
    )


# ---------------------------------------------------------------------------
# Network Plan  (per-node attachment summary)
# ---------------------------------------------------------------------------


@dataclass
class Attachment:
    node_id: str
    interface_id: str
    bridge: str
    vlan: int | None = None
    mac: str | None = None
    docker_network: str | None = None
    container_ip: str | None = None


@dataclass
class NetworkPlan:
    bridges: dict[str, list[Attachment]] = field(default_factory=dict)
    docker_networks: dict[str, dict] = field(default_factory=dict)

    def add_attachment(self, att: Attachment) -> None:
        self.bridges.setdefault(att.bridge, []).append(att)
        if att.docker_network:
            self.docker_networks.setdefault(att.docker_network, {})

    def get_attachments(self, node_id: str) -> list[Attachment]:
        result: list[Attachment] = []
        for atts in self.bridges.values():
            for a in atts:
                if a.node_id == node_id:
                    result.append(a)
        return result

    def all_bridges(self) -> list[str]:
        return list(self.bridges.keys())


def plan_network(topo: Topology, drivers: dict, project_id: str = "") -> NetworkPlan:
    """Build a network plan from topology links, consulting drivers for VLAN/MAC.

    *project_id* is used to qualify bridge and docker-network names so
    that multiple projects can coexist on the same host.
    """
    plan = NetworkPlan()
    linked: set[tuple[str, str]] = set()

    pid = project_id or topo.project_id

    for lk in topo.links:
        bridge_logical = lk.bridge_name
        bridge = qualify_bridge(bridge_logical, pid)
        net_cfg = lk.network or {}

        src_node = topo.get_node(lk.source.node)
        tgt_node = topo.get_node(lk.target.node)
        if not src_node or not tgt_node:
            continue
        src_iface = src_node.get_interface(lk.source.interface)
        tgt_iface = tgt_node.get_interface(lk.target.interface)
        if not src_iface or not tgt_iface:
            continue

        src_drv = drivers.get(src_node.driver)
        tgt_drv = drivers.get(tgt_node.driver)

        src_vlan = (
            src_drv.vlan_for_interface(src_node.to_dict(), src_iface.to_dict())
            if src_drv
            else src_iface.vlan
        )
        tgt_vlan = (
            tgt_drv.vlan_for_interface(tgt_node.to_dict(), tgt_iface.to_dict())
            if tgt_drv
            else tgt_iface.vlan
        )
        src_mac = (
            src_drv.mac_address(src_node.to_dict(), src_iface.to_dict())
            if src_drv
            else src_iface.mac
        )
        tgt_mac = (
            tgt_drv.mac_address(tgt_node.to_dict(), tgt_iface.to_dict())
            if tgt_drv
            else tgt_iface.mac
        )

        docker_net_logical = net_cfg.get("docker_network")
        docker_net = qualify_docker_net(docker_net_logical, pid) if docker_net_logical else None
        container_ips = net_cfg.get("container_ips", {})

        plan.add_attachment(
            Attachment(
                node_id=src_node.id,
                interface_id=src_iface.id,
                bridge=bridge,
                vlan=src_vlan,
                mac=src_mac,
                docker_network=(docker_net if src_node.runtime in ("docker", "podman") else None),
                container_ip=container_ips.get(src_node.id),
            )
        )
        plan.add_attachment(
            Attachment(
                node_id=tgt_node.id,
                interface_id=tgt_iface.id,
                bridge=bridge,
                vlan=tgt_vlan,
                mac=tgt_mac,
                docker_network=(docker_net if tgt_node.runtime in ("docker", "podman") else None),
                container_ip=container_ips.get(tgt_node.id),
            )
        )
        linked.add((src_node.id, src_iface.id))
        linked.add((tgt_node.id, tgt_iface.id))

        # Track docker network config in the plan
        if docker_net:
            plan.docker_networks[docker_net] = {
                "subnet": net_cfg.get("docker_subnet"),
                "gateway": net_cfg.get("docker_gateway"),
                "driver": net_cfg.get("docker_driver", "bridge"),
            }

    # Unlinked interfaces on runnable nodes → orphan bridges
    for node in topo.runnable_nodes():
        for iface in node.interfaces:
            if (node.id, iface.id) not in linked:
                orphan_br = qualify_bridge(f"br-orphan-{node.id}-{iface.id}", pid)
                plan.add_attachment(
                    Attachment(
                        node_id=node.id,
                        interface_id=iface.id,
                        bridge=orphan_br,
                    )
                )

    return plan


# ---------------------------------------------------------------------------
# Bridge lifecycle
# ---------------------------------------------------------------------------


def ensure_bridge(name: str, stp: bool = True) -> bool:
    """Create a Linux bridge if it does not exist. Returns True if created."""
    if len(name) > _LINUX_IFNAME_MAX:
        raise ValueError(
            f"Bridge name '{name}' is {len(name)} chars — exceeds Linux "
            f"{_LINUX_IFNAME_MAX}-char limit. Use qualify_bridge() to get "
            f"a safe name."
        )
    if _iface_exists(name):
        return False
    alias = bridge_display_name(name)
    label = f"{name} ({alias})" if alias != name else name
    print(f"  Creating bridge: {label}")
    _sudo(f"ip link add name {name} type bridge")
    if stp:
        _sudo(f"ip link set {name} type bridge stp_state 1")
        # forward_delay: try 200 centiseconds (2s) first; if the kernel
        # rejects it (value out of range), silently fall back.
        _sudo(f"ip link set {name} type bridge forward_delay 200", check=False)
    _sudo(f"ip link set {name} up")
    return True


def remove_bridge(name: str) -> bool:
    if not _iface_exists(name):
        return False
    _sudo(f"ip link set {name} down", check=False)
    _sudo(f"ip link del {name}", check=False)
    return True


def setup_vlan_iface(
    parent_bridge: str,
    vlan_id: int,
    host_ip: str | None,
    prefix: int,
    label: str = "",
    master_bridge: str | None = None,
) -> str:
    """Create ``vchs.<vlan>`` sub-interface on *parent_bridge*.

    *parent_bridge* is the physical bridge carrying tagged traffic
    (typically ``virbr-chassis``).

    If *master_bridge* is given, the VLAN iface is **enslaved** to that
    bridge and *host_ip* (if any) is assigned to the *master_bridge*
    instead of directly to the VLAN iface.  This is needed for
    ``bridge_to_docker`` links where the Linux bridge aggregates the VLAN
    iface + a veth into Docker.

    Returns the VLAN iface name (e.g. ``vchs.100``).
    """
    iface = f"{HOST_VLAN_PREFIX}.{vlan_id}"
    if _iface_exists(iface):
        print(f"  VLAN interface {iface} already up ({label})")
    else:
        print(f"  Creating VLAN interface: {iface} on {parent_bridge} ({label})")
        _sudo(f"ip link add link {parent_bridge} name {iface} type vlan id {vlan_id}")
        _sudo(f"ip link set {iface} up")

    if master_bridge:
        # Enslave to the aggregation bridge — IP goes on the bridge later
        _sudo(f"ip link set {iface} master {master_bridge}", check=False)
        print(f"  Enslaved {iface} → {master_bridge}")
    elif host_ip:
        _sudo(f"ip addr replace {host_ip}/{prefix} dev {iface}")

    return iface


# ---------------------------------------------------------------------------
# bridge_to_docker — veth pair connecting a Linux bridge to a Docker bridge
# ---------------------------------------------------------------------------


def _docker_bridge_iface(docker_net: str) -> str | None:
    """Return the underlying Linux bridge name (e.g. ``br-1deeb4541a73``)
    for a Docker network, or *None* if it cannot be determined."""
    try:
        r = _run(
            ["docker", "network", "inspect", "-f", "{{.Id}}", docker_net],
            check=False,
        )
        if r.returncode != 0:
            return None
        net_id = r.stdout.strip()[:12]
        candidate = f"br-{net_id}"
        if _iface_exists(candidate):
            return candidate
    except Exception:
        pass
    return None


def _veth_names(project_id: str, link_id: str) -> tuple[str, str]:
    """Return a (host_end, docker_end) veth name pair.

    Linux interface names are limited to 15 characters, so we build
    compact names: ``<prefix>-vh`` / ``<prefix>-vd``.
    The prefix is derived from the *link_id* (or a hash of it) with the
    *project_id* baked in for uniqueness.
    """
    import hashlib

    # Build a deterministic short tag from project_id + link_id
    raw = f"{project_id}:{link_id}"
    h = hashlib.md5(raw.encode()).hexdigest()[:6]
    vh = f"nv{h}-vh"  # 11 chars max  (nv + 6 + - + vh)
    vd = f"nv{h}-vd"  # 11 chars max
    return vh, vd


def provision_bridge_to_docker(
    bridge: str,
    docker_net: str,
    project_id: str,
    link_id: str,
    host_ip: str | None = None,
    prefix: int = 24,
) -> dict:
    """Create a veth pair that interconnects a Linux *bridge* and the
    underlying bridge of *docker_net*.

    Steps:
      1. Look up Docker network's underlying ``br-<id>`` interface.
      2. Create a veth pair (host-end ↔ docker-end).
      3. Attach docker-end to the Docker bridge.
      4. Enslave host-end to the Linux *bridge*.
      5. Assign *host_ip* to the Linux *bridge* (gateway for both worlds).

    Returns a report dict.
    """
    report: dict = {"created": [], "errors": []}

    # 1) Find Docker underlying bridge
    docker_br = _docker_bridge_iface(docker_net)
    if not docker_br:
        report["errors"].append(f"Cannot find underlying bridge for Docker network {docker_net}")
        return report

    # 2) Veth pair
    vh, vd = _veth_names(project_id, link_id)
    if not _iface_exists(vh):
        print(f"  Creating veth pair: {vh} ↔ {vd}")
        _sudo(f"ip link add {vh} type veth peer name {vd}")
        _sudo(f"ip link set {vh} up")
        _sudo(f"ip link set {vd} up")
        report["created"].append(f"veth:{vh}↔{vd}")
    else:
        print(f"  Veth pair {vh} ↔ {vd} already exists")

    # 3) Attach docker-end to Docker's bridge
    _sudo(f"ip link set {vd} master {docker_br}", check=False)
    print(f"  Attached {vd} → {docker_br}")

    # 4) Enslave host-end to the Linux bridge
    _sudo(f"ip link set {vh} master {bridge}", check=False)
    print(f"  Enslaved {vh} → {bridge}")

    # 5) Host IP on the Linux bridge (acts as gateway for both sides)
    if host_ip:
        _sudo(f"ip addr replace {host_ip}/{prefix} dev {bridge}")
        report["created"].append(f"host-ip:{host_ip}/{prefix}@{bridge}")
        print(f"  Assigned {host_ip}/{prefix} to {bridge}")

    return report


def teardown_bridge_to_docker(project_id: str, link_id: str) -> dict:
    """Remove the veth pair created by ``provision_bridge_to_docker``."""
    report: dict = {"removed": [], "errors": []}
    vh, vd = _veth_names(project_id, link_id)
    if _iface_exists(vh):
        _sudo(f"ip link del {vh}", check=False)  # also removes peer
        report["removed"].append(f"veth:{vh}↔{vd}")
        print(f"  Removed veth pair {vh} ↔ {vd}")
    return report


# ---------------------------------------------------------------------------
# VLAN filtering on libvirt-managed bridges (chassis-net / virbr-chassis)
# ---------------------------------------------------------------------------

LIBVIRT_URI = "qemu:///system"


def _resolve_vnet(vm_name: str) -> str | None:
    """Return the host-side ``vnetN`` interface for a VM's chassis-net NIC.

    The chassis-net NIC is identified by ``type=network`` in the
    ``virsh domiflist`` output.
    """
    try:
        r = _run(
            ["virsh", "-c", LIBVIRT_URI, "domiflist", vm_name],
            check=False,
        )
        if r.returncode != 0:
            return None
        for line in r.stdout.splitlines():
            parts = line.split()
            # columns: Interface, Type, Source, Model, MAC
            if len(parts) >= 3 and parts[1] == "network":
                return parts[0]  # e.g. "vnet39"
    except Exception:
        pass
    return None


def setup_bridge_vlan_filter(bridge: str, vnet: str | None, vlan_ids: list[int]) -> list[str]:
    """Ensure *bridge* has ``vlan_filtering=1`` and *vnet* + bridge CPU
    port allow the listed VLANs.

    Returns list of commands executed.
    """
    executed: list[str] = []

    # Enable filtering on bridge
    cmd = f"ip link set {bridge} type bridge vlan_filtering 1"
    _sudo(cmd, check=False)
    executed.append(cmd)

    for vid in vlan_ids:
        # Bridge CPU port (self)
        cmd = f"bridge vlan add dev {bridge} vid {vid} self"
        _sudo(cmd, check=False)
        executed.append(cmd)

        # VM tap port
        if vnet:
            cmd = f"bridge vlan add dev {vnet} vid {vid}"
            _sudo(cmd, check=False)
            executed.append(cmd)

    return executed


def provision_chassis_vlans(
    vm_name: str, vlan_ids: list[int], bridge: str = MGMT_BRIDGE
) -> dict[str, Any]:
    """One-shot: look up the VM's vnet and enable all needed VLANs on
    the chassis-net bridge.

    Call this after a libvirt VM is started and its vnet exists.
    """
    report: dict[str, Any] = {
        "vm": vm_name,
        "bridge": bridge,
        "vlans": vlan_ids,
        "vnet": None,
        "commands": [],
        "errors": [],
    }
    vnet = _resolve_vnet(vm_name)
    report["vnet"] = vnet
    if not vnet:
        report["errors"].append(f"Could not resolve vnet for {vm_name}")
        return report

    cmds = setup_bridge_vlan_filter(bridge, vnet, vlan_ids)
    report["commands"] = cmds
    return report


def create_all_bridges(plan: NetworkPlan, tracker=None) -> None:
    """Create all bridges in the plan."""
    for br_name in plan.all_bridges():
        if br_name == MGMT_BRIDGE:
            continue  # managed by libvirt
        created = ensure_bridge(br_name)
        if created and tracker:
            link_id = None
            for att in plan.bridges.get(br_name, []):
                link_id = br_name.replace("br-", "", 1)
                break
            tracker.track_bridge(br_name, link_id)


# ---------------------------------------------------------------------------
# Docker network management
# ---------------------------------------------------------------------------


def docker_network_exists(name: str) -> bool:
    """Check if a Docker network exists."""
    try:
        r = _run(["docker", "network", "inspect", name], check=False)
        return r.returncode == 0
    except FileNotFoundError:
        return False


def _ensure_bridge_iptables_accept(bridge: str) -> None:
    """Allow intra-bridge traffic in Docker's iptables FORWARD chain.

    Docker's ``br_netfilter`` module sends bridge-forwarded frames through
    iptables, where Docker's default DROP policy blocks non-Docker
    endpoints (e.g. libvirt VM taps).  We fix this in two ways:

    1. Insert an ACCEPT rule in DOCKER-USER (processed first) so frames
       within the bridge are never dropped.
    2. Disable ``nf_call_iptables`` on the bridge (belt-and-suspenders).
    """
    if not _iface_exists(bridge):
        return
    # 1. iptables DOCKER-USER rule
    #    Docker may use iptables-legacy; prefer it when available.
    ipt = "iptables-legacy" if shutil.which("iptables-legacy") else "iptables"
    rule = ["-i", bridge, "-o", bridge, "-j", "ACCEPT"]
    chk = _run([ipt, "-C", "DOCKER-USER"] + rule, check=False)
    if chk.returncode != 0:
        r = _run([ipt, "-I", "DOCKER-USER"] + rule, check=False)
        if r.returncode == 0:
            print(f"  iptables: ACCEPT intra-bridge traffic on {bridge} (via {ipt})")
        else:
            print(
                f"  iptables: FAILED to add ACCEPT rule on {bridge} (via {ipt}): {r.stderr.strip()}"
            )
    # 2. Disable nf_call_iptables via sysfs
    nf_path = f"/sys/devices/virtual/net/{bridge}/bridge/nf_call_iptables"
    try:
        with open(nf_path, "w") as f:
            f.write("0")
    except OSError:
        pass


def ensure_docker_network(
    name: str,
    subnet: str | None = None,
    gateway: str | None = None,
    driver: str = "bridge",
    bridge: str | None = None,
) -> tuple[bool, str]:
    """Create a Docker network if it doesn't exist.

    Returns (created_or_exists: bool, error: str).  error is empty on success.
    When *bridge* is given, the Docker network is backed by that existing
    Linux bridge (``com.docker.network.bridge.name`` option) instead of
    creating a new one.
    """
    if docker_network_exists(name):
        # Ensure iptables rules are in place even for pre-existing networks.
        if bridge:
            _ensure_bridge_iptables_accept(bridge)
        return True, ""
    cmd = ["docker", "network", "create", "--driver", driver]
    if bridge:
        cmd += ["-o", f"com.docker.network.bridge.name={bridge}"]
        # Disable Docker iptables interference on shared bridges so that
        # non-Docker endpoints (e.g. libvirt VM taps) can communicate
        # with containers through VLAN-tagged or plain L2 frames.
        cmd += ["-o", "com.docker.network.bridge.enable_icc=true"]
        cmd += ["-o", "com.docker.network.bridge.enable_ip_masquerade=false"]
    if subnet:
        cmd += ["--subnet", subnet]
    if gateway:
        cmd += ["--gateway", gateway]
    cmd.append(name)
    print(f"  Creating Docker network: {name}" + (f" (bridge={bridge})" if bridge else ""))
    r = _run(cmd, check=False)
    if r.returncode != 0:
        err = r.stderr.strip() or r.stdout.strip()
        print(f"  WARNING: docker network create failed: {err}")
        return False, err

    # Ensure VM ↔ container traffic isn't blocked by Docker iptables.
    if bridge:
        _ensure_bridge_iptables_accept(bridge)

    return True, ""


def docker_connect(container: str, network: str, ip: str | None = None) -> tuple[bool, str]:
    """Connect a container to a Docker network with optional static IP.

    Returns (ok: bool, error: str).  error is empty on success.
    If the container is already connected with a different IP, it is
    disconnected first and reconnected with the desired IP.
    """
    # Check if already connected
    r = _run(
        [
            "docker",
            "inspect",
            container,
            "--format",
            "{{json .NetworkSettings.Networks}}",
        ],
        check=False,
    )
    if r.returncode == 0:
        try:
            nets = json.loads(r.stdout.strip())
            if network in nets:
                current_ip = (nets[network] or {}).get("IPAddress", "")
                if not ip or current_ip == ip:
                    print(
                        f"  Container {container} already connected to {network}"
                        + (f" ({current_ip})" if current_ip else "")
                    )
                    return True, ""
                # Connected but with different IP — reconnect
                print(
                    f"  Container {container} connected to {network} with"
                    f" {current_ip}, reconnecting with {ip}"
                )
                docker_disconnect(container, network)
        except (json.JSONDecodeError, TypeError):
            pass

    cmd = ["docker", "network", "connect"]
    if ip:
        cmd += ["--ip", ip]
    cmd += [network, container]
    print(f"  Connecting {container} → {network}" + (f" ({ip})" if ip else ""))
    r = _run(cmd, check=False)
    if r.returncode == 0:
        return True, ""

    err = r.stderr.strip() or r.stdout.strip()

    # "Address already in use" — stale endpoint or another container
    # holding the IP.  Force-disconnect stale holders and retry once.
    if ip and ("already in use" in err.lower() or "already exists" in err.lower()):
        print(f"  Address conflict for {ip} on {network}, cleaning stale endpoints…")
        _evict_stale_ip(network, ip, exclude=container)
        # Also disconnect ourselves in case of a partial endpoint
        docker_disconnect(container, network)
        r = _run(cmd, check=False)
        if r.returncode == 0:
            return True, ""
        err = r.stderr.strip() or r.stdout.strip()

    print(f"  WARNING: docker network connect failed: {err}")
    return False, err


def _evict_stale_ip(network: str, ip: str, exclude: str = "") -> None:
    """Find any container/endpoint holding *ip* on *network* and disconnect it."""
    r = _run(["docker", "network", "inspect", network], check=False)
    if r.returncode != 0:
        return
    try:
        insp = json.loads(r.stdout.strip())
        if isinstance(insp, list) and insp:
            insp = insp[0]
        containers = insp.get("Containers") or {}
        for ep_id, ep_info in containers.items():
            ep_ip = (ep_info.get("IPv4Address") or "").split("/")[0]
            ep_name = ep_info.get("Name", "")
            if ep_ip == ip and ep_name != exclude:
                print(f"  Evicting stale endpoint {ep_name or ep_id[:12]} ({ep_ip}) from {network}")
                # Try by name first, fall back to endpoint ID
                if ep_name:
                    _run(
                        ["docker", "network", "disconnect", "-f", network, ep_name],
                        check=False,
                    )
                else:
                    _run(
                        ["docker", "network", "disconnect", "-f", network, ep_id],
                        check=False,
                    )
    except (json.JSONDecodeError, TypeError, KeyError):
        pass


def docker_disconnect(container: str, network: str) -> bool:
    """Disconnect a container from a Docker network."""
    r = _run(["docker", "network", "disconnect", network, container], check=False)
    return r.returncode == 0


def remove_docker_network(name: str) -> bool:
    """Remove a Docker network."""
    if not docker_network_exists(name):
        return False
    r = _run(["docker", "network", "rm", name], check=False)
    return r.returncode == 0


def get_container_networks(container: str) -> dict[str, dict]:
    """Return a dict of network_name → {ip, gateway, ...} for a container."""
    r = _run(
        [
            "docker",
            "inspect",
            container,
            "--format",
            "{{json .NetworkSettings.Networks}}",
        ],
        check=False,
    )
    if r.returncode != 0:
        return {}
    try:
        nets = json.loads(r.stdout.strip())
        result = {}
        for net_name, info in (nets or {}).items():
            result[net_name] = {
                "ip": info.get("IPAddress", ""),
                "gateway": info.get("Gateway", ""),
                "mac": info.get("MacAddress", ""),
            }
        return result
    except (json.JSONDecodeError, TypeError):
        return {}


def get_container_pid(container: str) -> int | None:
    """Return the host PID of the container's init process, or None."""
    r = _run(["docker", "inspect", container, "--format", "{{.State.Pid}}"], check=False)
    if r.returncode != 0:
        return None
    try:
        pid = int(r.stdout.strip())
        return pid if pid > 0 else None
    except ValueError:
        return None


def nsenter_run(pid: int, cmd: list[str], check: bool = False) -> subprocess.CompletedProcess:
    """Run *cmd* inside the network namespace of host PID *pid*."""
    return _run(["nsenter", "-t", str(pid), "-n", "--"] + cmd, check=check)


def container_setup_vlan(
    container: str, parent_dev: str, vlan_id: int, ip_cidr: str | None = None
) -> tuple[bool, str]:
    """Create a VLAN sub-interface inside *container* and optionally move IP.

    Uses ``nsenter`` into the container's network namespace (requires the
    caller to have CAP_SYS_ADMIN or run as root — the triv backend
    container satisfies this).

    Returns ``(ok, error_or_detail)``.
    """
    pid = get_container_pid(container)
    if pid is None:
        return False, f"Cannot get PID for container {container}"

    sub_dev = f"{parent_dev}.{vlan_id}"

    # Create VLAN sub-interface
    r = nsenter_run(
        pid,
        [
            "ip",
            "link",
            "add",
            "link",
            parent_dev,
            "name",
            sub_dev,
            "type",
            "vlan",
            "id",
            str(vlan_id),
        ],
    )
    if r.returncode != 0:
        err = r.stderr.strip()
        if "File exists" not in err:
            return False, f"ip link add {sub_dev}: {err}"

    # Move IP from parent to sub-interface
    if ip_cidr:
        nsenter_run(pid, ["ip", "addr", "flush", "dev", parent_dev])
        r = nsenter_run(pid, ["ip", "addr", "add", ip_cidr, "dev", sub_dev])
        if r.returncode != 0:
            err = r.stderr.strip()
            if "File exists" not in err:
                return False, f"ip addr add {ip_cidr} on {sub_dev}: {err}"

    # Bring sub-interface up
    nsenter_run(pid, ["ip", "link", "set", sub_dev, "up"])

    # ── Ensure the host-side bridge port allows this VLAN ──
    # When the bridge has vlan_filtering=1, tagged frames are dropped
    # unless the port is explicitly configured for the VLAN.
    _allow_vlan_on_host_port(pid, parent_dev, vlan_id)

    detail = f"VLAN {vlan_id} on {parent_dev} → {sub_dev}"
    if ip_cidr:
        detail += f" ({ip_cidr})"
    return True, detail


def _allow_vlan_on_host_port(pid: int, container_dev: str, vlan_id: int) -> None:
    """Add VLAN *vlan_id* to the host-side veth peer of *container_dev*.

    Inside the container netns, *container_dev* (e.g. ``eth0``) is one
    end of a veth pair.  Its ``iflink`` points to the host-side peer's
    ifindex.  We resolve that to a name, check it sits on a bridge with
    ``vlan_filtering``, and add the VID to both the port and the bridge
    CPU port (``self``).
    """
    print(f"  _allow_vlan_on_host_port: pid={pid} dev={container_dev} vid={vlan_id}")

    # 1. Get the host-side ifindex from the container's device.
    #    We use ``ip -o link show`` via nsenter (netlink — namespace-aware)
    #    instead of reading /sys/class/net/.../iflink (sysfs — mount-
    #    namespace scoped) because nsenter -n only switches the network
    #    namespace and the sysfs mount still comes from the caller's
    #    mount namespace.
    r = nsenter_run(pid, ["ip", "-o", "link", "show", container_dev])
    if r.returncode != 0 or not r.stdout.strip():
        print(
            f"  _allow_vlan_on_host_port: FAILED to query {container_dev} "
            f"(rc={r.returncode}, err={r.stderr.strip()})"
        )
        return
    # Output: "9: eth0@if2189: <FLAGS> ..."  — the @ifNNN suffix is the peer
    peer_idx: int | None = None
    link_line = r.stdout.strip().splitlines()[0]
    # Try the @ifNNN suffix first (present on veth pairs)
    m = re.search(r"@if(\d+)", link_line)
    if m:
        peer_idx = int(m.group(1))
    if peer_idx is None:
        print(f"  _allow_vlan_on_host_port: no @ifN peer index in: {link_line!r}")
        return
    print(f"  _allow_vlan_on_host_port: peer ifindex = {peer_idx}")

    # 2. Resolve host ifindex → interface name
    r2 = _run(["ip", "-o", "link", "show"], check=False)
    host_veth: str | None = None
    for line in r2.stdout.splitlines():
        # Format: "42: vethXXX@if41: <FLAGS> ..."
        parts = line.split(":")
        if len(parts) >= 2:
            try:
                idx = int(parts[0].strip())
            except ValueError:
                continue
            if idx == peer_idx:
                host_veth = parts[1].strip().split("@")[0]
                break
    if not host_veth:
        print(f"  _allow_vlan_on_host_port: FAILED to find host veth for ifindex {peer_idx}")
        return
    print(f"  _allow_vlan_on_host_port: host_veth = {host_veth}")

    # 3. Check if the bridge has vlan_filtering enabled
    r3 = _run(["ip", "-d", "link", "show", host_veth], check=False)
    master = ""
    for line in r3.stdout.splitlines():
        if "master" in line:
            for tok in line.split():
                if tok == "master":
                    idx = line.split().index("master")
                    toks = line.split()
                    if idx + 1 < len(toks):
                        master = toks[idx + 1]
                    break
            break
    if not master:
        print(f"  _allow_vlan_on_host_port: FAILED to find master bridge for {host_veth}")
        print(f"  _allow_vlan_on_host_port: ip -d link output:\n{r3.stdout}")
        return
    print(f"  _allow_vlan_on_host_port: master bridge = {master}")

    # 4. Add VLAN to the bridge port, bridge self, and ALL other ports
    #    (e.g. VM taps) so tagged frames pass in both directions when
    #    the bridge has vlan_filtering=1.
    #
    #    Container veth ports carry *tagged* frames (the container kernel
    #    adds/strips the VLAN tag on its eth0.VID sub-interface).
    #
    #    VM tap ports carry *untagged* frames (the VM sees a plain
    #    Ethernet NIC).  We configure taps as "access ports" by setting
    #    the VID as PVID+untagged — ingress untagged frames are assigned
    #    to the VLAN, and egress frames for that VLAN are sent untagged.
    #    We also remove the default PVID 1 so traffic isn't leaked.
    r_veth = _sudo(f"bridge vlan add dev {host_veth} vid {vlan_id}", check=False)
    print(f"  VLAN {vlan_id}: add to {host_veth} → rc={r_veth.returncode}")
    r_self = _sudo(f"bridge vlan add dev {master} vid {vlan_id} self", check=False)
    print(f"  VLAN {vlan_id}: add to {master} self → rc={r_self.returncode}")

    # Enumerate every port on the bridge and allow the VID on each.
    r4 = _run(["ip", "-o", "link", "show", "master", master], check=False)
    for line in r4.stdout.splitlines():
        parts = line.split(":")
        if len(parts) >= 2:
            port = parts[1].strip().split("@")[0]
            if port and port != host_veth:
                # Detect whether this is a veth (has @ifN peer) or a tap.
                is_veth = "@if" in line
                if is_veth:
                    # Another container's veth — keep tagged
                    rp = _sudo(f"bridge vlan add dev {port} vid {vlan_id}", check=False)
                    print(
                        f"  VLAN {vlan_id}: add to port {port} (bridge {master}) → rc={rp.returncode}"
                    )
                else:
                    # VM tap — make it an access port (pvid untagged)
                    _sudo(f"bridge vlan del dev {port} vid 1", check=False)
                    rp = _sudo(
                        f"bridge vlan add dev {port} vid {vlan_id} pvid untagged",
                        check=False,
                    )
                    print(
                        f"  VLAN {vlan_id}: access port {port} (bridge {master}, pvid untagged) → rc={rp.returncode}"
                    )

    # 5. Remove the gateway IP that Docker assigned to the bridge.
    #    Docker places the network's gateway address on the bridge device
    #    itself (untagged / PVID 1), but container traffic is tagged with
    #    the VLAN, so that IP is unreachable and can cause ARP confusion.
    _sudo(f"ip addr flush dev {master}", check=False)
    print(f"  Flushed IP addresses from bridge {master} (VLAN trunk — IP not needed)")

    print(f"  VLAN {vlan_id}: allowed on bridge port {host_veth} (bridge {master})")


def container_remove_vlans(container: str) -> list[str]:
    """Remove all VLAN sub-interfaces inside *container*.

    Returns list of removed device names.
    """
    pid = get_container_pid(container)
    if pid is None:
        return []

    r = nsenter_run(pid, ["ip", "-d", "link", "show", "type", "vlan"])
    if r.returncode != 0:
        return []

    removed: list[str] = []
    for line in r.stdout.splitlines():
        # Lines like: "4: eth1.100@eth1: <BROADCAST,..."
        if "@" in line and ":" in line:
            parts = line.split(":")
            if len(parts) >= 2:
                dev = parts[1].strip().split("@")[0]
                dr = nsenter_run(pid, ["ip", "link", "del", dev])
                if dr.returncode == 0:
                    removed.append(dev)
    return removed


# ---------------------------------------------------------------------------
# Provision / tear-down for a single link
# ---------------------------------------------------------------------------


def provision_link(
    link: Link, topo: Topology, drivers: dict, tracker=None, project_id: str = ""
) -> dict[str, Any]:
    """Provision all networking resources for a single link.

    *project_id* qualifies bridge and docker-network names so multiple
    projects can coexist.  Falls back to ``topo.project_id``.

    When the link's ``network`` contains ``bridge_to_docker: true``, the
    provisioner creates an end-to-end path:

        VLAN sub-iface (on virbr-chassis)
            ↕  enslaved to
        Linux bridge  (my-lab-br-mgmt)
            ↕  veth pair
        Docker bridge  (br-xxxx  underlying my-lab-triv-mgmt)

    The host IP is placed on the Linux bridge so it acts as gateway for
    both VM and container traffic.

    Returns a report dict with created resources.
    """
    pid = project_id or topo.project_id
    report: dict[str, Any] = {"link_id": link.id, "created": [], "errors": []}
    net_cfg = link.network or {}
    b2d = net_cfg.get("bridge_to_docker", False)

    # 1) Linux bridge  (qualified)
    bridge_logical = link.bridge_name
    bridge = qualify_bridge(bridge_logical, pid)
    stp = net_cfg.get("stp", True)
    if bridge and bridge != MGMT_BRIDGE:
        created = ensure_bridge(bridge, stp=stp)
        if created:
            report["created"].append(f"bridge:{bridge}")
            if tracker:
                tracker.track_bridge(bridge, link.id)

    # 2) VLAN interface
    vlan_id = net_cfg.get("vlan")
    vlan_host_ip = net_cfg.get("vlan_host_ip")
    vlan_prefix = net_cfg.get("vlan_prefix", 24)
    # parent_bridge: explicit trunk bridge to create the VLAN sub-iface on.
    # Falls back to MGMT_BRIDGE for b2d mode or the link's own bridge.
    explicit_parent = net_cfg.get("parent_bridge")
    if explicit_parent:
        explicit_parent = qualify_bridge(explicit_parent, pid)

    # Create VLAN iface when there's a vlan_host_ip to assign, OR when
    # parent_bridge is configured (the VLAN sub-iface must be enslaved
    # to the link's bridge even without a host IP).
    needs_vlan_iface = vlan_id and (vlan_host_ip or explicit_parent)
    if needs_vlan_iface:
        if b2d and bridge and bridge != MGMT_BRIDGE:
            # bridge_to_docker mode: VLAN iface is created on the parent
            # bridge and enslaved to the aggregation bridge.  IP is NOT
            # assigned here — it goes on the bridge after the veth is
            # connected (step 5).
            vlan_parent = explicit_parent or MGMT_BRIDGE
            iface = setup_vlan_iface(
                vlan_parent,
                vlan_id,
                host_ip=None,  # no IP on the VLAN iface itself
                prefix=vlan_prefix,
                label=link.label or link.id,
                master_bridge=bridge,
            )
        else:
            # Simple mode: VLAN iface directly on the parent bridge with IP
            vlan_parent = explicit_parent or bridge or MGMT_BRIDGE
            iface = setup_vlan_iface(
                vlan_parent,
                vlan_id,
                host_ip=vlan_host_ip,
                prefix=vlan_prefix,
                label=link.label or link.id,
            )
        report["created"].append(f"vlan:{iface}")
        if tracker:
            tracker.track_vlan_iface(iface, str(vlan_id), vlan_host_ip, str(vlan_prefix))

    # 2b) VLAN filtering on chassis-net bridge for libvirt VMs
    #     Skip when parent_bridge is set — the VLAN lives on that bridge,
    #     not on the legacy chassis-net.
    chassis_vlans = net_cfg.get("chassis_vlans") or []
    if vlan_id and vlan_id not in chassis_vlans and not explicit_parent:
        chassis_vlans.append(vlan_id)
    if chassis_vlans:
        for endpoint in (link.source, link.target):
            node = topo.get_node(endpoint.node)
            if not node or node.runtime != RuntimeBackend.LIBVIRT:
                continue
            drv = drivers.get(node.driver)
            props = node.properties or {}
            vm_name_str = props.get("vm-name")
            if not vm_name_str and drv:
                vm_name_str = drv.vm_name(node.to_dict())
            if not vm_name_str:
                continue
            vr = provision_chassis_vlans(vm_name_str, chassis_vlans)
            if vr.get("vnet"):
                report["created"].append(f"chassis-vlan:{vr['vnet']}←{chassis_vlans}")
            if vr.get("errors"):
                report["errors"].extend(vr["errors"])

    # 3) Assign host IP to bridge (for management links without VLAN)
    host_ip = net_cfg.get("host_ip")
    prefix = net_cfg.get("prefix", 24)
    if host_ip and bridge:
        _sudo(f"ip addr replace {host_ip}/{prefix} dev {bridge}", check=False)
        report["created"].append(f"host-ip:{host_ip}/{prefix}@{bridge}")

    # 4) Docker network  (qualified)
    docker_net_logical = net_cfg.get("docker_network")
    docker_net = qualify_docker_net(docker_net_logical, pid) if docker_net_logical else None
    if docker_net:
        created, _err = ensure_docker_network(
            docker_net,
            subnet=net_cfg.get("docker_subnet"),
            gateway=net_cfg.get("docker_gateway"),
            driver=net_cfg.get("docker_driver", "bridge"),
        )
        if created:
            report["created"].append(f"docker-network:{docker_net}")

        # 5) bridge_to_docker — veth interconnection
        if b2d and bridge and bridge != MGMT_BRIDGE:
            b2d_report = provision_bridge_to_docker(
                bridge=bridge,
                docker_net=docker_net,
                project_id=pid,
                link_id=link.id,
                host_ip=vlan_host_ip,
                prefix=vlan_prefix,
            )
            report["created"].extend(b2d_report.get("created", []))
            report["errors"].extend(b2d_report.get("errors", []))

        # Connect containers to the Docker network
        container_ips = net_cfg.get("container_ips", {})
        for endpoint in (link.source, link.target):
            node = topo.get_node(endpoint.node)
            if not node:
                continue
            if node.runtime not in (RuntimeBackend.DOCKER, RuntimeBackend.PODMAN):
                continue
            # Resolve container name
            drv = drivers.get(node.driver)
            props = node.properties or {}
            cname = props.get("container-name")
            if not cname and drv:
                cname = drv.vm_name(node.to_dict())
            if not cname:
                continue
            ip = container_ips.get(node.id)
            ok, err = docker_connect(cname, docker_net, ip)
            if ok:
                report["created"].append(f"docker-connect:{cname}→{docker_net}")
            else:
                report["errors"].append(f"Failed to connect {cname} to {docker_net}: {err}")

    return report


def provision_all_links(
    topo: Topology, drivers: dict, tracker=None, project_id: str = ""
) -> list[dict]:
    """Provision networking for ALL links in the topology."""
    pid = project_id or topo.project_id
    reports = []
    for link in topo.links:
        r = provision_link(link, topo, drivers, tracker, project_id=pid)
        reports.append(r)
    return reports


def teardown_link(link: Link, tracker=None, project_id: str = "") -> dict[str, Any]:
    """Remove networking resources for a single link.

    Removes docker network, VLAN sub-interface, and bridge that were
    provisioned for this link.  If *tracker* is provided, resources are
    un-tracked as they are removed.

    *project_id* is used to qualify names the same way ``provision_link``
    does, so we remove the correct host-level resources.
    """
    pid = project_id
    net = link.network or {}
    report: dict[str, Any] = {
        "link_id": link.id,
        "removed": [],
        "errors": [],
    }

    # 1) Disconnect containers from docker network before removing it
    docker_net_logical = net.get("docker_network")
    docker_net = qualify_docker_net(docker_net_logical, pid) if docker_net_logical else None

    # 1b) Remove veth pair (bridge_to_docker) BEFORE removing docker network
    b2d = net.get("bridge_to_docker", False)
    if b2d and pid:
        b2d_report = teardown_bridge_to_docker(pid, link.id)
        report["removed"].extend(b2d_report.get("removed", []))
        report["errors"].extend(b2d_report.get("errors", []))

    if docker_net and docker_network_exists(docker_net):
        # Disconnect any containers still attached
        try:
            r = _run(
                [
                    "docker",
                    "network",
                    "inspect",
                    "-f",
                    "{{range .Containers}}{{.Name}} {{end}}",
                    docker_net,
                ],
                check=False,
            )
            if r.returncode == 0:
                for cname in r.stdout.strip().split():
                    if cname:
                        docker_disconnect(cname, docker_net)
        except Exception:
            pass

        ok = remove_docker_network(docker_net)
        if ok:
            report["removed"].append(f"docker-network:{docker_net}")
        else:
            report["errors"].append(f"Failed to remove docker network {docker_net}")

    # 2) Remove VLAN sub-interface
    vlan_id = net.get("vlan")
    if vlan_id:
        iface = f"{HOST_VLAN_PREFIX}.{vlan_id}"
        if _iface_exists(iface):
            rc = _sudo(f"ip link del {iface}", check=False)
            if rc.returncode == 0:
                report["removed"].append(f"vlan-iface:{iface}")
                if tracker:
                    tracker.state.vlan_ifaces.pop(iface, None)
                    tracker.save()
            else:
                report["errors"].append(f"Failed to remove VLAN iface {iface}")

    # 3) Remove bridge  (qualified)
    bridge_logical = net.get("bridge")
    if bridge_logical:
        bridge = qualify_bridge(bridge_logical, pid)
    else:
        bridge = qualify_bridge(link.bridge_name, pid)
    if bridge and bridge != MGMT_BRIDGE:
        ok = remove_bridge(bridge)
        if ok:
            report["removed"].append(f"bridge:{bridge}")
            if tracker:
                tracker.untrack_bridge(bridge)
        else:
            # Bridge may not exist (already cleaned up) — not an error
            if _iface_exists(bridge):
                report["errors"].append(f"Failed to remove bridge {bridge}")

    return report


def teardown_all_links(topo: Topology, tracker=None, project_id: str = "") -> list[dict]:
    """Remove networking for ALL links in the topology."""
    pid = project_id or topo.project_id
    reports = []
    for link in topo.links:
        r = teardown_link(link, tracker, project_id=pid)
        reports.append(r)
    return reports


# ---------------------------------------------------------------------------
# Enriched link info (for API / UI)
# ---------------------------------------------------------------------------


def enrich_link(link: Link, topo: Topology, project_id: str = "") -> dict[str, Any]:
    """Return an enriched dict for a link with full endpoint info."""
    pid = project_id or topo.project_id
    d = link.to_dict()

    # Add endpoint details: interface label, type, IP, connector
    for side in ("source", "target"):
        ep = getattr(link, side)
        node = topo.get_node(ep.node)
        if node:
            iface = node.get_interface(ep.interface)
            if iface:
                d[side] = {
                    **d[side],
                    "interface_label": iface.label or iface.id,
                    "interface_type": (
                        iface.type.value if hasattr(iface.type, "value") else str(iface.type)
                    ),
                    "interface_ip": iface.ip,
                    "interface_direction": (
                        iface.direction.value
                        if hasattr(iface.direction, "value")
                        else str(iface.direction)
                    ),
                    "interface_connector": iface.connector,
                }

    # Add medium group for UI filtering
    d["medium_group"] = link.medium_group

    # Bridge / network status  (qualified names)
    br_logical = link.bridge_name
    br = qualify_bridge(br_logical, pid)
    d["bridge"] = br
    d["bridge_logical"] = br_logical
    d["bridge_state"] = get_bridge_state(br)

    # Docker network status  (qualified)
    docker_net_logical = (link.network or {}).get("docker_network")
    if docker_net_logical:
        docker_net = qualify_docker_net(docker_net_logical, pid)
        d["docker_network"] = docker_net
        d["docker_network_logical"] = docker_net_logical
        d["docker_network_status"] = "exists" if docker_network_exists(docker_net) else "missing"

    return d


# ---------------------------------------------------------------------------
# Status / info
# ---------------------------------------------------------------------------


def get_bridge_stats(name: str) -> dict:
    """Read basic stats for a bridge."""
    base = f"/sys/class/net/{name}/statistics"
    stats = {}
    for metric in ("tx_packets", "rx_packets", "tx_bytes", "rx_bytes"):
        path = f"{base}/{metric}"
        try:
            with open(path) as f:
                stats[metric] = int(f.read().strip())
        except (FileNotFoundError, ValueError):
            stats[metric] = 0
    return stats


def get_bridge_state(name: str) -> str:
    try:
        with open(f"/sys/class/net/{name}/operstate") as f:
            return f.read().strip()
    except FileNotFoundError:
        return "unknown"


def get_stp_state(name: str) -> bool:
    try:
        with open(f"/sys/class/net/{name}/bridge/stp_state") as f:
            return f.read().strip() == "1"
    except FileNotFoundError:
        return False


# ---------------------------------------------------------------------------
# Docker network discovery
# ---------------------------------------------------------------------------


def discover_container_networks(nodes: list[dict]) -> list[dict]:
    """Inspect running Docker containers and return their shared networks.

    For each Docker network shared by 2+ containers, returns a discovery
    record that can be used to populate topology links.

    Args:
        nodes: list of node dicts from topology (node.to_dict()), each must
               have ``runtime`` = "docker"|"podman" and resolve to a container
               name via ``properties.container-name``.

    Returns:
        list of dicts, one per discovered Docker network::

            {
                "network":    "<docker_network_name>",
                "driver":     "bridge" | "overlay" | ...,
                "subnet":     "172.x.x.0/24" | None,
                "gateway":    "172.x.x.1" | None,
                "containers": {
                    "<node_id>": {"ip": "...", "gateway": "...", "mac": "..."}
                },
                "exists": True,
                "suggested_link_id": "disc-<network>",
            }
    """
    # Collect docker/podman containers from nodes
    docker_nodes: list[tuple[str, str]] = []  # (node_id, container_name)
    for nd in nodes:
        rt = nd.get("runtime")
        if rt not in ("docker", "podman"):
            continue
        props = nd.get("properties") or {}
        cname = props.get("container-name") or nd.get("id")
        docker_nodes.append((nd["id"], cname))

    if not docker_nodes:
        return []

    # Inspect all containers at once
    # network_map[network_name] = {node_id: {ip, gateway, mac}}
    network_map: dict[str, dict[str, dict]] = {}
    network_meta: dict[str, dict] = {}  # network_name → {driver, subnet, gateway}

    for node_id, cname in docker_nodes:
        nets = get_container_networks(cname)
        for net_name, info in nets.items():
            if net_name not in network_map:
                network_map[net_name] = {}
            network_map[net_name][node_id] = info

    # Gather docker network metadata (driver, subnet, gateway)
    for net_name in list(network_map.keys()):
        try:
            r = _run(
                [
                    "docker",
                    "network",
                    "inspect",
                    "--format",
                    "{{.Driver}}|{{range .IPAM.Config}}{{.Subnet}}|{{.Gateway}}{{end}}",
                    net_name,
                ],
                check=False,
            )
            if r.returncode == 0:
                parts = r.stdout.strip().split("|")
                network_meta[net_name] = {
                    "driver": parts[0] if len(parts) > 0 else "bridge",
                    "subnet": parts[1] if len(parts) > 1 else None,
                    "gateway": parts[2] if len(parts) > 2 else None,
                }
            else:
                network_meta[net_name] = {
                    "driver": "bridge",
                    "subnet": None,
                    "gateway": None,
                }
        except Exception:
            network_meta[net_name] = {
                "driver": "bridge",
                "subnet": None,
                "gateway": None,
            }

    results = []
    for net_name, containers in network_map.items():
        meta = network_meta.get(net_name, {})
        results.append(
            {
                "network": net_name,
                "driver": meta.get("driver", "bridge"),
                "subnet": meta.get("subnet"),
                "gateway": meta.get("gateway"),
                "containers": containers,
                "exists": True,
                "suggested_link_id": f"disc-{net_name}",
            }
        )

    return results
