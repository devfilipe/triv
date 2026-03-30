<p align="center">
  <img src="webui/frontend/public/logo.svg" alt="triv logo" width="280"/>
</p>

# triv

**Topology-driven Runtime for Infrastructure Virtualisation**

triv is an open, multi-vendor orchestration platform for managing virtualised and physical network infrastructure. It provides a topology-aware WebUI, a pluggable driver architecture, and built-in AI agent capabilities for automating infrastructure tasks.

| | URL |
|---|---|
| 🖥️ WebUI | http://localhost:5173 |
| 📡 API Docs (Swagger) | http://localhost:5173/docs · http://localhost:8481/docs |
| 📖 ReDoc | http://localhost:5173/redoc |

---

## 🗺️ Overview

Define a topology — nodes, links, and properties — and triv handles the rest: lifecycle management, interactive consoles, log streaming, one-click actions, network configuration, and AI-powered automation.

Nodes can be Docker/Podman containers, libvirt VMs, remote physical devices, LLM endpoints, or AI agents. Any combination can coexist in the same topology.

```
my-project/
  topology.json                 ← nodes, links, interfaces, properties
  capabilities-node-<id>.json   ← per-node: drivers, driver_args, actions
```

---

## ✨ Features

### 🗂️ Topology & Canvas
- 🎨 **Visual topology builder** — React Flow canvas with drag-and-drop, auto-layout, and live status indicators
- 🔀 **Multi-runtime** — Docker, Podman, libvirt/QEMU, remote SSH, logical/app nodes in a single topology
- 🔗 **Link management** — bridge networks, VLANs, trunks; live connectivity matrix
- 📁 **Multi-project** — switch between topology projects at runtime

### ⚙️ Node Management
- 🔄 **Lifecycle actions** — start, stop, restart, create, destroy per node
- 🖥️ **Interactive console** — `virsh console`, `docker exec`, or SSH via xterm.js in the browser
- 📋 **Log streaming** — live container/VM logs in floating panels
- 📡 **Status polling** — runtime state reflected on topology canvas

### 🔌 Driver Architecture
- 📄 **JSON drivers** — define actions declaratively in JSON; no code required for common patterns
- 🐍 **Python drivers** — full lifecycle control via `DriverBase` subclass; vendor-extensible
- 📦 **Driver catalog** — browse, create, and edit drivers from the WebUI
- 🧩 **Capabilities system** — per-node JSON sidecar selects drivers, sets driver args, and picks actions
- 🔁 **`$ref` actions** — reference driver-defined actions by ID for DRY capabilities files
- 🏭 **Vendor drivers** — drop Python or JSON drivers into `~/.triv/vendors/<vendor>/drivers/`

### 🤖 AI Integration
- 🧠 **LLM nodes** — topology nodes backed by any OpenAI-compatible API (OpenAI, Anthropic, DeepSeek, Ollama, Groq, Mistral, and more)
- 🤖 **AI Agent nodes** — agentic reasoning loop: LLM + tool_use over topology nodes
- 🛠️ **AI Tool nodes** — expose any node's actions as callable tools for agents; select which actions to expose per node
- 🔒 **Allowed tools control** — agent driver_args let you explicitly choose which tools are available to each agent
- 🛡️ **Guardrails** — max steps, max tool calls, dry-run mode, custom context, behavioral rules, system prompt override
- 📐 **Structured tool args** — declare typed parameters (`tool_args`) per action so the LLM knows what to pass
- 🔄 **OpenAI & Anthropic protocol** — automatic format detection; tool results sent in the correct wire format per provider

### 🖥️ WebUI Apps
| App | Description |
|---|---|
| 🗂️ **Builder** | Visual topology builder and editor |
| 🔌 **Drivers** | Driver catalog: browse, create, edit JSON and Python drivers |
| 🤖 **AI Central** | LLM node inventory, secrets, provider configuration |
| 🌐 **Net Manager** | First-class network objects: bridges, VLANs, trunks |
| 🔗 **Connectivity** | End-to-end connectivity matrix |
| 📊 **Net Stats** | Live view of all network infrastructure elements |
| 📋 **Nodes** | Browse and interact with all topology nodes |
| 🔧 **Ad-hoc Devices** | Manage standalone devices outside the main topology |
| 💚 **Status** | System health and bridge statistics |

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        WebUI (React)                         │
│  Topology canvas (React Flow) · xterm.js terminals           │
│  Node actions · Driver catalog · AI Central · Net Manager    │
└─────────────────────┬────────────────────────────────────────┘
                      │  REST + WebSocket
┌─────────────────────▼────────────────────────────────────────┐
│                   Backend (FastAPI)                          │
│  Project mgmt · capabilities loader · action executor        │
│  WS proxy (console/SSH/logs) · driver catalog API            │
└─────────────────────┬────────────────────────────────────────┘
                      │
┌─────────────────────▼────────────────────────────────────────┐
│                   triv core                                  │
│  Topology models · env resolver · $ref actions               │
│  DriverRegistry → JSON drivers + Python drivers              │
│  node_helpers: resolve_node_actions, capabilities_path       │
└──────────────────────────────────────────────────────────────┘
```

---

## 🔌 Driver Types

| Type | Runtime | Description |
|---|---|---|
| `container` | docker, podman | Container lifecycle (create, start, stop, exec, logs) |
| `libvirt` | libvirt | VM lifecycle via `virsh` (define, start, shutdown, console) |
| `remote` | remote | Physical devices via SSH or RESTCONF |
| `app` | app | Application processes on the host |
| `ai-llm` | llm | LLM endpoint (OpenAI-compat API, Ollama) |
| `ai-agent` | agent | Agentic loop: LLM reasoning + tool execution |
| `ai-tool` | any | Marker driver: exposes a node's actions as AI agent tools |

---

## 📦 Native Drivers

### 🐳 Container (`generic-driver-container`)
Manages Docker/Podman containers. Provides: `create`, `start`, `stop`, `remove`, `console`, `logs`, `container-status`, `connect-network`, `disconnect-network`.

### 🖥️ Libvirt (`generic-driver-libvirt`)
Manages libvirt VMs. Provides: `vm-define`, `vm-start`, `vm-shutdown`, `vm-destroy`, `vm-reboot`, `vm-reset`, `vm-suspend`, `vm-resume`, `vm-console`, `vm-info`, `vm-screenshot`.

### 🌐 Remote (`generic-driver-remote`)
SSH-based access to remote physical or virtual devices.

### ⚙️ App (`generic-driver-app`)
Manages application processes running directly on the host.

### 🧠 LLM (`generic-driver-llm`)
Connects to any OpenAI-compatible LLM API. Supports: OpenAI, Anthropic, DeepSeek, xAI/Grok, Google Gemini, Groq, Mistral, Together, Fireworks, Cohere. Provides `llm-chat`, `llm-status`, `llm-list-models`.

### 🦙 Ollama (`generic-driver-ollama`)
Local Ollama integration with dynamic model discovery.

### 🤖 Generic AI Agent (`generic-driver-agent`)
Runs an agentic reasoning loop using a configured LLM node and tool nodes discovered from the topology. Provides `run-task` and `list-tools`.

**Driver args:**

| Field | Type | Description |
|---|---|---|
| `llm_node` | node-select | LLM node used for reasoning |
| `max_steps` | number | Max reasoning iterations (default 10) |
| `max_tool_calls` | number | Hard cap on tool executions per task (0 = unlimited) |
| `allowed_tools` | multiselect | Tools the agent may call; empty = all discovered tools |
| `context` | text | Domain knowledge injected into every task |
| `rules` | text | Behavioral constraints in natural language |
| `dry_run` | boolean | Simulate tool calls without executing them |
| `system_prompt` | text | Override the default agent system prompt |

### 🛠️ Generic AI Tool (`generic-driver-ai-tool`)
Marker driver. Add to any node's capabilities to expose it as a callable tool for Agent nodes.

**Driver args:**

| Field | Type | Description |
|---|---|---|
| `description` | string | Natural-language description of this node for the agent |
| `expose_actions` | multiselect | Which actions to expose; empty = all non-interactive actions |

---

## 🤖 AI Agent Flow

```
User task
    │
    ▼
Agent node (generic-driver-agent)
    │  discover tools from topology
    │  (nodes with generic-driver-ai-tool in capabilities)
    ▼
LLM node (generic-driver-llm / generic-driver-ollama)
    │  tool_use response
    ▼
Tool executor → node action → result
    │
    ▼
LLM node (next reasoning step)
    │  ...
    ▼
Final answer
```

**Tool discovery** is opt-in and per-node:
1. Add `generic-driver-ai-tool` to a node's capabilities
2. Set `expose_actions` to select which actions the agent can call
3. Optionally define `tool_args` on each action so the LLM knows what parameters to pass
4. In the Agent node's capabilities, use `allowed_tools` to restrict which tools this agent can use

**Action types compatible with tool calling:**
- `exec-output` — runs a command, returns stdout (no payload substitution)
- `exec-with-data` — runs a command with `${param}` substitution from LLM-supplied args
- `driver-command` — delegates to a Python driver method that receives the full payload

---

## 🧩 Capabilities File Format

Each node can have a capabilities sidecar JSON file that configures drivers and actions:

```json
{
  "drivers": [
    {
      "driver": "generic-driver-container",
      "driver_args": {
        "image": "alpine:latest"
      }
    },
    {
      "driver": "generic-driver-ai-tool",
      "driver_args": {
        "description": "Alpine Linux container for network diagnostics",
        "expose_actions": "container-status, exec-ping"
      }
    }
  ],
  "actions": [
    { "$ref": "container-status", "driver": "generic-driver-container", "origin": "native" },
    {
      "id": "exec-ping",
      "label": "Ping",
      "type": "exec-with-data",
      "icon": "activity",
      "command": "docker exec ${vm_name} ping -c4 ${target}",
      "ai_tool_enabled": true,
      "tool_args": {
        "target": {
          "type": "string",
          "description": "IP address or hostname to ping",
          "required": true
        }
      }
    }
  ]
}
```

**Template variables** available in action commands:

| Variable | Value |
|---|---|
| `${vm_name}` | Resolved VM/container name |
| `${node.id}` | Node ID |
| `${node.properties.<key>}` | Node property |
| `${iface.<id>.<field>}` | Interface attribute (e.g. `${iface.mgmt.ip}`) |
| `${env.<key>}` | Driver args value |
| `${json:env.<key>}` | JSON-serialised driver args value |
| `${project_dir}` | Absolute project directory |
| `${project_id}` | Project identifier |

---

## 🏭 Vendor Drivers

Drop custom drivers into `~/.triv/vendors/<vendor>/drivers/` to extend triv without modifying the core.

**JSON driver skeleton** (`~/.triv/vendors/acme/drivers/acme-router.json`):
```json
{
  "id": "acme-router",
  "type": "remote",
  "label": "ACME Router",
  "vendor": "ACME Corp",
  "version": "1.0.0",
  "accent_color": "#a6e3a1",
  "driver_args_schema": {
    "host": { "type": "string", "label": "Host", "required": true }
  },
  "actions": {
    "show-version": {
      "id": "show-version",
      "label": "Show Version",
      "type": "exec-output",
      "icon": "info",
      "command": "ssh admin@${env.host} show version",
      "ai_tool_enabled": true
    }
  }
}
```

**Python driver skeleton** (`~/.triv/vendors/acme/drivers/acme_router.py`):
```python
from triv.drivers.base import DriverBase, Branding, DeviceCommand

class AcmeRouterDriver(DriverBase):
    name = "acme-router-python"

    def metadata(self) -> Branding:
        return Branding(vendor_name="ACME Corp", driver_label="ACME Router", accent_color="#a6e3a1")

    def driver_type(self) -> str:
        return "remote"

    def commands(self) -> list[DeviceCommand]:
        return [
            DeviceCommand(
                name="show-version",
                label="Show Version",
                icon="info",
                description="Display firmware version",
                tool_args={
                    "format": {"type": "string", "description": "Output format (text or json)"}
                },
            )
        ]

    def run_command(self, cmd_name, node, env_data=None, **kwargs):
        args = (env_data or {}).get("driver_args", {})
        payload = kwargs.get("payload") or {}
        if cmd_name == "show-version":
            # ... implementation
            return {"ok": True, "output": "...", "output_type": "panel"}
        return {"ok": False, "error": f"Unknown command: {cmd_name}"}
```

The Driver Catalog in the WebUI lets you create, browse, and edit vendor drivers without leaving the browser.

---

## 📂 `~/.triv` — Data directory

All persistent triv state lives under `~/.triv` on the host. This directory is created automatically by `setup.sh` and is shared between local and container runs.

```
~/.triv/
├── users.json                   # User accounts (created on first boot)
├── vendors/                     # Vendor driver packages
│   └── <vendor>/
│       ├── drivers/             # JSON and Python drivers for this vendor
│       │   ├── my-device.json
│       │   └── my_device.py
│       ├── capabilities/        # Per-node capabilities files
│       │   └── capabilities-node-<id>.json
│       └── templates/           # Vendor-specific templates (libvirt XML, etc.)
├── secrets/                     # Credentials store (never committed)
│   └── <secret-name>.json
└── state/                       # Runtime state (active project, etc.)
```

- 🏭 **Vendor drivers** placed under `~/.triv/vendors/<vendor>/drivers/` are discovered automatically at startup — no code changes needed. They appear in the Driver Catalog alongside native drivers.
- 🧩 **Capabilities files** under `~/.triv/vendors/<vendor>/capabilities/` are linked to nodes by the `env` field in the topology. The backend resolves relative paths through this directory first.
- 🔐 **Secrets** stored under `~/.triv/secrets/` are referenced by name in driver args (e.g. `"credential": "my-api-key"`). Their values are never exposed through the API.

---

## 📋 Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| 🐍 Python | ≥ 3.11 | Core framework + backend |
| 🟩 Node.js | ≥ 20 | Frontend build |
| 🐳 Docker | ≥ 24 | Container runtime + docker-compose stack |
| 🖥️ libvirt | any | `virsh`, `libvirtd` (VM backend, optional) |
| 💾 qemu-img | any | qcow2 overlay creation (VM backend, optional) |

---

## 🚀 Setup

```bash
git clone https://github.com/devfilipe/triv
cd triv
chmod +x setup.sh
```

| Command | Description |
|---|---|
| `./setup.sh docker` | 🐳 Build container images and start the full stack (no local deps needed) |
| `./setup.sh local` | 🐍 Install Python venv + build frontend locally |
| `./setup.sh status` | 📊 Show running containers, ports, `~/.triv` state |
| `./setup.sh clean` | 🧹 Remove `.venv`, `node_modules`, `dist`, `__pycache__` |

---

## 🔐 Authentication

triv requires login. All API routes are protected by JWT — the WebUI redirects to the login page automatically when not authenticated.

### First run

`setup.sh docker` handles everything automatically:

- If `docker/.env` is missing, it is created from `.env.example` (default password: `admin`)
- If `TRIV_SECRET_KEY` is empty, a random key is generated and saved to `docker/.env`
- On first boot, the admin user is created in `~/.triv/users.json`

**Login:** `admin` / `admin`

To use a custom password before the first boot, edit `docker/.env`:

```bash
TRIV_ADMIN_PASSWORD=your_password_here
```

> `TRIV_ADMIN_PASSWORD` is only read on first boot (when `~/.triv/users.json` doesn't exist yet). After that it has no effect — the password lives as a bcrypt hash in `users.json`.

### Changing the password

- **Phase 1 (coming):** Settings → Users → Reset password in the UI
- **Now:** Delete `~/.triv/users.json`, set a new `TRIV_ADMIN_PASSWORD` in `docker/.env`, and restart

### Sessions & JWT

| Property | Value |
|---|---|
| Algorithm | HS256 |
| Default lifetime | 8 hours (`TRIV_TOKEN_EXPIRE_HOURS`) |
| Storage | `localStorage` (`triv_token`) |
| Auto-refresh | Yes — renewed automatically when < 5 minutes remain |
| On expiry | 401 → frontend redirects to login |
| Logout | Clears token from localStorage immediately |

Tokens are signed with `TRIV_SECRET_KEY`. If that key changes (or is not set and the container restarts), all active sessions are invalidated — users will be redirected to login on their next API call.

For persistent sessions across container restarts, set a fixed key:

```bash
echo "TRIV_SECRET_KEY=$(openssl rand -hex 32)" >> docker/.env
```

To adjust session duration:

```bash
TRIV_TOKEN_EXPIRE_HOURS=24   # 24-hour sessions
```

> **API access:** to call the API directly (e.g. curl, scripts), obtain a token via `POST /api/auth/login` and pass it as `Authorization: Bearer <token>` on subsequent requests.

---

## ▶️ Running

### 🐳 Docker (recommended)

The fastest way to build and run triv is with the setup script:

```bash
# First time: configure credentials
cp docker/.env.example docker/.env
# edit docker/.env and set TRIV_ADMIN_PASSWORD

./setup.sh docker
```

This builds both container images and starts the stack via `docker compose`. No local Python or Node.js required.

```
WebUI    → http://localhost:5173
Swagger  → http://localhost:5173/docs     (proxied via nginx)
           http://localhost:8481/docs     (backend direct)
```

Other useful commands:

```bash
./setup.sh status                                          # show containers, paths, venv state
./setup.sh clean                                           # remove local build artefacts
docker compose -f docker/docker-compose.yml logs -f        # follow logs
docker compose -f docker/docker-compose.yml down           # stop
```

#### Container architecture & volumes

The stack has two containers:

| Container | Role | Port |
|---|---|---|
| `backend` | FastAPI, driver execution, WebSocket proxy | host network (8481) |
| `frontend` | nginx serving the pre-built React app | 5173 → 80 |

The **backend** runs with `network_mode: host` and `privileged: true` so it can reach libvirt, Docker, and any topology node on the host network without NAT.

The following **bind mounts** are used:

| Host path | Container path | Purpose |
|---|---|---|
| `~/.triv` | `/root/.triv` | triv data dir — vendors, capabilities, secrets, state |
| `/var/run/libvirt` | `/var/run/libvirt` | libvirt UNIX socket (VM management) |
| `/var/run/docker.sock` | `/var/run/docker.sock` | Docker daemon socket (container management) |
| `/usr/bin/docker` | `/usr/local/bin/docker` | Docker CLI binary (read-only) |
| `/tmp` | `/tmp` | Shared temp dir (qcow2 overlays, pipes) |
| `$HOME` | `$HOME` | Host home directory read-only (disk image paths) |

The **frontend** container connects back to the backend via `host.docker.internal` (mapped to the host gateway), so the nginx reverse proxy can reach the backend API regardless of host network configuration.

#### Override the default project

```bash
TOPO_PROJECT_DIR=/path/to/my-project ./setup.sh docker
# or after the stack is running:
TOPO_PROJECT_DIR=/path/to/my-project docker compose -f docker/docker-compose.yml up -d --no-build
```

### 💻 Local development

```bash
# Start backend (FastAPI, auto-reload) + frontend (Vite, HMR) together
make run

# Or separately:
make run-backend    # FastAPI on :8080
make run-frontend   # Vite on :5173 (proxies /api → :8080)
```

Set a project directory:
```bash
make run PROJECT=/path/to/my-project
```

### 🧹 Code quality

triv uses [ruff](https://docs.astral.sh/ruff/) for linting and formatting. Install it with:

```bash
pip install ruff
# or via dev extras:
pip install -e ".[dev]"
```

```bash
# Lint
ruff check triv/ webui/backend/

# Lint + auto-fix
ruff check triv/ webui/backend/ --fix

# Format
ruff format triv/ webui/backend/
```

Configuration is in `pyproject.toml` under `[tool.ruff]`. The `webui/backend/app.py` file is exempt from `E402` (imports after code) because the bootstrap must run before router imports.

---

## 🛠️ Makefile reference

```
make help             List all targets
make setup            Full setup (venv + backend + frontend)
make setup-backend    Python venv + backend deps only
make setup-frontend   npm install for frontend only
make clean            Remove .venv, node_modules, __pycache__
make run              Start backend + frontend together
make run-backend      Start FastAPI backend (port 8080)
make run-frontend     Start Vite dev server (port 5173)
make check            Syntax-check all Python files
make docker-up        Build and start docker-compose stack
make docker-down      Stop docker-compose stack
```

---

## 📁 Project structure

```
triv/
├── triv/                        # Python package
│   ├── core/                    # env loader, topology models, enums, events
│   └── drivers/                 # DriverBase, DriverRegistry, all generic drivers
│       ├── base.py              # DriverBase, DeviceCommand, Branding
│       ├── registry.py          # Driver auto-discovery and registration
│       ├── generic_driver_container.py  # Docker/Podman driver
│       ├── generic_driver_libvirt.py    # libvirt/QEMU driver
│       ├── generic_driver_remote.py     # Remote/SSH driver
│       ├── generic_driver_llm.py        # LLM driver (OpenAI-compat)
│       ├── generic_driver_ollama.py     # Ollama driver
│       ├── generic_driver_agent.py      # AI Agent driver
│       └── generic_driver_*.json        # JSON driver definitions
├── webui/
│   ├── backend/                 # FastAPI application
│   │   ├── app.py               # Entry point: middleware, routers, startup
│   │   ├── auth.py              # JWT + bcrypt + user store (users.json)
│   │   ├── shared.py            # Global state (topology, registry, paths, auth config)
│   │   ├── node_helpers.py      # Capabilities resolution, action merging
│   │   └── routers/             # REST routers (nodes, drivers, networks, auth, …)
│   └── frontend/                # React + TypeScript
│       └── src/
│           ├── App.tsx           # Main layout, view routing, apps launcher
│           ├── AuthContext.tsx   # Auth provider: token, useAuth(), isAdmin, canEdit
│           ├── LoginPage.tsx     # Login form
│           ├── apiFetch.ts       # fetch() wrapper: injects Bearer token, handles 401
│           ├── BuilderCanvas.tsx # React Flow topology canvas
│           ├── CapabilitiesModal.tsx # Node capabilities editor
│           ├── NodeDrivers.tsx   # Driver catalog browser/editor
│           └── AiCentral.tsx     # AI/LLM resource management
├── docker/                      # Dockerfiles + docker-compose.yml + nginx.conf
│   ├── .env.example             # Environment template (copy to .env before first run)
├── pyproject.toml               # triv as installable Python package
├── setup.sh                     # One-command environment setup
└── Makefile                     # All dev/run/docker targets
```

---

## 📡 API reference

The FastAPI backend exposes interactive API docs at `/docs` (Swagger UI) and `/redoc`.

Key endpoints:

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check — no auth required |
| `POST` | `/api/auth/login` | Obtain JWT (`{ username, password }`) |
| `POST` | `/api/auth/refresh` | Renew JWT (Bearer token required) |
| `GET` | `/api/auth/me` | Return authenticated user info |
| `GET` | `/api/nodes` | List all topology nodes with resolved actions |
| `POST` | `/api/nodes/{id}/action/{action_id}` | Execute a node action |
| `GET` | `/api/nodes/{id}/capabilities` | Get node capabilities file |
| `PUT` | `/api/nodes/{id}/capabilities` | Save node capabilities file |
| `GET` | `/api/nodes/{id}/agent/tools` | Discover available tools for an agent node |
| `GET` | `/api/drivers/catalog` | List all drivers (native + vendor) |
| `POST` | `/api/drivers/scaffold` | Create a new driver blueprint |
| `PUT` | `/api/drivers/catalog/{id}/actions` | Update a JSON driver's actions |
| `GET` | `/api/networks` | List topology network definitions |
| `GET` | `/api/secrets` | List configured secrets (keys only) |
| `WS` | `/ws/console/{node_id}` | WebSocket console (virsh/docker/SSH) |
| `WS` | `/ws/logs/{node_id}` | WebSocket log stream |

---

## 🔐 Secrets

Credentials (API keys, SSH passwords) are stored in `~/.triv/secrets/` and referenced by name in driver args. They are never exposed through the API — only their names and types are listed.

---

## 📄 License

MIT
