"""triv.core.topology — Load, validate and query topologies."""

from __future__ import annotations

import json
import os
import re
from collections import defaultdict

from .enums import InterfaceDirection
from .models import Topology


# ---------------------------------------------------------------------------
# Project-id helpers
# ---------------------------------------------------------------------------

_SLUG_RE = re.compile(r"[^a-z0-9]+")


# Generic container mount points that should NOT be used as project_id
_GENERIC_MOUNT_NAMES = {"triv-project", "project", "workspace", "app", "src"}


def project_id_from_path(project_dir: str) -> str:
    """Derive a short, filesystem/network-safe project slug from a path.

    Uses the **directory name** that contains the topology file.
    E.g. ``/opt/triv-projects/my-lab`` → ``my-lab``.

    If the directory is a generic container mount (``/triv-project``),
    returns an empty string so the caller can fall back to the topology
    name or another source.

    The slug is lowercased, non-alphanumeric chars collapsed to ``-``,
    and leading/trailing dashes stripped.
    """
    basename = os.path.basename(os.path.normpath(project_dir))
    slug = _SLUG_RE.sub("-", basename.lower()).strip("-")
    if slug in _GENERIC_MOUNT_NAMES:
        return ""  # caller should fall back to topology name
    return slug or ""


def project_id_from_name(name: str) -> str:
    """Derive a project slug from a topology name.

    E.g. ``My Lab — 2 node cascade`` → ``my-lab-2-node-cascade``.
    """
    slug = _SLUG_RE.sub("-", name.lower()).strip("-")
    return slug or "default"


def load(path: str) -> Topology:
    """Load a topology.json and return a Topology model.

    Automatically sets ``topology.project_id`` from the containing
    directory name unless the JSON already provides one.  If the
    directory is a generic mount point (e.g. ``/ne-project`` inside a
    container), falls back to slugifying the topology name.
    """
    if not os.path.isfile(path):
        raise FileNotFoundError(f"Topology file not found: {path}")
    with open(path) as f:
        raw = json.load(f)
    topo = Topology.from_dict(raw)

    # Derive project_id from directory if not explicitly set in the JSON
    if not topo.project_id:
        project_dir = os.path.dirname(os.path.abspath(path))
        pid = project_id_from_path(project_dir)
        if not pid and topo.name:
            # Generic mount — fall back to topology name
            pid = project_id_from_name(topo.name)
        topo.project_id = pid or "default"

    return topo


def save(topo: Topology, path: str) -> None:
    with open(path, "w") as f:
        json.dump(topo.to_dict(), f, indent=2)
        f.write("\n")


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def validate(topo: Topology) -> list[str]:
    """Return list of error strings. Empty list = valid."""
    errors: list[str] = []

    node_ids = {n.id for n in topo.nodes}

    # Unique node ids
    seen: set[str] = set()
    for n in topo.nodes:
        if n.id in seen:
            errors.append(f"Duplicate node id: '{n.id}'")
        seen.add(n.id)

    # Parent references
    for n in topo.nodes:
        if n.parent and n.parent not in node_ids:
            errors.append(f"Node '{n.id}' references unknown parent '{n.parent}'")

    # Unique interface ids within each node
    for n in topo.nodes:
        iface_ids: set[str] = set()
        for i in n.interfaces:
            if i.id in iface_ids:
                errors.append(f"Duplicate interface '{i.id}' in node '{n.id}'")
            iface_ids.add(i.id)

    # Link validation
    link_ids: set[str] = set()
    for lk in topo.links:
        if lk.id in link_ids:
            errors.append(f"Duplicate link id: '{lk.id}'")
        link_ids.add(lk.id)

        for side, ep in [("source", lk.source), ("target", lk.target)]:
            node = topo.get_node(ep.node)
            if not node:
                errors.append(f"Link '{lk.id}' {side} references unknown node '{ep.node}'")
                continue
            iface = node.get_interface(ep.interface)
            if not iface:
                errors.append(
                    f"Link '{lk.id}' {side} references unknown interface "
                    f"'{ep.interface}' on node '{ep.node}'"
                )

    # Direction compatibility
    errors.extend(_validate_link_directions(topo))

    # Loop detection
    errors.extend(detect_loops(topo))

    return errors


def _validate_link_directions(topo: Topology) -> list[str]:
    errors: list[str] = []
    for lk in topo.links:
        src_node = topo.get_node(lk.source.node)
        tgt_node = topo.get_node(lk.target.node)
        if not src_node or not tgt_node:
            continue
        src_iface = src_node.get_interface(lk.source.interface)
        tgt_iface = tgt_node.get_interface(lk.target.interface)
        if not src_iface or not tgt_iface:
            continue

        if not lk.bidir:
            if src_iface.direction == InterfaceDirection.IN:
                errors.append(
                    f"Unidirectional link '{lk.id}': source interface "
                    f"'{src_iface.id}' on '{src_node.id}' is input-only"
                )
            if tgt_iface.direction == InterfaceDirection.OUT:
                errors.append(
                    f"Unidirectional link '{lk.id}': target interface "
                    f"'{tgt_iface.id}' on '{tgt_node.id}' is output-only"
                )
    return errors


# ---------------------------------------------------------------------------
# Loop detection (L2 broadcast storm prevention)
# ---------------------------------------------------------------------------


def detect_loops(topo: Topology) -> list[str]:
    """Detect L2 loops in the bridge graph."""
    errors: list[str] = []

    # Build adjacency: bridge → set of bridges reachable via shared nodes
    node_bridges: dict[str, set[str]] = defaultdict(set)
    for lk in topo.links:
        br = lk.bridge_name
        node_bridges[lk.source.node].add(br)
        node_bridges[lk.target.node].add(br)

    graph: dict[str, set[str]] = defaultdict(set)
    for _node_id, bridges in node_bridges.items():
        bridge_list = list(bridges)
        for i in range(len(bridge_list)):
            for j in range(i + 1, len(bridge_list)):
                graph[bridge_list[i]].add(bridge_list[j])
                graph[bridge_list[j]].add(bridge_list[i])

    visited: set[str] = set()

    def dfs(bridge: str, parent: str | None) -> bool:
        visited.add(bridge)
        for neighbor in graph[bridge]:
            if neighbor == parent:
                continue
            if neighbor in visited:
                errors.append(
                    f"L2 loop detected: bridges '{bridge}' <-> '{neighbor}' "
                    f"form a cycle. This may cause broadcast storms."
                )
                return True
            if dfs(neighbor, bridge):
                return True
        return False

    for br in list(graph.keys()):
        if br not in visited:
            dfs(br, None)

    return errors
