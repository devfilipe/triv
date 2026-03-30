#!/usr/bin/env bash
# lint.sh — Run ruff check (lint) and/or ruff format on triv source.
#
# Usage:
#   ./lint.sh                  # lint + format check (no writes)
#   ./lint.sh check            # lint only (no writes)
#   ./lint.sh fix              # lint + auto-fix
#   ./lint.sh format           # format only (no writes, diff preview)
#   ./lint.sh format-write     # format + write changes
#   ./lint.sh all              # lint auto-fix + format write
#
# Environment:
#   RUFF_BIN_PATH=...          # path to the ruff binary (defaults to "ruff")
#                              # e.g. RUFF_BIN_PATH=.venv/bin/ruff ./lint.sh
#
set -euo pipefail

REPO="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO"

# ── Config ────────────────────────────────────────────────────────────────

RUFF="${RUFF_BIN_PATH:-ruff}"
TARGETS="triv/ webui/backend/"
MODE="${1:-default}"

BOLD='\033[1m'
CYAN='\033[36m'
GREEN='\033[32m'
YELLOW='\033[33m'
RED='\033[31m'
DIM='\033[2m'
RESET='\033[0m'

# ── Helpers ───────────────────────────────────────────────────────────────

ensure_ruff() {
    if ! command -v "$RUFF" &>/dev/null && [ ! -x "$RUFF" ]; then
        echo -e "${RED}ERROR:${RESET} ruff not found."
        echo ""
        echo -e "  Set ${CYAN}RUFF_BIN_PATH${RESET} to the ruff binary, for example:"
        echo -e "    ${DIM}RUFF_BIN_PATH=.venv/bin/ruff ./lint.sh${RESET}"
        echo ""
        echo -e "  Or install ruff:"
        echo -e "    ${DIM}pip install ruff${RESET}"
        echo -e "    ${DIM}pip install -e '.[dev]'${RESET}"
        exit 1
    fi
}

ruff_version() {
    echo -e "${DIM}ruff $("$RUFF" --version 2>/dev/null || echo '(unknown version)')${RESET}"
}

run_check() {
    local fix="${1:-}"
    echo -e "\n${BOLD}==> ruff check${RESET} ${DIM}(${TARGETS})${RESET}"
    if [ "$fix" = "--fix" ]; then
        "$RUFF" check $TARGETS --fix
    else
        "$RUFF" check $TARGETS
    fi
}

run_format() {
    local write="${1:-}"
    echo -e "\n${BOLD}==> ruff format${RESET} ${DIM}(${TARGETS})${RESET}"
    if [ "$write" = "--write" ]; then
        "$RUFF" format $TARGETS
    else
        "$RUFF" format $TARGETS --diff
    fi
}

# ── Modes ─────────────────────────────────────────────────────────────────

ensure_ruff
ruff_version

case "$MODE" in
    default)
        # lint (no fixes) + format diff (no writes)
        run_check
        run_format
        echo -e "\n${GREEN}✓${RESET} Done. Use ${CYAN}./lint.sh all${RESET} to auto-fix and format."
        ;;
    check)
        run_check
        echo -e "\n${GREEN}✓${RESET} Lint check complete."
        ;;
    fix)
        run_check --fix
        echo -e "\n${GREEN}✓${RESET} Lint check + auto-fix complete."
        ;;
    format)
        run_format
        echo -e "\n${YELLOW}NOTE:${RESET} Preview only — use ${CYAN}./lint.sh format-write${RESET} to apply changes."
        ;;
    format-write)
        run_format --write
        echo -e "\n${GREEN}✓${RESET} Format applied."
        ;;
    all)
        run_check --fix
        run_format --write
        echo -e "\n${GREEN}✓${RESET} Lint auto-fix + format applied."
        ;;
    *)
        echo "Usage: $0 [check|fix|format|format-write|all]"
        echo ""
        echo "  (no args)      Lint check + format diff (read-only)"
        echo "  check          Lint only, no writes"
        echo "  fix            Lint + auto-fix violations"
        echo "  format         Format diff preview, no writes"
        echo "  format-write   Apply formatting"
        echo "  all            Auto-fix lint violations + apply formatting"
        echo ""
        echo "  RUFF_BIN_PATH  Override ruff binary path (default: ruff)"
        exit 1
        ;;
esac
