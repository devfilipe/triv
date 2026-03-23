"""triv.drivers.generic_netcfg — Generic Linux network configuration driver.

Reads IP addresses from each interface's ``ip`` field in the topology
and applies them to the corresponding guest network device using
``ip addr`` / ``ip link`` commands executed inside the container.

Driver args
-----------
  iface_map          Topology-interface-ID → guest-device-name mapping.
  default_prefix     CIDR prefix length when the IP has none (default 24).
  default_gateway    Optional default-gateway IP.
  dns                Comma-separated DNS server IPs.
  flush_before_apply Flush existing IPs before applying (default true).
"""

from __future__ import annotations

import re
import subprocess

from .base import Branding, DeviceCommand, DriverBase

_IP_RE = re.compile(r"^\d{1,3}(\.\d{1,3}){3}$")


# ── Helpers ──────────────────────────────────────────────────────────


def _parse_iface_map(raw: str) -> dict[str, str]:
    """Parse ``'topo-id:guest-dev, …'`` into ``{topo_id: guest_dev}``."""
    mapping: dict[str, str] = {}
    for pair in raw.split(","):
        pair = pair.strip()
        if ":" not in pair:
            continue
        topo_id, guest_dev = pair.split(":", 1)
        mapping[topo_id.strip()] = guest_dev.strip()
    return mapping


def _exec_in_guest(
    runtime: str,
    vm_name: str,
    cmd: list[str],
    timeout: int = 30,
    stdin_data: str | None = None,
) -> subprocess.CompletedProcess[str]:
    """Execute *cmd* inside the guest (docker/podman only for now)."""
    if runtime not in ("docker", "podman"):
        raise RuntimeError(f"Unsupported runtime '{runtime}' for netcfg")
    prefix = [runtime, "exec"]
    if stdin_data is not None:
        prefix.append("-i")
    prefix.append(vm_name)
    return subprocess.run(
        prefix + cmd,
        capture_output=True,
        text=True,
        timeout=timeout,
        input=stdin_data,
    )


# ── Driver ───────────────────────────────────────────────────────────


class GenericNetcfgDriver(DriverBase):
    """Configure IP addresses and routes inside containers/VMs."""

    name = "generic-driver-netcfg"
    vendor = "triv"
    version = "1.0.0"

    # ── Identity ─────────────────────────────────────────────────

    def metadata(self) -> Branding:
        return Branding(
            vendor_name="triv",
            driver_label="Generic Linux Network",
            accent_color="#a6e3a1",
        )

    def driver_type(self) -> str:
        return "netcfg"

    def driver_args_schema(self) -> dict:
        return {
            "iface_map": {
                "type": "string",
                "label": "Interface Map",
                "description": (
                    "Map topology interface IDs to guest device names.  "
                    "Format: topo-id:guest-dev, …  "
                    "Example: mgmt:eth0,data:eth1"
                ),
                "required": False,
                "placeholder": "iface-0:eth1,iface-1:eth2",
            },
            "default_prefix": {
                "type": "string",
                "label": "Default Prefix Length",
                "description": (
                    "CIDR prefix appended when interface IP has no /prefix (e.g. 24 → /24)"
                ),
                "required": False,
                "default": "24",
                "placeholder": "24",
            },
            "default_gateway": {
                "type": "string",
                "label": "Default Gateway",
                "description": "Default gateway IP to configure after applying",
                "required": False,
                "placeholder": "10.0.0.1",
            },
            "dns": {
                "type": "string",
                "label": "DNS Servers",
                "description": "Comma-separated DNS server IPs",
                "required": False,
                "placeholder": "8.8.8.8,8.8.4.4",
            },
            "flush_before_apply": {
                "type": "boolean",
                "label": "Flush Before Apply",
                "description": "Flush existing IPs from each interface before applying",
                "required": False,
                "default": True,
            },
        }

    # ── VM name ──────────────────────────────────────────────────

    def vm_name(self, node: dict, env_data: dict | None = None) -> str:
        props = node.get("properties") or {}
        container_name = props.get("container-name")
        if container_name and node.get("runtime") in ("docker", "podman"):
            return container_name
        return f"triv-{node['id']}"

    # ── Commands ─────────────────────────────────────────────────

    def commands(self) -> list[DeviceCommand]:
        return [
            DeviceCommand(
                name="apply-ip-config",
                label="Apply IP Config",
                icon="upload",
                description="Configure IPs on guest interfaces from topology data",
            ),
            DeviceCommand(
                name="show-ip-config",
                label="Show IP Config",
                icon="info",
                description="Show current IP configuration inside the guest",
            ),
            DeviceCommand(
                name="link-up",
                label="Link Up All",
                icon="wifi",
                description="Bring all mapped interfaces up",
            ),
            DeviceCommand(
                name="link-down",
                label="Link Down All",
                icon="wifi-off",
                description="Bring all mapped interfaces down",
            ),
        ]

    # ── Command dispatch ─────────────────────────────────────────

    def run_command(
        self,
        cmd_name: str,
        node: dict,
        env_data: dict,
        project_dir: str = "",
    ) -> dict:
        runtime = node.get("runtime", "")
        if runtime not in ("docker", "podman"):
            return {
                "ok": False,
                "error": (
                    f"Unsupported runtime: {runtime or 'none'}.  Only docker/podman supported."
                ),
            }

        vm = self.vm_name(node, env_data)
        args = (env_data or {}).get("driver_args", {})

        if cmd_name == "apply-ip-config":
            return self._apply_ip_config(runtime, vm, node, args)
        if cmd_name == "show-ip-config":
            return self._show_ip_config(runtime, vm)
        if cmd_name == "link-up":
            return self._set_links(runtime, vm, node, args, up=True)
        if cmd_name == "link-down":
            return self._set_links(runtime, vm, node, args, up=False)

        return {"ok": False, "error": f"Unknown command: {cmd_name}"}

    # ── Private helpers ──────────────────────────────────────────

    def _resolve_iface_map(self, node: dict, args: dict) -> dict[str, str]:
        raw = args.get("iface_map", "")
        if raw:
            return _parse_iface_map(raw)
        # Fallback: use interface id as guest device name
        return {ifc["id"]: ifc["id"] for ifc in node.get("interfaces", [])}

    def _apply_ip_config(self, rt: str, vm: str, node: dict, args: dict) -> dict:
        imap = self._resolve_iface_map(node, args)
        default_pfx = str(args.get("default_prefix", "24"))
        flush = args.get("flush_before_apply", True)
        results: list[str] = []
        errors: list[str] = []

        for ifc in node.get("interfaces", []):
            ip_raw = ifc.get("ip")
            if not ip_raw:
                continue

            topo_id = ifc["id"]
            dev = imap.get(topo_id)
            if not dev:
                results.append(f"⚠ {topo_id}: no mapping, skipped")
                continue

            # Normalise to CIDR
            ip_cidr = ip_raw if "/" in ip_raw else f"{ip_raw}/{default_pfx}"

            try:
                if flush:
                    _exec_in_guest(rt, vm, ["ip", "addr", "flush", "dev", dev])

                r = _exec_in_guest(rt, vm, ["ip", "addr", "add", ip_cidr, "dev", dev])
                if r.returncode != 0:
                    err = r.stderr.strip()
                    if "File exists" not in err:
                        errors.append(f"{dev}: {err}")
                        continue

                r = _exec_in_guest(rt, vm, ["ip", "link", "set", dev, "up"])
                if r.returncode != 0:
                    errors.append(f"{dev} link up: {r.stderr.strip()}")
                    continue

                results.append(f"✓ {dev} ← {ip_cidr}")

            except subprocess.TimeoutExpired:
                errors.append(f"{dev}: timeout")
            except Exception as exc:
                errors.append(f"{dev}: {exc}")

        # Default gateway
        gw = args.get("default_gateway", "")
        if gw:
            try:
                r = _exec_in_guest(
                    rt,
                    vm,
                    ["ip", "route", "replace", "default", "via", gw],
                )
                if r.returncode == 0:
                    results.append(f"✓ default gw → {gw}")
                else:
                    errors.append(f"gateway: {r.stderr.strip()}")
            except Exception as exc:
                errors.append(f"gateway: {exc}")

        # DNS — write /etc/resolv.conf via stdin (no shell interpolation)
        dns_raw = args.get("dns", "")
        if dns_raw:
            nameservers = [s.strip() for s in dns_raw.split(",") if s.strip()]
            valid_ns = []
            for ns in nameservers:
                if _IP_RE.match(ns):
                    valid_ns.append(ns)
                else:
                    errors.append(f"dns: invalid server '{ns}'")
            if valid_ns:
                content = "".join(f"nameserver {ns}\n" for ns in valid_ns)
                try:
                    r = _exec_in_guest(
                        rt,
                        vm,
                        ["tee", "/etc/resolv.conf"],
                        stdin_data=content,
                    )
                    if r.returncode == 0:
                        results.append(f"✓ DNS → {', '.join(valid_ns)}")
                    else:
                        errors.append(f"dns: {r.stderr.strip()}")
                except Exception as exc:
                    errors.append(f"dns: {exc}")

        ok = len(errors) == 0
        lines = results
        if errors:
            lines = results + ["--- errors ---"] + errors
        detail = "\n".join(lines) or (
            "Nothing to apply — no interfaces have an IP" if not results else "Done"
        )
        return {"ok": ok, "detail": detail, "output_type": "panel"}

    def _show_ip_config(self, rt: str, vm: str) -> dict:
        try:
            r = _exec_in_guest(rt, vm, ["ip", "addr", "show"], timeout=10)
            output = r.stdout if r.returncode == 0 else r.stderr
            return {
                "ok": r.returncode == 0,
                "detail": output,
                "output_type": "panel",
            }
        except subprocess.TimeoutExpired:
            return {"ok": False, "error": "Timed out"}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def _set_links(self, rt: str, vm: str, node: dict, args: dict, *, up: bool) -> dict:
        imap = self._resolve_iface_map(node, args)
        state = "up" if up else "down"
        results: list[str] = []
        errors: list[str] = []

        for topo_id, dev in imap.items():
            try:
                r = _exec_in_guest(rt, vm, ["ip", "link", "set", dev, state])
                if r.returncode == 0:
                    results.append(f"✓ {dev} → {state}")
                else:
                    errors.append(f"{dev}: {r.stderr.strip()}")
            except Exception as exc:
                errors.append(f"{dev}: {exc}")

        ok = len(errors) == 0
        detail = "\n".join(results + errors) or f"All links {state}"
        return {"ok": ok, "detail": detail, "output_type": "panel"}
