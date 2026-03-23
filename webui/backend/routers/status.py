"""
Router: status — system status overview.
"""

import time

from fastapi import APIRouter

from triv.core.state import detect_orphans

import shared
from shared import state_tracker, registry

router = APIRouter(prefix="/api", tags=["status"])


@router.get("/status")
def get_system_status():
    st = state_tracker.state
    uptime_s = 0
    if st.created_at:
        try:
            created = time.mktime(time.strptime(st.created_at, "%Y-%m-%dT%H:%M:%SZ"))
            uptime_s = int(time.time() - created)
        except Exception:
            pass

    # Lazy import to avoid circular dependency
    from routers.nodes import get_nodes

    nodes_info = get_nodes() if shared.topology else []
    drivers_used = list(shared.topology.drivers_used()) if shared.topology else []

    orphans = detect_orphans()
    has_orphans = any(v for v in orphans.values())

    loops = []
    if shared.topology:
        from triv.core.topology import detect_loops

        loops = detect_loops(shared.topology)

    return {
        "project": st.project,
        "topology_name": st.topology_name or (shared.topology.name if shared.topology else ""),
        "uptime_seconds": uptime_s,
        "node_count": len(shared.topology.nodes) if shared.topology else 0,
        "link_count": len(shared.topology.links) if shared.topology else 0,
        "drivers_used": drivers_used,
        "drivers_available": registry.names,
        "plugins_loaded": shared.plugin_mgr.loaded if shared.plugin_mgr else [],
        "nodes": nodes_info,
        "health": {
            "loops": loops,
            "orphans": orphans,
            "has_orphans": has_orphans,
            "bridge_count": len(st.bridges),
            "vlan_count": len(st.vlan_ifaces),
        },
    }
