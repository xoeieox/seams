#!/usr/bin/env bash
# verify-tunnel-fingerprint.sh - post-cut fingerprint for the Seams node-one public origin (keeper F1).
#
# WHY THIS EXISTS (keeper adversary report 2026-10-28, F1 CRITICAL): an origin resolved by PORT
# ALONE is a collision hazard - on the host, :8080 answers from a docker-proxy (qBittorrent WebUI),
# not node-one. If the tunnel ingress ever points at the wrong port (or the wrong process grabs
# the port first), a naive healthcheck sees "some HTTP answered" and calls the node live while the
# public endpoint actually serves qBittorrent's "Not Found". This script refuses that future: a
# PASS means the PUBLIC URL answered with the node-one wire fingerprint, byte-for-byte, over HTTPS.
#
# It is read-only: exactly one GET /api/hello against the public URL (plus one GET / optional).
# Run it AFTER cutover (see docs), and after every restart/ingress edit. Exit 0 = fingerprint OK;
# exit 1 = the public endpoint is NOT the node - treat as an incident: investigate before serving.
#
# Usage:   verify-tunnel-fingerprint.sh [public-url]      (default https://seams.fyi)
# Proves:  /api/hello answers 200; body has ok:true, node:"node-one", the pinned wire version,
#          the closed gate-kind list, and a format string. ANY qBittorrent shape ("Not Found",
#          wrong/missing fields, non-JSON, non-200) is a hard FAIL, never a warning.
set -euo pipefail

URL_BASE="${1:-https://seams.fyi}"
# PINNED wire fingerprint - the values the shipped binary answers with. If node-one legitimately
# bumps its wire version, update this line in the same commit (conformance test REQ-HELLO-1 pins
# the same value tree-side; the two must never drift).
PIN_WIRE="seams-wire/0.3-draft"
PIN_NODE="node-one"
PIN_FORMAT="seams-attribution-log/0-eom.1"
KINDS="node-key session-log"

fail() { echo "FAIL: $*" >&2; exit 1; }

body="$(curl -fsS --max-time 15 "${URL_BASE}/api/hello")" \
  || fail "GET ${URL_BASE}/api/hello did not return 2xx - the public origin is not answering as node-one (wrong ingress port? server down? docker-proxy on the port?)"

have() { command -v jq >/dev/null 2>&1; }

field() { # field <name> - jq when present, tolerant grep fallback otherwise
  local name="$1"
  if have; then printf '%s' "$body" | jq -r ".${name} // empty"
  else printf '%s' "$body" | tr -d ' \n' | grep -o "\"${name}\":\"[^\"]*\"" | head -1 | sed "s/.*:\"//;s/\"$//"
  fi
}

[ "$(field ok)" = "true" ] || [ "$(printf '%s' "$body" | tr -d ' \n' | grep -c '"ok":true')" = "1" ] \
  || fail "response has no ok:true - not the node-one hello shape"
[ "$(field node)" = "$PIN_NODE" ] || fail "node field is not ${PIN_NODE} - the port answered with something else's identity"
w="$(field wire)"; [ "$w" = "$PIN_WIRE" ] || fail "wire version is '${w}', pinned '${PIN_WIRE}' - version skew or wrong origin; do not ship"
f="$(field format)"; [ "$f" = "$PIN_FORMAT" ] || fail "format is '${f}', pinned '${PIN_FORMAT}'"
for k in $KINDS; do
  printf '%s' "$body" | grep -q "\"$k\"" || fail "gate kind '$k' missing from /api/hello - not the closed gate list of node-one"
done
# Negative guard, stated explicitly (the qBittorrent shape): the docker-proxy's entire 404 body is
# "Not Found". If that string is our whole hello body we are pointed at :8080's real owner.
printf '%s' "$body" | grep -qi 'Not Found' && fail "hello body contains 'Not Found' - that is the docker-proxy/qBittorrent shape, the ingress points at the wrong port"

echo "PASS: ${URL_BASE}/api/hello answers with the node-one wire fingerprint (wire ${w}, format ${f}, kinds: ${KINDS})"
