"""
Auto-reconcile: track resources that exist on the host.

Covers resources created by the old run_image.py or manually
before state-tracking was introduced.
"""

import glob as _glob
import subprocess

from triv.core import network as netmod
from triv.core.state import _is_triv_bridge

import shared


def reconcile_state() -> None:
    """Scan running VMs, bridges, vlans and temp dirs that match the
    topology, and make sure they are tracked in state.json."""
    if not shared.topology:
        return

    changed = False

    # 1) Running VMs for topology nodes
    for node in shared.topology.nodes:
        nd = node.__dict__ if hasattr(node, "__dict__") else node
        runtime = nd.get("runtime")
        if runtime != "libvirt":
            continue
        drv = shared.registry.get_or_default(nd.get("driver", "generic"))
        vm_name = drv.vm_name(nd)
        if vm_name and vm_name not in shared.state_tracker.state.vms:
            try:
                r = subprocess.run(
                    ["virsh", "-c", shared.LIBVIRT_URI, "domstate", vm_name],
                    capture_output=True,
                    text=True,
                    env=shared.C_ENV,
                )
                if r.returncode == 0:
                    shared.state_tracker.track_vm(vm_name, nd.get("id", ""), "libvirt")
                    changed = True
            except Exception:
                pass

    # 2) Containers for topology nodes (docker/podman)
    for node in shared.topology.nodes:
        nd = node.__dict__ if hasattr(node, "__dict__") else node
        runtime = nd.get("runtime")
        if runtime not in ("docker", "podman"):
            continue
        drv = shared.registry.get_or_default(nd.get("driver", "generic"))
        cname = (nd.get("properties") or {}).get("container-name")
        if not cname and drv:
            cname = drv.vm_name(nd)
        if cname and cname not in shared.state_tracker.state.containers:
            try:
                r = subprocess.run(
                    [runtime, "inspect", "-f", "{{.State.Status}}", cname],
                    capture_output=True,
                    text=True,
                )
                if r.returncode == 0:
                    shared.state_tracker.track_container(cname, nd.get("id", ""), runtime)
                    changed = True
            except Exception:
                pass

    # 3) Bridges from topology links (qualified names)
    pid = shared.topology.project_id if shared.topology else ""
    for link in shared.topology.links:
        br_logical = link.bridge_name
        br_name = netmod.qualify_bridge(br_logical, pid)
        if br_name and br_name not in shared.state_tracker.state.bridges:
            st = netmod.get_bridge_state(br_name)
            if st and st != "unknown":
                shared.state_tracker.track_bridge(br_name, link.id)
                changed = True

    # 4) Triv-prefixed bridges on host
    try:
        out = subprocess.run(
            ["ip", "-br", "link", "show", "type", "bridge"],
            capture_output=True,
            text=True,
            env=shared.C_ENV,
        ).stdout
        for line in out.splitlines():
            parts = line.split()
            if not parts:
                continue
            name = parts[0]
            if _is_triv_bridge(name) and name not in shared.state_tracker.state.bridges:
                shared.state_tracker.track_bridge(name, None)
                changed = True
    except Exception:
        pass

    # 5) VLAN interfaces (vchs.*)
    try:
        out = subprocess.run(
            ["ip", "-br", "link", "show"],
            capture_output=True,
            text=True,
            env=shared.C_ENV,
        ).stdout
        for line in out.splitlines():
            name = line.split()[0].split("@")[0]
            if name.startswith("vchs.") and name not in shared.state_tracker.state.vlan_ifaces:
                shared.state_tracker.track_vlan_iface(name, "", "", "")
                changed = True
    except Exception:
        pass

    # 6) Temp dirs
    for prefix in ("/tmp/run_triv-",):
        for d in _glob.glob(prefix + "*"):
            if d not in shared.state_tracker.state.temp_dirs:
                shared.state_tracker.track_temp_dir(d)
                changed = True

    if changed:
        print(f"[reconcile] Auto-tracked existing resources into {shared.state_tracker.path}")

    # Also update project info
    if shared.topology and not shared.state_tracker.state.topology_name:
        shared.state_tracker.init_project(str(shared.PROJECT_DIR), shared.topology.name or "")
