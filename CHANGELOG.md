# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.1] - 2026-03-22

### Added

#### Topology & Canvas
- Visual topology builder with React Flow canvas — drag-and-drop nodes and links, auto-layout, live status indicators
- Multi-runtime node types: Docker/Podman containers, libvirt/QEMU VMs, remote/SSH devices, application processes, logical nodes, LLM endpoints, AI agents, AI tools
- Link management with bridge networks, VLANs, and trunk support
- Live connectivity matrix panel
- Multi-project support — switch between topology projects at runtime via Project Manager
- Node status polling with runtime state reflected on the canvas

#### Driver Architecture
- `DriverBase` abstract class for Python drivers with `run_command()`, `commands()`, `driver_args_schema()`, and metadata hooks
- JSON driver format for declarative action definitions without code
- `DriverRegistry` for built-in driver registration and vendor driver discovery via `importlib.metadata` entry points
- Capabilities system — per-node JSON sidecar selects drivers, sets `driver_args`, and declares actions
- `$ref` action entries — reference driver-defined actions by ID for DRY capabilities files
- Template variable substitution in action commands (`{{node.id}}`, `{{driver_args.image}}`, `{{secrets.X}}`, etc.)
- Vendor driver extension — drop JSON or Python drivers into `~/.triv/vendors/<vendor>/drivers/`

#### Built-in Drivers
- `generic-driver-container` — Docker/Podman lifecycle: create, start, stop, restart, remove, console, logs, status, network connect/disconnect
- `generic-driver-libvirt` — libvirt/QEMU VM lifecycle: define, start, shutdown, reboot, destroy, console, info
- `generic-driver-remote` — remote/physical device access: SSH console, ping, status
- `generic-driver-app` — application process management: start, stop, status, logs
- `generic-driver-llm` — OpenAI-compatible LLM endpoint node (OpenAI, Anthropic, DeepSeek, Groq, Mistral, and others)
- `generic-driver-ollama` — Ollama local LLM node with model pull and chat
- `generic-driver-ai-tool` — expose a node's actions as callable tools for AI agents; selects which actions to expose per node, with per-action `ai_tool_enabled` flag and `tool_args` schema
- `generic-driver-agent` — AI agent node: agentic reasoning loop (LLM + tool_use) over topology nodes exposed as tools; supports `allowed_tools` whitelist, `max_steps`, `max_tool_calls`, `dry_run`, custom `context`, behavioral `rules`, and `system_prompt` override
- `generic-driver-netcfg` — Linux network interface configuration

#### AI Integration
- Agentic loop with multi-step LLM reasoning and tool execution over topology nodes
- Automatic Anthropic vs OpenAI wire format detection for tool results — compatible with any OpenAI-compatible provider
- `allowed_tools` multiselect in agent `driver_args` — explicit whitelist of tools the agent may call (empty = all tools allowed)
- Tool discovery endpoint `GET /api/nodes/{id}/agent/tools` — returns all tools discoverable from the topology for a given agent node
- `dry_run` mode — tools are described but not executed, safe for testing tasks
- AI Central — browser-based chat interface for interacting with LLM nodes
- Floating task panel — live agentic task progress with step-by-step tool call log

#### WebUI
- React + Vite frontend served via nginx on port 5173
- FastAPI backend on port 8481 with REST and WebSocket APIs
- Apps launcher screen with categorized application entries (Editor, AI, Network, Nodes, System)
- Driver catalog — browse, create, and edit JSON drivers from the browser
- Capabilities modal — per-node driver selection, `driver_args` configuration, and action management with field types: string, number, boolean, text, select, node-select, multiselect, action-multiselect (grouped by driver, excluding `ai-*` types), agent-tool-multiselect
- Node drivers panel — view driver metadata, actions, `ai_tool_enabled` badge, and `tool_args` schema
- Interactive console via xterm.js — `docker exec`, `virsh console`, or SSH in the browser
- Floating output panels for action results, logs, and web content
- Network manager — create and manage bridge networks, VLANs, trunks
- Connectivity panel — live reachability matrix between nodes
- Ad-hoc devices panel — manage out-of-topology devices
- Secrets manager — store and reference encrypted secrets in driver args

#### Infrastructure & Operations
- Docker Compose deployment via `./setup.sh docker` — backend with `network_mode: host` and `privileged: true`, nginx frontend
- `~/.triv` persistent data directory — vendor drivers, capabilities, secrets, state; bind-mounted into the backend container
- `Makefile` with `build`, `up`, `down`, `logs`, `shell`, `clean` targets
- WebSocket live event bus for real-time topology and status updates
- Plugin system with `PluginBase` and `PluginManager` for backend extensions

[Unreleased]: https://github.com/devfilipe/triv/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/devfilipe/triv/releases/tag/v0.0.1
