"""
Bootstrap — driver discovery, topology loading, plugin initialisation.

Called once from ``app.py`` startup to populate ``shared`` module globals.
"""

import importlib.util
import sys
import types

from triv.core import topology as topo_mod
from triv.core import network_v2 as netv2
from triv.drivers import discover_drivers
from triv.drivers import base as _base_mod
from triv.drivers.base import DriverBase as _DB
from triv.plugins.manager import PluginManager, TrivContext

import shared


def _register_vendor_py_drivers() -> None:
    """Load vendor py-drivers from ~/.triv/vendors/*/drivers/*.py."""
    for py_file in sorted(shared.TRIV_HOME.glob("vendors/*/drivers/*.py")):
        if py_file.name.startswith("_"):
            continue
        vendor_name = py_file.parent.parent.name
        pkg_name = f"_triv_vendor_{vendor_name}_drivers"
        mod_name = f"{pkg_name}.{py_file.stem}"
        if pkg_name not in sys.modules:
            pkg = types.ModuleType(pkg_name)
            pkg.__path__ = [str(py_file.parent)]
            pkg.__package__ = pkg_name
            sys.modules[pkg_name] = pkg
            sys.modules[f"{pkg_name}.base"] = _base_mod
        try:
            spec = importlib.util.spec_from_file_location(
                mod_name,
                str(py_file),
                submodule_search_locations=[],
            )
            mod = importlib.util.module_from_spec(spec)
            mod.__package__ = pkg_name
            sys.modules[mod_name] = mod
            spec.loader.exec_module(mod)
            for attr in dir(mod):
                cls = getattr(mod, attr)
                if isinstance(cls, type) and issubclass(cls, _DB) and cls is not _DB:
                    drv = cls()
                    if drv.name not in shared.registry:
                        shared.registry.register(drv)
                        print(f"[drivers] Registered vendor driver: {drv.name} ({py_file})")
                    break
        except Exception as e:
            print(f"[drivers] Warning: failed to load vendor driver {py_file}: {e}")


def resolve_network_refs_in_topology() -> None:
    """Resolve $ref entries in topology.network_defs using vendor network files.

    Only entries with a ``_ref`` are re-resolved from their source file.
    Inline entries are kept as-is to avoid data loss.
    """
    if not shared.topology or not shared.topology.network_defs:
        return
    try:
        net_dir = netv2.networks_dir_for_project(str(shared.PROJECT_DIR), shared.TRIV_HOME)
        inline_entries: list = []
        refs_batch: list[dict] = []
        order: list[tuple[str, int]] = []
        for nd in shared.topology.network_defs:
            if nd._ref:
                order.append(("ref", len(refs_batch)))
                refs_batch.append(nd.to_ref_dict())
            else:
                order.append(("inline", len(inline_entries)))
                inline_entries.append(nd)
        resolved = netv2.resolve_network_refs(refs_batch, net_dir) if refs_batch else []
        final: list = []
        ri = ii = 0
        for kind, _ in order:
            if kind == "ref":
                if ri < len(resolved):
                    final.append(resolved[ri])
                    ri += 1
            else:
                final.append(inline_entries[ii])
                ii += 1
        shared.topology.network_defs = final
    except Exception as e:
        print(f"[network_v2] Warning: failed to resolve network refs: {e}")


def bootstrap() -> None:
    """One-shot initialisation: discover drivers, load topology, load plugins."""

    # 1. Discover and register entry-point drivers
    for drv_name, drv_cls in discover_drivers().items():
        shared.registry.register(drv_cls())

    # 2. Register vendor py-drivers
    _register_vendor_py_drivers()

    # 3. Load topology (if PROJECT_DIR is set)
    if shared.TOPOLOGY_FILE.exists():
        try:
            shared.topology = topo_mod.load(str(shared.TOPOLOGY_FILE))
        except Exception as e:
            print(f"Warning: failed to load topology: {e}")

    # 4. Resolve network $ref entries
    resolve_network_refs_in_topology()

    # 5. Plugin manager
    shared.plugin_mgr = PluginManager(shared.event_bus)
    shared.ctx = TrivContext(
        topology=shared.topology,
        drivers=shared.registry.all(),
        event_bus=shared.event_bus,
        project_dir=str(shared.PROJECT_DIR),
    )

    for plugin_name, plugin_cls in PluginManager.discover().items():
        try:
            shared.plugin_mgr.load(plugin_cls(), shared.ctx)
        except Exception as e:
            print(f"Warning: failed to load plugin '{plugin_name}': {e}")

    # 6. State tracker — reconcile
    from reconcile import reconcile_state

    reconcile_state()
