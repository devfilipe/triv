"""
Router: segments — host-access helpers shared across cleanup and project routers.
"""

import triv.core.network as netmod


def _disconnect_host_from_segment(seg, pid: str) -> dict:
    """Remove host access from a segment (VLAN iface or host IP on bridge)."""
    hn = seg.host_network
    report: dict = {"segment": seg.id, "removed": [], "errors": []}

    vlan_id = hn.get("vlan")
    host_ip = hn.get("ip")
    via_bridge = hn.get("via_bridge", "")
    br_qual = netmod.qualify_bridge(via_bridge, pid) if via_bridge else ""

    if vlan_id:
        iface = f"vchs.{vlan_id}"
        if netmod._iface_exists(iface):
            netmod._sudo(f"ip link del {iface}", check=False)
            report["removed"].append(f"vlan:{iface}")
    elif host_ip and br_qual:
        prefix = hn.get("prefix", 24)
        netmod._sudo(f"ip addr del {host_ip}/{prefix} dev {br_qual}", check=False)
        report["removed"].append(f"host-ip:{host_ip}/{prefix}@{br_qual}")

    return report
