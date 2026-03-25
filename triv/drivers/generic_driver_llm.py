"""triv.drivers.generic_llm — Generic LLM driver.

Supports Ollama (local), OpenAI, Anthropic, Groq and any OpenAI-compatible
endpoint. Uses only stdlib (urllib) — no extra dependencies required.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any

from .base import Branding, DeviceCommand, DriverBase


_PROVIDER_DEFAULTS: dict[str, str] = {
    "openai": "https://api.openai.com/v1",
    "anthropic": "https://api.anthropic.com",
    "ollama": "http://localhost:11434/v1",
    "xai": "https://api.x.ai/v1",
    "gemini": "https://generativelanguage.googleapis.com/v1beta/openai",
    "groq": "https://api.groq.com/openai/v1",
    "lmstudio": "http://localhost:1234/v1",
    "mistral": "https://api.mistral.ai/v1",
    "together": "https://api.together.xyz/v1",
    "fireworks": "https://api.fireworks.ai/inference/v1",
    "deepseek": "https://api.deepseek.com/v1",
    "cohere": "https://api.cohere.com/v2",
}


class GenericLlmDriver(DriverBase):
    """Python driver backing generic-driver-llm.json."""

    name = "generic-driver-llm-python"
    version = "1.0.0"

    def metadata(self) -> Branding:
        return Branding(
            vendor_name="triv",
            driver_label="Generic LLM",
            description="Connects to LLM services (Ollama, OpenAI, Anthropic, Groq, LM Studio) — check status, list models and run chat completions.",
            accent_color="#cba6f7",
        )

    def driver_type(self) -> str:
        return "ai-llm"

    def vm_name(self, node: dict, env_data: dict | None = None) -> str:
        return (node.get("properties") or {}).get("label", "") or node.get("id", "llm")

    def driver_args_schema(self) -> dict:
        return {
            "provider": {
                "type": "provider-select",
                "label": "Provider",
                "description": "LLM provider — pick from the list or type a custom value",
                "required": True,
                "default": "ollama",
                "placeholder": "ollama",
            },
            "model": {
                "type": "model-select",
                "label": "Model",
                "description": "Model name — type or pick from the list (varies by provider)",
                "required": True,
                "placeholder": "llama3",
                "depends_on": "provider",
            },
            "base_url": {
                "type": "string",
                "label": "Base URL",
                "description": "API base URL — leave empty to use provider default",
                "required": False,
                "placeholder": "http://localhost:11434",
            },
            "credential": {
                "type": "secret",
                "label": "Credential",
                "description": "Secret from the triv secrets store — takes priority over API Key below",
                "required": False,
            },
            "api_key": {
                "type": "password",
                "label": "API Key (inline)",
                "description": "API key stored directly — prefer using a named Credential instead",
                "required": False,
            },
            "temperature": {
                "type": "number",
                "label": "Temperature",
                "description": "Sampling temperature 0.0–2.0",
                "required": False,
                "default": 0.7,
            },
            "max_tokens": {
                "type": "number",
                "label": "Max Tokens",
                "description": "Maximum tokens in the response",
                "required": False,
                "default": 2048,
            },
        }

    def commands(self) -> list[DeviceCommand]:
        return [
            DeviceCommand(
                name="status",
                label="Status",
                icon="activity",
                description="Check if the LLM endpoint is reachable",
            ),
            DeviceCommand(
                name="list-models",
                label="List Models",
                icon="layers",
                description="List available models from the provider",
            ),
            DeviceCommand(
                name="chat",
                label="Chat",
                icon="message-square",
                description="Run a single-turn chat completion",
            ),
        ]

    # ── Internal helpers ─────────────────────────────────────────────

    def _args(self, env_data: dict | None) -> tuple[str, str, str, str, float, int]:
        a = (env_data or {}).get("driver_args", {})
        provider = a.get("provider", "ollama").lower().strip()
        model = a.get("model", "llama3").strip()
        base_url = (a.get("base_url") or "").rstrip("/").strip()
        api_key = a.get("api_key", "")
        # Named credential takes priority over inline api_key
        credential = (a.get("credential") or "").strip()
        if credential:
            try:
                from triv.core.secrets import resolve as _resolve

                resolved = _resolve(credential)
                if resolved:
                    api_key = resolved
            except Exception:
                pass
        temperature = float(a.get("temperature", 0.7))
        max_tokens = int(a.get("max_tokens", 2048))
        if not base_url:
            base_url = _PROVIDER_DEFAULTS.get(provider, "http://localhost:11434")
        return provider, model, base_url, api_key, temperature, max_tokens

    def _get(self, url: str, headers: dict) -> tuple[bool, dict]:
        req = urllib.request.Request(url, headers=headers, method="GET")
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return True, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return False, {"error": f"HTTP {e.code}: {e.read().decode()[:300]}"}
        except Exception as e:
            return False, {"error": str(e)}

    def _post(self, url: str, body: dict, headers: dict, timeout: int = 60) -> tuple[bool, dict]:
        data = json.dumps(body).encode()
        req = urllib.request.Request(
            url,
            data=data,
            headers={**headers, "Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return True, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return False, {"error": f"HTTP {e.code}: {e.read().decode()[:500]}"}
        except Exception as e:
            return False, {"error": str(e)}

    # ── Public command implementations ────────────────────────────────

    def chat(self, env_data: dict | None, prompt: str, system: str = "") -> dict:
        """Single-turn chat. Returns {"ok", "output", "output_type"}."""
        provider, model, base_url, api_key, temperature, max_tokens = self._args(env_data)
        return self._chat(
            provider, base_url, api_key, model, temperature, max_tokens, prompt, system
        )

    def multi_turn_chat(
        self, env_data: dict | None, messages: list[dict], system: str = ""
    ) -> dict:
        """Multi-turn chat. messages is [{role, content}, ...]. Returns {ok, output, output_type}."""
        provider, model, base_url, api_key, temperature, max_tokens = self._args(env_data)
        if provider == "anthropic":
            return self._anthropic_chat(
                base_url, api_key, model, temperature, max_tokens, messages, system
            )
        # OpenAI-compatible: prepend optional system message
        h = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        msgs: list[dict] = []
        if system:
            msgs.append({"role": "system", "content": system})
        msgs.extend(messages)
        body = {
            "model": model,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "messages": msgs,
        }
        ok, data = self._post(f"{base_url}/chat/completions", body, h, timeout=120)
        if not ok:
            err = data.get("error", {})
            return {
                "ok": False,
                "output": (err.get("message", str(err)) if isinstance(err, dict) else str(err)),
                "output_type": "panel",
            }
        text = (data.get("choices") or [{}])[0].get("message", {}).get("content", "")
        return {"ok": True, "output": text, "output_type": "panel"}

    def chat_with_tools(
        self,
        env_data: dict | None,
        messages: list[dict],
        tools: list[dict],
        system: str = "",
    ) -> dict:
        """Multi-turn chat with tool definitions (Anthropic format)."""
        provider, model, base_url, api_key, temperature, max_tokens = self._args(env_data)
        return self._chat_tools(
            provider,
            base_url,
            api_key,
            model,
            temperature,
            max_tokens,
            messages,
            tools,
            system,
        )

    def status(self, env_data: dict | None) -> dict:
        provider, model, base_url, api_key, *_ = self._args(env_data)
        h = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        ok, _ = self._get(f"{base_url}/models", h)
        msg = "reachable" if ok else "unreachable"
        return {
            "ok": ok,
            "output": f"{provider} endpoint {msg} @ {base_url}",
            "output_type": "panel",
        }

    def list_models(self, env_data: dict | None) -> dict:
        provider, _, base_url, api_key, *_ = self._args(env_data)
        h = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        ok, data = self._get(f"{base_url}/models", h)
        if not ok:
            return {
                "ok": False,
                "output": data.get("error", "Failed"),
                "output_type": "panel",
            }
        ids = sorted(m.get("id", "?") for m in data.get("data", []))
        return {
            "ok": True,
            "output": "Models:\n" + "\n".join(f"  {i}" for i in ids),
            "output_type": "panel",
        }

    # ── Internal LLM calls ────────────────────────────────────────────

    def _chat(
        self,
        provider: str,
        base_url: str,
        api_key: str,
        model: str,
        temperature: float,
        max_tokens: int,
        prompt: str,
        system: str = "",
    ) -> dict:
        h = {"Authorization": f"Bearer {api_key}"} if api_key else {}

        if provider == "anthropic":
            return self._anthropic_chat(
                base_url,
                api_key,
                model,
                temperature,
                max_tokens,
                [{"role": "user", "content": prompt}],
                system,
            )

        # OpenAI-compatible
        msgs: list[dict] = []
        if system:
            msgs.append({"role": "system", "content": system})
        msgs.append({"role": "user", "content": prompt})
        body = {
            "model": model,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "messages": msgs,
        }
        ok, data = self._post(f"{base_url}/chat/completions", body, h)
        if not ok:
            err = data.get("error", {})
            return {
                "ok": False,
                "output": (err.get("message", str(err)) if isinstance(err, dict) else str(err)),
                "output_type": "panel",
            }
        text = (data.get("choices") or [{}])[0].get("message", {}).get("content", "")
        return {"ok": True, "output": text, "output_type": "panel"}

    def _chat_tools(
        self,
        provider: str,
        base_url: str,
        api_key: str,
        model: str,
        temperature: float,
        max_tokens: int,
        messages: list[dict],
        tools: list[dict],
        system: str = "",
    ) -> dict:
        """One call with tool definitions. Returns the raw API response dict."""
        if provider == "anthropic":
            h = {"x-api-key": api_key, "anthropic-version": "2023-06-01"}
            body: dict = {
                "model": model,
                "max_tokens": max_tokens,
                "temperature": temperature,
                "tools": tools,
                "messages": messages,
            }
            if system:
                body["system"] = system
            ok, data = self._post(f"{base_url}/v1/messages", body, h, timeout=120)
            return {"ok": ok, "data": data}

        # OpenAI-compatible tool_call format
        h = {"Authorization": f"Bearer {api_key}"}
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
        oai_msgs: list[dict] = []
        if system:
            oai_msgs.append({"role": "system", "content": system})
        oai_msgs.extend(messages)
        body = {
            "model": model,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "tools": oai_tools,
            "messages": oai_msgs,
        }
        ok, data = self._post(f"{base_url}/chat/completions", body, h, timeout=300)
        return {"ok": ok, "data": data}

    def _anthropic_chat(
        self,
        base_url: str,
        api_key: str,
        model: str,
        temperature: float,
        max_tokens: int,
        messages: list[dict],
        system: str = "",
    ) -> dict:
        h = {"x-api-key": api_key, "anthropic-version": "2023-06-01"}
        body: dict = {
            "model": model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": messages,
        }
        if system:
            body["system"] = system
        ok, data = self._post(f"{base_url}/v1/messages", body, h)
        if not ok:
            return {
                "ok": False,
                "output": data.get("error", "Failed"),
                "output_type": "panel",
            }
        text = ""
        for block in data.get("content", []):
            if isinstance(block, dict) and block.get("type") == "text":
                text += block.get("text", "")
        return {"ok": True, "output": text, "output_type": "panel"}

    # ── DriverBase.run_command ────────────────────────────────────────

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

        if cmd_name == "status":
            return self.status(env_data)
        if cmd_name == "list-models":
            return self.list_models(env_data)
        if cmd_name == "chat":
            if not prompt:
                prompt = "Hello! Briefly introduce yourself."
            return self.chat(env_data, prompt)
        if cmd_name == "pull-model":
            _, model, base_url, *_ = self._args(env_data)
            import subprocess

            r = subprocess.run(
                ["ollama", "pull", model], capture_output=True, text=True, timeout=300
            )
            out = (r.stdout + r.stderr).strip()
            return {
                "ok": r.returncode == 0,
                "output": out or f"Pulled {model}",
                "output_type": "panel",
            }

        return {"ok": False, "error": f"Unknown command: {cmd_name}"}


def _fmt_size(n: int) -> str:
    for u in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.0f} {u}"
        n //= 1024
    return f"{n:.1f} TB"
