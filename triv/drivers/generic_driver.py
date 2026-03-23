"""triv.drivers.generic — Built-in generic driver (no vendor specifics).

This is the fallback driver used when no vendor-specific driver is registered
for a node.  It provides only the basic identity helpers; container-level
actions (logs, status, …) are supplied through the reusable *ne-actions*
library (``templates/common/ne-actions.json``) and referenced from env files
via ``$ref:action-id``.
"""

from __future__ import annotations

from .base import Branding, DriverBase


class GenericDriver(DriverBase):
    name = "generic"
    vendor = "triv"
    version = "1.0.0"

    def metadata(self) -> Branding:
        return Branding(
            vendor_name="Generic",
            driver_label="Generic Device",
            accent_color="#6c7086",
        )

    def vm_name(self, node: dict, env_data: dict | None = None) -> str:
        return f"triv-{node['id']}"
