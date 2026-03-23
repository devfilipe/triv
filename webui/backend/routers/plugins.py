"""
Router: plugins — list loaded plugins.
"""

from fastapi import APIRouter

import shared

router = APIRouter(prefix="/api", tags=["plugins"])


@router.get("/plugins")
def get_plugins():
    pm = shared.plugin_mgr
    if not pm:
        return []
    return [
        {
            "name": n,
            "version": pm.get(n).version if pm.get(n) else "",
            "description": pm.get(n).description if pm.get(n) else "",
        }
        for n in pm.loaded
    ]
