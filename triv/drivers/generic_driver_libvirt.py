"""triv.drivers.generic_libvirt — Built-in generic py-driver for libvirt VMs.

Extends the GenericDriver with libvirt-specific lifecycle operations
and driver_args schema.  The schema defines which parameters the
actions and lifecycle hooks expect from the capabilities file.
"""

from __future__ import annotations

from typing import Any

from .base import Branding, DriverBase


# ── driver_args schema ────────────────────────────────────────────
# Every key here corresponds to a field the user configures in the
# capabilities UI.  Actions reference these via ${env.<key>}.

DRIVER_ARGS_SCHEMA: dict[str, dict] = {
    "image-path": {
        "type": "string",
        "label": "Disk Image Path",
        "description": "Path to the qcow2/raw base image for the VM",
        "required": True,
        "placeholder": "/path/to/images/my-image.qcow2",
    },
    "template": {
        "type": "string",
        "label": "Domain XML Template",
        "description": "Path to libvirt domain XML template (relative to project)",
        "required": False,
        "placeholder": "templates/vm-box-template.xml",
    },
    "memory_mb": {
        "type": "number",
        "label": "Memory (MB)",
        "description": "RAM allocation in megabytes",
        "required": False,
        "default": 1024,
    },
    "vcpus": {
        "type": "number",
        "label": "vCPUs",
        "description": "Number of virtual CPUs",
        "required": False,
        "default": 4,
    },
    "uefi": {
        "type": "boolean",
        "label": "UEFI Boot",
        "description": "Use UEFI firmware instead of BIOS",
        "required": False,
        "default": True,
    },
}


class GenericLibvirtDriver(DriverBase):
    """Generic py-driver for libvirt/QEMU virtual machines."""

    name = "generic-driver-libvirt-python"
    vendor = "triv"
    version = "1.0.0"

    # ── Type identifier (matches runtime) ────────────────────────
    @staticmethod
    def driver_type() -> str:
        """Return the runtime type this driver is designed for."""
        return "libvirt"

    # ── driver_args schema ───────────────────────────────────────
    @staticmethod
    def driver_args_schema() -> dict[str, dict]:
        return DRIVER_ARGS_SCHEMA

    # ── Identity ─────────────────────────────────────────────────

    def metadata(self) -> Branding:
        return Branding(
            vendor_name="triv",
            driver_label="Generic Libvirt VM",
            accent_color="#a6e3a1",
        )

    def vm_name(self, node: dict, env_data: dict | None = None) -> str:
        return f"triv-{node['id']}"

    # ── Resources ────────────────────────────────────────────────

    def vm_resources(self, node: dict, env_data: dict | None = None) -> dict[str, Any]:
        if env_data and env_data.get("driver_args"):
            args = env_data["driver_args"]
            return {
                "memory_mb": args.get("memory_mb", 1024),
                "vcpus": args.get("vcpus", 4),
            }
        return {"memory_mb": 1024, "vcpus": 4}

    # ── Template ─────────────────────────────────────────────────

    def vm_template(self, node: dict | None = None, env_data: dict | None = None) -> str | None:
        """Return template from driver_args or None for core default."""
        if env_data and env_data.get("driver_args"):
            import os

            tmpl = env_data["driver_args"].get("template", "")
            project_dir = (node or {}).get("properties", {}).get("project_dir", "")
            if tmpl and project_dir:
                path = os.path.join(project_dir, tmpl)
                if os.path.isfile(path):
                    with open(path) as f:
                        return f.read()
        return None

    # ── Action vars ──────────────────────────────────────────────

    def resolve_action_vars(self, node: dict, env_data: dict) -> dict[str, Any]:
        args = env_data.get("driver_args", {})
        extra: dict[str, Any] = {}
        if args.get("image-path"):
            extra["driver.image_path"] = args["image-path"]
        return extra
