"""
routers/ai.py — AI Central: inventory and system capability assessment for AI/LLM nodes.
"""

import json
import os
import subprocess
from typing import Any

from fastapi import APIRouter

import shared

router = APIRouter(prefix="/api/ai", tags=["ai"])

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_LLM_CONTAINER_KEYWORDS = {
    "ollama",
    "lmstudio",
    "lm-studio",
    "llama",
    "vllm",
    "localai",
    "openwebui",
    "open-webui",
    "text-generation-webui",
    "koboldcpp",
    "jan-",
    "gpt4all",
    "mistral",
    "mixtral",
    "phi3",
    "gemma",
}

_API_KEY_ENV_MAP = {
    "OPENAI_API_KEY": {"provider": "OpenAI", "base_url": "https://api.openai.com/v1"},
    "ANTHROPIC_API_KEY": {"provider": "Anthropic", "base_url": "https://api.anthropic.com"},
    "GROQ_API_KEY": {"provider": "Groq", "base_url": "https://api.groq.com/openai/v1"},
    "TOGETHER_API_KEY": {"provider": "Together AI", "base_url": "https://api.together.xyz/v1"},
    "MISTRAL_API_KEY": {"provider": "Mistral", "base_url": "https://api.mistral.ai/v1"},
    "COHERE_API_KEY": {"provider": "Cohere", "base_url": "https://api.cohere.ai/v1"},
    "GEMINI_API_KEY": {
        "provider": "Google Gemini",
        "base_url": "https://generativelanguage.googleapis.com",
    },
    "OPENROUTER_API_KEY": {"provider": "OpenRouter", "base_url": "https://openrouter.ai/api/v1"},
}

# Approximate model sizes in GB — used for capability assessment
# Format: list of (substring_to_match_in_name, size_gb)
_MODEL_SIZE_HINTS: list[tuple[str, float]] = [
    ("405b", 230.0),
    ("70b", 40.0),
    ("72b", 42.0),
    ("65b", 38.0),
    ("34b", 20.0),
    ("33b", 19.0),
    ("30b", 17.0),
    ("22b", 13.0),
    ("13b", 8.0),
    ("14b", 9.0),
    ("8x7b", 30.0),
    ("8x22b", 90.0),
    ("8b", 5.0),
    ("7b", 4.5),
    ("6b", 4.0),
    ("3b", 2.0),
    ("2b", 1.5),
    ("1b", 0.8),
    ("0.5b", 0.4),
]


def _estimate_model_size_gb(model_name: str) -> float | None:
    """Estimate model parameter size in GB from its name."""
    name_lower = model_name.lower()
    for substr, gb in _MODEL_SIZE_HINTS:
        if substr in name_lower:
            return gb
    return None


def _get_sysinfo() -> dict[str, Any]:
    """Read host RAM and GPU VRAM."""
    info: dict[str, Any] = {
        "ram_total_gb": None,
        "ram_available_gb": None,
        "gpus": [],
    }

    # RAM from /proc/meminfo
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                parts = line.split()
                if parts[0] == "MemTotal:":
                    info["ram_total_gb"] = round(int(parts[1]) / 1024 / 1024, 1)
                elif parts[0] == "MemAvailable:":
                    info["ram_available_gb"] = round(int(parts[1]) / 1024 / 1024, 1)
    except OSError:
        pass

    # NVIDIA GPU
    try:
        result = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,memory.total,memory.free",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            for line in result.stdout.strip().splitlines():
                cols = [c.strip() for c in line.split(",")]
                if len(cols) >= 3:
                    info["gpus"].append(
                        {
                            "name": cols[0],
                            "vram_total_gb": round(int(cols[1]) / 1024, 1),
                            "vram_free_gb": round(int(cols[2]) / 1024, 1),
                            "vendor": "nvidia",
                        }
                    )
    except (FileNotFoundError, subprocess.TimeoutExpired, ValueError):
        pass

    # AMD GPU
    if not info["gpus"]:
        try:
            result = subprocess.run(
                ["rocm-smi", "--showmeminfo", "vram", "--json"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            if result.returncode == 0:
                data = json.loads(result.stdout)
                for card_id, card_data in data.items():
                    total = card_data.get("VRAM Total Memory (B)", 0)
                    used = card_data.get("VRAM Total Used Memory (B)", 0)
                    if total:
                        info["gpus"].append(
                            {
                                "name": card_id,
                                "vram_total_gb": round(total / 1024**3, 1),
                                "vram_free_gb": round((total - used) / 1024**3, 1),
                                "vendor": "amd",
                            }
                        )
        except (FileNotFoundError, subprocess.TimeoutExpired, json.JSONDecodeError, OSError):
            pass

    return info


def _rate_model(model_size_gb: float, sysinfo: dict) -> str:
    """Return 'green', 'orange', or 'red' capability rating."""
    # GPU VRAM — fastest path
    for gpu in sysinfo.get("gpus", []):
        vram = gpu.get("vram_free_gb", 0) or 0
        if vram >= model_size_gb:
            return "green"
        if vram >= model_size_gb * 0.7:
            return "orange"

    # RAM fallback (slower, but functional)
    ram_avail = sysinfo.get("ram_available_gb") or 0
    ram_total = sysinfo.get("ram_total_gb") or 0
    effective = max(ram_avail, ram_total * 0.5)  # conservative estimate

    if effective >= model_size_gb * 1.5:
        return "green"
    if effective >= model_size_gb * 1.0:
        return "orange"
    return "red"


def _ollama_models() -> list[dict]:
    """Return list of models from `ollama list`."""
    models = []
    try:
        result = subprocess.run(
            ["ollama", "list"],
            capture_output=True,
            text=True,
            timeout=8,
        )
        if result.returncode == 0:
            lines = result.stdout.strip().splitlines()
            for line in lines[1:]:  # skip header
                parts = line.split()
                if parts:
                    name = parts[0]
                    size_str = parts[3] if len(parts) > 3 else ""
                    size_gb = None
                    if size_str:
                        try:
                            val = float(parts[3])
                            unit = parts[4].upper() if len(parts) > 4 else "GB"
                            size_gb = val if "GB" in unit else val / 1024
                        except (ValueError, IndexError):
                            size_gb = _estimate_model_size_gb(name)
                    else:
                        size_gb = _estimate_model_size_gb(name)
                    models.append(
                        {
                            "name": name,
                            "size_gb": size_gb,
                            "modified": parts[2] if len(parts) > 2 else None,
                        }
                    )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    return models


def _llm_containers() -> list[dict]:
    """Return running containers that look LLM-related."""
    containers = []
    try:
        result = subprocess.run(
            ["docker", "ps", "--format", "{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"],
            capture_output=True,
            text=True,
            timeout=8,
        )
        if result.returncode == 0:
            for line in result.stdout.strip().splitlines():
                parts = line.split("\t")
                name = parts[0] if parts else ""
                image = parts[1] if len(parts) > 1 else ""
                status = parts[2] if len(parts) > 2 else ""
                ports = parts[3] if len(parts) > 3 else ""
                combined = (name + image).lower()
                if any(kw in combined for kw in _LLM_CONTAINER_KEYWORDS):
                    containers.append(
                        {
                            "name": name,
                            "image": image,
                            "status": status,
                            "ports": ports,
                        }
                    )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    return containers


def _topology_ai_nodes() -> list[dict]:
    """Return LLM/Agent nodes from the active topology."""
    topo = shared.topology
    if not topo:
        return []
    nodes = []
    for node in topo.nodes or []:
        cat = getattr(node, "category", None) or ""
        rt = getattr(node, "runtime", None) or ""
        if cat in ("llm", "agent") or rt in ("llm", "agent"):
            props = getattr(node, "properties", {}) or {}
            nodes.append(
                {
                    "id": node.id,
                    "label": props.get("label") or node.id,
                    "category": cat,
                    "runtime": rt,
                    "driver": getattr(node, "driver", ""),
                    "env": getattr(node, "env", None),
                    "properties": props,
                }
            )
    return nodes


def _remote_apis() -> list[dict]:
    """Return configured remote API providers based on env vars."""
    apis = []
    for env_key, meta in _API_KEY_ENV_MAP.items():
        val = os.environ.get(env_key, "")
        if val:
            apis.append(
                {
                    "provider": meta["provider"],
                    "base_url": meta["base_url"],
                    "env_var": env_key,
                    "key_hint": val[:4] + "..." + val[-2:] if len(val) > 6 else "***",
                    "capability": "green",  # remote APIs always capable
                }
            )
    return apis


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/inventory")
def get_ai_inventory():
    """Return a full AI inventory: topology nodes, local models, APIs, containers."""
    sysinfo = _get_sysinfo()
    local_models = _ollama_models()

    # Rate local models
    rated_models = []
    for m in local_models:
        size = m.get("size_gb")
        rating = _rate_model(size, sysinfo) if size is not None else "unknown"
        rated_models.append({**m, "capability": rating})

    return {
        "topology_nodes": _topology_ai_nodes(),
        "local_models": rated_models,
        "remote_apis": _remote_apis(),
        "llm_containers": _llm_containers(),
    }


@router.get("/sysinfo")
def get_ai_sysinfo():
    """Return host RAM and GPU information with per-model capability ratings."""
    sysinfo = _get_sysinfo()
    local_models = _ollama_models()

    rated_models = []
    for m in local_models:
        size = m.get("size_gb")
        rating = _rate_model(size, sysinfo) if size is not None else "unknown"
        rated_models.append({**m, "capability": rating})

    return {
        **sysinfo,
        "ollama_models": rated_models,
    }
