"""triv.core.state — Runtime state tracker.

Persists all resources created by triv so cleanup is deterministic,
even after a crash.  State is kept at ~/.triv/state/state.json (or a
user-supplied path via TRIV_STATE_DIR or TRIV_HOME).
"""

from __future__ import annotations

import glob
import json
import os
import subprocess
import time
from dataclasses import dataclass, field


def _default_state_dir() -> str:
    if d := os.environ.get("TRIV_STATE_DIR"):
        return d
    triv_home = os.environ.get("TRIV_HOME", os.path.join(os.path.expanduser("~"), ".triv"))
    return os.path.join(triv_home, "state")


DEFAULT_STATE_DIR = _default_state_dir()
DEFAULT_STATE_PATH = os.path.join(DEFAULT_STATE_DIR, "state.json")

C_ENV = {**os.environ, "LANG": "C", "LC_ALL": "C"}


def _sudo(cmd: str, check: bool = False) -> int:
    # Skip sudo when already running as root (e.g. inside a Docker container)
    prefix = [] if os.getuid() == 0 else ["sudo"]
    return subprocess.run(
        prefix + cmd.split(),
        check=check,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    ).returncode


@dataclass
class ResourceState:
    project: str = ""
    topology_name: str = ""
    created_at: str = ""
    vms: dict[str, dict] = field(default_factory=dict)
    containers: dict[str, dict] = field(default_factory=dict)
    bridges: dict[str, dict] = field(default_factory=dict)
    vlan_ifaces: dict[str, dict] = field(default_factory=dict)
    veth_pairs: list[dict] = field(default_factory=list)
    temp_dirs: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "project": self.project,
            "topology_name": self.topology_name,
            "created_at": self.created_at,
            "resources": {
                "vms": self.vms,
                "containers": self.containers,
                "bridges": self.bridges,
                "vlan_ifaces": self.vlan_ifaces,
                "veth_pairs": self.veth_pairs,
                "temp_dirs": self.temp_dirs,
            },
        }

    @classmethod
    def from_dict(cls, d: dict) -> "ResourceState":
        res = d.get("resources", {})
        return cls(
            project=d.get("project", ""),
            topology_name=d.get("topology_name", ""),
            created_at=d.get("created_at", ""),
            vms=res.get("vms", {}),
            containers=res.get("containers", {}),
            bridges=res.get("bridges", {}),
            vlan_ifaces=res.get("vlan_ifaces", {}),
            veth_pairs=res.get("veth_pairs", []),
            temp_dirs=res.get("temp_dirs", []),
        )


class StateTracker:
    """Tracks all resources for deterministic cleanup."""

    def __init__(self, path: str = DEFAULT_STATE_PATH) -> None:
        self.path = path
        self._state = self._load()

    @property
    def state(self) -> ResourceState:
        return self._state

    def _load(self) -> ResourceState:
        if os.path.isfile(self.path):
            with open(self.path) as f:
                return ResourceState.from_dict(json.load(f))
        return ResourceState()

    def save(self) -> None:
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        with open(self.path, "w") as f:
            json.dump(self._state.to_dict(), f, indent=2)
            f.write("\n")

    def init_project(self, project_dir: str, topo_name: str) -> None:
        self._state.project = project_dir
        self._state.topology_name = topo_name
        self._state.created_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        self.save()

    # -- Track resources --

    def track_vm(self, name: str, node_id: str, runtime: str = "libvirt") -> None:
        self._state.vms[name] = {"node": node_id, "runtime": runtime}
        self.save()

    def track_container(self, name: str, node_id: str, runtime: str = "docker") -> None:
        self._state.containers[name] = {"node": node_id, "runtime": runtime}
        self.save()

    def track_bridge(self, name: str, link_id: str | None = None) -> None:
        self._state.bridges[name] = {"link": link_id, "attached": []}
        self.save()

    def track_bridge_attach(self, bridge: str, iface: str) -> None:
        if bridge in self._state.bridges:
            att = self._state.bridges[bridge].get("attached", [])
            if iface not in att:
                att.append(iface)
                self._state.bridges[bridge]["attached"] = att
                self.save()

    def track_vlan_iface(self, name: str, bridge: str, ip: str, network: str) -> None:
        self._state.vlan_ifaces[name] = {
            "bridge": bridge,
            "ip": ip,
            "network": network,
        }
        self.save()

    def track_temp_dir(self, path: str) -> None:
        if path not in self._state.temp_dirs:
            self._state.temp_dirs.append(path)
            self.save()

    # -- Untrack --

    def untrack_vm(self, name: str) -> None:
        self._state.vms.pop(name, None)
        self.save()

    def untrack_bridge(self, name: str) -> None:
        self._state.bridges.pop(name, None)
        self.save()


class Cleanup:
    """Deterministic teardown — reverse creation order, idempotent."""

    def __init__(self, state_path: str = DEFAULT_STATE_PATH) -> None:
        self.state_path = state_path
        self.tracker = StateTracker(state_path)

    def plan(self) -> list[tuple[str, str, str]]:
        """Return ordered list of (kind, cmd, target) to execute."""
        st = self.tracker.state
        steps: list[tuple[str, str, str]] = []

        for name in list(st.vlan_ifaces):
            steps.append(("vlan_iface", f"ip link del {name}", name))

        for name, info in list(st.containers.items()):
            rt = info.get("runtime", "docker")
            steps.append(("container", f"{rt} rm -f {name}", name))

        for name in list(st.vms):
            steps.append(("vm", f"virsh destroy {name}", name))
            steps.append(("vm", f"virsh undefine --nvram {name}", name))

        for pair in st.veth_pairs:
            steps.append(("veth", f"ip link del {pair.get('host', '')}", pair.get("host", "")))

        for name in list(st.bridges):
            if name.startswith("br-"):
                steps.append(("bridge", f"ip link del {name}", name))

        for d in st.temp_dirs:
            steps.append(("tmpdir", f"rm -rf {d}", d))

        return steps

    def teardown_all(self, dry_run: bool = False) -> list[str]:
        """Full cleanup. Returns list of error messages."""
        steps = self.plan()
        errors: list[str] = []

        if dry_run:
            for kind, cmd, target in steps:
                print(f"  [dry-run] [{kind:12s}] sudo {cmd}")
            return errors

        for kind, cmd, target in steps:
            rc = _sudo(cmd, check=False)
            if rc == 0:
                print(f"  \u2713 {kind:12s} {target}")
            else:
                msg = f"{kind} {target}: command failed (rc={rc})"
                errors.append(msg)
                print(f"  \u2717 {msg}")

        # Clear state
        try:
            os.remove(self.state_path)
        except FileNotFoundError:
            pass

        if not errors:
            print("\n\u2713 Full cleanup complete")
        else:
            print(f"\n\u26a0 {len(errors)} cleanup errors (non-fatal)")
        return errors


# Prefixes used by triv-created resources.  Docker/Podman bridges
# (br-<hex>) and unrelated /tmp dirs are intentionally excluded.
TRIV_BRIDGE_PREFIXES = ("br-cascade-", "br-up-", "br-down-", "br-dcn-", "triv-")
TRIV_VLAN_PREFIXES = ("vchs.",)
TRIV_TMPDIR_PREFIXES = ("/tmp/run_triv-",)


def _is_triv_bridge(name: str) -> bool:
    return any(name.startswith(p) for p in TRIV_BRIDGE_PREFIXES)


def detect_orphans() -> dict[str, list[str]]:
    """Scan host for triv resources not tracked in state file."""
    orphans: dict[str, list[str]] = {
        "bridges": [],
        "vlan_ifaces": [],
        "temp_dirs": [],
    }

    tracker = StateTracker()
    tracked_bridges = set(tracker.state.bridges.keys())
    tracked_vlans = set(tracker.state.vlan_ifaces.keys())
    tracked_dirs = set(tracker.state.temp_dirs)

    # Bridges with triv naming convention
    try:
        out = subprocess.run(
            ["ip", "-br", "link", "show", "type", "bridge"],
            capture_output=True,
            text=True,
        ).stdout
        for line in out.splitlines():
            name = line.split()[0]
            if _is_triv_bridge(name) and name not in tracked_bridges:
                orphans["bridges"].append(name)
    except Exception:
        pass

    # vchs.* VLAN ifaces
    try:
        out = subprocess.run(
            ["ip", "-br", "link", "show"],
            capture_output=True,
            text=True,
        ).stdout
        for line in out.splitlines():
            name = line.split()[0].split("@")[0]
            if any(name.startswith(p) for p in TRIV_VLAN_PREFIXES) and name not in tracked_vlans:
                orphans["vlan_ifaces"].append(name)
    except Exception:
        pass

    # /tmp/run_* dirs created by triv
    for prefix in TRIV_TMPDIR_PREFIXES:
        for d in glob.glob(prefix + "*"):
            if d not in tracked_dirs:
                orphans["temp_dirs"].append(d)

    return orphans
