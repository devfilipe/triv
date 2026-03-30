#!/usr/bin/env bash
# setup.sh — Single entry-point to install / build / run triv.
#
# Usage:
#   ./setup.sh local           # install locally (venv + frontend build)
#   ./setup.sh docker          # build & start via docker compose
#   ./setup.sh clean           # remove .venv, node_modules, dist, __pycache__
#   ./setup.sh status          # show current state (ports, paths, containers)
#
# Environment:
#   PYTHON=python3.12          # override python binary for local mode
#   TOPO_PROJECT_DIR=...         # override default project dir
#
set -euo pipefail

REPO="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO"

TRIV_HOME="${TRIV_HOME:-$HOME/.triv}"
VENV_DIR=".venv"
PYTHON="${PYTHON:-python3}"
MODE="${1:-}"

BOLD='\033[1m'
CYAN='\033[36m'
GREEN='\033[32m'
YELLOW='\033[33m'
DIM='\033[2m'
RESET='\033[0m'

# ── Helpers ───────────────────────────────────────────────────────────────

ensure_triv_home() {
    echo -e "${DIM}Ensuring TRIV_HOME at ${TRIV_HOME} ...${RESET}"
    mkdir -p "$TRIV_HOME"/{vendors,state}
}

setup_backend() {
    echo -e "\n${BOLD}==> Setting up Python virtualenv${RESET}"
    $PYTHON -m venv "$VENV_DIR"
    "$VENV_DIR/bin/pip" install --upgrade -q pip
    "$VENV_DIR/bin/pip" install -q -e ".[webui,dev]"
    echo -e "  ${GREEN}✓${RESET} Backend installed in ${CYAN}${VENV_DIR}/${RESET}"
}

setup_frontend() {
    if ! command -v npm &>/dev/null; then
        echo -e "\n${YELLOW}WARNING:${RESET} npm not found — skipping frontend build."
        echo "  Install Node.js 20+ to build the WebUI frontend."
        return
    fi
    echo -e "\n${BOLD}==> Building frontend${RESET}"
    (cd webui/frontend && npm install --silent && npm run build --silent)
    echo -e "  ${GREEN}✓${RESET} Frontend built in ${CYAN}webui/frontend/dist/${RESET}"
}

print_summary() {
    local mode="$1"
    echo ""
    echo -e "${BOLD}================================================================${RESET}"
    echo -e "${BOLD}  triv — setup complete (${mode})${RESET}"
    echo -e "${BOLD}================================================================${RESET}"
    echo ""
    echo -e "  ${BOLD}Data directory:${RESET}   ${CYAN}${TRIV_HOME}/${RESET}"
    echo -e "  ${BOLD}Vendor drivers:${RESET}   ${CYAN}${TRIV_HOME}/vendors/${RESET}"
    echo -e "  ${BOLD}State:${RESET}            ${CYAN}${TRIV_HOME}/projects.json${RESET}"
    echo ""
    if [ "$mode" = "docker" ]; then
        echo -e "  ${BOLD}Backend:${RESET}          http://localhost:${CYAN}8481${RESET}  (container, host network)"
        echo -e "  ${BOLD}Frontend:${RESET}         http://localhost:${CYAN}5173${RESET}  (nginx container)"
        echo ""
        echo -e "  ${DIM}Stop:   docker compose -f docker/docker-compose.yml down${RESET}"
        echo -e "  ${DIM}Logs:   docker compose -f docker/docker-compose.yml logs -f${RESET}"
    else
        echo -e "  ${BOLD}Start backend:${RESET}"
        echo -e "    source ${VENV_DIR}/bin/activate"
        echo -e "    make run-backend"
        echo ""
        echo -e "  ${BOLD}Start frontend:${RESET}"
        echo -e "    cd webui/frontend && npm run dev"
        echo ""
        echo -e "  ${BOLD}Backend port:${RESET}     ${CYAN}8080${RESET}  (Makefile default)"
        echo -e "  ${BOLD}Frontend port:${RESET}    ${CYAN}5173${RESET}  (Vite dev server)"
    fi
    echo ""
    echo -e "${BOLD}================================================================${RESET}"
}

# ── Modes ─────────────────────────────────────────────────────────────────

do_local() {
    ensure_triv_home
    setup_backend
    setup_frontend
    print_summary "local"
}

do_docker() {
    ensure_triv_home

    local ENV_FILE="$REPO/docker/.env"
    local ENV_EXAMPLE="$REPO/docker/.env.example"

    # ── Check .env exists — auto-copy from example if missing ────────
    if [ ! -f "$ENV_FILE" ]; then
        cp "$ENV_EXAMPLE" "$ENV_FILE"
        echo -e "  ${GREEN}✓${RESET} Created ${CYAN}docker/.env${RESET} from .env.example"
    fi

    # ── Source .env ──────────────────────────────────────────────────
    # shellcheck disable=SC1090
    set -a; source "$ENV_FILE"; set +a

    # Warn about default password but don't block — it's intentional for quick start
    if [ "${TRIV_ADMIN_PASSWORD:-}" = "admin" ] && [ ! -f "$TRIV_HOME/users.json" ]; then
        echo ""
        echo -e "  ${YELLOW}NOTE:${RESET} Using default admin password 'admin'."
        echo -e "  ${DIM}Change it after login via Settings → Users (Phase 1), or${RESET}"
        echo -e "  ${DIM}edit docker/.env and delete ~/.triv/users.json to reset.${RESET}"
        echo ""
    fi

    # ── Auto-generate TRIV_SECRET_KEY if missing ────────────────────
    if [ -z "${TRIV_SECRET_KEY:-}" ]; then
        local GENERATED_KEY
        GENERATED_KEY="$(openssl rand -hex 32 2>/dev/null || python3 -c 'import secrets; print(secrets.token_hex(32))')"
        echo "TRIV_SECRET_KEY=${GENERATED_KEY}" >> "$ENV_FILE"
        export TRIV_SECRET_KEY="$GENERATED_KEY"
        echo -e "  ${GREEN}✓${RESET} Generated TRIV_SECRET_KEY and saved to docker/.env"
    fi

    echo -e "\n${BOLD}==> Building and starting docker compose stack${RESET}"
    docker compose -f "$REPO/docker/docker-compose.yml" up --build -d
    echo -e "  ${GREEN}✓${RESET} Containers started"
    print_summary "docker"
}

do_clean() {
    echo -e "${BOLD}==> Cleaning build artifacts${RESET}"
    rm -rf "$VENV_DIR"
    rm -rf webui/frontend/node_modules
    rm -rf webui/frontend/dist
    find . -type d -name '__pycache__' -exec rm -rf {} + 2>/dev/null || true
    echo -e "  ${GREEN}✓${RESET} Cleaned .venv, node_modules, dist, __pycache__"
    echo ""
    echo -e "  ${DIM}Note: ${TRIV_HOME}/ is NOT removed (persistent data).${RESET}"
    echo -e "  ${DIM}To fully reset:  rm -rf ${TRIV_HOME}${RESET}"
}

do_status() {
    echo -e "${BOLD}triv status${RESET}"
    echo ""
    echo -e "  ${BOLD}TRIV_HOME:${RESET}  ${TRIV_HOME}"
    if [ -d "$TRIV_HOME" ]; then
        echo -e "    vendors:   $(ls -d "$TRIV_HOME"/vendors/*/ 2>/dev/null | wc -l)"
    else
        echo -e "    ${YELLOW}(not initialised — run ./setup.sh local or ./setup.sh docker)${RESET}"
    fi
    echo ""
    echo -e "  ${BOLD}Docker containers:${RESET}"
    if docker compose -f "$REPO/docker/docker-compose.yml" ps --format '{{.Name}} {{.Status}}' 2>/dev/null | grep -q .; then
        docker compose -f "$REPO/docker/docker-compose.yml" ps --format '    {{.Name}}: {{.Status}}'
    else
        echo "    (none running)"
    fi
    echo ""
    echo -e "  ${BOLD}Local venv:${RESET}  $([ -d "$VENV_DIR" ] && echo "${GREEN}present${RESET}" || echo "${DIM}not created${RESET}")"
}

# ── Main ──────────────────────────────────────────────────────────────────

case "${MODE}" in
    local)
        do_local
        ;;
    docker)
        do_docker
        ;;
    clean)
        do_clean
        ;;
    status)
        do_status
        ;;
    *)
        echo "Usage: $0 <local|docker|clean|status>"
        echo ""
        echo "  local    Set up a local Python venv + build frontend"
        echo "  docker   Build & start containers via docker compose"
        echo "  clean    Remove .venv, node_modules, dist, __pycache__"
        echo "  status   Show current state (paths, containers, venv)"
        exit 1
        ;;
esac
