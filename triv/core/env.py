"""
triv.core.env — Env-file loader and template engine.

An *env file* is a JSON sidecar that sits next to the topology.  Each node
may reference one via ``"env": "capabilities-node-r1.json"``.

The file is split into well-known sections:

  driver_args   — opaque dict; the core never interprets it, only forwards
                  it to the driver so vendor code can read whatever it needs.

  actions       — list of action descriptors that the core resolves (template
                  expansion) and the UI renders as buttons on the device card.

  health        — health check configuration for this node:
                  {
                    "type":     "docker" | "exec",
                    "command":  "<shell cmd>",   // for type=exec; template-expanded
                    "interval": 30,              // seconds between checks (default 30)
                    "timeout":  5                // seconds before marking unhealthy (default 5)
                  }
                  type=docker: reads {{.State.Health.Status}} from docker inspect.
                  type=exec:   runs command; exit 0 = healthy, non-zero = unhealthy.

Any top-level key that is **not** ``driver_args``, ``actions``, or ``health`` is
migrated into ``driver_args`` transparently so legacy env files keep
working without edits.

Template variables
------------------
Inside ``command``, ``confirm``, ``host`` and ``data`` strings the core
expands placeholders of the form ``${...}``:

  ${vm_name}           — resolved VM / container name
  ${node.id}           — node id from topology
  ${node.<field>}      — any top-level node field
  ${iface.<id>.<key>}  — interface attribute (e.g. ${iface.dcn.ip})
  ${env.<key>}         — value from driver_args (flat or dotted)
  ${project_dir}       — absolute project directory
  ${json:env.<key>}    — JSON-serialised value (for structured data)
  ${data_file}         — when type=exec-with-data + data_source=file-picker,
                         the file selected by the user at invocation time

Drivers can extend the variable bag by overriding
``resolve_action_vars(node, env_data) → dict``.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# ne-actions.json library (reusable action definitions)
# ---------------------------------------------------------------------------

# Package root → templates/common/
_PACKAGE_ROOT = Path(__file__).resolve().parent.parent.parent
_GLOBAL_ACTIONS_PATH = _PACKAGE_ROOT / "templates" / "common" / "ne-actions.json"

# Cache: { path-string → { action-id → action-dict } }
_actions_cache: dict[str, dict[str, dict]] = {}

# Driver actions cache (from json-driver files)
_driver_actions_cache: dict[str, dict[str, dict]] = {}


def _load_driver_actions() -> dict[str, dict]:
    """Load actions from all json-driver files in triv/drivers/ and
    ~/.triv/vendors/*/drivers/.  Used as fallback for $ref resolution
    when the legacy ne-actions library doesn't have the ref."""
    if _driver_actions_cache:
        return _driver_actions_cache.get("_merged", {})

    merged: dict[str, dict] = {}
    search_dirs = [
        _PACKAGE_ROOT / "triv" / "drivers",
    ]
    triv_home = Path.home() / ".triv"
    if triv_home.is_dir():
        for vdir in sorted(triv_home.glob("vendors/*/drivers")):
            search_dirs.append(vdir)

    for d in search_dirs:
        if not d.is_dir():
            continue
        for f in sorted(d.glob("*.json")):
            try:
                with open(f) as fh:
                    data = json.load(fh)
                for k, v in data.get("actions", {}).items():
                    if not k.startswith("_") and k not in merged:
                        merged[k] = v
            except (json.JSONDecodeError, OSError):
                continue

    _driver_actions_cache["_merged"] = merged
    return merged


def _load_actions_library(project_dir: str) -> dict[str, dict]:
    """Load and merge the reusable actions library.

    Search order (later wins):
      1. ``templates/common/ne-actions.json``  (package-level defaults)
      2. ``<project_dir>/ne-actions.json``     (project-level overrides)

    Returns a dict mapping ``action-id → action-definition``.
    """
    cache_key = project_dir
    if cache_key in _actions_cache:
        return _actions_cache[cache_key]

    merged: dict[str, dict] = {}

    for path in [_GLOBAL_ACTIONS_PATH, Path(project_dir) / "ne-actions.json"]:
        if path.is_file():
            try:
                with open(path) as f:
                    data = json.load(f)
                actions_map = data.get("actions", {})
                if isinstance(actions_map, dict):
                    merged.update(actions_map)
            except (json.JSONDecodeError, OSError):
                pass

    _actions_cache[cache_key] = merged
    return merged


def clear_actions_cache() -> None:
    """Clear the actions library cache (useful after project switch)."""
    _actions_cache.clear()
    _driver_actions_cache.clear()


# ---------------------------------------------------------------------------
# Public data-classes (plain dicts with well-known keys)
# ---------------------------------------------------------------------------

# An action descriptor as it appears in the env JSON:
# {
#   "id":          str   — unique key
#   "label":       str   — button text
#   "icon":        str   — lucide icon name (default "terminal")
#   "type":        str   — "console" | "ssh" | "exec" | "exec-with-data" | "exec-output"
#   "command":     str   — shell command template (for exec types)
#   "confirm":     str?  — confirmation prompt template
#   "host":        str?  — for type=ssh
#   "user":        str?  — for type=ssh  (default "root")
#   "port":        int?  — for type=ssh  (default 22)
#   "data_source": str?  — "inline" | "file-picker" | "file:<path>"
#   "data":        any?  — inline payload (or ${env.*} ref)
#   "file_filter": str?  — glob for file-picker  (e.g. "*.bin,*.img")
#   "categories":  list? — restrict to these device categories
# }


# ---------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------


def load_env(env_filename: str | None, project_dir: str) -> dict[str, Any]:
    """Load an env file and return a normalised ``{driver_args, actions}``
    dict.  Returns empty sections when *env_filename* is ``None``.

    Action entries can be:
      • A full action dict (as before).
      • A string ``"$ref:<action-id>"`` — resolved from the ne-actions
        library (project-level ``ne-actions.json`` → global
        ``templates/common/ne-actions.json``).
      • A dict ``{"$ref": "<action-id>", ...overrides}`` — library action
        with specific fields overridden.
    """
    if not env_filename:
        return {"driver_args": {}, "actions": []}

    path = os.path.join(project_dir, env_filename)
    if not os.path.isfile(path):
        return {"driver_args": {}, "actions": []}

    with open(path) as f:
        raw: dict = json.load(f)

    drivers_list: list = raw.pop("drivers", [])  # preserve at top level
    driver_args: dict = raw.pop("driver_args", {})
    actions_raw: list = raw.pop("actions", [])
    health: dict | None = raw.pop("health", None)

    # Backward-compat: any remaining top-level keys are migrated into
    # driver_args so old-style flat env files keep working.
    if raw:
        driver_args = {**raw, **driver_args}

    # --- Resolve $ref entries in the actions list ---
    library = _load_actions_library(project_dir)
    driver_acts = _load_driver_actions()  # fallback: actions from json-drivers
    actions: list[dict] = []
    for entry in actions_raw:
        if isinstance(entry, str) and entry.startswith("$ref:"):
            ref_id = entry[5:]
            if ref_id in library:
                actions.append(dict(library[ref_id]))  # copy
            elif ref_id in driver_acts:
                actions.append(dict(driver_acts[ref_id]))
            # silently skip unknown refs
        elif isinstance(entry, dict) and "$ref" in entry:
            ref_id = entry["$ref"]
            base = library.get(ref_id) or driver_acts.get(ref_id)
            if base:
                merged = dict(base)
                # Apply overrides (everything except $ref itself)
                for k, v in entry.items():
                    if k != "$ref":
                        merged[k] = v
                actions.append(merged)
            else:
                actions.append(entry)  # keep as-is if ref not found
        else:
            actions.append(entry)

    result: dict[str, Any] = {"driver_args": driver_args, "actions": actions}
    if drivers_list:
        result["drivers"] = drivers_list
    if health is not None:
        result["health"] = health
    return result


# ---------------------------------------------------------------------------
# Template expansion
# ---------------------------------------------------------------------------

_VAR_RE = re.compile(r"\$\{([^}]+)\}")


def _deep_get(d: dict, dotted_key: str, default: Any = "") -> Any:
    """Retrieve a nested value with a dotted key like 'a.b.c'."""
    parts = dotted_key.split(".")
    cur: Any = d
    for p in parts:
        if isinstance(cur, dict):
            cur = cur.get(p, default)
        else:
            return default
    return cur


def build_template_vars(
    *,
    node_dict: dict,
    vm_name: str,
    env_data: dict,
    project_dir: str,
    project_id: str = "",
    extra: dict | None = None,
) -> dict[str, Any]:
    """Build the full variable bag available to action templates."""
    # Merge driver_args from all overlay drivers first, then top-level wins.
    # This lets ${env.foo} resolve even when 'foo' lives in an overlay driver's
    # driver_args (e.g. a JSON-only driver like linux-stats added as a capability).
    driver_args: dict = {}
    for _drv_entry in env_data.get("drivers", []):
        _da = _drv_entry.get("driver_args")
        if isinstance(_da, dict):
            driver_args.update(_da)
    driver_args.update(env_data.get("driver_args", {}))
    vars_: dict[str, Any] = {
        "vm_name": vm_name,
        "project_dir": project_dir,
        "project_id": project_id,
    }

    # node.* (flat top-level fields)
    for k, v in node_dict.items():
        if isinstance(v, (str, int, float, bool)):
            vars_[f"node.{k}"] = v
    vars_["node.id"] = node_dict.get("id", "")

    # node.properties.* (nested properties — image, command, etc.)
    props = node_dict.get("properties") or {}
    for k, v in props.items():
        if isinstance(v, (str, int, float, bool)):
            vars_[f"node.properties.{k}"] = v

    # iface.<id>.<field>  (all interfaces)
    for iface in node_dict.get("interfaces", []):
        iid = iface.get("id", "")
        for k, v in iface.items():
            if isinstance(v, (str, int, float, bool)):
                vars_[f"iface.{iid}.{k}"] = v

    # env.* (driver_args values — supports dotted paths)
    # We store both flat leaves AND intermediate dicts so that
    # ${env.inventory} resolves to the whole object while
    # ${env.inventory.sn} resolves to the leaf value.
    def _flatten(prefix: str, obj: Any) -> None:
        vars_[f"env.{prefix}"] = obj  # always store the node itself
        if isinstance(obj, dict):
            for k, v in obj.items():
                _flatten(f"{prefix}.{k}" if prefix else k, v)

    for k, v in driver_args.items():
        _flatten(k, v)

    # json: prefix is handled during expansion, not here.

    if extra:
        vars_.update(extra)

    return vars_


def expand_template(template: str, vars_: dict[str, Any], _depth: int = 0) -> str:
    """Replace ``${key}`` placeholders in *template*.

    Performs up to 3 expansion passes so that nested references work.
    E.g. if ``env.dcn_network`` = ``${project_id}-triv-dcn`` and
    ``project_id`` = ``my-lab``, the first pass produces
    ``my-lab-triv-dcn`` which has no more placeholders.
    """
    if not template or "$" not in template:
        return template

    def _replacer(m: re.Match) -> str:
        key = m.group(1)
        # json: prefix — serialise the referenced value
        if key.startswith("json:"):
            inner_key = key[5:]
            val = vars_.get(inner_key, "")
            return json.dumps(val) if not isinstance(val, str) else val
        val = vars_.get(key, m.group(0))  # leave unmatched as-is
        if isinstance(val, (dict, list)):
            return json.dumps(val)
        return str(val)

    result = _VAR_RE.sub(_replacer, template)

    # Re-expand if there are still placeholders and we haven't exceeded
    # the recursion limit (prevents infinite loops on circular refs).
    if "${" in result and result != template and _depth < 2:
        result = expand_template(result, vars_, _depth + 1)

    return result


# ---------------------------------------------------------------------------
# Resolve actions for a node
# ---------------------------------------------------------------------------


def resolve_actions(
    *,
    actions: list[dict],
    node_dict: dict,
    vm_name: str,
    env_data: dict,
    project_dir: str,
    project_id: str = "",
    extra_vars: dict | None = None,
    node_category: str | None = None,
) -> list[dict]:
    """Expand all templates in *actions* and filter by category.

    Returns a new list of action dicts ready for the frontend.
    """
    vars_ = build_template_vars(
        node_dict=node_dict,
        vm_name=vm_name,
        env_data=env_data,
        project_dir=project_dir,
        project_id=project_id,
        extra=extra_vars,
    )

    resolved: list[dict] = []
    for raw_act in actions:
        # Category filter
        cats = raw_act.get("categories")
        if cats and node_category and node_category not in cats:
            continue

        act: dict[str, Any] = {}
        for k, v in raw_act.items():
            if k == "categories":
                continue
            if isinstance(v, str):
                act[k] = expand_template(v, vars_)
            elif k == "data":
                # data can be a ${env.*} reference (string) or inline object
                if isinstance(v, str):
                    expanded = expand_template(v, vars_)
                    # Try to parse as JSON for structured data
                    try:
                        act[k] = json.loads(expanded)
                    except (json.JSONDecodeError, TypeError):
                        act[k] = expanded
                else:
                    act[k] = v
            else:
                act[k] = v

        # Ensure required fields
        act.setdefault("id", act.get("label", "action"))
        act.setdefault("icon", "terminal")
        act.setdefault("type", "exec")

        resolved.append(act)

    return resolved
