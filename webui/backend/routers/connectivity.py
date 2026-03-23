"""
Router: connectivity — ping / HTTP checks between topology nodes.
"""

import re
import subprocess

from fastapi import APIRouter, HTTPException


import shared
from shared import registry
from node_helpers import resolve_vm_name

router = APIRouter(prefix="/api", tags=["connectivity"])


# ── Helpers ──────────────────────────────────────────────────────


def _collect_pingable_ips() -> dict[str, list[dict]]:
    result: dict[str, list[dict]] = {}
    if not shared.topology:
        return result
    for node in shared.topology.nodes:
        ips: list[dict] = []
        for iface in node.interfaces:
            if iface.ip:
                ips.append(
                    {
                        "ip": iface.ip,
                        "label": iface.label or iface.id,
                        "interface_id": iface.id,
                    }
                )
        if ips:
            result[node.id] = ips
    return result


def _ping(ip: str, count: int = 2, timeout: int = 2) -> dict:
    try:
        result = subprocess.run(
            ["ping", "-c", str(count), "-W", str(timeout), ip],
            capture_output=True,
            text=True,
            timeout=count * timeout + 2,
        )
        rtt = None
        for line in result.stdout.splitlines():
            if "avg" in line:
                parts = line.split("=")
                if len(parts) >= 2:
                    vals = parts[-1].strip().split("/")
                    if len(vals) >= 2:
                        try:
                            rtt = float(vals[1])
                        except ValueError:
                            pass
        return {"reachable": result.returncode == 0, "rtt_ms": rtt}
    except (subprocess.TimeoutExpired, Exception):
        return {"reachable": False, "rtt_ms": None}


def _ping_from_node(
    container: str, ip: str, runtime: str = "docker", count: int = 2, timeout: int = 2
) -> dict:
    if runtime in ("docker", "podman"):
        cmd = [runtime, "exec", container, "sh", "-c", f"ping -c {count} -W {timeout} {ip}"]
    elif runtime == "libvirt":
        return _ping(ip, count, timeout)
    else:
        return _ping(ip, count, timeout)

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=count * timeout + 5)
        rtt = None
        for line in result.stdout.splitlines():
            if "avg" in line:
                parts = line.split("=")
                if len(parts) >= 2:
                    vals = parts[-1].strip().split("/")
                    if len(vals) >= 2:
                        try:
                            rtt = float(vals[1])
                        except ValueError:
                            pass
        return {"reachable": result.returncode == 0, "rtt_ms": rtt}
    except (subprocess.TimeoutExpired, Exception):
        return {"reachable": False, "rtt_ms": None}


def _http_check_from_node(
    container: str,
    url: str,
    runtime: str = "docker",
    method: str = "HEAD",
    timeout: int = 5,
    expected_status: int = 200,
    auth: str | None = None,
) -> dict:
    curl_cmd = f"curl -s -o /dev/null -w '%{{http_code}}' -X {method} --max-time {timeout}"
    if auth:
        curl_cmd += f" -u {auth}"
    curl_cmd += f" '{url}'"

    if runtime in ("docker", "podman"):
        cmd = [runtime, "exec", container, "sh", "-c", curl_cmd]
    else:
        cmd = ["sh", "-c", curl_cmd]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout + 5)
        status_str = result.stdout.strip().strip("'")
        try:
            status_code = int(status_str)
        except ValueError:
            return {
                "reachable": False,
                "status_code": None,
                "detail": f"curl returned: {status_str}",
            }
        ok = status_code == expected_status
        return {
            "reachable": ok,
            "status_code": status_code,
            "detail": f"HTTP {status_code}" + ("" if ok else f" (expected {expected_status})"),
        }
    except subprocess.TimeoutExpired:
        return {"reachable": False, "status_code": None, "detail": "timeout"}
    except Exception as exc:
        return {"reachable": False, "status_code": None, "detail": str(exc)}


def _resolve_check_vars(template: str, src_node, tgt_node, link, topo) -> str:
    def _node_iface_ip(node, iface_id: str) -> str:
        for iface in node.interfaces:
            if iface.id == iface_id and iface.ip:
                return iface.ip
        return ""

    def _link_ep_ip(node, ep) -> str:
        return _node_iface_ip(node, ep.interface)

    def _replacer(m: re.Match) -> str:
        expr = m.group(1)
        if expr.startswith("target.ip."):
            return _node_iface_ip(tgt_node, expr[10:])
        if expr.startswith("source.ip."):
            return _node_iface_ip(src_node, expr[10:])
        if expr == "target.ip":
            return _link_ep_ip(tgt_node, link.target)
        if expr == "source.ip":
            return _link_ep_ip(src_node, link.source)
        if expr.startswith("target.prop."):
            return str((tgt_node.properties or {}).get(expr[12:], ""))
        if expr.startswith("source.prop."):
            return str((src_node.properties or {}).get(expr[12:], ""))
        return m.group(0)

    return re.sub(r"\$\{([^}]+)\}", _replacer, template)


def _resolve_node_for_check(from_spec, src_node, tgt_node, topo):
    if from_spec == "source":
        node = src_node
    elif from_spec == "target":
        node = tgt_node
    else:
        node = topo.get_node(from_spec)
    if not node:
        return None
    rt = node.runtime
    if not rt:
        return None
    nd = node.to_dict()
    drv = registry.get_or_default(node.driver)
    vm_name = resolve_vm_name(nd, drv)
    return (node.id, vm_name, rt.value if hasattr(rt, "value") else str(rt))


def _run_link_check(link, topo) -> dict | None:
    net_cfg = link.network or {}
    check_cfg = net_cfg.get("connectivity_check")
    if check_cfg is None:
        return None

    src_node = topo.get_node(link.source.node)
    tgt_node = topo.get_node(link.target.node)
    if not src_node or not tgt_node:
        return None

    method = check_cfg.get("method", "ping")
    from_spec = check_cfg.get("from", "source")
    timeout = check_cfg.get("timeout", 5)
    probe = _resolve_node_for_check(from_spec, src_node, tgt_node, topo)

    if method == "ping":
        target_ip = check_cfg.get("target_ip")
        if not target_ip:
            if from_spec == "source":
                for iface in tgt_node.interfaces:
                    if iface.id == link.target.interface and iface.ip:
                        target_ip = iface.ip
                        break
            else:
                for iface in src_node.interfaces:
                    if iface.id == link.source.interface and iface.ip:
                        target_ip = iface.ip
                        break
        if not target_ip:
            return {
                "reachable": False,
                "detail": "no target IP for ping",
                "method": "ping",
                "check": check_cfg,
            }
        if probe:
            pr = _ping_from_node(probe[1], target_ip, probe[2], timeout=timeout)
        else:
            pr = _ping(target_ip, timeout=timeout)
        return {
            **pr,
            "method": "ping",
            "from": probe[0] if probe else "host",
            "target_ip": target_ip,
            "check": check_cfg,
        }

    elif method in ("http-head", "http-get"):
        url_template = check_cfg.get("url", "")
        url = _resolve_check_vars(url_template, src_node, tgt_node, link, topo)
        auth = check_cfg.get("auth")
        expected = check_cfg.get("expected_status", 200)
        http_method = "HEAD" if method == "http-head" else "GET"
        if probe:
            pr = _http_check_from_node(
                probe[1],
                url,
                probe[2],
                method=http_method,
                timeout=timeout,
                expected_status=expected,
                auth=auth,
            )
        else:
            pr = _http_check_from_node(
                "",
                url,
                "host",
                method=http_method,
                timeout=timeout,
                expected_status=expected,
                auth=auth,
            )
        return {
            **pr,
            "method": method,
            "from": probe[0] if probe else "host",
            "url": url,
            "check": check_cfg,
        }
    return None


def _find_probe_node():
    if not shared.topology:
        return None
    candidates = []
    for node in shared.topology.nodes:
        rt = node.runtime
        if not rt or rt.value not in ("docker", "podman"):
            continue
        nd = node.to_dict()
        drv = registry.get_or_default(node.driver)
        vm_name = resolve_vm_name(nd, drv)
        try:
            st = subprocess.run(
                [rt.value, "inspect", "-f", "{{.State.Status}}", vm_name],
                capture_output=True,
                text=True,
            )
            if st.stdout.strip() != "running":
                continue
        except Exception:
            continue
        mgmt_count = sum(1 for iface in node.interfaces if iface.type == "ethernet" and iface.ip)
        candidates.append((node.id, vm_name, rt.value, mgmt_count))

    if not candidates:
        return None
    candidates.sort(key=lambda c: c[3], reverse=True)
    best = candidates[0]
    return (best[0], best[1], best[2])


# ── Endpoints ────────────────────────────────────────────────────


@router.get("/connectivity")
def get_connectivity():
    if not shared.topology:
        return {"links": []}

    link_results: list[dict] = []
    for link in shared.topology.links:
        src_node = shared.topology.get_node(link.source.node)
        tgt_node = shared.topology.get_node(link.target.node)
        if not src_node or not tgt_node:
            continue

        src_ip = None
        tgt_ip = None
        for iface in src_node.interfaces:
            if iface.id == link.source.interface and iface.ip:
                src_ip = iface.ip
        for iface in tgt_node.interfaces:
            if iface.id == link.target.interface and iface.ip:
                tgt_ip = iface.ip

        custom = _run_link_check(link, shared.topology)
        if custom is not None:
            link_results.append(
                {
                    "link_id": link.id,
                    "label": link.label or link.id,
                    "type": link.type,
                    "source": {
                        "node": link.source.node,
                        "interface": link.source.interface,
                        "ip": src_ip,
                    },
                    "target": {
                        "node": link.target.node,
                        "interface": link.target.interface,
                        "ip": tgt_ip,
                    },
                    "reachable": custom.get("reachable"),
                    "status": "ok" if custom.get("reachable") else "fail",
                    "detail": custom.get("detail", ""),
                    "method": custom.get("method"),
                    "from_node": custom.get("from"),
                    "check_result": custom,
                }
            )
        else:
            link_results.append(
                {
                    "link_id": link.id,
                    "label": link.label or link.id,
                    "type": link.type,
                    "source": {
                        "node": link.source.node,
                        "interface": link.source.interface,
                        "ip": src_ip,
                    },
                    "target": {
                        "node": link.target.node,
                        "interface": link.target.interface,
                        "ip": tgt_ip,
                    },
                    "reachable": None,
                    "status": "no-check",
                    "detail": "No connectivity_check defined for this link",
                    "method": None,
                    "from_node": None,
                    "check_result": None,
                }
            )
    return {"links": link_results}


@router.get("/ping/{node_id}")
def ping_node(node_id: str):
    if not shared.topology:
        raise HTTPException(404, "Topology not loaded")
    node = shared.topology.get_node(node_id)
    if not node:
        raise HTTPException(404, f"Node '{node_id}' not found")

    probe = _find_probe_node()
    probe_name = probe[1] if probe else None
    probe_rt = probe[2] if probe else None

    results = []
    for iface in node.interfaces:
        if iface.ip:
            if probe_name:
                pr = _ping_from_node(probe_name, iface.ip, probe_rt)
            else:
                pr = _ping(iface.ip)
            results.append(
                {
                    "interface": iface.id,
                    "label": iface.label or iface.id,
                    "ip": iface.ip,
                    "reachable": pr["reachable"],
                    "rtt_ms": pr["rtt_ms"],
                }
            )
    return {
        "node_id": node_id,
        "probe": {"node_id": probe[0], "container": probe_name} if probe else None,
        "results": results,
        "all_reachable": all(r["reachable"] for r in results) if results else False,
    }
