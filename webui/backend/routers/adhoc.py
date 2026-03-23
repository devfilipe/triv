"""
Router: adhoc — ad-hoc devices (standalone, not in topology file).
"""

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException, Body

import shared

router = APIRouter(prefix="/api", tags=["adhoc"])


def _load_adhoc() -> list[dict]:
    adhoc_file = Path(shared.PROJECT_DIR) / "adhoc-devices.json"
    if adhoc_file.exists():
        with open(adhoc_file) as f:
            return json.load(f)
    return []


def _save_adhoc(devices: list[dict]) -> None:
    adhoc_file = Path(shared.PROJECT_DIR) / "adhoc-devices.json"
    adhoc_file.parent.mkdir(parents=True, exist_ok=True)
    with open(adhoc_file, "w") as f:
        json.dump(devices, f, indent=2)
        f.write("\n")


@router.get("/adhoc")
def get_adhoc_devices():
    return _load_adhoc()


@router.post("/adhoc")
def create_adhoc_device(body: dict = Body(...)):
    devices = _load_adhoc()
    dev_id = body.get("id")
    if not dev_id:
        raise HTTPException(400, "Field 'id' is required")
    if any(d["id"] == dev_id for d in devices):
        raise HTTPException(409, f"Ad-hoc device '{dev_id}' already exists")

    device = {
        "id": dev_id,
        "label": body.get("label", dev_id),
        "category": body.get("category", "generic"),
        "type": body.get("type", "physical"),
        "hostname": body.get("hostname", ""),
        "port": body.get("port", 22),
        "username": body.get("username", "root"),
        "password": body.get("password"),
        "key_file": body.get("key_file"),
        "driver": body.get("driver", "generic"),
        "properties": body.get("properties", {}),
    }
    devices.append(device)
    _save_adhoc(devices)
    return {"ok": True, "id": dev_id}


@router.put("/adhoc/{dev_id}")
def update_adhoc_device(dev_id: str, body: dict = Body(...)):
    devices = _load_adhoc()
    idx = next((i for i, d in enumerate(devices) if d["id"] == dev_id), None)
    if idx is None:
        raise HTTPException(404, f"Ad-hoc device '{dev_id}' not found")
    body["id"] = dev_id
    devices[idx] = {**devices[idx], **body}
    _save_adhoc(devices)
    return {"ok": True, "id": dev_id}


@router.delete("/adhoc/{dev_id}")
def delete_adhoc_device(dev_id: str):
    devices = _load_adhoc()
    idx = next((i for i, d in enumerate(devices) if d["id"] == dev_id), None)
    if idx is None:
        raise HTTPException(404, f"Ad-hoc device '{dev_id}' not found")
    devices.pop(idx)
    _save_adhoc(devices)
    return {"ok": True, "id": dev_id}
