# triv — Makefile
# Run 'make help' for usage.

SHELL      := /bin/bash
REPO       := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
VENV       := $(REPO).venv
PY         := $(VENV)/bin/python3
UVICORN    := $(VENV)/bin/uvicorn
PIP        := $(VENV)/bin/pip
TRIV_HOME  ?= $(HOME)/.triv

# ===========================================================================
.PHONY: help setup setup-local setup-docker clean \
        run run-backend run-frontend \
        status check docker-up docker-down

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------
setup-local: ## Setup for local development (venv + frontend)
	@bash $(REPO)setup.sh local

setup-docker: ## Build & start via docker compose
	@bash $(REPO)setup.sh docker

clean: ## Remove .venv, node_modules, __pycache__
	@bash $(REPO)setup.sh clean

status: ## Show current state (paths, containers, venv)
	@bash $(REPO)setup.sh status

# ---------------------------------------------------------------------------
# Run (local)
# ---------------------------------------------------------------------------
run-backend: ## Start FastAPI backend
	TRIV_HOME=$(TRIV_HOME) $(UVICORN) webui.backend.app:app \
	  --host 0.0.0.0 --port 8080 --reload --app-dir $(REPO)

run-frontend: ## Start Vite dev server (frontend)
	cd $(REPO)webui/frontend && npm run dev

run: ## Start backend (background) + frontend
	@echo "Starting backend on :8080 ..."
	@TRIV_HOME=$(TRIV_HOME) $(UVICORN) webui.backend.app:app \
	  --host 0.0.0.0 --port 8080 --reload --app-dir $(REPO) &
	@sleep 1
	@echo "Starting frontend dev server ..."
	cd $(REPO)webui/frontend && npm run dev

# ---------------------------------------------------------------------------
# CLI shortcuts
# ---------------------------------------------------------------------------
check: ## Syntax-check all Python files
	@$(PY) -m py_compile webui/backend/app.py && echo "  OK  webui/backend/app.py"
	@echo ""; echo "Use 'make run-backend' to start the API."

# ---------------------------------------------------------------------------
# Docker
# ---------------------------------------------------------------------------
docker-up: ## Build and start docker-compose stack
	@bash $(REPO)setup.sh docker

docker-down: ## Stop docker-compose stack
	docker compose -f $(REPO)docker/docker-compose.yml down
