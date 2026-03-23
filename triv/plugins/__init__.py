"""triv.plugins — Plugin system for extensibility (AI agents, metrics, etc)."""

from .base import PluginBase
from .manager import TrivContext, PluginManager

__all__ = ["TrivContext", "PluginBase", "PluginManager"]
