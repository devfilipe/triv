"""
triv — Network Element Virtualisation framework.

Multi-vendor, topology-aware orchestration for network element emulation.
Supports VMs (libvirt), containers (docker/podman), and physical devices.
"""

__version__ = "1.0.0"

from .core.enums import (
    DeviceCategory,
    InterfaceDirection,
    InterfaceType,
    LinkType,
    RuntimeBackend,
)
from .core.events import EventBus
from .core.models import Interface, Link, LinkEndpoint, Node, Topology
from .drivers import DriverBase, DriverRegistry, GenericDriver
from .plugins import PluginBase, PluginManager

__all__ = [
    "DeviceCategory",
    "DriverBase",
    "DriverRegistry",
    "EventBus",
    "GenericDriver",
    "Interface",
    "InterfaceDirection",
    "InterfaceType",
    "Link",
    "LinkEndpoint",
    "LinkType",
    "Node",
    "PluginBase",
    "PluginManager",
    "RuntimeBackend",
    "Topology",
]
