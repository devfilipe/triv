"""
Router: cleanup — full teardown of VMs, containers, networking, segments.
"""

from fastapi import APIRouter

from triv.core.state import Cleanup
import triv.core.network as netmod

import shared
from shared import state_tracker

router = APIRouter(prefix="/api", tags=["cleanup"])


@router.post("/cleanup/dry-run")
def cleanup_dry_run():
    c = Cleanup()
    return {"steps": [{"kind": k, "cmd": cmd, "target": t} for k, cmd, t in c.plan()]}


@router.post("/cleanup")
def cleanup_all():
    from routers.segments import _disconnect_host_from_segment
    from routers.projects import _load_projects, _save_projects

    all_errors: list[str] = []

    if shared.topology and shared.topology.segments:
        pid = shared.topology.project_id
        for seg in shared.topology.segments:
            if seg.host_access and seg.host_network:
                try:
                    _disconnect_host_from_segment(seg, pid)
                except Exception as e:
                    all_errors.append(f"host-disconnect {seg.id}: {e}")
            for link_id in seg.links:
                link = next((lk for lk in shared.topology.links if lk.id == link_id), None)
                if link:
                    try:
                        netmod.teardown_link(link, state_tracker, project_id=pid)
                    except Exception as e:
                        all_errors.append(f"teardown link {link_id}: {e}")

    if shared.topology:
        pid = shared.topology.project_id
        for link in shared.topology.links:
            try:
                netmod.teardown_link(link, state_tracker, project_id=pid)
            except Exception:
                pass

    c = Cleanup()
    try:
        state_errors = c.teardown_all(dry_run=False)
        all_errors.extend(state_errors)
    except Exception as e:
        all_errors.append(f"state-cleanup: {e}")

    shared.topology = None
    try:
        data = _load_projects()
        data["active"] = ""
        _save_projects(data)
    except Exception:
        pass

    return {"ok": len(all_errors) == 0, "errors": all_errors, "deactivated": True}
