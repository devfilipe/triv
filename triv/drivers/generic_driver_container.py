"""triv.drivers.generic_container — Built-in generic py-driver for Docker/Podman containers.

Extends the GenericDriver with container-specific lifecycle operations
and driver_args schema.  The schema defines which parameters the
actions and lifecycle hooks expect from the capabilities file.

Container lifecycle commands (create, remove, connect-network,
disconnect-network) are implemented as ``run_command()`` methods so
that the JSON driver can reference them via ``type: driver-command``
and the UI always shows an informational command string.
"""

from __future__ import annotations

import ipaddress
import subprocess
from typing import Any

from triv.core import network as netmod
from .base import Branding, DeviceCommand, DriverBase


# ── driver_args schema ────────────────────────────────────────────

DRIVER_ARGS_SCHEMA: dict[str, dict] = {
    "image": {
        "type": "string",
        "label": "Container Image",
        "description": "Docker/OCI image reference (e.g. alpine:latest)",
        "required": True,
        "placeholder": "alpine:latest",
    },
    "command": {
        "type": "string",
        "label": "Command",
        "description": "Override the container entrypoint/command",
        "required": False,
        "placeholder": "",
    },
    "network_mode": {
        "type": "string",
        "label": "Network Mode",
        "description": "Docker network mode: bridge, host, none, or a custom network name",
        "required": False,
        "default": "bridge",
    },
    "hostname": {
        "type": "string",
        "label": "Hostname",
        "description": "Container hostname. Uses vm_name if empty.",
        "required": False,
        "placeholder": "",
    },
    "privileged": {
        "type": "boolean",
        "label": "Privileged",
        "description": "Run container in privileged mode",
        "required": False,
        "default": False,
    },
    "cap_add": {
        "type": "string",
        "label": "Capabilities (cap_add)",
        "description": "Comma-separated list of Linux capabilities to add",
        "required": False,
        "placeholder": "NET_ADMIN,SYS_ADMIN",
    },
    "restart": {
        "type": "string",
        "label": "Restart Policy",
        "description": "Container restart policy: no, always, unless-stopped, on-failure",
        "required": False,
        "default": "no",
    },
    "volumes": {
        "type": "string",
        "label": "Volumes",
        "description": "Comma-separated volume mounts (host:container format)",
        "required": False,
        "placeholder": "/data:/mnt/data",
    },
    "env_vars": {
        "type": "string",
        "label": "Environment Variables",
        "description": "Comma-separated KEY=VALUE pairs",
        "required": False,
        "placeholder": "TZ=UTC,DEBUG=1",
    },
    "ports": {
        "type": "string",
        "label": "Port Mappings",
        "description": "Comma-separated host:container port mappings",
        "required": False,
        "placeholder": "8080:80,443:443",
    },
}


class GenericContainerDriver(DriverBase):
    """Generic py-driver for Docker/Podman containers."""

    name = "generic-driver-container-python"
    vendor = "triv"
    version = "1.0.0"

    # ── Type identifier (matches runtime) ────────────────────────
    @staticmethod
    def driver_type() -> str:
        """Return the runtime type this driver is designed for."""
        return "container"

    # ── driver_args schema ───────────────────────────────────────
    @staticmethod
    def driver_args_schema() -> dict[str, dict]:
        return DRIVER_ARGS_SCHEMA

    # ── Identity ─────────────────────────────────────────────────

    def metadata(self) -> Branding:
        return Branding(
            vendor_name="triv",
            driver_label="Generic Container",
            accent_color="#89b4fa",
        )

    def vm_name(self, node: dict, env_data: dict | None = None) -> str:
        if node.get("vm_name"):
            return node["vm_name"]
        args = (env_data or {}).get("driver_args", {})
        if args.get("container-name"):
            return args["container-name"]
        return f"triv-{node['id']}"

    # ── Container config ─────────────────────────────────────────

    def container_image(self, node: dict, env_data: dict | None = None) -> str | None:
        """Image from driver_args."""
        if env_data and env_data.get("driver_args"):
            return env_data["driver_args"].get("image") or None
        return None

    def container_config(self, node: dict, env_data: dict | None = None) -> dict:
        """Build container config from driver_args."""
        cfg: dict[str, Any] = {}
        if not env_data:
            return cfg
        args = env_data.get("driver_args", {})
        if args.get("hostname"):
            cfg["hostname"] = args["hostname"]
        if args.get("network_mode"):
            cfg["network_mode"] = args["network_mode"]
        if args.get("privileged"):
            cfg["privileged"] = True
        if args.get("cap_add"):
            cfg["cap_add"] = [c.strip() for c in args["cap_add"].split(",") if c.strip()]
        if args.get("restart"):
            cfg["restart"] = args["restart"]
        if args.get("command"):
            cfg["command"] = args["command"]
        if args.get("volumes"):
            cfg["volumes"] = [v.strip() for v in args["volumes"].split(",") if v.strip()]
        if args.get("env_vars"):
            cfg["env_vars"] = [e.strip() for e in args["env_vars"].split(",") if e.strip()]
        if args.get("ports"):
            cfg["ports"] = [p.strip() for p in args["ports"].split(",") if p.strip()]
        return cfg

    # ── Action vars ──────────────────────────────────────────────

    def resolve_action_vars(self, node: dict, env_data: dict) -> dict[str, Any]:
        args = env_data.get("driver_args", {})
        extra: dict[str, Any] = {}
        if args.get("image"):
            extra["driver.image"] = args["image"]
        return extra

    # ── Commands ─────────────────────────────────────────────────

    def commands(self) -> list[DeviceCommand]:
        return [
            DeviceCommand(
                name="create-container",
                label="Create Container",
                icon="box",
                description="Pull image (if needed) and docker create the container",
            ),
            DeviceCommand(
                name="remove-container",
                label="Remove Container",
                icon="trash-2",
                description="Remove container and clean up triv Docker networks",
            ),
            DeviceCommand(
                name="connect-network",
                label="Connect",
                icon="network",
                description=(
                    "For each interface, ensure a Docker network backed by "
                    "the topology bridge exists and connect the container"
                ),
            ),
            DeviceCommand(
                name="disconnect-network",
                label="Disconnect",
                icon="unplug",
                description=("Disconnect the container from all triv Docker networks"),
            ),
        ]

    # ── Command dispatch ─────────────────────────────────────────

    def run_command(
        self,
        cmd_name: str,
        node: dict,
        env_data: dict | None = None,
        project_dir: str = "",
        **kwargs: Any,
    ) -> dict:
        runtime = node.get("runtime", "docker")
        vm = self.vm_name(node, env_data)

        if cmd_name == "create-container":
            return self._create_container(
                runtime, vm, node, env_data, output_cb=kwargs.get("output_cb")
            )
        if cmd_name == "remove-container":
            return self._remove_container(runtime, vm, node, **kwargs)
        if cmd_name in ("connect-network", "apply-network"):
            return self._connect_network(runtime, vm, node, **kwargs)
        if cmd_name == "disconnect-network":
            return self._disconnect_network(runtime, vm, node, **kwargs)

        return {"ok": False, "error": f"Unknown command: {cmd_name}"}

    # ── Private: create ──────────────────────────────────────────

    def _create_container(
        self,
        rt: str,
        vm_name: str,
        node: dict,
        env_data: dict | None = None,
        output_cb=None,
    ) -> dict:
        def emit(line: str) -> None:
            print(line)
            if output_cb:
                output_cb(line)

        image = self.container_image(node, env_data)
        if not image:
            return {"ok": False, "error": "No 'image' in driver_args"}

        # Pull image if not present
        r = subprocess.run([rt, "image", "inspect", image], capture_output=True, check=False)
        if r.returncode != 0:
            emit(f"Pulling image {image}...")
            proc = subprocess.Popen(
                [rt, "pull", image],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
            )
            assert proc.stdout is not None
            for line in proc.stdout:
                emit(line.rstrip())
            proc.wait()
            if proc.returncode != 0:
                return {
                    "ok": False,
                    "error": f"Failed to pull {image}",
                }
        else:
            emit(f"Image {image} already present, skipping pull.")

        # Remove stale container
        subprocess.run([rt, "rm", "-f", vm_name], capture_output=True, check=False)

        cfg = self.container_config(node, env_data)

        cmd: list[str] = [rt, "create", "--name", vm_name]

        net_mode = cfg.get("network_mode", "bridge")
        cmd += ["--network", net_mode]

        hostname = cfg.get("hostname") or vm_name
        cmd += ["--hostname", hostname]

        if cfg.get("privileged"):
            cmd.append("--privileged")

        for cap in cfg.get("cap_add") or []:
            cmd += ["--cap-add", cap]

        restart = cfg.get("restart")
        if restart:
            cmd += ["--restart", restart]

        for vol in cfg.get("volumes") or []:
            cmd += ["-v", vol]

        for item in cfg.get("env_vars") or []:
            cmd += ["-e", item]

        for port in cfg.get("ports") or []:
            cmd += ["-p", port]

        cmd.append(image)

        container_cmd = cfg.get("command", "")
        if container_cmd:
            if isinstance(container_cmd, str):
                cmd += container_cmd.split()
            elif isinstance(container_cmd, list):
                cmd += container_cmd

        emit(f"Creating container: {' '.join(cmd)}")
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            return {"ok": False, "error": result.stderr.strip(), "command": cmd}

        container_id = result.stdout.strip()[:12]
        emit(f"Container created: {vm_name} ({container_id})")
        return {
            "ok": True,
            "vm_name": vm_name,
            "container_id": container_id,
            "image": image,
            "network_mode": net_mode,
        }

    # ── Private: remove ──────────────────────────────────────────

    def _remove_container(self, rt: str, vm_name: str, node: dict, **kwargs: Any) -> dict:
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

        lines = [f"Removed container: {vm_name}"]
        if removed_nets:
            lines.append(f"Cleaned up networks: {', '.join(removed_nets)}")
        return {
            "ok": True,
            "detail": "\n".join(lines),
            "removed_nets": removed_nets,
        }

    # ── Private: connect-network ──────────────────────────────────

    def _connect_network(self, rt: str, vm_name: str, node: dict, **kwargs: Any) -> dict:
        """Connect the container to Docker networks backed by topology bridges.

        Expects ``bridges`` kwarg: ``{iface_id: bridge_name}``.
        When an interface has a ``vlan`` field, a VLAN sub-interface is
        created inside the container's network namespace (via nsenter)
        and the IP is moved from the parent ``ethN`` to ``ethN.<vlan>``.
        """
        bridges: dict[str, str] = kwargs.get("bridges", {})
        interfaces = node.get("interfaces") or []

        report: dict = {"ok": True, "connected": [], "skipped": [], "errors": []}

        pid = netmod.get_container_pid(vm_name)

        # Disconnect from the default "bridge" network first so that
        # the triv network gets assigned eth0 (instead of eth1).
        netmod.docker_disconnect(vm_name, "bridge")

        for iface in interfaces:
            iface_id = iface["id"] if isinstance(iface, dict) else iface.id
            bridge = bridges.get(iface_id)
            if not bridge:
                report["errors"].append(
                    f"[{iface_id}] no bridge resolved (not connected to a network?)"
                )
                continue
            docker_net = f"triv-{bridge}"

            ip_raw = iface.get("ip", "") if isinstance(iface, dict) else (iface.ip or "")
            ip_cidr = ip_raw
            ip_only = ip_cidr.split("/")[0] if "/" in ip_cidr else ip_cidr or None
            prefix = int(ip_cidr.split("/")[1]) if "/" in ip_cidr else 24
            full_cidr = f"{ip_only}/{prefix}" if ip_only else ip_cidr

            vlan_id = iface.get("vlan") if isinstance(iface, dict) else getattr(iface, "vlan", None)

            subnet: str | None = None
            gateway: str | None = None
            if ip_only:
                try:
                    net_obj = ipaddress.ip_interface(full_cidr).network
                    subnet = str(net_obj)
                    hosts = list(net_obj.hosts())
                    if hosts:
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
                    f"[{iface_id}] docker network create {docker_net} (bridge={bridge}): {net_err}"
                )
                continue

            ok, conn_err = netmod.docker_connect(vm_name, docker_net, ip=ip_only)

            # Ensure VM ↔ container traffic isn't blocked by Docker
            # iptables (must run AFTER docker_connect which may re-enable
            # nf_call_iptables on the bridge).
            if bridge:
                netmod._ensure_bridge_iptables_accept(bridge)
            if ok:
                entry = f"{iface_id} → {docker_net}"
                if ip_only:
                    entry += f" ({ip_cidr})"
                report["connected"].append(entry)

                # ── Fix prefix length ──
                # Docker network connect applies the *network's* subnet mask,
                # which may differ from the per-interface prefix (e.g. /24 vs
                # /30).  We must delete the old address first, because
                # ``ip addr replace`` treats different prefix lengths as
                # distinct addresses and would just add a second entry.
                if pid and ip_only and "/" in ip_cidr:
                    dev = self._find_dev_by_ip(pid, ip_only)
                    if dev:
                        # Find current prefix so we can delete the exact addr
                        r = netmod.nsenter_run(pid, ["ip", "-o", "addr", "show", "dev", dev])
                        for line in r.stdout.splitlines():
                            if f" {ip_only}/" in line:
                                # e.g. "… inet 169.254.32.6/24 brd …"
                                for tok in line.split():
                                    if tok.startswith(ip_only + "/"):
                                        old_cidr = tok
                                        if old_cidr != full_cidr:
                                            netmod.nsenter_run(
                                                pid,
                                                [
                                                    "ip",
                                                    "addr",
                                                    "del",
                                                    old_cidr,
                                                    "dev",
                                                    dev,
                                                ],
                                            )
                                            netmod.nsenter_run(
                                                pid,
                                                [
                                                    "ip",
                                                    "addr",
                                                    "add",
                                                    full_cidr,
                                                    "dev",
                                                    dev,
                                                ],
                                            )
                                        break
                                break

                # ── VLAN tagging ──
                if vlan_id and pid and ip_only:
                    parent = self._find_dev_by_ip(pid, ip_only)
                    if parent:
                        vok, vmsg = netmod.container_setup_vlan(vm_name, parent, vlan_id, full_cidr)
                        if vok:
                            report["connected"].append(f"  └ {vmsg}")
                        else:
                            report["errors"].append(f"[{iface_id}] VLAN {vlan_id}: {vmsg}")
                    else:
                        report["errors"].append(
                            f"[{iface_id}] VLAN {vlan_id}: could not find device with IP {ip_only}"
                        )
            else:
                report["errors"].append(
                    f"[{iface_id}] docker network connect {docker_net} {vm_name}: {conn_err}"
                )

        report["ok"] = len(report["errors"]) == 0
        if not report["ok"]:
            report["error"] = "\n".join(report["errors"])
        else:
            lines = [f"Connected: {e}" for e in report["connected"]]
            if report["skipped"]:
                lines += [f"Skipped: {e}" for e in report["skipped"]]
            report["detail"] = "\n".join(lines) or "No interfaces configured."
        return report

    @staticmethod
    def _find_dev_by_ip(pid: int, ip: str) -> str | None:
        """Find the network device inside a container that holds *ip*."""
        r = netmod.nsenter_run(pid, ["ip", "-o", "addr", "show"])
        for ln in r.stdout.splitlines():
            # Format: "3: eth1    inet 192.168.254.10/24 ..."
            if f" {ip}/" in ln or f" {ip} " in ln:
                parts = ln.split(":")
                if len(parts) >= 2:
                    return parts[1].strip().split()[0]
        return None

    # ── Private: disconnect-network ───────────────────────────────

    def _disconnect_network(self, rt: str, vm_name: str, node: dict, **kwargs: Any) -> dict:
        """Disconnect the container from all triv Docker networks."""
        # Remove VLAN sub-interfaces first
        removed_vlans = netmod.container_remove_vlans(vm_name)

        nets = netmod.get_container_networks(vm_name)
        disconnected: list[str] = []
        errors: list[str] = []
        for net_name in nets:
            if not net_name.startswith("triv-"):
                continue
            ok = netmod.docker_disconnect(vm_name, net_name)
            if ok:
                disconnected.append(net_name)
            else:
                errors.append(f"Failed to disconnect from {net_name}")

        if errors:
            return {
                "ok": False,
                "error": "\n".join(errors),
                "disconnected": disconnected,
            }

        lines = [f"Disconnected: {n}" for n in disconnected]
        if removed_vlans:
            lines.append(f"Removed VLANs: {', '.join(removed_vlans)}")
        detail = "\n".join(lines)
        return {
            "ok": True,
            "detail": detail or "No triv networks to disconnect.",
            "disconnected": disconnected,
        }
