"""triv.core.models — Dataclass models for topology, nodes, links."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, ClassVar

from .enums import (
    DeviceCategory,
    InterfaceDirection,
    InterfaceType,
    LinkMedium,
    LinkType,
    RuntimeBackend,
)


# ---------------------------------------------------------------------------
# Interface
# ---------------------------------------------------------------------------


@dataclass
class Interface:
    id: str
    type: InterfaceType = InterfaceType.ETHERNET
    direction: InterfaceDirection = InterfaceDirection.BIDIR
    label: str | None = None
    description: str | None = None
    speed: str | None = None
    connector: str | None = None
    ip: str | None = None
    vlan: int | None = None
    mac: str | None = None
    networks: list[str] = field(
        default_factory=list
    )  # network_ids this iface connects to (first = primary bridge)

    # Legacy type migration map (removed enum values → replacement)
    _TYPE_MIGRATION: ClassVar[dict[str, str]] = {
        "management": "ethernet",
        "wireless": "wi-fi",
    }

    @classmethod
    def from_dict(cls, d: dict) -> "Interface":
        raw_type = d.get("type", "ethernet")
        raw_type = cls._TYPE_MIGRATION.get(raw_type, raw_type)
        try:
            iface_type = InterfaceType(raw_type)
        except ValueError:
            iface_type = InterfaceType.UNDEFINED
        return cls(
            id=d["id"],
            type=iface_type,
            direction=InterfaceDirection(d.get("direction", "bidir")),
            label=d.get("label"),
            description=d.get("description"),
            speed=d.get("speed"),
            connector=d.get("connector"),
            ip=d.get("ip"),
            vlan=d.get("vlan"),
            mac=d.get("mac"),
            networks=d.get("networks") or [],
        )

    def to_dict(self) -> dict:
        d: dict[str, Any] = {"id": self.id, "type": self.type.value}
        if self.direction != InterfaceDirection.BIDIR:
            d["direction"] = self.direction.value
        for k in ("label", "description", "speed", "connector", "ip", "vlan", "mac"):
            v = getattr(self, k)
            if v is not None:
                d[k] = v
        if self.networks:
            d["networks"] = self.networks
        return d


# ---------------------------------------------------------------------------
# Node
# ---------------------------------------------------------------------------


@dataclass
class Node:
    id: str
    driver: str = "generic"
    category: DeviceCategory = DeviceCategory.GENERIC
    runtime: RuntimeBackend | None = None
    parent: str | None = None
    interfaces: list[Interface] = field(default_factory=list)
    properties: dict[str, Any] = field(default_factory=dict)
    env: str | None = None
    position: dict[str, float] | None = None  # {"x": ..., "y": ...} for builder canvas

    def get_interface(self, iface_id: str) -> Interface | None:
        for i in self.interfaces:
            if i.id == iface_id:
                return i
        return None

    @classmethod
    def from_dict(cls, d: dict) -> "Node":
        rt = d.get("runtime")
        pos = d.get("position")
        return cls(
            id=d["id"],
            driver=d.get("driver", "generic"),
            category=DeviceCategory(d.get("category", "generic")),
            runtime=RuntimeBackend(rt) if rt else None,
            parent=d.get("parent"),
            interfaces=[Interface.from_dict(i) for i in d.get("interfaces", [])],
            properties=d.get("properties", {}),
            env=d.get("env"),
            position=pos,
        )

    def to_dict(self) -> dict:
        d: dict[str, Any] = {
            "id": self.id,
            "driver": self.driver,
            "category": self.category.value,
        }
        if self.runtime:
            d["runtime"] = self.runtime.value
        if self.parent:
            d["parent"] = self.parent
        if self.interfaces:
            d["interfaces"] = [i.to_dict() for i in self.interfaces]
        if self.properties:
            d["properties"] = self.properties
        if self.env:
            d["env"] = self.env
        if self.position:
            d["position"] = self.position
        return d


# ---------------------------------------------------------------------------
# Link
# ---------------------------------------------------------------------------


@dataclass
class LinkEndpoint:
    node: str
    interface: str

    @classmethod
    def from_dict(cls, d: dict) -> "LinkEndpoint":
        return cls(node=d["node"], interface=d["interface"])

    def to_dict(self) -> dict:
        return {"node": self.node, "interface": self.interface}


@dataclass
class Link:
    id: str
    type: LinkType = LinkType.CABLE
    medium: LinkMedium = LinkMedium.CABLE
    source: LinkEndpoint = field(default_factory=lambda: LinkEndpoint("", ""))
    target: LinkEndpoint = field(default_factory=lambda: LinkEndpoint("", ""))
    bidir: bool = True
    segment: str | None = None
    label: str | None = None
    description: str | None = None
    properties: dict[str, Any] = field(default_factory=dict)
    network: dict[str, Any] = field(default_factory=dict)

    @property
    def bridge_name(self) -> str:
        """Name of the Linux bridge for this link.

        Priority: explicit ``network.bridge`` → segment-based → id-based.
        """
        explicit = self.network.get("bridge")
        if explicit:
            return explicit
        if self.segment:
            return f"br-{self.segment}"
        return f"br-{self.id}"

    @property
    def medium_group(self) -> str:
        """Return 'physical', 'wireless' or 'logical'."""
        return self.medium.group

    @classmethod
    def from_dict(cls, d: dict) -> "Link":
        med_raw = d.get("medium")
        if not med_raw:
            # Infer medium from type for backward compat
            lt = d.get("type", "cable")
            med_map = {
                "cable": "cable",
                "ethernet": "cable",
                "fiber": "fiber",
                "cascade": "cable",
                "backplane": "cable",
                "wireless": "wifi",
                "wi-fi": "wifi",
                "bluetooth": "bluetooth",
                "management": "cable",
                "logical": "logical",
            }
            med_raw = med_map.get(lt, "cable")
        return cls(
            id=d["id"],
            type=LinkType(d.get("type", "cable")),
            medium=LinkMedium(med_raw),
            source=LinkEndpoint.from_dict(d["source"]),
            target=LinkEndpoint.from_dict(d["target"]),
            bidir=d.get("bidir", True),
            segment=d.get("segment"),
            label=d.get("label"),
            description=d.get("description"),
            properties=d.get("properties", {}),
            network=d.get("network", {}),
        )

    def to_dict(self) -> dict:
        d: dict[str, Any] = {
            "id": self.id,
            "type": self.type.value,
            "medium": self.medium.value,
            "source": self.source.to_dict(),
            "target": self.target.to_dict(),
        }
        if not self.bidir:
            d["bidir"] = False
        for k in ("segment", "label", "description"):
            v = getattr(self, k)
            if v is not None:
                d[k] = v
        if self.properties:
            d["properties"] = self.properties
        if self.network:
            d["network"] = self.network
        return d


# ---------------------------------------------------------------------------
# NetworkDef — first-class network object (v2 networking)
# ---------------------------------------------------------------------------


@dataclass
class NetworkDef:
    """A first-class network definition.

    Stored as JSON files in ``vendors/<vendor>/networks/`` and referenced
    from topology.json via ``$ref``.  Each instance in a topology gets a
    unique ``network_id`` (8-char hex) used to qualify all host resources
    (bridges, Docker networks, VLAN interfaces) to avoid collisions.

    Supported types:
        bridge       — plain Linux bridge (L2, e.g. cascade)
        vlan-bridge  — VLAN sub-interface on a parent bridge (e.g. DCN)
        p2p          — point-to-point link (/30 or /31 subnet)
        trunk        — bridge with vlan_filtering enabled
        docker       — Docker-only network (no Linux bridge)
    """

    id: str
    network_id: str = ""  # 8-char hex, unique per topology instance
    label: str = ""
    description: str = ""
    type: str = "bridge"  # bridge | vlan-bridge | p2p | trunk | docker

    # L2 config
    bridge: str = ""  # logical bridge name (qualified at deploy time)
    vlan: int | None = None  # VLAN ID (for vlan-bridge / p2p types)
    parent_network: str = ""  # id of parent network (trunk) for VLAN overlay
    stp: bool = False
    vlan_filtering: bool = False
    vlans: list[int] = field(default_factory=list)  # for trunk type: allowed VLANs

    # L3 config
    subnet: str = ""  # e.g. "192.168.254.0/24"
    gateway: str = ""  # e.g. "192.168.254.1"

    # Docker config
    docker: dict[str, Any] = field(default_factory=dict)
    # { "enabled": bool, "subnet": str, "gateway": str, "bridge_to_docker": bool }

    # Host access
    host: dict[str, Any] = field(default_factory=dict)
    # { "access": bool, "ip": str, "prefix": int }

    # Internet access (NAT/masquerade)
    internet: dict[str, Any] = field(default_factory=dict)
    # { "access": bool }

    # Canvas layout
    position: dict = field(default_factory=dict)  # {"x": ..., "y": ...}

    # Source ref (when loaded from vendor file)
    _ref: str = ""  # original $ref filename

    @property
    def host_access(self) -> bool:
        # Explicit "access": true  OR  having an IP configured implies access
        return bool(self.host.get("access", False)) or bool(self.host.get("ip"))

    @property
    def host_ip(self) -> str:
        return self.host.get("ip", "")

    @property
    def host_prefix(self) -> int:
        return int(self.host.get("prefix", 24))

    @property
    def internet_access(self) -> bool:
        return bool(self.internet.get("access", False)) or bool(self.internet.get("enabled", False))

    @property
    def docker_enabled(self) -> bool:
        return bool(self.docker.get("enabled", False))

    @property
    def docker_subnet(self) -> str:
        return self.docker.get("subnet", "")

    @property
    def docker_gateway(self) -> str:
        return self.docker.get("gateway", "")

    @property
    def bridge_to_docker(self) -> bool:
        return bool(self.docker.get("bridge_to_docker", False))

    @classmethod
    def from_dict(cls, d: dict) -> "NetworkDef":
        return cls(
            id=d.get("id", ""),
            network_id=d.get("network_id", ""),
            label=d.get("label", d.get("id", "")),
            description=d.get("description", ""),
            type=d.get("type", "bridge"),
            bridge=d.get("bridge", ""),
            vlan=d.get("vlan"),
            parent_network=d.get("parent_network", ""),
            stp=d.get("stp", False),
            vlan_filtering=d.get("vlan_filtering", False),
            vlans=d.get("vlans", []),
            subnet=d.get("subnet", ""),
            gateway=d.get("gateway", ""),
            docker=d.get("docker", {}),
            host=d.get("host", {}),
            internet=d.get("internet", {}),
            position=d.get("position", {}),
            _ref=d.get("$ref", ""),
        )

    def to_dict(self) -> dict:
        d: dict[str, Any] = {"id": self.id}
        if self.network_id:
            d["network_id"] = self.network_id
        if self.label and self.label != self.id:
            d["label"] = self.label
        if self.description:
            d["description"] = self.description
        d["type"] = self.type
        if self.bridge:
            d["bridge"] = self.bridge
        if self.vlan is not None:
            d["vlan"] = self.vlan
        if self.parent_network:
            d["parent_network"] = self.parent_network
        if self.stp:
            d["stp"] = True
        if self.vlan_filtering:
            d["vlan_filtering"] = True
        if self.vlans:
            d["vlans"] = self.vlans
        if self.subnet:
            d["subnet"] = self.subnet
        if self.gateway:
            d["gateway"] = self.gateway
        if self.docker:
            d["docker"] = self.docker
        if self.host:
            d["host"] = self.host
        if self.internet:
            d["internet"] = self.internet
        if self.position:
            d["position"] = self.position
        return d

    def to_ref_dict(self) -> dict:
        """Serialize as a topology.json entry (with $ref + overrides)."""
        d: dict[str, Any] = {}
        if self._ref:
            d["$ref"] = self._ref
        if self.network_id:
            d["network_id"] = self.network_id
        if self.position:
            d["position"] = self.position
        # Include any overrides that differ from the base file
        # (caller can decide which fields to include)
        return d


# ---------------------------------------------------------------------------
# Segment — groups links into user-facing network segments
# ---------------------------------------------------------------------------


@dataclass
class Segment:
    """A named group of topology links representing a logical network segment.

    Segments are the UI-facing abstraction for network provisioning:
    the user connects/disconnects *segments*, not individual links.
    """

    id: str
    label: str = ""
    description: str = ""
    links: list[str] = field(default_factory=list)  # link ids
    host_access: bool = False
    host_network: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, d: dict) -> "Segment":
        return cls(
            id=d["id"],
            label=d.get("label", d["id"]),
            description=d.get("description", ""),
            links=d.get("links", []),
            host_access=d.get("host_access", False),
            host_network=d.get("host_network", {}),
        )

    def to_dict(self) -> dict:
        d: dict[str, Any] = {
            "id": self.id,
            "label": self.label,
        }
        if self.description:
            d["description"] = self.description
        d["links"] = self.links
        d["host_access"] = self.host_access
        if self.host_network:
            d["host_network"] = self.host_network
        return d


# ---------------------------------------------------------------------------
# Topology (top-level)
# ---------------------------------------------------------------------------


@dataclass
class Topology:
    version: str = "1.0"
    name: str = ""
    project_id: str = ""  # short slug derived from project directory name
    nodes: list[Node] = field(default_factory=list)
    links: list[Link] = field(default_factory=list)
    networks: dict[str, dict] = field(default_factory=dict)  # legacy
    segments: list[Segment] = field(default_factory=list)  # legacy
    network_defs: list[NetworkDef] = field(default_factory=list)  # v2 networks
    actions: list[dict] = field(default_factory=list)  # topology-level actions

    # --- Query helpers ---

    def get_node(self, node_id: str) -> Node | None:
        for n in self.nodes:
            if n.id == node_id:
                return n
        return None

    def children(self, parent_id: str) -> list[Node]:
        return [n for n in self.nodes if n.parent == parent_id]

    def roots(self) -> list[Node]:
        return [n for n in self.nodes if n.parent is None]

    def runnable_nodes(self) -> list[Node]:
        return [n for n in self.nodes if n.runtime is not None]

    def links_for_node(self, node_id: str) -> list[Link]:
        return [lk for lk in self.links if lk.source.node == node_id or lk.target.node == node_id]

    def get_network_def(self, net_id: str) -> NetworkDef | None:
        """Find a v2 network by id or network_id."""
        for nd in self.network_defs:
            if nd.id == net_id or nd.network_id == net_id:
                return nd
        return None

    def drivers_used(self) -> set[str]:
        return {n.driver for n in self.nodes}

    @classmethod
    def from_dict(cls, d: dict) -> "Topology":
        # network_defs: can be a list of NetworkDef dicts (resolved)
        # or list with $ref entries (resolved by caller / topology loader)
        raw_ndefs = d.get("network_defs", [])
        ndefs = []
        for nd in raw_ndefs:
            if isinstance(nd, dict):
                ndefs.append(NetworkDef.from_dict(nd))
        return cls(
            version=d.get("version", "1.0"),
            name=d.get("name", ""),
            project_id=d.get("project_id", ""),
            nodes=[Node.from_dict(n) for n in d.get("nodes", [])],
            links=[Link.from_dict(lk) for lk in d.get("links", [])],
            networks=d.get("networks", {}),
            segments=[Segment.from_dict(s) for s in d.get("segments", [])],
            network_defs=ndefs,
            actions=d.get("actions", []),
        )

    def to_dict(self) -> dict:
        d: dict[str, Any] = {
            "version": self.version,
            "name": self.name,
            "nodes": [n.to_dict() for n in self.nodes],
            "links": [lk.to_dict() for lk in self.links],
        }
        if self.project_id:
            d["project_id"] = self.project_id
        if self.networks:
            d["networks"] = self.networks
        if self.segments:
            d["segments"] = [s.to_dict() for s in self.segments]
        if self.network_defs:
            d["network_defs"] = [nd.to_dict() for nd in self.network_defs]
        if self.actions:
            d["actions"] = self.actions
        return d
