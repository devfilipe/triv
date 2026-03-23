"""triv.plugins.manager — Plugin discovery, lifecycle, and shared context."""

from __future__ import annotations

from dataclasses import dataclass, field

from triv.core.events import EventBus
from triv.core.models import Topology
from triv.drivers.base import DriverBase

from .base import PluginBase


@dataclass
class TrivContext:
    """Shared context exposed to plugins (read-mostly, safe APIs)."""

    topology: Topology | None = None
    drivers: dict[str, DriverBase] = field(default_factory=dict)
    state: dict = field(default_factory=dict)
    event_bus: EventBus = field(default_factory=EventBus)
    project_dir: str = ""

    def get_node(self, node_id: str) -> dict | None:
        if self.topology:
            n = self.topology.get_node(node_id)
            return n.to_dict() if n else None
        return None

    def get_nodes_by_driver(self, driver_name: str) -> list[dict]:
        if not self.topology:
            return []
        return [n.to_dict() for n in self.topology.nodes if n.driver == driver_name]

    def get_nodes_by_category(self, category: str) -> list[dict]:
        if not self.topology:
            return []
        return [n.to_dict() for n in self.topology.nodes if n.category.value == category]

    def get_links_for_node(self, node_id: str) -> list[dict]:
        if not self.topology:
            return []
        return [lk.to_dict() for lk in self.topology.links_for_node(node_id)]


class PluginManager:
    """Discovers, loads, and manages plugin lifecycle."""

    def __init__(self, event_bus: EventBus) -> None:
        self.event_bus = event_bus
        self._plugins: dict[str, PluginBase] = {}

    def load(self, plugin: PluginBase, ctx: TrivContext) -> None:
        plugin.on_load(ctx)
        for event, handler in plugin.subscriptions().items():
            self.event_bus.subscribe(event, handler)
        self._plugins[plugin.name] = plugin
        print(f"  Plugin loaded: {plugin.name} v{plugin.version}")

    def unload(self, name: str) -> None:
        plugin = self._plugins.pop(name, None)
        if plugin:
            for event, handler in plugin.subscriptions().items():
                self.event_bus.unsubscribe(event, handler)
            plugin.on_unload()

    def unload_all(self) -> None:
        for name in list(self._plugins):
            self.unload(name)

    @property
    def loaded(self) -> list[str]:
        return list(self._plugins.keys())

    def get(self, name: str) -> PluginBase | None:
        return self._plugins.get(name)

    @staticmethod
    def discover() -> dict[str, type]:
        """Discover plugins via entry_points (triv.plugins group)."""
        found: dict[str, type] = {}
        try:
            from importlib.metadata import entry_points

            eps = entry_points(group="triv.plugins")
            for ep in eps:
                try:
                    found[ep.name] = ep.load()
                except Exception as e:
                    print(f"  Warning: failed to load plugin '{ep.name}': {e}")
        except Exception:
            pass
        return found
