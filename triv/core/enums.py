"""triv.core.enums — Shared enumerations."""

from enum import Enum


class DeviceCategory(str, Enum):
    RACK = "rack"
    CHASSIS = "chassis"
    CLUSTER = "cluster"  # Operational group with runtime (e.g. docker-compose stack)
    GROUP = "group"  # Logical/visual grouping — no runtime, no state
    CONTROLLER = "controller"
    LINECARD = "linecard"
    SWITCH = "switch"
    ROUTER = "router"
    GATEWAY = "gateway"
    SERVER = "server"
    BEACON = "beacon"
    PC = "pc"
    GENERIC = "generic"
    LLM = "llm"
    AGENT = "agent"


class RuntimeBackend(str, Enum):
    LIBVIRT = "libvirt"
    DOCKER = "docker"
    PODMAN = "podman"
    PHYSICAL = "physical"
    REMOTE = "remote"
    APP = "app"
    LLM = "llm"
    AGENT = "agent"


class InterfaceType(str, Enum):
    UNDEFINED = "undefined"
    ETHERNET = "ethernet"
    SERIAL = "serial"
    OPTICAL = "optical"
    INTERNAL = "internal"
    DUMMY = "dummy"
    BLUETOOTH = "bluetooth"
    WIFI = "wi-fi"


class InterfaceDirection(str, Enum):
    IN = "in"
    OUT = "out"
    BIDIR = "bidir"


class LinkType(str, Enum):
    CABLE = "cable"
    ETHERNET = "ethernet"
    FIBER = "fiber"
    CASCADE = "cascade"
    BACKPLANE = "backplane"
    LOGICAL = "logical"
    WIRELESS = "wireless"
    WIFI = "wi-fi"
    BLUETOOTH = "bluetooth"
    MANAGEMENT = "management"


class LinkMedium(str, Enum):
    """Physical/logical medium for the link — drives visual styling."""

    CABLE = "cable"  # copper Ethernet
    FIBER = "fiber"  # optical fibre
    WIFI = "wifi"  # Wi-Fi radio
    BLUETOOTH = "bluetooth"  # Bluetooth / BLE
    ZIGBEE = "zigbee"  # Zigbee / Thread
    LORAWAN = "lorawan"  # LoRaWAN / LPWAN
    SERIAL = "serial"  # RS-232 / RS-485 / UART
    LOGICAL = "logical"  # VLAN / tunnel / overlay
    VIRTUAL = "virtual"  # veth / internal bridge interconnection

    # Classification helpers used by the UI
    @property
    def group(self) -> str:
        """Return 'physical', 'wireless' or 'logical' for UI filtering."""
        if self in (LinkMedium.CABLE, LinkMedium.FIBER, LinkMedium.SERIAL):
            return "physical"
        if self in (
            LinkMedium.WIFI,
            LinkMedium.BLUETOOTH,
            LinkMedium.ZIGBEE,
            LinkMedium.LORAWAN,
        ):
            return "wireless"
        return "logical"  # LOGICAL, VIRTUAL
