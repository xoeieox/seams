#!/usr/bin/env bash
# make-mac-bundle.sh - Kyma-style Mac delivery for the Seams Launcher (EoM 2026-10-26).
#
# Packs eom/launcher/ (including the tauri/ shell) PLUS the node-one/attributed-text runtime it
# boots into ONE flat tree at a stable path, writes the sha256 sidecar next to it, and prints
# both. Erah receives the bundle, verifies it, unpacks, and runs it exactly like he iterates
# Kyma on his Mac. (Mac run #1 triage 2026-10-26: the tarball MUST carry node-one/ beside
# launch.mjs - launch.mjs probes for it there; a bundle without it boots nothing.)
#
# Mac run #3 triage 2026-10-27: macOS ships BSD tar (bsdtar), which hard-rejects the GNU-only
# create flags this script once used (the sort flag printed Erah's trace: Option not supported).
# The create side is now a node-only POSIX ustar + gzip writer: byte-deterministic by
# construction (bytewise-sorted paths, mtime/uid/gid/uname/gname/modes pinned, gzip header
# clock zeroed) and it runs wherever node runs - BRIX or Mac - with NO external tar, gzip, or
# GNU-coreutils sha256sum anywhere. Unpack side stays plain -tf/-xf (both flavors auto-detect
# gzip). The launcher suite gates this: two builds must produce identical bytes, and the
# archive must parse under a hand-written STRICT ustar reader (the subset bsdtar reads).
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

command -v node >/dev/null 2>&1 || { echo "make-mac-bundle: node is required (the packer is node-only on purpose - BSD tar lacks the GNU create flags this used to need)" >&2; exit 1; }

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
# as a sibling inside the bundle - then pack the staging dir with the node writer below.
mkdir -p "$STAGE/seams-launcher/node-one"
cp -R "$SRC/." "$STAGE/seams-launcher/"
cp -R "$NODE_SRC" "$STAGE/seams-launcher/node-one/"

# Deterministic POSIX ustar packer (node builtins ONLY - no tar/gzip/sha256sum invocations).
# Byte-stable by construction: bytewise-sorted members, typeflag files+dirs only, modes
# normalized (0644 + preserved exec bits for files, 0755 dirs), uid/gid 0, uname/gname root,
# mtime pinned 0, gzip header MTIME/OS zeroed. Determinism of the sha sidecar depends on this.
STAGE_DIR="$STAGE" OUT_FILE="$TMP" node <<'NODE_PACK'
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const STAGE = process.env.STAGE_DIR, OUT = process.env.OUT_FILE;
if (!STAGE || !OUT) { console.error('packer: STAGE_DIR/OUT_FILE env required'); process.exit(1); }
const JUNK_DIRS = new Set(['target', 'node_modules', 'ops', 'data', '.git']);
const JUNK_FILES = new Set(['.DS_Store']);

function* walk(dir, rel) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) {
      if (JUNK_DIRS.has(e.name)) continue;
      yield { type: 'dir', rel: r };
      yield* walk(path.join(dir, e.name), r);
    } else if (e.isFile()) {
      if (JUNK_FILES.has(e.name) || e.name.startsWith('._')) continue;
      yield { type: 'file', rel: r, abs: path.join(dir, e.name) };
    } else {
      throw new Error('make-mac-bundle: symlink or special file in the stage tree (' + r + ') - the packer speaks plain files only');
    }
  }
}

function header(name, type, mode, size) {
  const h = Buffer.alloc(512);
  const put = (s, o, len) => {
    const b = Buffer.from(s, 'latin1');
    if (b.length > len) throw new Error('member name/field too long for ustar: ' + JSON.stringify(s));
    b.copy(h, o);
  };
  const num = (n, o, w) => {
    const d = n.toString(8).padStart(w - 2, '0');
    h.write(d, o, 'latin1');
    h[o + w - 2] = 0x00; h[o + w - 1] = 0x20;
  };
  put(name, 0, 100);
  num(mode, 100, 8); num(0, 108, 8); num(0, 116, 8);
  num(size, 124, 12); num(0, 136, 12);
  h.write('        ', 148, 8, 'latin1');
  h[156] = type.charCodeAt(0);
  put('ustar\0', 257, 6); h.write('00', 263, 'latin1');
  put('root', 265, 32); put('root', 297, 32);
  let sum = 0;
  for (const byte of h) sum += byte;
  h.write(sum.toString(8).padStart(6, '0'), 148, 'latin1');
  h[148 + 6] = 0x00; h[148 + 7] = 0x20;
  return h;
}

const entries = [...walk(STAGE, '')].sort((a, b) =>
  Buffer.compare(Buffer.from(a.rel + (a.type === 'dir' ? '/' : ''), 'utf8'),
                 Buffer.from(b.rel + (b.type === 'dir' ? '/' : ''), 'utf8')));
const parts = [];
for (const e of entries) {
  if (e.type === 'dir') { parts.push(header(e.rel + '/', '5', 0o755, 0)); continue; }
  const buf = fs.readFileSync(e.abs);
  const st = fs.statSync(e.abs);
  parts.push(header(e.rel, '0', 0o644 | ((st.mode & 0o111) ? 0o111 : 0), buf.length));
  parts.push(buf);
  const pad = (512 - (buf.length % 512)) % 512;
  if (pad) parts.push(Buffer.alloc(pad));
}
parts.push(Buffer.alloc(1024));
const tarBytes = Buffer.concat(parts);
const gz = zlib.gzipSync(tarBytes, { level: 9 });
gz[4] = 0; gz[5] = 0; gz[6] = 0; gz[7] = 0; // header MTIME -> 0: no build clock in the bytes
gz[9] = 0xff;                               // OS byte -> unknown: flavor-agnostic
fs.writeFileSync(OUT, gz);
console.log('packed ' + entries.length + ' members (strict ustar, clock pinned) -> ' + OUT);
NODE_PACK

mv "$TMP" "$OUT_DIR/$NAME.tar.gz"
trap - EXIT; rm -rf "$STAGE"

# sha256 sidecar via node crypto (macOS ships shasum, not the GNU coreutils tool).
OUT_FINAL="$OUT_DIR/$NAME.tar.gz" SIDE_NAME="$NAME.tar.gz" node <<'NODE_HASH'
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const out = process.env.OUT_FINAL, base = process.env.SIDE_NAME;
const h = createHash('sha256').update(fs.readFileSync(out)).digest('hex');
fs.writeFileSync(out + '.sha256', h + '  ' + base + '\n');
const recheck = createHash('sha256').update(fs.readFileSync(out)).digest('hex');
if (recheck !== h) { console.error('sidecar recheck mismatch'); process.exit(1); }
console.log(base + ': OK');
NODE_HASH

echo "bundle : $OUT_DIR/$NAME.tar.gz"
echo "sidecar: $OUT_DIR/$NAME.tar.gz.sha256"
echo "on the mac: scp BRIX:$OUT_DIR/$NAME.tar.gz{,.sha256} . && shasum -a 256 -c $NAME.tar.gz.sha256 && tar xf $NAME.tar.gz && cd seams-launcher && npm install && npm run tauri"
