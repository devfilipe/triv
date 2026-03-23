"""triv.drivers.generic_app — Generic application process driver (placeholder)."""

from __future__ import annotations

from .base import Branding, DeviceCommand, DriverBase


class GenericAppDriver(DriverBase):
    """Placeholder driver for application-level process management.

    Future: start/stop/monitor local processes, systemd units, etc.
    """

    name = "generic-driver-app-python"
    version = "1.0.0"

    def metadata(self) -> Branding:
        return Branding(
            vendor_name="triv",
            driver_label="Generic Application",
            accent_color="#f5c2e7",
        )

    # -- type helpers ------------------------------------------------
    def driver_type(self) -> str:
        return "app"

    def driver_args_schema(self) -> dict:
        return {
            "binary": {
                "type": "string",
                "label": "Program Name",
                "description": "Path to the application binary or script",
                "required": True,
                "placeholder": "/usr/bin/my-app",
            },
            "args": {
                "type": "string",
                "label": "Parameters",
                "description": "Command-line arguments",
                "required": False,
                "placeholder": "--config /etc/my-app.conf",
            },
            "env_vars": {
                "type": "string",
                "label": "Environment Variables",
                "description": "KEY=VALUE pairs, comma-separated",
                "required": False,
                "placeholder": "LOG_LEVEL=debug,PORT=8080",
            },
        }

    # -- lifecycle (stubs) -------------------------------------------
    def vm_name(self, node: dict, env_data: dict) -> str:
        return (node.get("properties") or {}).get("label", "") or node.get("id", "app")

    def commands(self) -> list[DeviceCommand]:
        return [
            DeviceCommand(
                name="app-start",
                label="Start",
                icon="play",
                description="Start the application process",
            ),
            DeviceCommand(
                name="app-stop",
                label="Stop",
                icon="square",
                description="Stop the application process",
            ),
            DeviceCommand(
                name="app-status",
                label="Status",
                icon="activity",
                description="Check whether the application process is running",
            ),
        ]

    def run_command(self, cmd_name: str, node: dict, env_data: dict, project_dir: str = "") -> dict:
        if cmd_name == "app-status":
            return {"ok": True, "output": "[placeholder] app process status"}
        return {"ok": False, "error": f"Unknown command: {cmd_name}"}
