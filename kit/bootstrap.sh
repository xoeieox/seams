#!/bin/sh
# Seams battle-kit bootstrap. Pins an interpreter >= 3.10 by ABSOLUTE path, builds its own
# venv, and fails with a clear message instead of hanging. Never uses bare python3.
#
#   ./bootstrap.sh            stub target only (nothing to install; stdlib)
#   ./bootstrap.sh helper     also install the real zephyr helper's dependencies
#
# Override the interpreter with SEAMS_PYTHON=/absolute/path/to/python3.1x
set -eu
KIT="$(cd "$(dirname "$0")" && pwd)"
MODE="${1:-stub}"
MINOR=10; [ "$MODE" = "helper" ] && MINOR=11   # archetypes-core needs 3.11

pick() {
  for c in "${SEAMS_PYTHON:-}" /opt/homebrew/bin/python3.14 /opt/homebrew/bin/python3.13 \
           /opt/homebrew/bin/python3.12 /opt/homebrew/bin/python3.11 /opt/homebrew/bin/python3.10 \
           /opt/homebrew/bin/python3 /usr/local/bin/python3.14 /usr/local/bin/python3.13 \
           /usr/local/bin/python3.12 /usr/local/bin/python3.11 /usr/local/bin/python3.10 \
           /usr/local/bin/python3 /usr/bin/python3; do
    [ -n "$c" ] && [ -x "$c" ] || continue
    if "$c" -c "import sys; sys.exit(0 if sys.version_info >= (3, $MINOR) else 1)" 2>/dev/null; then
      echo "$c"; return 0
    fi
  done
  return 1
}

PY="$(pick)" || {
  echo "bootstrap: no Python >= 3.$MINOR found at an absolute path." >&2
  echo "  Tried SEAMS_PYTHON, /opt/homebrew/bin, /usr/local/bin, /usr/bin. System 3.9 is too old." >&2
  echo "  Set SEAMS_PYTHON=/absolute/path/to/python3.1x and run again." >&2
  exit 2
}
echo "bootstrap: using $PY ($("$PY" -c 'import sys; print(sys.version.split()[0])'))"

[ -x "$KIT/.venv/bin/python" ] || "$PY" -m venv "$KIT/.venv" || { echo "bootstrap: could not create .venv" >&2; exit 3; }
VPY="$KIT/.venv/bin/python"

if [ "$MODE" = "helper" ]; then
  [ -f "$KIT/zephyr-src/zephyr/wire.py" ] || { echo "bootstrap: zephyr-src/ missing from the kit" >&2; exit 4; }
  # bounded: a stalled index fails in about a minute rather than hanging
  "$VPY" -m pip install --quiet --disable-pip-version-check --timeout 20 --retries 2 \
      "cryptography>=42" "httpx>=0.24" "pydantic>=2" \
    || { echo "bootstrap: pip could not install cryptography/httpx/pydantic (offline or index unreachable?)." >&2; exit 5; }
fi

echo "bootstrap: running the self-test"
SEAMS_TARGET=stub "$VPY" "$KIT/battle.py" selftest
if [ "$MODE" = "helper" ]; then SEAMS_TARGET=helper "$VPY" "$KIT/battle.py" selftest; fi
echo "bootstrap: done. Run with $VPY $KIT/battle.py ... (see README.md)"
