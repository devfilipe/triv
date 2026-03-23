"""
VM / container lifecycle helpers — define, remove, interface management.
"""

import hashlib
import ipaddress
import os
import subprocess
from pathlib import Path

from triv.core.enums import RuntimeBackend
from triv.core import network as netmod
from triv.core import network_v2 as netv2

import shared
from node_helpers import load_node_env, resolve_vm_name


def resolve_bridge_for_iface(node_id: str, iface_id: str) -> str:
    """Resolve the qualified bridge name for a node's interface.

    Looks up the first entry in ``iface.networks`` → finds the NetworkDef →
    returns the same bridge name that the Net Manager uses on deploy.

    Raises ValueError if the interface has no networks or the NetworkDef is
    not found.
    """
    if not shared.topology:
        raise ValueError("Topology not loaded")

    pid = shared.topology.project_id or ""
    node = shared.topology.get_node(node_id)
    if not node:
        raise ValueError(f"Node '{node_id}' not found in topology")

    iface = next((i for i in node.interfaces if i.id == iface_id), None)
    if not iface:
        raise ValueError(f"Interface '{iface_id}' not found on node '{node_id}'")

    if not iface.networks:
        raise ValueError(f"Interface '{iface_id}' on node '{node_id}' has no networks configured")

    nd = shared.topology.get_network_def(iface.networks[0])
    if not nd:
        raise ValueError(f"NetworkDef '{iface.networks[0]}' not found for interface '{iface_id}'")

    return netv2.qualified_bridge(nd, pid)


def resolve_iface_mac(node_id: str, iface, drv) -> str:
    """Get MAC address for an interface from the driver or generate one."""
    node = shared.topology.get_node(node_id) if shared.topology else None
    if node and drv:
        mac = drv.mac_address(node.to_dict(), iface.to_dict())
        if mac:
            return mac
    h = hashlib.md5(f"{node_id}:{iface.id}".encode()).hexdigest()
    return f"52:54:00:{h[0:2]}:{h[2:4]}:{h[4:6]}"


def define_vm(node_id: str) -> dict:
    """Generate VM XML from template, create qcow2 overlay, and virsh define."""
    if not shared.topology:
        return {"ok": False, "error": "Topology not loaded"}

    node = shared.topology.get_node(node_id)
    if not node or node.runtime != RuntimeBackend.LIBVIRT:
        return {"ok": False, "error": f"Node '{node_id}' is not a libvirt VM"}

    nd = node.to_dict()
    drv = shared.registry.get_or_default(node.driver)
    env_data = load_node_env(nd)
    vm_name = resolve_vm_name(nd, drv, env_data)
    driver_args = env_data.get("driver_args", {})

    image_path = driver_args.get("image-path", "")
    if not image_path:
        return {"ok": False, "error": "No 'image-path' in env driver_args"}
    if not os.path.isfile(image_path):
        return {"ok": False, "error": f"Image not found: {image_path}"}

    # Resolve bridges + MACs for ALL interfaces
    iface_bridges: dict[str, str] = {}
    iface_macs: dict[str, str] = {}
    for iface in node.interfaces:
        try:
            bridge = resolve_bridge_for_iface(node_id, iface.id)
        except ValueError as exc:
            return {"ok": False, "error": str(exc)}
        netmod.ensure_bridge(bridge, stp=False)
        iface_bridges[iface.id] = bridge
        iface_macs[iface.id] = resolve_iface_mac(node_id, iface, drv)

    # Temp dir + qcow2 overlay
    temp_dir = f"/tmp/run_{vm_name}"
    if os.path.exists(temp_dir):
        subprocess.run(["rm", "-rf", temp_dir], check=False)
    os.makedirs(temp_dir, exist_ok=True)

    overlay_path = os.path.join(temp_dir, f"{vm_name}.qcow2")
    backing = os.path.realpath(image_path)
    result = subprocess.run(
        [
            "qemu-img",
            "create",
            "-f",
            "qcow2",
            "-o",
            f"backing_file={backing},backing_fmt=raw",
            overlay_path,
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return {"ok": False, "error": f"qemu-img failed: {result.stderr.strip()}"}

    uefi_memory_path = os.path.join(temp_dir, "uefi_memory")

    # Generate XML from template
    xml_str = drv.vm_template(nd, env_data)

    if not xml_str:
        tmpl_from_args = driver_args.get("template", "")
        if tmpl_from_args and os.path.isabs(tmpl_from_args) and os.path.isfile(tmpl_from_args):
            with open(tmpl_from_args) as _f:
                xml_str = _f.read()

    if not xml_str:
        tmpl_path = Path(shared.PROJECT_DIR) / "templates" / "vm-box-template.xml"
        if tmpl_path.is_file():
            xml_str = tmpl_path.read_text()
    if not xml_str:
        return {"ok": False, "error": "No VM template found"}

    # Core placeholders
    xml_str = xml_str.replace("{{VM_NAME}}", vm_name)
    xml_str = xml_str.replace("{{IMAGE_PATH}}", overlay_path)
    xml_str = xml_str.replace("{{UEFI_MEMORY_PATH}}", uefi_memory_path)
    xml_str = xml_str.replace("{{IMAGE_NAME}}", vm_name)

    for iface_id, bridge in iface_bridges.items():
        xml_str = xml_str.replace(f"{{{{IFACE_{iface_id}_BRIDGE}}}}", bridge)
    for iface_id, mac in iface_macs.items():
        xml_str = xml_str.replace(f"{{{{IFACE_{iface_id}_MAC}}}}", mac)

    # Legacy compat
    props = nd.get("properties", {})
    cid = int(props.get("chassis-id", 0))
    sid = int(props.get("slot-id", 0))
    xml_str = xml_str.replace("{{MAC_SUFFIX}}", f"{cid:02x}:{sid:02x}")
    xml_str = xml_str.replace("{{UP_BRIDGE}}", iface_bridges.get("up", ""))
    xml_str = xml_str.replace("{{DOWN_BRIDGE}}", iface_bridges.get("down", ""))

    xml_str = xml_str.replace(
        "<driver name='qemu' type='raw' />",
        "<driver name='qemu' type='qcow2' />",
    )

    xml_file = os.path.join(temp_dir, f"{vm_name}.xml")
    with open(xml_file, "w") as f:
        f.write(xml_str)

    # Destroy + undefine stale domain
    subprocess.run(
        ["virsh", "-c", shared.LIBVIRT_URI, "destroy", vm_name],
        capture_output=True,
        env=shared.C_ENV,
        check=False,
    )
    subprocess.run(
        ["virsh", "-c", shared.LIBVIRT_URI, "undefine", "--nvram", vm_name],
        capture_output=True,
        env=shared.C_ENV,
        check=False,
    )

    # Define
    result = subprocess.run(
        ["virsh", "-c", shared.LIBVIRT_URI, "define", "--file", xml_file],
        capture_output=True,
        text=True,
        env=shared.C_ENV,
    )
    if result.returncode != 0:
        return {"ok": False, "error": result.stderr.strip(), "xml_file": xml_file}

    shared.state_tracker.track_vm(vm_name, node_id, "libvirt")

    return {
        "ok": True,
        "vm_name": vm_name,
        "xml_file": xml_file,
        "overlay": overlay_path,
        "backing": backing,
        "interfaces": {
            iid: {"bridge": iface_bridges[iid], "mac": iface_macs[iid]} for iid in iface_bridges
        },
        "detail": result.stdout.strip(),
    }


def apply_container_interfaces(node_id: str) -> dict:
    """For each interface on a container node, resolve the bridge from the
    topology links, ensure a Docker network backed by that bridge exists,
    and connect the container with the IP configured on the interface."""
    if not shared.topology:
        return {"ok": False, "error": "Topology not loaded"}

    node = shared.topology.get_node(node_id)
    if not node:
        return {"ok": False, "error": f"Node '{node_id}' not found"}
    if node.runtime not in (RuntimeBackend.DOCKER, RuntimeBackend.PODMAN):
        return {"ok": False, "error": f"Node '{node_id}' is not a container"}

    nd = node.to_dict()
    drv = shared.registry.get_or_default(node.driver)
    vm_name = resolve_vm_name(nd, drv)

    report: dict = {"ok": True, "connected": [], "skipped": [], "errors": []}

    for iface in node.interfaces:
        try:
            bridge = resolve_bridge_for_iface(node_id, iface.id)
        except ValueError as exc:
            report["errors"].append(f"[{iface.id}] {exc}")
            continue
        docker_net = f"triv-{bridge}"

        ip_cidr = iface.ip or ""
        ip_only = ip_cidr.split("/")[0] if "/" in ip_cidr else ip_cidr or None
        prefix = int(ip_cidr.split("/")[1]) if "/" in ip_cidr else 24
        # Always build a full CIDR for network calculation so bare IPs
        # ("192.168.1.10") don't degrade to /32.
        full_cidr = f"{ip_only}/{prefix}" if ip_only else ip_cidr

        subnet: str | None = None
        gateway: str | None = None
        if ip_only:
            try:
                net_obj = ipaddress.ip_interface(full_cidr).network
                subnet = str(net_obj)
                hosts = list(net_obj.hosts())
                if hosts:
                    # Pick a gateway that does NOT collide with the
                    # container's own IP.  Default to first host; if that
                    # is the same as ip_only, use the last host instead.
                    gw = hosts[0]
                    if str(gw) == ip_only and len(hosts) > 1:
                        gw = hosts[-1]
                    gateway = str(gw) if str(gw) != ip_only else None
            except ValueError:
                pass

        net_ok, net_err = netmod.ensure_docker_network(
            docker_net,
            subnet=subnet,
            gateway=gateway,
            bridge=bridge,
        )
        if not net_ok and net_err:
            report["errors"].append(
                f"[{iface.id}] docker network create {docker_net} (bridge={bridge}): {net_err}"
            )
            continue

        ok, conn_err = netmod.docker_connect(vm_name, docker_net, ip=ip_only)
        if ok:
            entry = f"{iface.id} → {docker_net}"
            if ip_only:
                entry += f" ({ip_cidr})"
            report["connected"].append(entry)
        else:
            report["errors"].append(
                f"[{iface.id}] docker network connect {docker_net} {vm_name}: {conn_err}"
            )

    if report["connected"]:
        netmod.docker_disconnect(vm_name, "bridge")

    report["ok"] = len(report["errors"]) == 0
    if not report["ok"]:
        report["error"] = "\n".join(report["errors"])
    else:
        lines = [f"Connected: {e}" for e in report["connected"]]
        if report["skipped"]:
            lines += [f"Skipped: {e}" for e in report["skipped"]]
        report["detail"] = "\n".join(lines) or "No interfaces configured."
    return report


def cleanup_orphaned_bridges(bridges: list[str]) -> dict:
    """For each bridge, if no interfaces are enslaved, remove it.

    Bridges that were created by network deploy (tracked in state_tracker)
    are never removed here — they are only removed via network undeploy.
    """
    # Collect bridges owned by deployed networks so we never tear them down.
    network_bridges: set[str] = set()
    if shared.state_tracker:
        for br_name, info in shared.state_tracker.state.bridges.items():
            if info.get("link"):  # link == network-def id → network-owned
                network_bridges.add(br_name)

    removed: list[str] = []
    skipped: list[str] = []
    for bridge in bridges:
        if not bridge:
            continue
        if bridge in network_bridges:
            skipped.append(bridge)
            continue
        try:
            r = subprocess.run(
                ["ip", "link", "show", "master", bridge],
                capture_output=True,
                text=True,
                check=False,
            )
            if r.stdout.strip():
                skipped.append(bridge)
                continue
            netmod.remove_bridge(bridge)
            netmod.remove_docker_network(f"triv-{bridge}")
            removed.append(bridge)
        except Exception:
            skipped.append(bridge)
    return {"removed_bridges": removed, "skipped_bridges": skipped}


def remove_container(node_id: str) -> dict:
    """Remove a container and clean up Docker networks that were created for it."""
    if not shared.topology:
        return {"ok": False, "error": "Topology not loaded"}

    node = shared.topology.get_node(node_id)
    if not node:
        return {"ok": False, "error": f"Node '{node_id}' not found"}

    nd = node.to_dict()
    drv = shared.registry.get_or_default(node.driver)
    env_data = load_node_env(nd)
    vm_name = resolve_vm_name(nd, drv, env_data)
    rt = node.runtime.value if node.runtime else "docker"

    triv_nets: list[str] = []
    nets = netmod.get_container_networks(vm_name)
    for net_name in nets:
        if net_name.startswith("triv-"):
            triv_nets.append(net_name)

    r = subprocess.run(
        [rt, "rm", "-f", vm_name],
        capture_output=True,
        text=True,
        check=False,
    )
    if r.returncode != 0:
        err = r.stderr.strip() or r.stdout.strip()
        return {"ok": False, "error": f"docker rm failed: {err}"}

    removed_nets: list[str] = []
    for net_name in triv_nets:
        ok = netmod.remove_docker_network(net_name)
        if ok:
            removed_nets.append(net_name)

    bridges: list[str] = []
    for iface in node.interfaces:
        try:
            bridges.append(resolve_bridge_for_iface(node_id, iface.id))
        except ValueError:
            pass
    bridge_cleanup = cleanup_orphaned_bridges(bridges)

    lines = [f"Removed container: {vm_name}"]
    if removed_nets:
        lines.append(f"Cleaned up networks: {', '.join(removed_nets)}")
    if bridge_cleanup["removed_bridges"]:
        lines.append(f"Cleaned up bridges: {', '.join(bridge_cleanup['removed_bridges'])}")
    return {"ok": True, "detail": "\n".join(lines)}


def define_container(node_id: str) -> dict:
    """Create a Docker container from the node's topology properties."""
    if not shared.topology:
        return {"ok": False, "error": "Topology not loaded"}

    node = shared.topology.get_node(node_id)
    if not node:
        return {"ok": False, "error": f"Node '{node_id}' not found"}
    if node.runtime not in (RuntimeBackend.DOCKER, RuntimeBackend.PODMAN):
        return {"ok": False, "error": f"Node '{node_id}' is not a container node"}

    nd = node.to_dict()
    drv = shared.registry.get_or_default(node.driver)
    env_data = load_node_env(nd)
    vm_name = resolve_vm_name(nd, drv, env_data)
    props = nd.get("properties") or {}
    rt = node.runtime.value

    image = props.get("image", "")
    if not image:
        return {"ok": False, "error": "No 'image' in node properties"}

    # Pull image if not present
    r = subprocess.run([rt, "image", "inspect", image], capture_output=True, check=False)
    if r.returncode != 0:
        print(f"  Pulling image {image}...")
        r = subprocess.run([rt, "pull", image], capture_output=True, text=True, timeout=300)
        if r.returncode != 0:
            return {"ok": False, "error": f"Failed to pull {image}: {r.stderr.strip()}"}

    # Remove stale container
    subprocess.run([rt, "rm", "-f", vm_name], capture_output=True, check=False)

    # Build docker create command
    cmd = [rt, "create", "--name", vm_name]

    net_mode = props.get("network_mode", "bridge")
    cmd += ["--network", net_mode]

    hostname = props.get("hostname", vm_name)
    cmd += ["--hostname", hostname]

    if props.get("privileged"):
        cmd.append("--privileged")

    for cap in props.get("cap_add") or []:
        cmd += ["--cap-add", cap]

    restart = props.get("restart")
    if restart:
        cmd += ["--restart", restart]

    for vol in props.get("volumes") or []:
        cmd += ["-v", vol]

    env_vars = props.get("env_vars") or {}
    if isinstance(env_vars, dict):
        for k, v in env_vars.items():
            cmd += ["-e", f"{k}={v}"]
    elif isinstance(env_vars, list):
        for item in env_vars:
            cmd += ["-e", item]

    cmd.append(image)

    container_cmd = props.get("command", "")
    if container_cmd:
        if isinstance(container_cmd, str):
            cmd += container_cmd.split()
        elif isinstance(container_cmd, list):
            cmd += container_cmd

    print(f"  Creating container: {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        return {"ok": False, "error": result.stderr.strip(), "command": cmd}

    container_id = result.stdout.strip()[:12]

    shared.state_tracker.track_container(vm_name, node_id, rt)

    return {
        "ok": True,
        "vm_name": vm_name,
        "container_id": container_id,
        "image": image,
        "network_mode": net_mode,
    }
