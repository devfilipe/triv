"""triv.drivers.registry — Driver discovery and instantiation."""

from __future__ import annotations

from typing import Type

from .base import DriverBase
from .generic_driver import GenericDriver
from .generic_driver_libvirt import GenericLibvirtDriver
from .generic_driver_container import GenericContainerDriver
from .generic_driver_app import GenericAppDriver
from .generic_driver_remote import GenericRemoteDriver
from .generic_driver_netcfg import GenericNetcfgDriver
from .generic_driver_llm import GenericLlmDriver
from .generic_driver_ollama import GenericOllamaDriver
from .generic_driver_agent import GenericAgentDriver


class DriverRegistry:
    """Registry of available drivers. Always includes built-in drivers."""

    def __init__(self) -> None:
        self._drivers: dict[str, DriverBase] = {}
        # Built-in drivers
        self.register(GenericDriver())
        self.register(GenericLibvirtDriver())
        self.register(GenericContainerDriver())
        self.register(GenericAppDriver())
        self.register(GenericRemoteDriver())
        self.register(GenericNetcfgDriver())
        self.register(GenericLlmDriver())
        self.register(GenericOllamaDriver())
        self.register(GenericAgentDriver())

    def register(self, driver: DriverBase) -> None:
        self._drivers[driver.name] = driver

    def get(self, name: str) -> DriverBase:
        if name not in self._drivers:
            raise KeyError(f"Driver '{name}' not found. Available: {', '.join(self._drivers)}")
        return self._drivers[name]

    def get_or_default(self, name: str) -> DriverBase:
        return self._drivers.get(name, self._drivers["generic"])

    @property
    def names(self) -> list[str]:
        return list(self._drivers.keys())

    def all(self) -> dict[str, DriverBase]:
        return dict(self._drivers)

    def __contains__(self, name: str) -> bool:
        return name in self._drivers


def discover_drivers() -> dict[str, Type[DriverBase]]:
    """Discover drivers via entry_points (triv.drivers group)."""
    found: dict[str, Type[DriverBase]] = {}
    try:
        from importlib.metadata import entry_points

        eps = entry_points(group="triv.drivers")
        for ep in eps:
            try:
                cls = ep.load()
                found[ep.name] = cls
            except Exception as e:
                print(f"  Warning: failed to load driver '{ep.name}': {e}")
    except Exception:
        pass
    return found
