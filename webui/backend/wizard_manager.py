"""
wizard_manager.py — Manages the triv Wizard topology lifecycle.

The wizard topology (LLM + Agent + App nodes) is loaded once at startup
and kept in memory separately from the user's active project topology.
It is never stored in shared.topology.

Key responsibilities:
  - Load wizard topology from triv/wizard/projects/wizard/topology.json
  - Patch node env fields with absolute paths to triv/wizard/capabilities/
  - Patch capabilities at runtime with user config (provider, model, instructions)
  - Provide run_task() to execute a wizard agent task with screen context
  - Load/save wizard config from ~/.triv/wizard_config.json
"""

import json
import os
import subprocess
from pathlib import Path
from typing import Any

import shared


# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------

_DEFAULT_CONFIG = {
    "enabled": False,
    "provider": "ollama",
    "model": "qwen2.5:1.5b",
    "base_url": "",
    "api_key": "",
    "credential": "",
    "instructions": "",
    "capability_groups": {
        "node_capabilities": False,
        "node_actions": False,
        "node_lifecycle": False,
        "network_ops": False,
        "secrets": False,
        "topology_ai_tools": False,
    },
}

# Tool names follow the agent driver's format: {node_id}__{action_id} with hyphens→underscores
# node_id = "triv-wizard-app" → "triv_wizard_app"
def _tool(action_id: str) -> str:
    return f"triv_wizard_app__{action_id}".replace("-", "_")

# Tools always available (read + basic topology CRUD)
_BASE_TOOLS: list[str] = [_tool(a) for a in [
    "list-nodes", "get-topology-summary",
    "create-node", "update-node", "update-node-label", "delete-node",
    "add-link", "remove-link",
    "list-networks", "list-drivers", "list-projects", "list-orgs",
    "create-project", "activate-project", "reload-topology",
    "list-secrets",
]]

# Extra tools unlocked per Danger Area group
_GROUP_TOOLS: dict[str, list[str]] = {
    "node_capabilities": [_tool(a) for a in ["get-node-capabilities", "set-node-capabilities"]],
    "node_actions":      [_tool(a) for a in ["get-node-actions", "run-node-action"]],
    "node_lifecycle":    [_tool(a) for a in ["start-node", "stop-node", "restart-node"]],
    "network_ops":       [_tool(a) for a in ["create-network", "assign-node-to-network", "delete-network", "deploy-network", "undeploy-network"]],
    "secrets":           [_tool(a) for a in ["set-secret", "delete-secret"]],
}

# Actions that modify or destroy data and require explicit user confirmation.
# Uses raw action IDs (not tool names) since the executor receives action_id.
_DESTRUCTIVE_ACTIONS: set[str] = {
    "delete-node", "remove-link",
    "delete-network", "undeploy-network",
    "delete-secret",
    "set-node-capabilities",
    "stop-node",
    "run-node-action",
}


# ---------------------------------------------------------------------------
# WizardManager
# ---------------------------------------------------------------------------

class WizardManager:

    @staticmethod
    def init() -> None:
        """Load wizard topology + config.  Called once at app startup."""
        WizardManager._load_config()
        WizardManager._load_topology()
        print(f"[wizard] Wizard initialised — enabled={shared.wizard_config.get('enabled', False)}")

    # ── Config ────────────────────────────────────────────────────────

    @staticmethod
    def _load_config() -> None:
        cfg = dict(_DEFAULT_CONFIG)
        if shared.WIZARD_CONFIG_FILE.is_file():
            try:
                saved = json.loads(shared.WIZARD_CONFIG_FILE.read_text())
                cfg.update(saved)
            except Exception:
                pass
        shared.wizard_config = cfg

    @staticmethod
    def get_config() -> dict:
        return dict(shared.wizard_config)

    @staticmethod
    def save_config(data: dict) -> None:
        """Persist config and patch in-memory topology."""
        cfg = dict(shared.wizard_config)
        for k, v in data.items():
            if k not in _DEFAULT_CONFIG:
                continue
            if k == "capability_groups" and isinstance(v, dict):
                groups = dict(cfg.get("capability_groups", {}))
                groups.update(v)
                cfg["capability_groups"] = groups
            else:
                cfg[k] = v
        shared.wizard_config = cfg
        try:
            shared.WIZARD_CONFIG_FILE.write_text(json.dumps(cfg, indent=2))
        except Exception as e:
            print(f"[wizard] Could not save config: {e}")
        # Re-patch in-memory topology with new LLM settings
        WizardManager._patch_topology_config()

    # ── Topology loading ──────────────────────────────────────────────

    @staticmethod
    def _load_topology() -> None:
        """Load wizard topology and patch env fields to absolute paths."""
        if not shared.WIZARD_TOPOLOGY_FILE.is_file():
            print(f"[wizard] Topology not found: {shared.WIZARD_TOPOLOGY_FILE}")
            return
        try:
            from triv.core import topology as topo_mod
            topo = topo_mod.load(str(shared.WIZARD_TOPOLOGY_FILE))
            # Patch env fields to absolute paths in wizard capabilities dir
            for node in topo.nodes:
                if node.env and not os.path.isabs(node.env):
                    abs_path = str(shared.WIZARD_CAPS_DIR / node.env)
                    node.env = abs_path
            shared.wizard_topology = topo
            WizardManager._patch_topology_config()
        except Exception as e:
            print(f"[wizard] Could not load wizard topology: {e}")

    @staticmethod
    def _patch_topology_config() -> None:
        """Patch LLM node capabilities in memory AND on disk with wizard_config values.

        This ensures that wizard_config (persisted in ~/.triv/) is the source
        of truth for LLM connection settings.  Even if the capabilities JSON
        file on disk is reset (git checkout, container restart, etc.), the
        values are written back on every init/save_config cycle.
        """
        if not shared.wizard_topology:
            return
        cfg = shared.wizard_config
        llm_node = shared.wizard_topology.get_node("triv-wizard-llm")
        if not llm_node:
            return

        # Sync wizard_config LLM fields back into the caps JSON file on disk
        _llm_ids = {"generic-driver-llm", "generic-driver-ollama"}
        _sync_keys = ("provider", "model", "base_url", "api_key", "credential")
        if llm_node.env:
            caps_path = Path(llm_node.env)
            if caps_path.is_file():
                try:
                    data = json.loads(caps_path.read_text())
                    changed = False
                    for drv in data.get("drivers", []):
                        cid = drv.get("driver") or drv.get("id") or ""
                        if cid in _llm_ids:
                            da = drv.setdefault("driver_args", {})
                            for key in _sync_keys:
                                val = cfg.get(key)
                                if val and da.get(key, "") != val:
                                    da[key] = val
                                    changed = True
                            break
                    if changed:
                        caps_path.write_text(json.dumps(data, indent=2))
                except Exception as e:
                    print(f"[wizard] Could not sync config to LLM caps file: {e}")

        # Patch wizard_app.py absolute path into triv-wizard-app capabilities
        WizardManager._patch_app_caps()

    @staticmethod
    def _patch_app_caps() -> None:
        """Patch __WIZARD_APP_PATH__ placeholder in triv-wizard-app capabilities."""
        app_node = shared.wizard_topology.get_node("triv-wizard-app") if shared.wizard_topology else None
        if not app_node or not app_node.env:
            return
        caps_path = Path(app_node.env)
        if not caps_path.is_file():
            return
        # We don't modify the file on disk — WizardManager._get_app_env() applies
        # the patch at runtime when building tool definitions.

    # ── Env loading (wizard-aware) ────────────────────────────────────

    @staticmethod
    def _load_wizard_env(node_env_path: str) -> dict:
        """Load a capabilities file from an absolute path."""
        try:
            from triv.core import env as env_mod
            return env_mod.load_env(node_env_path, str(shared.WIZARD_CAPS_DIR))
        except Exception:
            return {"drivers": [], "actions": []}

    @staticmethod
    def _get_llm_env() -> dict:
        """Return LLM env data with current wizard config merged in."""
        llm_node = shared.wizard_topology.get_node("triv-wizard-llm") if shared.wizard_topology else None
        if not llm_node:
            return {}
        env = WizardManager._load_wizard_env(llm_node.env)

        # Extract driver_args from the llm driver entry in the drivers list
        _llm_ids = {"generic-driver-llm", "generic-driver-ollama"}
        base_args: dict = {}
        for cap in env.get("drivers", []):
            cid = cap.get("driver") or cap.get("id") or ""
            if cid in _llm_ids:
                base_args = dict(cap.get("driver_args", {}))
                break
        # Fall back to top-level driver_args (legacy flat format)
        if not base_args:
            base_args = dict(env.get("driver_args", {}))

        # wizard_config is the source of truth for LLM connection settings
        cfg = shared.wizard_config
        for key in ("provider", "model", "base_url", "api_key", "credential"):
            val = cfg.get(key)
            if val:
                base_args[key] = val

        return {**env, "driver_args": base_args}

    @staticmethod
    def _load_dot_file(path) -> str:
        """Read a wizard dot file (e.g. .system_prompt, .rules), stripping comment lines."""
        try:
            text = Path(path).read_text().strip()
            # Strip markdown comment lines (# …) from .rules for cleaner injection
            lines = [line for line in text.splitlines() if not line.startswith("#")]
            return "\n".join(lines).strip()
        except Exception:
            return ""

    @staticmethod
    def _get_agent_env(context: str, instructions: str) -> dict:
        """Return agent env data with context + instructions injected."""
        agent_node = shared.wizard_topology.get_node("triv-wizard-agent") if shared.wizard_topology else None
        if not agent_node:
            return {}
        env = WizardManager._load_wizard_env(agent_node.env)

        # Extract driver_args from the agent driver entry in the drivers list
        base_args: dict = {}
        for cap in env.get("drivers", []):
            if cap.get("driver") == "generic-driver-agent":
                base_args = dict(cap.get("driver_args", {}))
                break
        # Fall back to top-level driver_args (legacy flat format)
        if not base_args:
            base_args = dict(env.get("driver_args", {}))

        # Load system prompt and rules from dot files (override capabilities inline value)
        system_prompt = WizardManager._load_dot_file(shared.WIZARD_SYSTEM_PROMPT_FILE)
        rules = WizardManager._load_dot_file(shared.WIZARD_RULES_FILE)
        if system_prompt:
            base_args["system_prompt"] = system_prompt
        if rules:
            base_args["rules"] = rules

        # Inject active org context
        parts: list[str] = []
        try:
            from routers.projects import _load_projects
            proj_data = _load_projects()
            active_org = proj_data.get("active_org", "")
            if active_org and shared.ORGS_DIR:
                org_file = shared.ORGS_DIR / f"{active_org}.json"
                if org_file.exists():
                    org_data = json.loads(org_file.read_text())
                    org_name = org_data.get("name", active_org)
                    org_vendors = org_data.get("vendors", [])
                    vendors_str = ", ".join(org_vendors) if org_vendors else "none"
                    parts.append(
                        f"Active organization: {org_name} (id: {active_org})\n"
                        f"Vendors in this org: {vendors_str}\n"
                        f"Projects for this org are stored under ~/.triv/vendors/<vendor>/"
                    )
        except Exception:
            pass

        if instructions:
            parts.append(f"User instructions: {instructions}")
        if context:
            parts.append(f"Current screen context:\n{context}")
        base_args["context"] = "\n\n".join(parts)

        # Build allowed_tools from base + enabled capability groups
        cfg = shared.wizard_config
        capability_groups = cfg.get("capability_groups", {})
        allowed: list[str] = list(_BASE_TOOLS)
        for group, extra_tools in _GROUP_TOOLS.items():
            if capability_groups.get(group, False):
                allowed.extend(extra_tools)

        # When topology_ai_tools is enabled, discover AI-tool-enabled actions
        # from the user's active topology and add their tool names to the
        # allowed set.  Tool names follow the agent driver convention:
        #   {node_id}__{action_id} with hyphens replaced by underscores.
        if capability_groups.get("topology_ai_tools", False) and shared.topology:
            allowed.extend(WizardManager._discover_topology_ai_tool_names())

        base_args["allowed_tools"] = ", ".join(allowed)

        return {**env, "driver_args": base_args}

    @staticmethod
    def _get_app_env() -> dict:
        """Return triv-wizard-app env with __WIZARD_APP_PATH__ resolved."""
        app_node = shared.wizard_topology.get_node("triv-wizard-app") if shared.wizard_topology else None
        if not app_node or not app_node.env:
            return {"drivers": [], "actions": []}
        env = WizardManager._load_wizard_env(app_node.env)
        app_path = str(shared.WIZARD_APP_SCRIPT)
        # Replace placeholder in action commands
        actions = []
        for action in env.get("actions", []):
            act = dict(action)
            cmd = act.get("command", "")
            if "__WIZARD_APP_PATH__" in cmd:
                act["command"] = cmd.replace("__WIZARD_APP_PATH__", app_path)
            # Also replace __PAYLOAD__ placeholder used in exec-with-data commands
            # The actual payload injection is handled by the exec-with-data action type
            actions.append(act)
        return {**env, "actions": actions}

    # ── Tool executor ─────────────────────────────────────────────────

    @staticmethod
    def _discover_topology_ai_tool_names() -> list[str]:
        """Return tool names for AI-tool-enabled actions in the user topology."""
        names: list[str] = []
        if not shared.topology:
            return names
        try:
            from node_helpers import load_node_env as _lne
        except Exception:
            return names

        for n in shared.topology.nodes:
            nd = n.to_dict()
            try:
                caps = _lne(nd)
            except Exception:
                continue
            if not caps:
                continue

            drivers_list = caps.get("drivers", [])
            plugin_cfg = next(
                (
                    d.get("driver_args", {})
                    for d in drivers_list
                    if (d.get("driver") or d.get("id") or "") == "generic-driver-ai-tool"
                ),
                None,
            )
            if plugin_cfg is None:
                plugin_cfg = {}

            _exposed_raw = plugin_cfg.get("expose_actions", [])
            if isinstance(_exposed_raw, str):
                exposed = [s.strip() for s in _exposed_raw.split(",") if s.strip()]
            else:
                exposed = list(_exposed_raw)
            explicit = bool(exposed)

            for action in caps.get("actions", []):
                act_id = action.get("id") or action.get("$ref", "")
                if not act_id or act_id.startswith("_"):
                    continue
                if explicit and act_id not in exposed:
                    continue

                # Resolve full definition from driver JSON + caps overlay
                drv_id = action.get("driver", "")
                if drv_id:
                    drv_json_path = shared.TOOLS_DIR / "triv" / "drivers" / f"{drv_id}.json"
                    drv_acts: dict = {}
                    if drv_json_path.is_file():
                        try:
                            drv_acts = json.loads(drv_json_path.read_text()).get("actions", {})
                        except Exception:
                            pass
                    base_act = drv_acts.get(act_id, {})
                else:
                    base_act = {}
                merged = {**base_act, **{k: v for k, v in action.items() if k != "$ref"}}

                if not explicit and not merged.get("ai_tool_enabled"):
                    continue
                if merged.get("type") in ("console", "ssh", "link", "webui"):
                    continue

                names.append(f"{n.id}__{act_id}".replace("-", "_"))

        return names

    @staticmethod
    def get_topology_tools() -> list[dict]:
        """Return AI-tool-enabled actions grouped by node and driver."""
        result: list[dict] = []
        if not shared.topology:
            return result
        try:
            from node_helpers import load_node_env as _lne
        except Exception:
            return result

        for n in shared.topology.nodes:
            nd = n.to_dict()
            try:
                caps = _lne(nd)
            except Exception:
                continue
            if not caps:
                continue

            drivers_list = caps.get("drivers", [])
            plugin_cfg = next(
                (
                    d.get("driver_args", {})
                    for d in drivers_list
                    if (d.get("driver") or d.get("id") or "") == "generic-driver-ai-tool"
                ),
                None,
            )
            if plugin_cfg is None:
                plugin_cfg = {}

            _exposed_raw = plugin_cfg.get("expose_actions", [])
            if isinstance(_exposed_raw, str):
                exposed = [s.strip() for s in _exposed_raw.split(",") if s.strip()]
            else:
                exposed = list(_exposed_raw)
            explicit = bool(exposed)

            # Collect actions grouped by driver
            drv_map: dict[str, list[dict]] = {}
            for action in caps.get("actions", []):
                act_id = action.get("id") or action.get("$ref", "")
                if not act_id or act_id.startswith("_"):
                    continue
                if explicit and act_id not in exposed:
                    continue

                drv_id = action.get("driver", "")
                if drv_id:
                    drv_json_path = shared.TOOLS_DIR / "triv" / "drivers" / f"{drv_id}.json"
                    drv_acts: dict = {}
                    if drv_json_path.is_file():
                        try:
                            drv_acts = json.loads(drv_json_path.read_text()).get("actions", {})
                        except Exception:
                            pass
                    base_act = drv_acts.get(act_id, {})
                else:
                    base_act = {}
                merged = {**base_act, **{k: v for k, v in action.items() if k != "$ref"}}

                if not explicit and not merged.get("ai_tool_enabled"):
                    continue
                if merged.get("type") in ("console", "ssh", "link", "webui"):
                    continue

                act_label = merged.get("label", act_id)
                drv_key = drv_id or "(inline)"
                drv_map.setdefault(drv_key, []).append({"id": act_id, "label": act_label})

            if not drv_map:
                continue

            props = getattr(n, "properties", {}) or {}
            node_label = props.get("label") or n.id
            drivers_out = [
                {"driver_id": did, "actions": acts}
                for did, acts in drv_map.items()
            ]
            result.append({
                "node_id": n.id,
                "node_label": node_label,
                "drivers": drivers_out,
            })

        return result

    @staticmethod
    def _make_tool_executor(confirmed_actions: set[str] | None = None, blocked_log: list[dict] | None = None):
        """Return a callable that executes tool actions via shell.

        Handles both wizard-app actions (subprocess) and user topology node
        actions (delegated to the regular topology tool executor).

        Args:
            confirmed_actions: Action IDs the user has explicitly confirmed.
                Destructive actions not in this set are blocked.
            blocked_log: Mutable list — the executor appends info about each
                blocked call so the caller can return them to the frontend.
        """
        _confirmed = confirmed_actions or set()
        _blocked = blocked_log if blocked_log is not None else []

        # Lazy-build the user topology executor only when needed
        _topo_exec = None

        def _get_topo_exec():
            nonlocal _topo_exec
            if _topo_exec is None:
                try:
                    from routers.nodes import _make_tool_executor as _mk
                    _topo_exec = _mk()
                except Exception:
                    pass
            return _topo_exec

        def _execute(node_id: str, action_id: str, payload: dict | None = None) -> dict:
            # Gate: block destructive actions that haven't been confirmed
            if action_id in _DESTRUCTIVE_ACTIONS and action_id not in _confirmed:
                _blocked.append({"action_id": action_id, "node_id": node_id, "payload": payload or {}})
                return {
                    "ok": False,
                    "requires_confirmation": True,
                    "output": (
                        f"⚠️ BLOCKED: '{action_id}' is a destructive operation "
                        f"and requires explicit user confirmation. "
                        f"Tell the user what you intend to do and wait for approval."
                    ),
                }

            # Check if this is a user topology node
            if shared.topology and shared.topology.get_node(node_id):
                tex = _get_topo_exec()
                if tex:
                    return tex(node_id, action_id, payload)
                return {"ok": False, "error": "Topology tool executor not available"}

            if not shared.wizard_topology:
                return {"ok": False, "error": "Wizard topology not loaded"}
            node = shared.wizard_topology.get_node(node_id)
            if not node:
                return {"ok": False, "error": f"Node '{node_id}' not found in wizard or project topology"}

            # Only triv-wizard-app executes shell actions
            if node_id != "triv-wizard-app":
                return {"ok": False, "error": f"Node '{node_id}' is not executable as a tool"}

            env_data = WizardManager._get_app_env()
            action = next((a for a in env_data.get("actions", []) if a.get("id") == action_id), None)
            if not action:
                return {"ok": False, "error": f"Action '{action_id}' not found on wizard-app"}

            atype = action.get("type", "exec")
            command = action.get("command", "")

            try:
                if atype == "exec-with-data":
                    # Replace __PAYLOAD__ with the JSON payload string
                    payload_str = json.dumps(payload or {})
                    command = command.replace("'__PAYLOAD__'", f"'{payload_str}'")
                    # Also handle unquoted variant
                    command = command.replace("__PAYLOAD__", payload_str)

                result = subprocess.run(
                    command,
                    shell=True,
                    capture_output=True,
                    text=True,
                    timeout=30,
                    env={**os.environ, "TRIV_API_URL": shared.SERVER_URL},
                )
                stdout = result.stdout.strip()
                stderr = result.stderr.strip()

                if result.returncode != 0:
                    return {"ok": False, "output": stdout or stderr,
                            "error": stderr or f"exit code {result.returncode}"}

                # Try to parse JSON output for structured results
                try:
                    parsed = json.loads(stdout)
                    output = json.dumps(parsed, indent=2) if isinstance(parsed, (dict, list)) else stdout
                    ok = parsed.get("ok", True) if isinstance(parsed, dict) else True
                    return {"ok": ok, "output": output}
                except (json.JSONDecodeError, AttributeError):
                    return {"ok": True, "output": stdout}

            except subprocess.TimeoutExpired:
                return {"ok": False, "error": "Tool execution timed out (30s)"}
            except Exception as e:
                return {"ok": False, "error": str(e)}

        return _execute

    # ── Task execution ────────────────────────────────────────────────

    @staticmethod
    def run_task(task: str, context: str = "", confirmed_actions: list[str] | None = None) -> dict:
        """Run a wizard agent task with optional screen context JSON.

        Args:
            confirmed_actions: Action IDs the user explicitly approved for this
                request.  Destructive actions not in this list are blocked and
                the response will contain ``confirmation_required``.
        """
        if not shared.wizard_topology:
            return {"ok": False, "error": "Wizard topology not loaded. Check startup logs."}

        cfg = shared.wizard_config
        if not cfg.get("enabled", False):
            return {"ok": False, "error": "Wizard is disabled. Enable it in Apps → Wizard."}

        instructions = cfg.get("instructions", "")
        agent_env = WizardManager._get_agent_env(context, instructions)
        agent_node = shared.wizard_topology.get_node("triv-wizard-agent")
        if not agent_node:
            return {"ok": False, "error": "Wizard agent node not found in topology."}

        capability_groups = cfg.get("capability_groups", {})
        include_ai_tools = capability_groups.get("topology_ai_tools", False)
        topo_view = _WizardTopologyView(shared.wizard_topology, include_user_topo=include_ai_tools)

        blocked_log: list[dict] = []
        confirmed_set = set(confirmed_actions) if confirmed_actions else set()
        tool_exec = WizardManager._make_tool_executor(
            confirmed_actions=confirmed_set,
            blocked_log=blocked_log,
        )

        try:
            from triv.drivers.generic_driver_agent import GenericAgentDriver
            agent = GenericAgentDriver()
            nd = agent_node.to_dict()
            result = agent.run_command(
                "run-task",
                nd,
                agent_env,
                topology=topo_view,
                tool_executor=tool_exec,
                registry=shared.registry,
                payload={"task": task},
            )

            # If any destructive tools were blocked, enrich the response
            # so the frontend can show a confirmation dialog.
            if blocked_log:
                result["confirmation_required"] = True
                result["blocked_actions"] = blocked_log
            return result
        except Exception as e:
            return {"ok": False, "error": f"Wizard agent error: {e}", "output_type": "panel"}

    # ── Status ────────────────────────────────────────────────────────

    @staticmethod
    def get_status() -> dict:
        cfg = shared.wizard_config
        enabled = cfg.get("enabled", False)
        loaded = shared.wizard_topology is not None
        provider = ""
        model = ""
        if loaded:
            try:
                llm_env = WizardManager._get_llm_env()
                args = llm_env.get("driver_args", {})
                provider = args.get("provider", "")
                model = args.get("model", "")
            except Exception:
                pass
        return {
            "enabled": enabled,
            "topology_loaded": loaded,
            "provider": provider,
            "model": model,
        }


# ---------------------------------------------------------------------------
# WizardTopologyView — wraps the wizard topology so that the agent driver
# uses wizard-specific env data for the LLM node lookup.
# ---------------------------------------------------------------------------

class _WizardTopologyView:
    """Thin wrapper around wizard_topology that merges user topology nodes
    so the agent driver can discover AI-tool-enabled actions on them."""

    def __init__(self, topo: Any, include_user_topo: bool = False) -> None:
        self._topo = topo
        self._include_user = include_user_topo and shared.topology is not None
        # Pre-build patched LLM env so it can be served by get_node overrides
        self._llm_env = WizardManager._get_llm_env()
        self._app_env = WizardManager._get_app_env()

    @property
    def nodes(self):
        wizard_nodes = self._topo.nodes
        if not self._include_user:
            return wizard_nodes
        # Merge: wizard nodes first, then user topology nodes (skip id clashes)
        wizard_ids = {n.id for n in wizard_nodes}
        extra = [n for n in shared.topology.nodes if n.id not in wizard_ids]
        return list(wizard_nodes) + extra

    @property
    def links(self):
        return self._topo.links

    @property
    def network_defs(self):
        return getattr(self._topo, "network_defs", [])

    @property
    def project_id(self):
        return getattr(self._topo, "project_id", "wizard")

    def get_node(self, node_id: str):
        node = self._topo.get_node(node_id)
        if node:
            return node
        if self._include_user and shared.topology:
            return shared.topology.get_node(node_id)
        return None
