"""
triv.drivers.base — Abstract driver interface that vendors implement.

Every driver **must** implement the two abstract methods: ``metadata()``
and ``vm_name()``.  Everything else has sensible defaults so simple
drivers can stay tiny, while complex ones can override the full
lifecycle.

Lifecycle hooks (called by the core orchestrator)
--------------------------------------------------

  setup()          Provision a new instance (create VM, pull image…).
  start()         Start an already-provisioned instance.
  stop()          Gracefully stop a running instance.
  teardown()      Destroy the instance and clean up artefacts.

  validate_node()  Extra validation rules beyond what the core checks.

All lifecycle hooks receive the loaded ``env_data`` dict so the driver
can read ``driver_args`` freely.

Action integration
------------------

  commands()            Static command definitions (shown even without env).
  resolve_action_vars() Extra template variables the driver wants to inject
                        into action expansion.  Called by ``core.env``.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

from triv.core.enums import DeviceCategory


@dataclass
class Branding:
    vendor_name: str
    driver_label: str
    description: str = ""
    logo_url: str | None = None
    accent_color: str = "#6c7086"


@dataclass
class DeviceCommand:
    """A static command exposed by the driver regardless of env.

    These appear *alongside* any actions defined in the env file.
    If an env-action has the same ``id`` as a DeviceCommand, the
    env-action takes precedence (override pattern).

    ``tool_args`` declares the typed parameters this command accepts when
    called as an agent tool.  The agent converts this to the LLM protocol
    ``input_schema`` automatically.  When set, the agent passes a structured
    payload to ``run_command`` via ``kwargs["payload"]`` instead of the
    generic ``{"data": str}`` fallback.

    Format — a flat dict of parameter definitions (no wrapping object/properties)::

        DeviceCommand(
            name="set-interface",
            label="Set Interface State",
            tool_args={
                "interface": {"type": "string",  "description": "Interface name", "required": True},
                "enabled":   {"type": "boolean", "description": "Admin state"},
            },
        )
    """

    name: str
    label: str
    description: str = ""
    icon: str = "terminal"
    applicable_categories: list[DeviceCategory] = field(default_factory=list)
    requires_runtime: bool = True
    tool_args: dict | None = None  # flat param map; agent converts to input_schema


@dataclass
class SetupResult:
    """Return value of ``DriverBase.setup()``."""

    ok: bool = True
    vm_name: str = ""
    message: str = ""
    artefacts: dict[str, Any] = field(default_factory=dict)


class DriverBase(ABC):
    """Every vendor/product driver extends this.

    Subclass contract
    -----------------
    * Override the two ``@abstractmethod``s.
    * Override lifecycle / network / action hooks as needed.
    * Never import UI or web code — drivers are backend-only.
    """

    name: str = "base"
    vendor: str = "unknown"
    version: str = "0.0.0"

    # ── Identity (required) ──────────────────────────────────────────

    @abstractmethod
    def metadata(self) -> Branding:
        """Brand information used by the UI and logging."""
        ...

    @abstractmethod
    def vm_name(self, node: dict, env_data: dict | None = None) -> str:
        """Canonical instance name (VM domain, container name, hostname).

        ``env_data`` is the loaded env sidecar dict (may be ``None`` when
        no env file is configured for the node).
        """
        ...

    # ── Lifecycle (optional) ─────────────────────────────────────────

    def setup(self, node: dict, env_data: dict, project_dir: str = "", **kw: Any) -> SetupResult:
        """Provision (create) the instance.  Default: no-op."""
        return SetupResult(ok=True, vm_name=self.vm_name(node, env_data))

    def start(self, node: dict, env_data: dict, project_dir: str = "", **kw: Any) -> bool:
        """Start an already-provisioned instance.  Return True on success."""
        return True

    def stop(self, node: dict, env_data: dict, project_dir: str = "", **kw: Any) -> bool:
        """Stop the instance.  Return True on success."""
        return True

    def teardown(self, node: dict, env_data: dict, project_dir: str = "", **kw: Any) -> bool:
        """Destroy the instance and clean artefacts.  Return True."""
        return True

    # ── Runtime — Libvirt ────────────────────────────────────────────

    def vm_template(self, node: dict | None = None, env_data: dict | None = None) -> str | None:
        """Libvirt XML template content.  ``None`` → core default."""
        return None

    def vm_resources(self, node: dict, env_data: dict | None = None) -> dict:
        """Memory / vCPU allocation."""
        return {"memory_mb": 1024, "vcpus": 4}

    # ── Runtime — Containers (docker / podman) ───────────────────────

    def container_image(self, node: dict, env_data: dict | None = None) -> str | None:
        """Image reference.  ``None`` → read from ``properties.image``."""
        return None

    def container_config(self, node: dict, env_data: dict | None = None) -> dict:
        """Extra ``docker run`` / ``podman run`` flags as a dict."""
        return {}

    # ── Network ──────────────────────────────────────────────────────

    def vlan_for_interface(self, node: dict, iface: dict) -> int | None:
        """VLAN calculation.  Default: return static value from interface."""
        return iface.get("vlan")

    def mac_address(self, node: dict, iface: dict) -> str | None:
        """Custom MAC.  ``None`` → core auto-generates."""
        return iface.get("mac")

    # ── Actions / Commands ───────────────────────────────────────────

    def commands(self) -> list[DeviceCommand]:
        """Static commands exposed by this driver.

        These are merged with the ``actions`` from the env file.  If an
        env-action has the same ``id`` as a command here, the env-action
        wins (useful for per-node overrides).
        """
        return []

    def resolve_action_vars(self, node: dict, env_data: dict) -> dict[str, Any]:
        """Extra template variables injected into action expansion.

        Override this to expose driver-specific variables like
        ``${driver.serial}`` without touching the env file schema.
        """
        return {}

    def startup_commands(self, node: dict, env_data: dict | None = None) -> list[str]:
        """Shell commands to auto-run after the instance starts."""
        return []

    def run_command(
        self,
        cmd_name: str,
        node: dict,
        env_data: dict | None = None,
        project_dir: str = "",
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Execute a named command.  Return ``{"ok": bool, ...}``."""
        return {"ok": False, "error": f"Command '{cmd_name}' not implemented"}

    # ── Validation ───────────────────────────────────────────────────

    def validate_node(self, node: dict, env_data: dict | None = None) -> list[str]:
        """Extra validation rules for nodes of this driver.

        Return a list of error strings.  Empty → valid.
        """
        return []
