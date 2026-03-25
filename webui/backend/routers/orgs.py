"""
Router: orgs — organization CRUD + activation.

An Org groups vendors (departments/areas) under a single entity (company/team).
Each org is stored as ~/.triv/orgs/<org-id>.json with {name, vendors: []}.
A vendor belongs to exactly one org.

Endpoints:
    GET    /api/orgs
    POST   /api/orgs
    GET    /api/orgs/active
    POST   /api/orgs/{org_id}/activate
    GET    /api/orgs/{org_id}
    PUT    /api/orgs/{org_id}
    DELETE /api/orgs/{org_id}
"""

import json
import re
from pathlib import Path

from fastapi import APIRouter, HTTPException, Body

import shared

router = APIRouter(prefix="/api/orgs", tags=["orgs"])


# ── Helpers ───────────────────────────────────────────────────────────────

def _slugify(name: str) -> str:
    s = name.lower().strip()
    s = re.sub(r"[^\w\s-]", "", s)
    s = re.sub(r"[\s_]+", "-", s)
    s = s.strip("-")
    return s or "org"


def _org_file(org_id: str) -> Path:
    return shared.ORGS_DIR / f"{org_id}.json"


def _load_org(org_id: str) -> dict:
    f = _org_file(org_id)
    if not f.exists():
        raise HTTPException(404, f"Org '{org_id}' not found")
    return json.loads(f.read_text())


def _save_org(org_id: str, data: dict) -> None:
    _org_file(org_id).write_text(json.dumps(data, indent=2))


def _list_orgs() -> list[dict]:
    orgs = []
    for f in sorted(shared.ORGS_DIR.glob("*.json")):
        try:
            d = json.loads(f.read_text())
            orgs.append({"id": f.stem, "name": d.get("name", f.stem), "vendors": d.get("vendors", [])})
        except Exception:
            pass
    return orgs


def _get_active_org() -> str:
    from routers.projects import _load_projects
    return _load_projects().get("active_org", "")


def _set_active_org(org_id: str) -> None:
    from routers.projects import _load_projects, _save_projects
    data = _load_projects()
    data["active_org"] = org_id
    _save_projects(data)


def _vendor_owner(vendor: str) -> str | None:
    """Return org_id that owns the vendor, or None."""
    for f in shared.ORGS_DIR.glob("*.json"):
        try:
            d = json.loads(f.read_text())
            if vendor in d.get("vendors", []):
                return f.stem
        except Exception:
            pass
    return None


# ── Endpoints ─────────────────────────────────────────────────────────────

@router.get("")
def list_orgs():
    active = _get_active_org()
    orgs = _list_orgs()
    for o in orgs:
        o["active"] = o["id"] == active
    return {"orgs": orgs, "active_org": active}


@router.post("")
def create_org(body: dict = Body(...)):
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "name is required")
    vendors = [v.strip() for v in (body.get("vendors") or []) if v.strip()]

    # Validate vendor uniqueness
    for vendor in vendors:
        owner = _vendor_owner(vendor)
        if owner:
            raise HTTPException(409, f"Vendor '{vendor}' already belongs to org '{owner}'")

    org_id = body.get("id") or _slugify(name)
    # Ensure uniqueness
    existing_ids = {f.stem for f in shared.ORGS_DIR.glob("*.json")}
    base = org_id
    counter = 1
    while org_id in existing_ids:
        org_id = f"{base}-{counter}"
        counter += 1

    data = {"name": name, "vendors": vendors}
    _save_org(org_id, data)
    return {"ok": True, "id": org_id, "name": name, "vendors": vendors}


@router.get("/active")
def get_active_org():
    active = _get_active_org()
    if not active:
        return {"id": "", "name": "", "vendors": []}
    try:
        d = _load_org(active)
        return {"id": active, "name": d.get("name", active), "vendors": d.get("vendors", [])}
    except HTTPException:
        return {"id": "", "name": "", "vendors": []}


@router.post("/{org_id}/activate")
def activate_org(org_id: str):
    if org_id:
        _load_org(org_id)  # validates exists
    _set_active_org(org_id)
    return {"ok": True, "active_org": org_id}


@router.get("/{org_id}")
def get_org(org_id: str):
    d = _load_org(org_id)
    active = _get_active_org()
    return {"id": org_id, "name": d.get("name", org_id), "vendors": d.get("vendors", []), "active": org_id == active}


@router.put("/{org_id}")
def update_org(org_id: str, body: dict = Body(...)):
    d = _load_org(org_id)
    if "name" in body:
        d["name"] = body["name"]
    vendors = list(d.get("vendors", []))
    for v in (body.get("add_vendors") or []):
        v = v.strip()
        if not v or v in vendors:
            continue
        owner = _vendor_owner(v)
        if owner and owner != org_id:
            raise HTTPException(409, f"Vendor '{v}' already belongs to org '{owner}'")
        vendors.append(v)
    for v in (body.get("remove_vendors") or []):
        vendors = [x for x in vendors if x != v.strip()]
    d["vendors"] = vendors
    _save_org(org_id, d)
    return {"ok": True, "id": org_id, "name": d["name"], "vendors": vendors}


@router.delete("/{org_id}")
def delete_org(org_id: str):
    f = _org_file(org_id)
    if not f.exists():
        raise HTTPException(404, f"Org '{org_id}' not found")
    f.unlink()
    # Clear active_org if it was this one
    active = _get_active_org()
    if active == org_id:
        _set_active_org("")
    return {"ok": True}
