"""triv.drivers.generic_ollama — Ollama local LLM driver.

Manages and runs local Ollama models via the Ollama REST API.
Uses only stdlib (urllib) — no extra dependencies required.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any

from .base import Branding, DeviceCommand, DriverBase


class GenericOllamaDriver(DriverBase):
    """Python driver backing generic-driver-ollama.json."""

    name = "generic-driver-ollama-python"
    version = "1.0.0"

    def metadata(self) -> Branding:
        return Branding(
            vendor_name="triv",
            driver_label="Generic Ollama",
            description="Local Ollama runtime — list, pull and delete models, run chat and generate embeddings directly on the host without an API key.",
            accent_color="#cba6f7",
        )

    def driver_type(self) -> str:
        return "ai-llm"

    def vm_name(self, node: dict, env_data: dict | None = None) -> str:
        return (node.get("properties") or {}).get("label", "") or node.get("id", "ollama")

    def driver_args_schema(self) -> dict:
        return {
            "base_url": {
                "type": "string",
                "label": "Base URL",
                "description": "Ollama server URL — use 'Check Connection' to verify",
                "required": False,
                "default": "http://localhost:11434",
                "placeholder": "http://localhost:11434",
            },
            "model": {
                "type": "model-select",
                "label": "Model",
                "description": "Ollama model — click refresh to fetch installed models",
                "required": True,
                "placeholder": "llama3",
                "provider": "ollama",
                "depends_on_url": "base_url",
            },
            "temperature": {
                "type": "number",
                "label": "Temperature",
                "description": "Sampling temperature 0.0–2.0",
                "required": False,
                "default": 0.7,
            },
            "num_predict": {
                "type": "number",
                "label": "Max Tokens",
                "description": "Maximum tokens to generate (num_predict)",
                "required": False,
                "default": 2048,
            },
        }

    def commands(self) -> list[DeviceCommand]:
        return [
            DeviceCommand(
                name="check-connection",
                label="Check Connection",
                icon="wifi",
                description="Ping the Ollama server and show version + model count",
            ),
            DeviceCommand(
                name="status",
                label="Status",
                icon="activity",
                description="Full status: Ollama version, installed models and sizes",
            ),
            DeviceCommand(
                name="list-models",
                label="List Models",
                icon="layers",
                description="List locally installed Ollama models",
            ),
            DeviceCommand(
                name="list-running",
                label="Running Models",
                icon="cpu",
                description="Show models currently loaded in memory / VRAM",
            ),
            DeviceCommand(
                name="pull-model",
                label="Pull Model",
                icon="download",
                description="Pull a model from the Ollama registry",
            ),
            DeviceCommand(
                name="delete-model",
                label="Delete Model",
                icon="trash-2",
                description="Delete a locally installed Ollama model",
            ),
            DeviceCommand(
                name="show-model",
                label="Model Info",
                icon="info",
                description="Show modelfile, template and parameters",
            ),
            DeviceCommand(
                name="chat",
                label="Chat",
                icon="message-square",
                description="Run a chat completion via Ollama",
            ),
            DeviceCommand(
                name="embeddings",
                label="Test Embeddings",
                icon="cpu",
                description="Generate embeddings for a prompt",
            ),
        ]

    # ── Internal helpers ───────────────────────────────────────────────

    def _args(self, env_data: dict | None) -> tuple[str, str, float, int]:
        a = (env_data or {}).get("driver_args", {})
        model = a.get("model", "llama3").strip()
        base_url = (a.get("base_url") or "http://localhost:11434").rstrip("/").strip()
        temperature = float(a.get("temperature", 0.7))
        num_predict = int(a.get("num_predict", 2048))
        return model, base_url, temperature, num_predict

    def _get(self, url: str) -> tuple[bool, dict]:
        req = urllib.request.Request(url, method="GET")
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return True, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return False, {"error": f"HTTP {e.code}: {e.read().decode()[:300]}"}
        except Exception as e:
            return False, {"error": str(e)}

    def _post(self, url: str, body: dict, timeout: int = 60) -> tuple[bool, dict]:
        data = json.dumps(body).encode()
        req = urllib.request.Request(
            url,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return True, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return False, {"error": f"HTTP {e.code}: {e.read().decode()[:500]}"}
        except Exception as e:
            return False, {"error": str(e)}

    def _delete(self, url: str, body: dict) -> tuple[bool, dict]:
        data = json.dumps(body).encode()
        req = urllib.request.Request(
            url,
            data=data,
            headers={"Content-Type": "application/json"},
            method="DELETE",
        )
        try:
            with urllib.request.urlopen(req, timeout=10):
                return True, {}
        except urllib.error.HTTPError as e:
            return False, {"error": f"HTTP {e.code}: {e.read().decode()[:300]}"}
        except Exception as e:
            return False, {"error": str(e)}

    @staticmethod
    def _fmt_size(n: int) -> str:
        for u in ("B", "KB", "MB", "GB"):
            if n < 1024:
                return f"{n:.0f} {u}"
            n //= 1024
        return f"{n:.1f} TB"

    # ── Action implementations ─────────────────────────────────────────

    def _check_connection(self, env_data: dict | None) -> dict:
        _, base_url, *_ = self._args(env_data)
        ok, data = self._get(f"{base_url}/api/version")
        if not ok:
            return {
                "ok": True,  # always open a panel — ✘ is informational, not a command error
                "output": f"✘ Ollama unreachable @ {base_url}\n{data.get('error', '')}",
                "output_type": "panel",
            }
        version = data.get("version", "?")
        _, tags = self._get(f"{base_url}/api/tags")
        n = len(tags.get("models", []))
        return {
            "ok": True,
            "output": f"✔ Ollama {version} @ {base_url}\n{n} model(s) installed",
            "output_type": "panel",
        }

    def _status(self, env_data: dict | None) -> dict:
        _, base_url, *_ = self._args(env_data)
        ok_v, ver = self._get(f"{base_url}/api/version")
        ok_t, tags = self._get(f"{base_url}/api/tags")
        if not ok_v and not ok_t:
            return {
                "ok": False,
                "output": f"Ollama unreachable @ {base_url}\n{ver.get('error', '')}",
                "output_type": "panel",
            }
        version_str = ver.get("version", "?") if ok_v else "?"
        models = tags.get("models", []) if ok_t else []
        lines = [
            f"Ollama {version_str} @ {base_url}",
            f"Installed models: {len(models)}",
            "",
        ]
        for m in models:
            size_gb = m.get("size", 0) / 1_073_741_824
            d = m.get("details", {})
            info = " · ".join(
                filter(
                    None,
                    [
                        d.get("family", ""),
                        d.get("parameter_size", ""),
                        d.get("quantization_level", ""),
                    ],
                )
            )
            lines.append(f"  {m['name']:<36} {size_gb:>5.1f} GB  {info}")
        return {"ok": True, "output": "\n".join(lines), "output_type": "panel"}

    def _list_models(self, env_data: dict | None) -> dict:
        _, base_url, *_ = self._args(env_data)
        ok, data = self._get(f"{base_url}/api/tags")
        if not ok:
            return {
                "ok": False,
                "output": data.get("error", "Failed"),
                "output_type": "panel",
            }
        models = data.get("models", [])
        if not models:
            return {
                "ok": True,
                "output": f"No models installed @ {base_url}",
                "output_type": "panel",
            }
        lines = [f"Ollama models @ {base_url}:\n"]
        for m in models:
            size_gb = m.get("size", 0) / 1_073_741_824
            d = m.get("details", {})
            params = d.get("parameter_size", "")
            quant = d.get("quantization_level", "")
            family = d.get("family", "")
            modified = (m.get("modified_at") or "")[:10]
            lines.append(
                f"  {m['name']:<40} {size_gb:>5.1f} GB  {params:<8} {quant:<6} {family}  {modified}"
            )
        return {"ok": True, "output": "\n".join(lines), "output_type": "panel"}

    def _list_running(self, env_data: dict | None) -> dict:
        _, base_url, *_ = self._args(env_data)
        ok, data = self._get(f"{base_url}/api/ps")
        if not ok:
            return {
                "ok": False,
                "output": data.get("error", "Failed"),
                "output_type": "panel",
            }
        models = data.get("models", [])
        if not models:
            return {
                "ok": True,
                "output": "No models currently loaded in memory.",
                "output_type": "panel",
            }
        lines = [f"Running models @ {base_url}:\n"]
        for m in models:
            vram_gb = m.get("size_vram", 0) / 1_073_741_824
            expires = (m.get("expires_at") or "")[:19].replace("T", " ")
            lines.append(f"  {m['name']:<40} {vram_gb:>5.1f} GB VRAM  expires {expires}")
        return {"ok": True, "output": "\n".join(lines), "output_type": "panel"}

    def _chat(self, env_data: dict | None, prompt: str, system: str = "") -> dict:
        model, base_url, temperature, num_predict = self._args(env_data)
        messages: list[dict] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        body = {
            "model": model,
            "messages": messages,
            "stream": False,
            "options": {"temperature": temperature, "num_predict": num_predict},
        }
        ok, data = self._post(f"{base_url}/api/chat", body)
        if not ok:
            return {
                "ok": False,
                "output": data.get("error", "Failed"),
                "output_type": "panel",
            }
        text = (data.get("message") or {}).get("content", "")
        return {"ok": True, "output": text, "output_type": "panel"}

    def _pull_model(self, env_data: dict | None, output_cb=None) -> dict:
        model, base_url, *_ = self._args(env_data)

        def emit(line: str) -> None:
            if output_cb:
                output_cb(line)

        if output_cb:
            # Streaming pull — read NDJSON lines from Ollama
            data = json.dumps({"name": model, "stream": True}).encode()
            req = urllib.request.Request(
                f"{base_url}/api/pull",
                data=data,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            try:
                with urllib.request.urlopen(req, timeout=600) as r:
                    for raw in r:
                        try:
                            obj = json.loads(raw)
                        except Exception:
                            continue
                        status = obj.get("status", "")
                        total = obj.get("total")
                        completed = obj.get("completed")
                        if total and completed:
                            pct = int(completed * 100 / total)
                            emit(f"{status}: {pct}%")
                        elif status:
                            emit(status)
            except urllib.error.HTTPError as e:
                err = e.read().decode()[:500]
                return {"ok": False, "error": f"HTTP {e.code}: {err}"}
            except Exception as e:
                return {"ok": False, "error": str(e)}
            return {"ok": True, "output": f"✔ '{model}' ready", "output_type": "panel"}

        # Non-streaming fallback
        ok, data = self._post(f"{base_url}/api/pull", {"name": model, "stream": False}, timeout=600)
        if not ok:
            return {
                "ok": False,
                "output": data.get("error", "Failed"),
                "output_type": "panel",
            }
        return {
            "ok": True,
            "output": f"Pull '{model}': {data.get('status', 'done')}",
            "output_type": "panel",
        }

    def _delete_model(self, env_data: dict | None) -> dict:
        model, base_url, *_ = self._args(env_data)
        ok, data = self._delete(f"{base_url}/api/delete", {"name": model})
        if not ok:
            return {
                "ok": False,
                "output": data.get("error", "Failed"),
                "output_type": "panel",
            }
        return {
            "ok": True,
            "output": f"Deleted model '{model}'",
            "output_type": "panel",
        }

    def _show_model(self, env_data: dict | None) -> dict:
        model, base_url, *_ = self._args(env_data)
        ok, data = self._post(f"{base_url}/api/show", {"name": model})
        if not ok:
            return {
                "ok": False,
                "output": data.get("error", "Failed"),
                "output_type": "panel",
            }
        lines = [f"Model: {model}\n"]
        for k, v in (data.get("details") or {}).items():
            lines.append(f"  {k}: {v}")
        params = (data.get("parameters") or "").strip()
        if params:
            lines.append(f"\nParameters:\n{params}")
        template = (data.get("template") or "").strip()
        if template:
            lines.append(f"\nTemplate:\n{template[:600]}")
        return {"ok": True, "output": "\n".join(lines), "output_type": "panel"}

    def _embeddings(self, env_data: dict | None, prompt: str) -> dict:
        model, base_url, *_ = self._args(env_data)
        if not prompt:
            prompt = "Hello, world!"
        ok, data = self._post(f"{base_url}/api/embeddings", {"model": model, "prompt": prompt})
        if not ok:
            return {
                "ok": False,
                "output": data.get("error", "Failed"),
                "output_type": "panel",
            }
        embedding = data.get("embedding", [])
        return {
            "ok": True,
            "output": f"Embedding dim: {len(embedding)}\nFirst 8 values: {embedding[:8]}",
            "output_type": "panel",
        }

    # ── Public interface used by Agent driver ──────────────────────────

    def chat(self, env_data: dict | None, prompt: str, system: str = "") -> dict:
        return self._chat(env_data, prompt, system)

    def multi_turn_chat(
        self, env_data: dict | None, messages: list[dict], system: str = ""
    ) -> dict:
        """Multi-turn chat via Ollama /api/chat with full message history."""
        model, base_url, temperature, num_predict = self._args(env_data)
        ollama_msgs: list[dict] = []
        if system:
            ollama_msgs.append({"role": "system", "content": system})
        ollama_msgs.extend(messages)
        body = {
            "model": model,
            "messages": ollama_msgs,
            "stream": False,
            "options": {"temperature": temperature, "num_predict": num_predict},
        }
        ok, data = self._post(f"{base_url}/api/chat", body, timeout=120)
        if not ok:
            return {
                "ok": False,
                "output": data.get("error", "Failed"),
                "output_type": "panel",
            }
        text = (data.get("message") or {}).get("content", "")
        return {"ok": True, "output": text, "output_type": "panel"}

    def chat_with_tools(
        self,
        env_data: dict | None,
        messages: list[dict],
        tools: list[dict],
        system: str = "",
    ) -> dict:
        """Ollama tool-use via POST /api/chat with tools parameter."""
        model, base_url, temperature, num_predict = self._args(env_data)
        oai_tools = [
            {
                "type": "function",
                "function": {
                    "name": t["name"],
                    "description": t.get("description", ""),
                    "parameters": t.get(
                        "input_schema",
                        {"type": "object", "properties": {}, "required": []},
                    ),
                },
            }
            for t in tools
        ]
        all_messages: list[dict] = []
        if system:
            all_messages.append({"role": "system", "content": system})
        all_messages.extend(messages)
        body = {
            "model": model,
            "messages": all_messages,
            "tools": oai_tools,
            "stream": False,
            "options": {"temperature": temperature, "num_predict": num_predict},
        }
        ok, data = self._post(f"{base_url}/api/chat", body, timeout=120)
        if not ok:
            return {"ok": False, "data": data}
        # Normalize to Anthropic-like content block format for the agent driver
        msg = data.get("message", {})
        content: list[dict] = []
        if msg.get("content"):
            content.append({"type": "text", "text": msg["content"]})
        for tc in msg.get("tool_calls") or []:
            fn = tc.get("function", {})
            content.append(
                {
                    "type": "tool_use",
                    "id": f"call_{fn.get('name', 'fn')}",
                    "name": fn.get("name", ""),
                    "input": fn.get("arguments", {}),
                }
            )
        stop_reason = "tool_use" if msg.get("tool_calls") else "end_turn"
        usage = {
            "tokens_in": data.get("prompt_eval_count", 0),
            "tokens_out": data.get("eval_count", 0),
            "duration_ns": data.get("total_duration", 0),
        }
        return {
            "ok": True,
            "data": {"content": content, "stop_reason": stop_reason},
            "usage": usage,
        }

    # ── run_command ────────────────────────────────────────────────────

    def run_command(
        self,
        cmd_name: str,
        node: dict,
        env_data: dict | None = None,
        project_dir: str = "",
        **kwargs: Any,
    ) -> dict:
        payload = kwargs.get("payload") or {}
        prompt = payload.get("prompt") or payload.get("task") or ""

        if cmd_name == "check-connection":
            return self._check_connection(env_data)
        if cmd_name == "status":
            return self._status(env_data)
        if cmd_name == "list-models":
            return self._list_models(env_data)
        if cmd_name == "list-running":
            return self._list_running(env_data)
        if cmd_name == "chat":
            return self._chat(
                env_data, prompt or "Hello! Briefly introduce yourself in one sentence."
            )
        if cmd_name == "pull-model":
            return self._pull_model(env_data, output_cb=kwargs.get("output_cb"))
        if cmd_name == "delete-model":
            return self._delete_model(env_data)
        if cmd_name == "show-model":
            return self._show_model(env_data)
        if cmd_name == "embeddings":
            return self._embeddings(env_data, prompt)
        return {"ok": False, "error": f"Unknown command: {cmd_name}"}
