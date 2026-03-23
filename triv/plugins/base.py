"""triv.plugins.base — Plugin abstract base class."""

from __future__ import annotations

from abc import ABC
from typing import TYPE_CHECKING, Callable

if TYPE_CHECKING:
    from .manager import TrivContext


class PluginBase(ABC):
    """Base class for triv plugins."""

    name: str = "unnamed"
    version: str = "0.0.0"
    description: str = ""

    def on_load(self, ctx: "TrivContext") -> None:
        """Called when plugin is loaded. Store context for later use."""
        self.ctx = ctx

    def on_unload(self) -> None:
        """Called when plugin is unloaded."""
        pass

    def subscriptions(self) -> dict[str, Callable]:
        """Return event_name → handler mapping.

        Available events:
            topology.loaded, topology.validated
            node.pre_start, node.post_start
            node.pre_stop, node.post_stop
            link.created, link.destroyed
            command.pre_run, command.post_run
            cleanup.pre, cleanup.post
            health.check, status.collect
        """
        return {}
