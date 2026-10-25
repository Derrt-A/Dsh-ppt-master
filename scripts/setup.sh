#!/usr/bin/env bash
# Install the local engine and Python environment for the dsh-ppt plugin.
set -euo pipefail

DATA_ROOT=""
ENGINE_PATH=""
ENGINE_VERSION="v4.7.0"
PYTHON=""
SKIP_DEPS=0
FORCE=0
SKIP_LOCAL_CONFIG=0

usage() {
  cat <<'EOF'
Usage: scripts/setup.sh [options]

  --data-root <dir>        data directory (default: $DSH_HOME/dsh-ppt)
  --engine-path <dir>      reuse an existing engine root (contains SKILL.md)
  --engine-version <tag>   ppt-master tag to download (default: v4.7.0)
  --python <path>          reuse an existing Python interpreter
  --skip-deps              do not run pip install -r requirements.txt
  --force                  replace an existing engine checkout/settings
  --skip-local-config      do not write config.local.json (use DSH_PPT_DATA)
  -h, --help               show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --data-root) DATA_ROOT="${2:?}"; shift 2 ;;
    --engine-path) ENGINE_PATH="${2:?}"; shift 2 ;;
    --engine-version) ENGINE_VERSION="${2:?}"; shift 2 ;;
    --python) PYTHON="${2:?}"; shift 2 ;;
    --skip-deps) SKIP_DEPS=1; shift ;;
    --force) FORCE=1; shift ;;
    --skip-local-config) SKIP_LOCAL_CONFIG=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "[setup] ERROR: unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

step() { printf '[setup] %s\n' "$*"; }
warn() { printf '[setup] WARN: %s\n' "$*" >&2; }
die()  { printf '[setup] ERROR: %s\n' "$*" >&2; exit 1; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
if [[ -z "$DATA_ROOT" ]]; then DATA_ROOT="$DSH_HOME/dsh-ppt"; fi
mkdir -p "$DATA_ROOT/projects" "$DATA_ROOT/output"

command -v node >/dev/null 2>&1 || die "Node.js >= 22 was not found on PATH."
NODE_MAJOR="$(node --version | sed 's/^v//' | cut -d. -f1)"
if [[ "$NODE_MAJOR" -lt 22 ]]; then die "Node.js >= 22 is required, found $(node --version)."; fi
command -v git >/dev/null 2>&1 || die "git was not found on PATH."

test_engine() {
  [[ -f "$1/SKILL.md" && -f "$1/scripts/attribution_guard.py" ]]
}

step "data root: $DATA_ROOT"
step "repository: $REPO_ROOT"

# --- engine ---------------------------------------------------------------
if [[ -n "$ENGINE_PATH" ]]; then
  test_engine "$ENGINE_PATH" || die "not an engine root: $ENGINE_PATH"
  step "using existing engine: $ENGINE_PATH"
else
  ENGINE_REPO="$DATA_ROOT/engine/ppt-master"
  CANDIDATE="$ENGINE_REPO/skills/ppt-master"
  if test_engine "$CANDIDATE"; then
    step "reusing downloaded engine: $CANDIDATE"
  else
    if [[ -e "$ENGINE_REPO" ]]; then
      if [[ "$FORCE" -ne 1 ]]; then die "engine directory exists but is incomplete: $ENGINE_REPO (rerun with --force)"; fi
      rm -rf "$ENGINE_REPO"
    fi
    step "downloading ppt-master $ENGINE_VERSION ..."
    git -c core.longpaths=true clone --depth 1 --branch "$ENGINE_VERSION" \
      https://github.com/hugohe3/ppt-master.git "$ENGINE_REPO" \
      || die "git clone failed (tag: $ENGINE_VERSION)."
    test_engine "$CANDIDATE" || die "downloaded layout is not the expected engine root: $CANDIDATE"
  fi
  ENGINE_PATH="$CANDIDATE"
fi
ENGINE_PATH="$(cd "$ENGINE_PATH" && pwd)"

SKILL_VERSION="$(sed -n 's/^[[:space:]]*version:[[:space:]]*"\([^"]*\)".*/\1/p' "$ENGINE_PATH/SKILL.md" | head -n 1)"
if [[ -n "$SKILL_VERSION" && "$SKILL_VERSION" != "4.7.0" ]]; then
  warn "engine $SKILL_VERSION detected; this plugin is validated against 4.7.0."
fi

# --- python ---------------------------------------------------------------
if [[ -n "$PYTHON" ]]; then
  [[ -x "$PYTHON" ]] || die "Python interpreter not found or not executable: $PYTHON"
  step "using existing interpreter: $PYTHON"
else
  VENV="$DATA_ROOT/.venv"
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) VENV_PY="$VENV/Scripts/python.exe" ;;
    *) VENV_PY="$VENV/bin/python" ;;
  esac
  if [[ ! -x "$VENV_PY" ]]; then
    step "creating virtual environment: $VENV"
    if command -v python3 >/dev/null 2>&1; then python3 -m venv "$VENV"; else python -m venv "$VENV"; fi
    [[ -x "$VENV_PY" ]] || die "failed to create the virtual environment."
  fi
  PYTHON="$VENV_PY"
fi

PY_VERSION="$("$PYTHON" -c "import sys; print('%d.%d' % sys.version_info[:2])")"
PY_MAJOR="${PY_VERSION%%.*}"
PY_MINOR="${PY_VERSION#*.}"
if [[ "$PY_MAJOR" -lt 3 || ( "$PY_MAJOR" -eq 3 && "$PY_MINOR" -lt 10 ) ]]; then
  die "Python >= 3.10 is required, found $PY_VERSION."
fi
step "python: $PYTHON ($PY_VERSION)"

if [[ "$SKIP_DEPS" -eq 0 ]]; then
  step "installing engine requirements (this can take several minutes) ..."
  "$PYTHON" -m pip install --upgrade pip || die "pip upgrade failed."
  "$PYTHON" -m pip install -r "$ENGINE_PATH/requirements.txt" || die "pip install failed."
else
  step "skipping Python dependencies (--skip-deps)"
fi

# --- integrity gate -------------------------------------------------------
step "running engine attribution guard ..."
"$PYTHON" "$ENGINE_PATH/scripts/attribution_guard.py" \
  || die "engine integrity check failed. Re-download the engine; do not edit its attribution files."

# --- settings -------------------------------------------------------------
SETTINGS_PATH="$DATA_ROOT/settings.json"
if [[ -f "$SETTINGS_PATH" && "$FORCE" -ne 1 ]]; then
  cp "$SETTINGS_PATH" "$SETTINGS_PATH.bak"
  step "existing settings backed up to settings.json.bak"
fi
"$PYTHON" - "$SETTINGS_PATH" "$ENGINE_PATH" "$PYTHON" <<'PY'
import json
import sys

path, engine_root, python = sys.argv[1:4]
settings = {
    "input_mode": "sources_only",
    "language": "zh",
    "canvas": "16:9",
    "image_backend": "none",
    "audio": False,
    "critic": {
        "enabled": True,
        "target": "both",
        "max_rounds": 2,
        "checklist": "four_dimensions",
    },
    "engine_root": engine_root,
    "python": python,
}
with open(path, "w", encoding="utf-8", newline="\n") as handle:
    json.dump(settings, handle, indent=2, ensure_ascii=False)
    handle.write("\n")
print("[setup] settings JSON OK")
PY

if [[ "$SKIP_LOCAL_CONFIG" -eq 0 ]]; then
  "$PYTHON" - "$REPO_ROOT/config.local.json" "$DATA_ROOT" <<'PY'
import json
import sys

path, data_root = sys.argv[1:3]
with open(path, "w", encoding="utf-8", newline="\n") as handle:
    json.dump({"dataRoot": data_root}, handle, indent=2)
    handle.write("\n")
PY
  step "wrote $REPO_ROOT/config.local.json"
fi

printf '\n'
step "installation data is ready."
printf '  settings : %s\n' "$SETTINGS_PATH"
printf '  engine   : %s\n' "$ENGINE_PATH"
printf '  python   : %s\n\n' "$PYTHON"
printf '  Next steps:\n'
printf '    dsh plugin --profile web add link:%s\n' "$REPO_ROOT"
printf '    restart your DSH Web host, then call ppt_status with no arguments.\n\n'
