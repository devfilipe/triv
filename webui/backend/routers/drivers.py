"""
Router: drivers — driver catalog, scaffold, CRUD, actions, templates.
"""

import json
import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException, Body

from triv.core import env as env_mod

import shared
from shared import TRIV_HOME, TOOLS_DIR, registry

router = APIRouter(prefix="/api", tags=["drivers"])


# ── Helpers ──────────────────────────────────────────────────────


def _find_py_driver_source(driver_id: str) -> Path | None:
    """Locate the .py source file for a vendor py-driver."""
    triv_home = TRIV_HOME
    if not triv_home.is_dir():
        return None
    for py_file in sorted(triv_home.glob("vendors/*/drivers/*.py")):
        if py_file.name.startswith("_"):
            continue
        if py_file.stem.replace("_", "-") == driver_id or py_file.stem == driver_id:
            return py_file
        try:
            src = py_file.read_text()
            import re as _re

            m = _re.search(r'name\s*[=:]\s*["\']([^"\']+)["\']', src)
            if m and m.group(1) == driver_id:
                return py_file
        except OSError:
            continue
    return None


def _scan_driver_usage(driver_id: str, action_name: str | None = None) -> list[dict]:
    triv_home = TRIV_HOME
    usages: list[dict] = []
    cap_dirs: list[Path] = []
    if triv_home.is_dir():
        for d in sorted(triv_home.glob("vendors/*/capabilities")):
            cap_dirs.append(d)

    env_to_nodes: dict[str, list[str]] = {}
    topo_files = list(triv_home.glob("vendors/*/projects/*/topology.json"))
    for tf in topo_files:
        try:
            with open(tf) as fh:
                tdata = json.load(fh)
            for nd in tdata.get("nodes", []):
                env = nd.get("env", "")
                if env:
                    fname = env.rsplit("/", 1)[-1] if "/" in env else env
                    env_to_nodes.setdefault(fname, []).append(nd["id"])
        except (json.JSONDecodeError, OSError):
            continue

    for cap_dir in cap_dirs:
        for cap_file in sorted(cap_dir.glob("*.json")):
            try:
                with open(cap_file) as fh:
                    data = json.load(fh)
            except (json.JSONDecodeError, OSError):
                continue

            fname = cap_file.name
            node_ids = env_to_nodes.get(fname, [])
            drivers_list = data.get("drivers", [])
            actions_list = data.get("actions", [])

            if action_name:
                refs = [
                    a
                    for a in actions_list
                    if isinstance(a, dict)
                    and a.get("$ref") == action_name
                    and a.get("driver") == driver_id
                ]
                if refs:
                    usages.append(
                        {
                            "file": fname,
                            "path": str(cap_file),
                            "node_ids": node_ids,
                            "kind": "action",
                            "action": action_name,
                            "driver": driver_id,
                        }
                    )
            else:
                drv_refs = [
                    d for d in drivers_list if isinstance(d, dict) and d.get("driver") == driver_id
                ]
                act_refs = [
                    a for a in actions_list if isinstance(a, dict) and a.get("driver") == driver_id
                ]
                if drv_refs or act_refs:
                    usages.append(
                        {
                            "file": fname,
                            "path": str(cap_file),
                            "node_ids": node_ids,
                            "kind": "driver",
                            "driver": driver_id,
                            "driver_refs": len(drv_refs),
                            "action_refs": len(act_refs),
                        }
                    )
    return usages


def _remove_driver_from_capabilities(driver_id: str, usages: list[dict]) -> list[str]:
    cleaned: list[str] = []
    for u in usages:
        cap_path = Path(u["path"])
        if not cap_path.is_file():
            continue
        try:
            with open(cap_path) as fh:
                data = json.load(fh)
        except (json.JSONDecodeError, OSError):
            continue

        changed = False
        drivers_list = data.get("drivers", [])
        new_drivers = [
            d for d in drivers_list if not (isinstance(d, dict) and d.get("driver") == driver_id)
        ]
        if len(new_drivers) != len(drivers_list):
            data["drivers"] = new_drivers
            changed = True

        actions_list = data.get("actions", [])
        new_actions = [
            a for a in actions_list if not (isinstance(a, dict) and a.get("driver") == driver_id)
        ]
        if len(new_actions) != len(actions_list):
            data["actions"] = new_actions
            changed = True

        if changed and data.get("drivers"):
            data["driver_args"] = data["drivers"][0].get("driver_args", {})
        elif changed and not data.get("drivers"):
            data["driver_args"] = {}

        if changed:
            try:
                with open(cap_path, "w") as fh:
                    json.dump(data, fh, indent=2, ensure_ascii=False)
                    fh.write("\n")
                cleaned.append(cap_path.name)
            except OSError:
                continue

    env_mod.clear_actions_cache()
    return cleaned


def _remove_action_from_capabilities(
    driver_id: str, action_name: str, usages: list[dict]
) -> list[str]:
    cleaned: list[str] = []
    for u in usages:
        cap_path = Path(u["path"])
        if not cap_path.is_file():
            continue
        try:
            with open(cap_path) as fh:
                data = json.load(fh)
        except (json.JSONDecodeError, OSError):
            continue

        actions_list = data.get("actions", [])
        new_actions = [
            a
            for a in actions_list
            if not (
                isinstance(a, dict)
                and a.get("driver") == driver_id
                and (a.get("$ref") == action_name or a.get("id") == action_name)
            )
        ]
        if len(new_actions) != len(actions_list):
            data["actions"] = new_actions
            try:
                with open(cap_path, "w") as fh:
                    json.dump(data, fh, indent=2, ensure_ascii=False)
                    fh.write("\n")
                cleaned.append(cap_path.name)
            except OSError:
                continue

    if cleaned:
        env_mod.clear_actions_cache()
    return cleaned


def _domain_template_search_dirs() -> list[tuple[str, Path]]:
    dirs = [
        ("triv", TOOLS_DIR / "triv" / "templates" / "libvirt" / "domains"),
        ("project", Path(shared.PROJECT_DIR) / "templates" / "libvirt" / "domains"),
    ]
    triv_home = TRIV_HOME
    if triv_home.is_dir():
        for vdir in sorted(triv_home.glob("vendors/*/templates/libvirt/domains")):
            vendor_name = vdir.parent.parent.parent.name
            dirs.append((f"vendor:{vendor_name}", vdir))
    return dirs


# ── Endpoints ────────────────────────────────────────────────────


@router.get("/drivers")
def get_drivers():
    result = []
    for name, drv in registry.all().items():
        meta = drv.metadata()
        result.append(
            {
                "name": name,
                "vendor": meta.vendor_name,
                "label": meta.driver_label,
                "version": drv.version,
                "accent_color": meta.accent_color,
                "logo_url": meta.logo_url,
                "actions": [
                    {"name": c.name, "label": c.label, "icon": c.icon, "description": c.description}
                    for c in drv.commands()
                ],
            }
        )
    return result


@router.get("/drivers/catalog")
def get_driver_catalog():
    catalog: list[dict] = []
    triv_home = TRIV_HOME

    json_driver_dirs: list[tuple[str, Path]] = [
        ("native", TOOLS_DIR / "triv" / "drivers"),
        ("native", Path(shared.PROJECT_DIR) / "drivers"),
    ]
    if triv_home.is_dir():
        for vendor_dir in sorted(triv_home.glob("vendors/*/drivers")):
            vname = vendor_dir.parent.name
            json_driver_dirs.append((f"vendor:{vname}", vendor_dir))

    seen_ids: set = set()
    for origin, d in json_driver_dirs:
        if not d.is_dir():
            continue
        for f in sorted(d.glob("*.json")):
            try:
                with open(f) as fh:
                    data = json.load(fh)
                did = data.get("id", f.stem)
                if did in seen_ids:
                    continue
                seen_ids.add(did)
                catalog.append(
                    {
                        "id": did,
                        "kind": "json-driver",
                        "type": data.get("type", "unknown"),
                        "label": data.get("label", did),
                        "vendor": data.get("vendor", ""),
                        "version": data.get("version", "1.0.0"),
                        "description": data.get("description", ""),
                        "accent_color": data.get("accent_color", "#6c7086"),
                        "driver_args_schema": data.get("driver_args_schema", {}),
                        "actions": {
                            k: v
                            for k, v in data.get("actions", {}).items()
                            if not k.startswith("_")
                        },
                        "path": str(f),
                        "origin": origin,
                    }
                )
            except (json.JSONDecodeError, OSError):
                continue

    _builtin_ids = {
        "generic",
        "generic-driver-libvirt-python",
        "generic-driver-container-python",
        "generic-driver-app-python",
        "generic-driver-remote-python",
        "generic-driver-netcfg",
        "generic-driver-llm-python",
        "generic-driver-ollama-python",
        "generic-driver-agent-python",
    }
    _hidden_ids = {"generic"}
    for name, drv in registry.all().items():
        if name in seen_ids or name in _hidden_ids:
            continue
        seen_ids.add(name)
        meta = drv.metadata()
        drv_type = "unknown"
        schema: dict = {}
        if hasattr(drv, "driver_type") and callable(drv.driver_type):
            drv_type = drv.driver_type()
        if hasattr(drv, "driver_args_schema") and callable(drv.driver_args_schema):
            schema = drv.driver_args_schema()

        if name in _builtin_ids:
            drv_origin = "native"
        else:
            vendor_slug = (
                meta.vendor_name.lower().replace(" ", "-") if meta.vendor_name else "custom"
            )
            drv_origin = f"vendor:{vendor_slug}"

        py_actions: dict = {}
        for c in drv.commands():
            py_actions[c.name] = {
                "id": c.name,
                "label": c.label,
                "icon": c.icon,
                "type": "py-command",
                "description": c.description,
            }

        drv_source = ""
        if hasattr(drv, "__module__") and drv.__module__:
            _mod = sys.modules.get(drv.__module__)
            if _mod and hasattr(_mod, "__file__") and _mod.__file__:
                drv_source = _mod.__file__

        if drv_source:
            try:
                import re as _re

                _src = Path(drv_source).read_text()
                for _m in _re.finditer(r"    def (action_(\w+))\(self", _src):
                    act_method, act_id = _m.group(1), _m.group(2).replace("_", "-")
                    if act_id not in py_actions:
                        py_actions[act_id] = {
                            "id": act_id,
                            "label": act_id.replace("-", " ").title(),
                            "icon": "code",
                            "type": "py-action",
                            "description": f"Python action method: {act_method}()",
                        }
            except OSError:
                pass

        catalog.append(
            {
                "id": name,
                "kind": "py-driver",
                "type": drv_type,
                "label": meta.driver_label,
                "vendor": meta.vendor_name,
                "version": drv.version,
                "description": meta.description,
                "accent_color": meta.accent_color,
                "driver_args_schema": schema,
                "actions": py_actions,
                "source": drv_source,
                "origin": drv_origin,
            }
        )

    # Vendor py-drivers from ~/.triv/vendors/*/drivers/*.py (late-discovered)
    if triv_home.is_dir():
        import importlib.util
        import types
        from triv.drivers import base as _base_mod
        from triv.drivers.base import DriverBase as _DB

        for py_file in sorted(triv_home.glob("vendors/*/drivers/*.py")):
            if py_file.name.startswith("_"):
                continue
            vendor_name = py_file.parent.parent.name
            pkg_name = f"_triv_vendor_{vendor_name}_drivers"
            mod_name = f"{pkg_name}.{py_file.stem}"
            try:
                if pkg_name not in sys.modules:
                    pkg = types.ModuleType(pkg_name)
                    pkg.__path__ = [str(py_file.parent)]
                    pkg.__package__ = pkg_name
                    sys.modules[pkg_name] = pkg
                    sys.modules[f"{pkg_name}.base"] = _base_mod
                if mod_name not in sys.modules:
                    spec = importlib.util.spec_from_file_location(
                        mod_name, str(py_file), submodule_search_locations=[]
                    )
                    mod = importlib.util.module_from_spec(spec)
                    mod.__package__ = pkg_name
                    sys.modules[mod_name] = mod
                    spec.loader.exec_module(mod)
                else:
                    mod = sys.modules[mod_name]
                for attr in dir(mod):
                    cls = getattr(mod, attr)
                    if isinstance(cls, type) and issubclass(cls, _DB) and cls is not _DB:
                        drv = cls()
                        drv_id = getattr(drv, "name", py_file.stem)
                        if drv_id in seen_ids:
                            break
                        seen_ids.add(drv_id)
                        meta = drv.metadata()
                        drv_type = "unknown"
                        schema = {}
                        if hasattr(drv, "driver_type") and callable(drv.driver_type):
                            drv_type = drv.driver_type()
                        if hasattr(drv, "driver_args_schema") and callable(drv.driver_args_schema):
                            schema = drv.driver_args_schema()
                        v_actions: dict = {}
                        for c in drv.commands():
                            v_actions[c.name] = {
                                "id": c.name,
                                "label": c.label,
                                "icon": c.icon,
                                "type": "py-command",
                                "description": c.description,
                            }
                        try:
                            import re as _re2

                            _vsrc = py_file.read_text()
                            for _m2 in _re2.finditer(r"    def (action_(\w+))\(self", _vsrc):
                                act_method, act_id = _m2.group(1), _m2.group(2).replace("_", "-")
                                if act_id not in v_actions:
                                    v_actions[act_id] = {
                                        "id": act_id,
                                        "label": act_id.replace("-", " ").title(),
                                        "icon": "code",
                                        "type": "py-action",
                                        "description": f"Python action method: {act_method}()",
                                    }
                        except OSError:
                            pass
                        catalog.append(
                            {
                                "id": drv_id,
                                "kind": "py-driver",
                                "type": drv_type,
                                "label": meta.driver_label,
                                "vendor": meta.vendor_name,
                                "version": drv.version,
                                "description": meta.description,
                                "accent_color": meta.accent_color,
                                "driver_args_schema": schema,
                                "actions": v_actions,
                                "source": str(py_file),
                                "origin": f"vendor:{vendor_name}",
                            }
                        )
                        if drv_id not in registry:
                            registry.register(drv)
                        break
            except Exception as e:
                print(f"[catalog] Warning: failed to load vendor driver {py_file}: {e}")

    return catalog


@router.get("/drivers/catalog/{driver_id}")
def get_driver_catalog_detail(driver_id: str):
    catalog = get_driver_catalog()
    for d in catalog:
        if d["id"] == driver_id:
            return d
    raise HTTPException(404, f"Driver '{driver_id}' not found in catalog")


@router.get("/drivers/{driver_name}")
def get_driver_detail(driver_name: str):
    try:
        drv = registry.get(driver_name)
    except KeyError:
        raise HTTPException(404, f"Driver '{driver_name}' not found")
    meta = drv.metadata()
    return {
        "name": drv.name,
        "vendor": meta.vendor_name,
        "label": meta.driver_label,
        "version": drv.version,
        "accent_color": meta.accent_color,
        "logo_url": meta.logo_url,
        "actions": [
            {"name": c.name, "label": c.label, "icon": c.icon, "description": c.description}
            for c in drv.commands()
        ],
    }


@router.post("/drivers/scaffold")
def scaffold_driver(body: dict = Body(...)):
    name = body.get("name", "").strip()
    kind = body.get("kind", "json-driver")
    vendor = body.get("vendor", "").strip() or "custom"
    base_type = body.get("base_type", "unknown")

    if not name:
        raise HTTPException(400, "Driver name is required")

    vendor_dir = TRIV_HOME / "vendors" / vendor / "drivers"
    vendor_dir.mkdir(parents=True, exist_ok=True)

    if kind == "json-driver":
        drv_file = vendor_dir / f"{name}.json"
        if drv_file.exists():
            raise HTTPException(409, f"Driver file already exists: {drv_file}")
        skeleton = {
            "id": name,
            "type": base_type,
            "label": name.replace("-", " ").title(),
            "vendor": vendor,
            "version": "1.0.0",
            "accent_color": "#6c7086",
            "driver_args_schema": {},
            "actions": {},
        }
        with open(drv_file, "w") as f:
            json.dump(skeleton, f, indent=2)
            f.write("\n")
    elif kind == "py-driver":
        drv_file = vendor_dir / f"{name.replace('-', '_')}.py"
        if drv_file.exists():
            raise HTTPException(409, f"Driver file already exists: {drv_file}")
        class_name = "".join(w.capitalize() for w in name.split("-")) + "Driver"
        content = f'''\
"""
Auto-generated py-driver: {name}
"""
from typing import Any
from triv.drivers.base import Branding, DriverBase, DeviceCommand


class {class_name}(DriverBase):
    name = "{name}"
    version = "1.0.0"

    def metadata(self) -> Branding:
        return Branding(
            vendor_name="{vendor}",
            driver_label="{name.replace("-", " ").title()}",
            accent_color="#6c7086",
        )

    def commands(self) -> list[DeviceCommand]:
        return []

    def driver_type(self) -> str:
        return "{base_type}"

    def driver_args_schema(self) -> dict[str, Any]:
        """Schema for driver_args used in capabilities files."""
        return {{}}
'''
        with open(drv_file, "w") as f:
            f.write(content)
    else:
        raise HTTPException(400, f"Unknown kind: {kind}")

    return {
        "ok": True,
        "driver_name": name,
        "kind": kind,
        "path": str(drv_file),
        "class_name": class_name if kind == "py-driver" else None,
        "detail": f"Driver scaffold created at {drv_file}",
    }


@router.put("/drivers/catalog/{driver_id}/actions")
def update_driver_actions(driver_id: str, body: dict = Body(...)):
    triv_home = TRIV_HOME
    new_actions = body.get("actions", {})
    if not isinstance(new_actions, dict):
        raise HTTPException(400, "actions must be a dict")

    target_file: Path | None = None
    if triv_home.is_dir():
        for f in sorted(triv_home.glob("vendors/*/drivers/*.json")):
            try:
                with open(f) as fh:
                    data = json.load(fh)
                if data.get("id", f.stem) == driver_id:
                    target_file = f
                    break
            except (json.JSONDecodeError, OSError):
                continue

    if target_file is None:
        raise HTTPException(404, f"No editable json-driver found for '{driver_id}'.")

    with open(target_file) as fh:
        data = json.load(fh)
    data["actions"] = new_actions
    with open(target_file, "w") as fh:
        json.dump(data, fh, indent=2)
    return {
        "ok": True,
        "driver_id": driver_id,
        "action_count": len(new_actions),
        "path": str(target_file),
    }


@router.get("/drivers/catalog/{driver_id}/source")
def get_py_driver_source(driver_id: str):
    src_file = _find_py_driver_source(driver_id)
    if not src_file:
        raise HTTPException(404, f"No py-driver source found for '{driver_id}'")
    return {
        "ok": True,
        "driver_id": driver_id,
        "path": str(src_file),
        "source": src_file.read_text(),
    }


@router.put("/drivers/catalog/{driver_id}/source")
def update_py_driver_source(driver_id: str, body: dict = Body(...)):
    src_file = _find_py_driver_source(driver_id)
    if not src_file:
        raise HTTPException(404, f"No py-driver source found for '{driver_id}'")
    new_source = body.get("source", "")
    if not new_source:
        raise HTTPException(400, "Missing 'source'")
    src_file.write_text(new_source)
    return {"ok": True, "driver_id": driver_id, "path": str(src_file)}


@router.put("/drivers/catalog/{driver_id}/schema")
def update_py_driver_schema(driver_id: str, body: dict = Body(...)):
    import re as _re

    src_file = _find_py_driver_source(driver_id)
    if not src_file:
        triv_home = TRIV_HOME
        if triv_home.is_dir():
            for f in sorted(triv_home.glob("vendors/*/drivers/*.json")):
                try:
                    with open(f) as fh:
                        data = json.load(fh)
                    if data.get("id", f.stem) == driver_id:
                        data["driver_args_schema"] = body.get("schema", {})
                        with open(f, "w") as fh:
                            json.dump(data, fh, indent=2)
                        return {
                            "ok": True,
                            "driver_id": driver_id,
                            "path": str(f),
                            "field_count": len(data["driver_args_schema"]),
                        }
                except (json.JSONDecodeError, OSError):
                    continue
        raise HTTPException(404, f"No editable driver found for '{driver_id}'")

    schema = body.get("schema", {})
    src = src_file.read_text()
    schema_repr = json.dumps(schema, indent=12)
    new_method = (
        "    def driver_args_schema(self) -> dict[str, Any]:\n"
        '        """Schema for driver_args used in capabilities files."""\n'
        f"        return {schema_repr}\n"
    )
    pattern = r"(    def driver_args_schema\(self\).*?\n)((?:        .*\n)*?)(?=\n    (?:def |#|@|class )|$)"
    match = _re.search(pattern, src)
    if match:
        src = src[: match.start()] + new_method + src[match.end() :]
    else:
        insert_marker = "    # ── Helpers"
        if insert_marker in src:
            src = src.replace(insert_marker, new_method + "\n" + insert_marker)
        else:
            src = src.rstrip() + "\n\n" + new_method + "\n"
    src_file.write_text(src)
    return {"ok": True, "driver_id": driver_id, "path": str(src_file), "field_count": len(schema)}


@router.get("/drivers/catalog/{driver_id}/actions/{action_name}")
def get_py_driver_action(driver_id: str, action_name: str):
    import re as _re

    src_file = _find_py_driver_source(driver_id)
    if not src_file:
        raise HTTPException(404, f"No py-driver source found for '{driver_id}'")
    src = src_file.read_text()
    method_name = f"action_{action_name.replace('-', '_')}"
    pattern = rf"(    def {_re.escape(method_name)}\(self.*?\n)((?:        .*\n)*)"
    match = _re.search(pattern, src)
    if match:
        return {
            "ok": True,
            "driver_id": driver_id,
            "action_name": action_name,
            "method_name": method_name,
            "source": match.group(0),
            "path": str(src_file),
        }
    template = (
        f"    def {method_name}(self, driver_args: dict) -> dict:\n"
        f'        """Action: {action_name}"""\n'
        f'        return {{"ok": True, "output": "{action_name} executed"}}\n'
    )
    return {
        "ok": True,
        "driver_id": driver_id,
        "action_name": action_name,
        "method_name": method_name,
        "source": template,
        "path": str(src_file),
        "is_template": True,
    }


@router.put("/drivers/catalog/{driver_id}/actions/{action_name}")
def update_py_driver_action(driver_id: str, action_name: str, body: dict = Body(...)):
    import re as _re

    src_file = _find_py_driver_source(driver_id)
    if not src_file:
        raise HTTPException(404, f"No py-driver source found for '{driver_id}'")
    new_source = body.get("source", "").rstrip() + "\n"
    method_name = f"action_{action_name.replace('-', '_')}"
    src = src_file.read_text()
    pattern = rf"(    def {_re.escape(method_name)}\(self.*?\n)((?:        .*\n)*)"
    match = _re.search(pattern, src)
    if match:
        src = src[: match.start()] + new_source + src[match.end() :]
    else:
        src = src.rstrip() + "\n\n" + new_source + "\n"
    src_file.write_text(src)
    return {
        "ok": True,
        "driver_id": driver_id,
        "action_name": action_name,
        "method_name": method_name,
        "path": str(src_file),
    }


@router.get("/drivers/catalog/{driver_id}/usage")
def get_driver_usage(driver_id: str, action: str | None = None):
    usages = _scan_driver_usage(driver_id, action_name=action)
    return {
        "ok": True,
        "driver_id": driver_id,
        "action": action,
        "usages": usages,
        "count": len(usages),
    }


@router.delete("/drivers/catalog/{driver_id}/actions/{action_name}")
def delete_driver_action(driver_id: str, action_name: str, force: bool = False):
    if not force:
        usages = _scan_driver_usage(driver_id, action_name=action_name)
        if usages:
            nodes = []
            for u in usages:
                nodes.extend(u.get("node_ids", []))
            raise HTTPException(
                409,
                {
                    "detail": f"Action '{action_name}' from driver '{driver_id}' is used by {len(usages)} capabilities file(s)",
                    "usages": usages,
                    "node_ids": list(set(nodes)),
                },
            )

    usages = _scan_driver_usage(driver_id, action_name=action_name)

    removed = False
    kind = ""
    extra: dict = {}
    src_file = _find_py_driver_source(driver_id)
    if src_file:
        import re as _re

        method_name = f"action_{action_name.replace('-', '_')}"
        src = src_file.read_text()
        pattern = rf"\n?    def {_re.escape(method_name)}\(self.*?\n((?:        .*\n)*)"
        match = _re.search(pattern, src)
        if match:
            src = src[: match.start()] + src[match.end() :]
            src_file.write_text(src)
            removed = True
            kind = "py-driver"
            extra = {"removed_method": method_name}

    if not removed:
        triv_home = TRIV_HOME
        if triv_home.is_dir():
            for f in sorted(triv_home.glob("vendors/*/drivers/*.json")):
                try:
                    with open(f) as fh:
                        data = json.load(fh)
                    if data.get("id", f.stem) == driver_id:
                        actions = data.get("actions", {})
                        if action_name in actions:
                            del actions[action_name]
                            data["actions"] = actions
                            with open(f, "w") as fh:
                                json.dump(data, fh, indent=2, ensure_ascii=False)
                                fh.write("\n")
                            removed = True
                            kind = "json-driver"
                            extra = {"remaining_actions": len(actions)}
                            break
                except (json.JSONDecodeError, OSError):
                    continue

    if not removed:
        raise HTTPException(404, f"Action '{action_name}' not found in driver '{driver_id}'")

    cleaned_files: list[str] = []
    if usages:
        cleaned_files = _remove_action_from_capabilities(driver_id, action_name, usages)

    return {
        "ok": True,
        "driver_id": driver_id,
        "action_name": action_name,
        "kind": kind,
        **extra,
        "cleaned_capabilities": cleaned_files,
    }


@router.delete("/drivers/catalog/{driver_id}")
def delete_vendor_driver(driver_id: str, force: bool = False):
    usages = _scan_driver_usage(driver_id)
    if not force:
        if usages:
            nodes = []
            for u in usages:
                nodes.extend(u.get("node_ids", []))
            raise HTTPException(
                409,
                {
                    "detail": f"Driver '{driver_id}' is used by {len(usages)} capabilities file(s)",
                    "usages": usages,
                    "node_ids": list(set(nodes)),
                },
            )

    cleaned_files: list[str] = []
    if usages:
        cleaned_files = _remove_driver_from_capabilities(driver_id, usages)

    triv_home = TRIV_HOME
    deleted_file: str = ""

    if triv_home.is_dir():
        for f in sorted(triv_home.glob("vendors/*/drivers/*.json")):
            try:
                with open(f) as fh:
                    data = json.load(fh)
                if data.get("id", f.stem) == driver_id:
                    deleted_file = str(f)
                    f.unlink()
                    return {
                        "ok": True,
                        "driver_id": driver_id,
                        "kind": "json-driver",
                        "deleted_file": deleted_file,
                        "cleaned_capabilities": cleaned_files,
                    }
            except (json.JSONDecodeError, OSError):
                continue

    src_file = _find_py_driver_source(driver_id)
    if src_file:
        deleted_file = str(src_file)
        src_file.unlink()
        if driver_id in registry:
            registry._drivers.pop(driver_id, None)
        return {
            "ok": True,
            "driver_id": driver_id,
            "kind": "py-driver",
            "deleted_file": deleted_file,
            "cleaned_capabilities": cleaned_files,
        }

    raise HTTPException(404, f"No vendor driver found for '{driver_id}'.")


@router.get("/templates/libvirt/domains")
def list_domain_templates():
    templates: list[dict] = []
    seen: set = set()
    for source, d in _domain_template_search_dirs():
        if not d.is_dir():
            continue
        for f in sorted(d.glob("*.xml")):
            if f.name in seen:
                continue
            seen.add(f.name)
            templates.append({"name": f.name, "path": str(f), "source": source})
    return templates
