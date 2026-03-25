"""triv.drivers.generic_agent — AI Agent driver.

An Agent node reasons over a task using an LLM and executes actions on
other topology nodes as tools. Tool discovery is opt-in: nodes must have
the 'generic-driver-ai-tool' driver in their capabilities.

Tool execution is handled via a callable injected by the backend
(``kwargs["tool_executor"]``) so the driver never imports web code.
"""

from __future__ import annotations

import json
import textwrap
import time
from datetime import datetime, timezone
from typing import Any

from .base import Branding, DeviceCommand, DriverBase


_MAX_STEPS = 10
_AGENT_SYSTEM = textwrap.dedent(
    """\
    You are an intelligent network and infrastructure automation agent running
    inside triv — a topology management platform.

    You have access to tools that correspond to actions on nodes in the
    current topology. Use them to fulfil the user's task.

    Guidelines:
    - Always explain what you are doing before calling a tool.
    - After a tool call, interpret the output and decide the next step.
    - If a tool fails, try an alternative or explain why the task cannot be completed.
    - When done, provide a clear summary of what was accomplished.
    - IMPORTANT: You must ALWAYS end with a text response summarising the result.
      Never end your turn with only a tool call and no text.
"""
)


class GenericAgentDriver(DriverBase):
    """Python driver backing generic-driver-agent.json."""

    name = "generic-driver-agent-python"
    version = "1.0.0"

    def metadata(self) -> Branding:
        return Branding(
            vendor_name="triv",
            driver_label="Generic AI Agent",
            description="AI agent driver — given a task, reasons step-by-step using an LLM node and executes actions on topology nodes exposed as tools.",
            accent_color="#f5c2e7",
        )

    def driver_type(self) -> str:
        return "ai-agent"

    def vm_name(self, node: dict, env_data: dict | None = None) -> str:
        return (node.get("properties") or {}).get("label", "") or node.get("id", "agent")

    def driver_args_schema(self) -> dict:
        return {
            # ── Core ────────────────────────────────────────────────────
            "llm_node": {
                "type": "node-select",
                "filter_runtime": "llm",
                "label": "LLM Node",
                "description": "LLM node this agent uses for reasoning",
                "required": True,
            },
            "max_steps": {
                "type": "number",
                "label": "Max Steps",
                "description": "Maximum reasoning iterations before the agent stops",
                "required": False,
                "default": 10,
            },
            "max_tool_calls": {
                "type": "number",
                "label": "Max Tool Calls",
                "description": "Hard cap on total tool executions per task (0 = unlimited)",
                "required": False,
                "default": 0,
            },
            # ── Agentic context ─────────────────────────────────────────
            "context": {
                "type": "text",
                "label": "Context",
                "description": "Domain knowledge injected into every task — describe the environment, criticality, topology purpose, etc.",
                "required": False,
                "placeholder": "This is a lab environment with 3 nodes. Node r1 acts as the default gateway.",
            },
            "rules": {
                "type": "text",
                "label": "Rules",
                "description": "Behavioral constraints in natural language — what the agent must or must not do",
                "required": False,
                "placeholder": "Never restart a node without logging the reason.\nOnly perform read-only actions unless the task explicitly requests a change.\nAlways verify state before and after any modification.",
            },
            # ── Safety guards ────────────────────────────────────────────
            "allowed_tools": {
                "type": "agent-tool-multiselect",
                "label": "Allowed Tools",
                "description": "Tools this agent is allowed to call. Empty = all discovered tools are allowed.",
                "required": False,
            },
            "dry_run": {
                "type": "boolean",
                "label": "Dry Run",
                "description": "When enabled, tools are described but NOT executed — safe for testing tasks",
                "required": False,
                "default": False,
            },
            # ── Prompt ──────────────────────────────────────────────────
            "system_prompt": {
                "type": "text",
                "label": "System Prompt (override)",
                "description": "Fully replace the default agent system prompt (context and rules are still appended)",
                "required": False,
            },
        }

    def commands(self) -> list[DeviceCommand]:
        return [
            DeviceCommand(
                name="show-llm",
                label="Show LLM",
                icon="brain-circuit",
                description="Show the LLM node configured for this agent",
            ),
            DeviceCommand(
                name="list-tools",
                label="List Tools",
                icon="layers",
                description="List all nodes exposed as tools to this agent",
            ),
            DeviceCommand(
                name="run-task",
                label="Run Task",
                icon="zap",
                description="Give the agent a task — it reasons step-by-step using the LLM and executes actions on tool nodes",
            ),
        ]

    # ── run_command ───────────────────────────────────────────────────

    def run_command(
        self,
        cmd_name: str,
        node: dict,
        env_data: dict | None = None,
        project_dir: str = "",
        **kwargs: Any,
    ) -> dict:
        if cmd_name == "show-llm":
            return self._show_llm(node, env_data, **kwargs)
        if cmd_name == "run-task":
            return self._run_task(node, env_data, **kwargs)
        if cmd_name == "list-tools":
            return self._list_tools(node, env_data, **kwargs)
        return {"ok": False, "error": f"Unknown command: {cmd_name}"}

    # ── Show LLM ─────────────────────────────────────────────────────

    def _show_llm(self, node: dict, env_data: dict | None, **kwargs: Any) -> dict:
        args = (env_data or {}).get("driver_args", {})
        llm_node_id = args.get("llm_node", "").strip()
        max_steps = args.get("max_steps", _MAX_STEPS)
        topology = kwargs.get("topology")

        if not llm_node_id:
            return {
                "ok": False,
                "output": "No LLM node configured. Set 'llm_node' in driver_args.",
                "output_type": "panel",
            }

        lines = [f"LLM node : {llm_node_id}", f"Max steps: {max_steps}"]

        if topology:
            llm_node = topology.get_node(llm_node_id)
            if llm_node:
                nd = llm_node.to_dict()
                props = nd.get("properties") or {}
                label = props.get("label") or llm_node_id
                runtime = nd.get("runtime") or "—"
                lines[0] = f"LLM node : {llm_node_id}  ({label},  runtime: {runtime})"
                llm_env = self._load_llm_env(llm_node_id, topology)
                da = (llm_env or {}).get("driver_args", {})
                if da.get("provider"):
                    lines.append(f"Provider : {da['provider']}")
                if da.get("model"):
                    lines.append(f"Model    : {da['model']}")
                if da.get("base_url"):
                    lines.append(f"Base URL : {da['base_url']}")
            else:
                lines.append(f"WARNING: node '{llm_node_id}' not found in current topology")

        return {"ok": True, "output": "\n".join(lines), "output_type": "panel"}

    # ── Tool discovery ────────────────────────────────────────────────

    def _discover_tools(self, topology: Any, tool_executor: Any, agent_node_id: str) -> list[dict]:
        """Return Anthropic-format tool definitions from ai-tool nodes."""
        tools: list[dict] = []
        if not topology:
            return tools

        try:
            from node_helpers import load_node_env as _load_node_env
            import shared as _shared
            import json as _json
        except Exception:
            return tools

        # Cache driver JSON action definitions to avoid repeated disk reads
        _drv_cache: dict[str, dict] = {}

        def _drv_actions(drv_id: str) -> dict:
            if drv_id in _drv_cache:
                return _drv_cache[drv_id]
            candidates = [_shared.TOOLS_DIR / "triv" / "drivers" / f"{drv_id}.json"]
            vendors_dir = _shared.TRIV_HOME / "vendors"
            if vendors_dir.is_dir():
                for vd in vendors_dir.iterdir():
                    candidates.append(vd / "drivers" / f"{drv_id}.json")
            for p in candidates:
                if p.is_file():
                    try:
                        _drv_cache[drv_id] = _json.loads(p.read_text()).get("actions", {})
                        return _drv_cache[drv_id]
                    except Exception:
                        pass
            _drv_cache[drv_id] = {}
            return {}

        for n in topology.nodes:
            if n.id == agent_node_id:
                continue
            nd = n.to_dict()

            # Use load_node_env for correct path resolution (handles relative paths
            # via capabilities_dir, TRIV_HOME, PROJECT_DIR lookups)
            try:
                caps = _load_node_env(nd)
            except Exception:
                continue
            if not caps:
                continue

            drivers_list = caps.get("drivers", [])
            plugin_cfg: dict | None = next(
                (
                    d.get("driver_args", {})
                    for d in drivers_list
                    if (d.get("driver") or d.get("id") or "") == "generic-driver-ai-tool"
                ),
                None,
            )

            node_label = (nd.get("properties") or {}).get("label", n.id)

            # plugin_cfg is None when generic-driver-ai-tool is not assigned.
            # Still allow nodes whose individual actions carry ai_tool_enabled=True.
            if plugin_cfg is None:
                plugin_cfg = {}

            node_desc = plugin_cfg.get("description", f"Node '{node_label}' in the topology")
            _exposed_raw = plugin_cfg.get("expose_actions", [])
            if isinstance(_exposed_raw, str):
                exposed: list[str] = [s.strip() for s in _exposed_raw.split(",") if s.strip()]
            else:
                exposed = list(_exposed_raw)
            # explicit=True means user made a specific selection in expose_actions
            explicit = bool(exposed)

            for action in caps.get("actions", []):
                # Support both inline {id: ...} and $ref {$ref: "action-id", driver: ...}
                act_id = action.get("id") or action.get("$ref", "")
                if not act_id or act_id.startswith("_"):
                    continue

                if explicit and act_id not in exposed:
                    continue

                # Resolve full definition: driver JSON (base) merged with caps entry
                drv_id = action.get("driver", "")
                drv_act = _drv_actions(drv_id).get(act_id, {}) if drv_id else {}
                merged = {**drv_act, **{k: v for k, v in action.items() if k != "$ref"}}

                # When not explicitly listed, require ai_tool_enabled on the definition
                if not explicit and not merged.get("ai_tool_enabled"):
                    continue

                # Skip interactive/client-side actions
                if merged.get("type") in ("console", "ssh", "link", "webui"):
                    continue

                tool_name = f"{n.id}__{act_id}".replace("-", "_")
                # Build input_schema (LLM protocol) from tool_args (user-facing).
                # tool_args: flat dict  {param_name: {type, description, required?, ...}}
                # input_schema: {type:"object", properties:{...}, required:[...]}
                tool_args: dict = merged.get("tool_args") or {}
                if tool_args:
                    properties = {
                        k: {fk: fv for fk, fv in v.items() if fk != "required"}
                        for k, v in tool_args.items()
                    }
                    required = [k for k, v in tool_args.items() if v.get("required")]
                    input_schema = {
                        "type": "object",
                        "properties": properties,
                        "required": required,
                    }
                else:
                    input_schema = {
                        "type": "object",
                        "properties": {
                            "data": {
                                "type": "string",
                                "description": "Optional data/payload to pass to the action",
                            }
                        },
                        "required": [],
                    }
                tools.append(
                    {
                        "name": tool_name,
                        "description": (
                            f"[{node_label}] {merged.get('label', act_id)}: "
                            f"{merged.get('description', '')} | {node_desc}"
                        ).strip(": "),
                        "input_schema": input_schema,
                        "_node_id": n.id,
                        "_action_id": act_id,
                    }
                )

        return tools

    # ── Task execution ────────────────────────────────────────────────

    def _run_task(self, node: dict, env_data: dict | None, **kwargs: Any) -> dict:
        args = (env_data or {}).get("driver_args", {})
        llm_node_id = args.get("llm_node", "")
        max_steps = int(args.get("max_steps", _MAX_STEPS))
        max_tool_calls = int(args.get("max_tool_calls", 0))  # 0 = unlimited
        sys_override = args.get("system_prompt", "").strip()
        context = args.get("context", "").strip()
        rules = args.get("rules", "").strip()
        dry_run = bool(args.get("dry_run", False))
        allowed_raw = args.get("allowed_tools", "")
        allowed: set[str] = {a.strip() for a in allowed_raw.replace(",", " ").split() if a.strip()}

        payload = kwargs.get("payload") or {}
        task = payload.get("task") or payload.get("prompt") or ""
        topology = kwargs.get("topology")
        tool_exec = kwargs.get("tool_executor")
        registry = kwargs.get("registry")

        if not task:
            return {
                "ok": False,
                "error": "No task provided. Send a 'task' field in the request body.",
                "output_type": "panel",
            }
        if not llm_node_id:
            return {
                "ok": False,
                "error": "No llm_node configured in driver_args.",
                "output_type": "panel",
            }

        # Get LLM node env_data
        llm_env = self._load_llm_env(llm_node_id, topology)
        if llm_env is None:
            return {
                "ok": False,
                "error": f"LLM node '{llm_node_id}' not found in topology.",
                "output_type": "panel",
            }

        # Resolve LLM driver from the LLM node's capabilities
        llm_drv = None
        _llm_py_ids = {"generic-driver-llm-python", "generic-driver-ollama-python"}
        for _cap in llm_env.get("drivers", []):
            _cid = _cap.get("driver") or _cap.get("id") or ""
            if _cid in _llm_py_ids and registry:
                llm_drv = registry.get(_cid) if _cid in registry else None
            elif f"{_cid}-python" in _llm_py_ids and registry:
                _pv = f"{_cid}-python"
                llm_drv = registry.get(_pv) if _pv in registry else None
            if llm_drv:
                break
        if not llm_drv:
            # Fallback to GenericLlmDriver for backward compat
            try:
                from .generic_driver_llm import GenericLlmDriver

                llm_drv = GenericLlmDriver()
            except ImportError as e:
                return {
                    "ok": False,
                    "error": f"Could not load LLM driver: {e}",
                    "output_type": "panel",
                }

        # Discover tools
        agent_node_id = node.get("id", "")
        tools = self._discover_tools(topology, tool_exec, agent_node_id)

        # Build system prompt
        system = sys_override or _AGENT_SYSTEM
        if context:
            system += f"\n\nContext:\n{context}"
        if rules:
            system += f"\n\nRules:\n{rules}"
        if dry_run:
            system += "\n\nDRY RUN MODE: Do NOT actually execute any tools. Describe what you would do instead."

        # Filter tool list by allowed set (if configured)
        if allowed:
            tools = [t for t in tools if t["name"] in allowed]

        meta: list[str] = [f"LLM: {llm_node_id}", f"Tools: {len(tools)}"]
        if dry_run:
            meta.append("DRY RUN")
        if allowed:
            meta.append(f"Allowed: {len(allowed)} tool(s)")
        if max_tool_calls:
            meta.append(f"Max tool calls: {max_tool_calls}")
        log: list[str] = [f"▶ Task: {task}", f"  {' | '.join(meta)}", ""]

        if not tools:
            log.append("⚠ No AI-plugin nodes found. Running without tools.\n")

        # Agentic loop
        messages: list[dict] = [{"role": "user", "content": task}]
        step = 0
        total_tool_calls = 0
        _t0 = time.monotonic()
        _tokens_in = 0
        _tokens_out = 0
        _tool_calls_log: list[str] = []

        while step < max_steps:
            step += 1
            log.append(f"── Step {step} ──────────────────────────────")

            resp = llm_drv.chat_with_tools(llm_env, messages, tools, system)
            if not resp.get("ok"):
                err = (resp.get("data") or {}).get("error", resp.get("error", "LLM call failed"))
                log.append(f"✗ LLM error: {err}")
                break

            _usage = resp.get("usage") or {}
            _tokens_in += _usage.get("tokens_in", 0)
            _tokens_out += _usage.get("tokens_out", 0)

            data = resp["data"]
            stop_reason = data.get("stop_reason") or data.get("finish_reason", "")
            content = data.get("content") or []

            # Collect text and tool_use blocks (Anthropic format)
            text_parts: list[str] = []
            tool_calls: list[dict] = []

            for block in content:
                if not isinstance(block, dict):
                    continue
                if block.get("type") == "text":
                    text_parts.append(block.get("text", ""))
                elif block.get("type") == "tool_use":
                    tool_calls.append(block)

            # Handle OpenAI-compat format
            oai_msg: dict = {}
            if not content and "choices" in data:
                choice = (data.get("choices") or [{}])[0]
                oai_msg = choice.get("message", {})
                if oai_msg.get("content"):
                    text_parts.append(oai_msg["content"])
                # Some reasoning models (e.g. deepseek-reasoner) return
                # content=null but place the answer in reasoning_content.
                elif oai_msg.get("reasoning_content") and not oai_msg.get("tool_calls"):
                    text_parts.append(oai_msg["reasoning_content"])
                for tc in oai_msg.get("tool_calls") or []:
                    fn = tc.get("function", {})
                    try:
                        inp = json.loads(fn.get("arguments", "{}"))
                    except Exception:
                        inp = {}
                    tool_calls.append(
                        {
                            "id": tc.get("id", ""),
                            "name": fn.get("name", ""),
                            "input": inp,
                        }
                    )
                stop_reason = choice.get("finish_reason", "")

            if text_parts:
                log.append("\n".join(text_parts))

            if not tool_calls or stop_reason in ("end_turn", "stop"):
                # If the model returned no text and we executed tools in
                # previous steps, ask the LLM once more to summarise the
                # results.  This handles reasoning models (e.g.
                # deepseek-reasoner) that return content=null after tool
                # use instead of producing a final answer.
                if not text_parts and total_tool_calls > 0 and step < max_steps:
                    messages.append(
                        {
                            "role": "user",
                            "content": (
                                "Please provide a clear and concise answer "
                                "to my original question based on the tool "
                                "results above."
                            ),
                        }
                    )
                    step += 1
                    log.append(f"── Step {step} (summary) ──────────────────")
                    follow = llm_drv.chat_with_tools(llm_env, messages, [], system)
                    if follow.get("ok"):
                        fdata = follow["data"]
                        fcontent = fdata.get("content") or []
                        ftext = ""
                        # Anthropic format
                        for blk in fcontent:
                            if isinstance(blk, dict) and blk.get("type") == "text":
                                ftext += blk.get("text", "")
                        # OpenAI-compat format
                        if not ftext and "choices" in fdata:
                            fc = (fdata.get("choices") or [{}])[0]
                            fm = fc.get("message", {})
                            ftext = fm.get("content") or fm.get("reasoning_content") or ""
                        if ftext:
                            log.append(ftext)
                log.append("\n✓ Done.")
                break

            # Execute tools
            tool_results: list[dict] = []
            for tc in tool_calls:
                tool_name = tc.get("name", "")
                tool_id = tc.get("id", tool_name)
                tool_input = tc.get("input", {})

                # Find the tool definition to get _node_id and _action_id
                tdef = next((t for t in tools if t["name"] == tool_name), None)
                if not tdef:
                    result_text = f"Error: unknown tool '{tool_name}'"
                    log.append(f"  ✗ {tool_name}: {result_text}")
                else:
                    n_id = tdef["_node_id"]
                    act_id = tdef["_action_id"]
                    # Pass the full structured input as payload; drivers and
                    # exec-with-data commands receive all declared parameters.
                    payload_arg = tool_input if tool_input else None

                    # Guard: max tool calls
                    if max_tool_calls and total_tool_calls >= max_tool_calls:
                        result_text = f"BLOCKED: max_tool_calls limit ({max_tool_calls}) reached"
                        log.append(f"  ⛔ {n_id} / {act_id} — {result_text}")
                    # Guard: dry run
                    elif dry_run:
                        result_text = f"DRY RUN: would execute {act_id} on {n_id}"
                        if tool_input:
                            params_str = ", ".join(f"{k}={v!r}" for k, v in tool_input.items())
                            log.append(
                                f"  ○ {n_id} / {act_id}  ({params_str}) — (dry run, not executed)"
                            )
                        else:
                            log.append(f"  ○ {n_id} / {act_id} — (dry run, not executed)")
                    else:
                        if tool_input:
                            params_str = ", ".join(f"{k}={v!r}" for k, v in tool_input.items())
                            log.append(f"  → {n_id} / {act_id}  ({params_str})")
                        else:
                            log.append(f"  → {n_id} / {act_id}")
                        try:
                            if tool_exec:
                                r = tool_exec(n_id, act_id, payload_arg)
                            else:
                                r = {"ok": False, "error": "No tool executor available"}
                            ok_flag = r.get("ok", False)
                            out_text = (
                                r.get("output")
                                or r.get("stdout")
                                or r.get("detail")
                                or r.get("error", "")
                            )
                            result_text = f"{'OK' if ok_flag else 'FAILED'}: {out_text[:800]}"
                            log.append(f"    {'✓' if ok_flag else '✗'} {result_text[:120]}")
                        except Exception as exc:
                            result_text = f"Exception: {exc}"
                            log.append(f"    ✗ {result_text}")
                        total_tool_calls += 1
                        _tool_calls_log.append(f"{n_id}/{act_id}")

                tool_results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": tool_id,
                        "content": result_text,
                    }
                )

            # Hard stop when tool cap is exhausted
            if max_tool_calls and total_tool_calls >= max_tool_calls and tool_calls:
                log.append(f"\n⛔ Stopped: max_tool_calls limit ({max_tool_calls}) reached.")
                self._append_turn(messages, content, text_parts, oai_msg, tool_results)
                break

            # Append assistant turn + tool results for next iteration
            self._append_turn(messages, content, text_parts, oai_msg, tool_results)

        else:
            log.append(f"\n⚠ Stopped after {max_steps} steps.")

        _duration = time.monotonic() - _t0
        _output = "\n".join(log)

        # Record in history via backend shared module (injected or imported lazily)
        try:
            import shared as _shared

            _shared.append_history(
                agent_node_id,
                {
                    "ts": datetime.now(timezone.utc).isoformat(),
                    "type": "agent_task",
                    "agent_node": agent_node_id,
                    "llm_node": llm_node_id,
                    "model": (llm_env or {}).get("driver_args", {}).get("model", ""),
                    "task": task,
                    "output": _output,
                    "tokens": {"in": _tokens_in, "out": _tokens_out},
                    "duration_s": round(_duration, 2),
                    "steps": step,
                    "tool_calls": _tool_calls_log,
                },
            )
        except Exception:
            pass  # history is best-effort; never break the task result

        return {"ok": True, "output": _output, "output_type": "panel"}

    @staticmethod
    def _append_turn(
        messages: list[dict],
        content: list,
        text_parts: list[str],
        oai_msg: dict,
        tool_results: list[dict],
    ) -> None:
        """Append the assistant turn + tool results in the correct format.

        Anthropic format:
          assistant: {content: [...blocks...]}
          user:      {content: [{type: tool_result, tool_use_id, content}...]}

        OpenAI format:
          assistant: {content, tool_calls: [...]}
          tool (×N): {role: tool, tool_call_id, content}
        """
        if oai_msg:
            # OpenAI-compat: reconstruct assistant message with tool_calls preserved
            asst: dict = {"role": "assistant"}
            if oai_msg.get("content"):
                asst["content"] = oai_msg["content"]
            if oai_msg.get("tool_calls"):
                asst["tool_calls"] = oai_msg["tool_calls"]
            messages.append(asst)
            for tr in tool_results:
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tr["tool_use_id"],
                        "content": tr["content"],
                    }
                )
        else:
            # Anthropic format
            messages.append({"role": "assistant", "content": content or text_parts or []})
            messages.append({"role": "user", "content": tool_results})

    def _list_tools(self, node: dict, env_data: dict | None, **kwargs: Any) -> dict:
        topology = kwargs.get("topology")
        tools = self._discover_tools(topology, None, node.get("id", ""))
        if not tools:
            return {
                "ok": True,
                "output": "No AI Tool nodes found in topology.\nAdd 'generic-driver-ai-tool' to a node's capabilities to expose it as a tool.",
                "output_type": "panel",
            }
        lines = ["Available tools:\n"]
        prev_node = ""
        for t in tools:
            nid = t["_node_id"]
            if nid != prev_node:
                lines.append(f"  [{nid}]")
                prev_node = nid
            lines.append(f"    • {t['name']}: {t['description'][:80]}")
        return {"ok": True, "output": "\n".join(lines), "output_type": "panel"}

    @staticmethod
    def _load_llm_env(llm_node_id: str, topology: Any) -> dict | None:
        """Load and normalise the LLM node env, merging per-driver args."""
        if not topology:
            return None
        n = topology.get_node(llm_node_id)
        if not n:
            return None
        nd = n.to_dict()
        try:
            from node_helpers import load_node_env as _load_node_env

            env_data = _load_node_env(nd)
        except Exception:
            env_data = {}

        # Merge per-driver args so _args() picks up provider/model/api_key
        _llm_driver_ids = {
            "generic-driver-llm",
            "generic-driver-ollama",
            "generic-driver-llm-python",
            "generic-driver-ollama-python",
        }
        for _cap in env_data.get("drivers", []):
            _cid = _cap.get("driver") or _cap.get("id") or ""
            if _cid in _llm_driver_ids or f"{_cid}-python" in _llm_driver_ids:
                _per = _cap.get("driver_args", {})
                if _per:
                    env_data = {
                        **env_data,
                        "driver_args": {**env_data.get("driver_args", {}), **_per},
                    }
                break
        return env_data
