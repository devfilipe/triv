"""
Background health-check loop and helpers.
"""

import subprocess
import time

from triv.core import env as env_mod

import shared


def run_health_check(node_id: str, health_cfg: dict, vm_name: str) -> dict:
    """Execute one health check and return the result dict."""
    htype = health_cfg.get("type", "docker")
    timeout = int(health_cfg.get("timeout", 5))

    try:
        if htype == "docker":
            r = subprocess.run(
                ["docker", "inspect", "--format", "{{.State.Health.Status}}", vm_name],
                capture_output=True,
                text=True,
                timeout=timeout,
            )
            if r.returncode != 0:
                return {"status": "unknown", "error": r.stderr.strip()}
            raw = r.stdout.strip()
            status = raw if raw else "none"
            return {"status": status, "error": None}

        elif htype == "exec":
            cmd = health_cfg.get("command", "")
            if not cmd:
                return {"status": "unknown", "error": "No command configured"}
            r = subprocess.run(
                cmd,
                shell=True,
                capture_output=True,
                text=True,
                timeout=timeout,
                env=shared.C_ENV,
            )
            if r.returncode == 0:
                return {"status": "healthy", "error": None}
            return {"status": "unhealthy", "error": (r.stderr or r.stdout).strip()[:200]}

        return {"status": "unknown", "error": f"Unknown health type: {htype}"}

    except subprocess.TimeoutExpired:
        return {"status": "unhealthy", "error": f"Health check timed out ({timeout}s)"}
    except Exception as e:
        return {"status": "unknown", "error": str(e)}


def health_check_loop() -> None:
    """Background thread: periodically run health checks for all nodes that
    declare a ``health`` section in their env file.
    """
    while True:
        time.sleep(10)
        if not shared.topology:
            continue
        for node in shared.topology.nodes:
            if not node.runtime:
                continue
            nd = node.to_dict()
            env_data = env_mod.load_env(nd.get("env"), str(shared.PROJECT_DIR))
            health_cfg = env_data.get("health")
            if not health_cfg:
                continue
            interval = int(health_cfg.get("interval", 30))
            if not _health_check_due(node.id, interval):
                continue
            from node_helpers import resolve_vm_name

            drv = shared.registry.get_or_default(node.driver)
            vm_name = resolve_vm_name(nd, drv, env_data) or nd["id"]
            result = run_health_check(node.id, health_cfg, vm_name)
            result["last_check"] = time.time()
            with shared._health_lock:
                shared._health_cache[node.id] = result


def _health_check_due(node_id: str, interval: int) -> bool:
    """Return True if a health check is due for this node."""
    with shared._health_lock:
        cached = shared._health_cache.get(node_id)
    if not cached:
        return True
    return (time.time() - cached.get("last_check", 0)) >= interval
