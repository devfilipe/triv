# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-03-25

### Added

#### Wizard AI Assistant
- Floating Wizard panel — persistent chat interface docked to the WebUI, sends natural-language tasks to the Wizard agent and renders step-by-step tool call progress
- `WizardManager` — wizard lifecycle manager: loads a dedicated internal topology (`~/.triv/wizard/`), manages config persistence in `~/.triv/wizard_config.json`, builds tool executors, and runs agent tasks
- Wizard internal topology with three built-in nodes: `triv-wizard-llm` (LLM endpoint), `triv-wizard-agent` (agentic reasoning loop), `triv-wizard-app` (REST API client for topology operations)
- `WizardConfig` canvas — ReactFlow view of the wizard internal topology; click any node to edit capabilities, run actions, or configure the agent
- `wizard_app.py` — CLI tool exposing topology CRUD operations (`create-node`, `update-node`, `delete-node`, `add-link`, `remove-link`, `set-node-capabilities`, `run-node-action`, `start/stop/restart-node`, network and project management, and more) as agent-callable tools
- Wizard REST API (`/api/wizard/*`): config CRUD, task execution, node capabilities read/write, action execution, topology AI-tool listing
- `WizardConfig` right panel: per-node capability editor, inline action runner with output display, User Instructions textarea, and Danger Area for capability group toggles
- Topology AI Tools support — wizard agent can call AI-tool-enabled actions from user topology nodes when the `topology_ai_tools` capability group is enabled; `GET /api/wizard/topology-tools` returns available tools grouped by node and driver
- "List Topology Tools" action in the agent node's Actions section — opens a modal showing all AI-tool-enabled actions from the user topology, grouped by node > driver > action

#### Destructive Action Confirmation Gate
- `_DESTRUCTIVE_ACTIONS` set in `WizardManager` — defines which tool calls require explicit user confirmation before execution (`delete-node`, `remove-link`, `delete-network`, `undeploy-network`, `delete-secret`, `set-node-capabilities`, `stop-node`, `run-node-action`)
- Confirmation flow in `FloatingWizardPanel`: when a destructive action is blocked, an orange banner lists the pending actions with Confirm / Cancel buttons; confirmed action IDs are re-sent with the next request
- `run_task()` returns `confirmation_required` and `blocked_actions` when destructive ops are intercepted

#### Organizations
- Organizations system — create and manage orgs; projects can be assigned to an org and filtered by active org
- `OrgSelector` component in the top navigation bar — switch active org to filter the project list
- `GET/POST /api/orgs`, `PUT /api/orgs/{id}`, `DELETE /api/orgs/{id}` endpoints
- `POST /api/projects/{id}/move` — move a project to a different org

### Changed
- `generic-driver-agent`: handle `content: null` responses from reasoning models (e.g. `deepseek-reasoner`) — falls back to `reasoning_content`, then issues a follow-up summary call; system prompt instructs the model to always end with a text response
- `generic-driver-llm`: added Ollama default base URL; increased HTTP timeout from 120 s to 300 s
- `CapabilitiesModal` now accepts `apiBase` and `lockedDrivers` props, enabling reuse for wizard nodes with a separate API prefix and driver lock
- `projects` list response includes `active_org` field; project list is filtered by active org when one is set

## [0.1.0] - 2026-03-22

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

[Unreleased]: https://github.com/devfilipe/triv/compare/0.2.0...HEAD
[0.2.0]: https://github.com/devfilipe/triv/compare/0.1.0...0.2.0
[0.1.0]: https://github.com/devfilipe/triv/releases/tag/0.1.0
