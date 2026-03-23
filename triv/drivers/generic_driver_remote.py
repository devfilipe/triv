"""triv.drivers.generic_remote — Generic remote/physical device driver (placeholder)."""

from __future__ import annotations

from .base import Branding, DeviceCommand, DriverBase


class GenericRemoteDriver(DriverBase):
    """Placeholder driver for managing remote devices via SSH/SNMP/etc.

    Future: SSH connectivity checks, ping monitoring, SNMP polls, etc.
    """

    name = "generic-driver-remote-python"
    version = "1.0.0"

    def metadata(self) -> Branding:
        return Branding(
            vendor_name="triv",
            driver_label="Generic Remote Device",
            accent_color="#fab387",
        )

    # -- type helpers ------------------------------------------------
    def driver_type(self) -> str:
        return "remote"

    def driver_args_schema(self) -> dict:
        return {
            "host": {
                "type": "string",
                "label": "Host / IP",
                "description": "Hostname or IP address of the remote device",
                "required": True,
                "placeholder": "192.168.1.100",
            },
            "user": {
                "type": "string",
                "label": "SSH User",
                "description": "Username for SSH connections",
                "required": False,
                "default": "root",
            },
            "port": {
                "type": "number",
                "label": "SSH Port",
                "description": "SSH port number",
                "required": False,
                "default": 22,
            },
        }

    # -- lifecycle (stubs) -------------------------------------------
    def vm_name(self, node: dict, env_data: dict) -> str:
        return (node.get("properties") or {}).get("label", "") or node.get("id", "remote")

    def commands(self) -> list[DeviceCommand]:
        return [
            DeviceCommand(
                name="remote-ssh",
                label="Connect (SSH)",
                icon="terminal",
                description="Open an SSH session to the remote device",
            ),
            DeviceCommand(
                name="remote-ping",
                label="Ping",
                icon="activity",
                description="Ping the remote device to check reachability",
            ),
            DeviceCommand(
                name="remote-uptime",
                label="Uptime",
                icon="info",
                description="Check uptime of the remote device via SSH",
            ),
        ]

    def run_command(self, cmd_name: str, node: dict, env_data: dict, project_dir: str = "") -> dict:
        host = (env_data.get("driver_args") or {}).get("host", "")
        if cmd_name == "remote-ping":
            return {"ok": True, "output": f"[placeholder] ping {host}"}
        if cmd_name == "remote-uptime":
            return {"ok": True, "output": f"[placeholder] uptime of {host}"}
        return {"ok": False, "error": f"Unknown command: {cmd_name}"}
