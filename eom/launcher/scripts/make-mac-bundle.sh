#!/usr/bin/env bash
# make-mac-bundle.sh - Kyma-style Mac delivery for the Seams Launcher (EoM 2026-10-26).
#
# Packs eom/launcher/ (including the tauri/ shell) into ONE tarball at a stable path,
# writes the sha256 sidecar next to it, and prints both. Erah receives the bundle,
# verifies it, unpacks, and runs it exactly like he iterates Kyma on his Mac.
#
#   scripts/make-mac-bundle.sh
#
# env knobs: SEAMS_BUNDLE_DIR  where the bundle lands (default /var/tmp/eom-bundles - reboot-stable,
#                             the build account may not create dirs under the root-owned /data itself)
#            SEAMS_LAUNCHER_DIR pack this launcher dir (default <repo>/eom/launcher)
#            REPO_ROOT          repo root override (default: git toplevel)
#
# Loopback-only posture means the bundle carries no secrets and no config - the tar is
# the whole story. Build junk stays home: target/, node_modules/, ops/, data/.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="${SEAMS_LAUNCHER_DIR:-}"
if [ -z "$SRC" ]; then
  REPO="${REPO_ROOT:-$(git -C "$HERE" rev-parse --show-toplevel)}"
  SRC="$REPO/eom/launcher"
fi
OUT_DIR="${SEAMS_BUNDLE_DIR:-/var/tmp/eom-bundles}"
NAME="seams-launcher-mac-latest"
BASE="$(basename "$SRC")"

[ -f "$SRC/launch.mjs" ] || { echo "make-mac-bundle: no launch.mjs under $SRC" >&2; exit 1; }
[ -f "$SRC/tauri/src-tauri/tauri.conf.json" ] || { echo "make-mac-bundle: tauri/src-tauri/tauri.conf.json missing under $SRC - scaffold must ride along" >&2; exit 1; }

mkdir -p "$OUT_DIR"
TMP="$(mktemp "${TMPDIR:-/tmp}/seams-mac-XXXXXX.tar.gz")"
trap 'rm -f "$TMP"' EXIT

tar -C "$(dirname "$SRC")" \
  --exclude=target \
  --exclude=node_modules \
  --exclude=ops \
  --exclude=data \
  --exclude=.DS_Store \
  --exclude='._*' \
  --sort=name --format=gnu \
  --transform "s,^$BASE,seams-launcher," \
  -cf - "$BASE" | gzip -n > "$TMP"

mv "$TMP" "$OUT_DIR/$NAME.tar.gz"
trap - EXIT

( cd "$OUT_DIR" && sha256sum "$NAME.tar.gz" > "$NAME.tar.gz.sha256" && sha256sum -c "$NAME.tar.gz.sha256" )
echo "bundle : $OUT_DIR/$NAME.tar.gz"
echo "sidecar: $OUT_DIR/$NAME.tar.gz.sha256"
echo "on the mac: scp BRIX:$OUT_DIR/$NAME.tar.gz{,.sha256} . && sha256sum -c $NAME.tar.gz.sha256 && tar xzf $NAME.tar.gz && cd seams-launcher && npm install && npm run tauri"
