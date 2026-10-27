#!/usr/bin/env bash
# make-mac-bundle.sh - Kyma-style Mac delivery for the Seams Launcher (EoM 2026-10-26).
#
# Packs eom/launcher/ (including the tauri/ shell) PLUS the node-one/attributed-text runtime it
# boots into ONE flat tree at a stable path, writes the sha256 sidecar next to it, and prints
# both. Erah receives the bundle, verifies it, unpacks, and runs it exactly like he iterates
# Kyma on his Mac. (Mac run #1 triage 2026-10-26: the tarball MUST carry node-one/ beside
# launch.mjs - launch.mjs probes for it there; a bundle without it boots nothing.)
#
#   scripts/make-mac-bundle.sh
#
# env knobs: SEAMS_BUNDLE_DIR  where the bundle lands (default /var/tmp/eom-bundles - reboot-stable,
#                             the build account may not create dirs under the root-owned /data itself)
#            SEAMS_LAUNCHER_DIR pack this launcher dir (default <repo>/eom/launcher)
#            SEAMS_NODE_ONE_DIR pack this node-one dir (default <launcher-dir>/../node-one/attributed-text;
#                             falls back to <launcher-dir>/node-one/attributed-text when repacking a bundle)
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

[ -f "$SRC/launch.mjs" ] || { echo "make-mac-bundle: no launch.mjs under $SRC" >&2; exit 1; }
[ -f "$SRC/tauri/src-tauri/tauri.conf.json" ] || { echo "make-mac-bundle: tauri/src-tauri/tauri.conf.json missing under $SRC - scaffold must ride along" >&2; exit 1; }

# node-one RIDES ALONG (Mac run #1 triage): launch.mjs resolves it as a SIBLING of launch.mjs
# in the flat bundle tree; without it the bundle boots nothing and tauri dev times out.
NODE_SRC="${SEAMS_NODE_ONE_DIR:-}"
if [ -z "$NODE_SRC" ]; then
  if [ -f "$(dirname "$SRC")/node-one/attributed-text/server.mjs" ]; then
    NODE_SRC="$(dirname "$SRC")/node-one/attributed-text"
  elif [ -f "$SRC/node-one/attributed-text/server.mjs" ]; then
    NODE_SRC="$SRC/node-one/attributed-text"   # repacking an unpacked bundle (self-describing)
  fi
fi
{ [ -n "$NODE_SRC" ] && [ -f "$NODE_SRC/server.mjs" ]; } || { echo "make-mac-bundle: node-one/attributed-text/server.mjs not found (SEAMS_NODE_ONE_DIR overrides the lookup) - the bundle MUST ship node-one beside launch.mjs" >&2; exit 1; }

mkdir -p "$OUT_DIR"
TMP="$(mktemp "${TMPDIR:-/tmp}/seams-mac-XXXXXX.tar.gz")"
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/seams-stage-XXXXXX")"
trap 'rm -f "$TMP"; rm -rf "$STAGE"' EXIT

# Stage the FLAT layout launch.mjs probes for: everything at seams-launcher/ root, node-one
# as a sibling inside the bundle - then tar the staging dir (sorted, gnu format, junk out).
mkdir -p "$STAGE/seams-launcher/node-one"
cp -R "$SRC/." "$STAGE/seams-launcher/"
cp -R "$NODE_SRC" "$STAGE/seams-launcher/node-one/"

tar -C "$STAGE" \
  --exclude=target \
  --exclude=node_modules \
  --exclude=ops \
  --exclude=data \
  --exclude=.git \
  --exclude=.DS_Store \
  --exclude='._*' \
  --sort=name --format=gnu \
  -cf - seams-launcher | gzip -n > "$TMP"

mv "$TMP" "$OUT_DIR/$NAME.tar.gz"
trap - EXIT; rm -rf "$STAGE"

( cd "$OUT_DIR" && sha256sum "$NAME.tar.gz" > "$NAME.tar.gz.sha256" && sha256sum -c "$NAME.tar.gz.sha256" )
echo "bundle : $OUT_DIR/$NAME.tar.gz"
echo "sidecar: $OUT_DIR/$NAME.tar.gz.sha256"
echo "on the mac: scp BRIX:$OUT_DIR/$NAME.tar.gz{,.sha256} . && sha256sum -c $NAME.tar.gz.sha256 && tar xzf $NAME.tar.gz && cd seams-launcher && npm install && npm run tauri"
