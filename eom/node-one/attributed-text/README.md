# One page of text, with attribution

A demo of the attribution part of Seams. One page of text anyone can edit. Every save is logged, and every word keeps the name of whoever wrote it. Consent is "all changes", compensation is none.

Zero dependencies, Node 18+.

This copy is the **EoM build leg** (node-one, branch `eom-node-one`): the kit plus the build-GO items of 2026-10-26 - a fail-closed ingest gate for wire-shaped emits, an append-only hash chain with load-time quarantine, and the T1 pre-exposure hardening - plus the ratified go-public shape of 2026-10-28 (budgeted reads at origin, published rate shape pinned by the launcher, the landing page, and the bind rail below). The day-to-day posture is **loopback only**. The ruled public path is one dedicated route: a Cloudflare Tunnel (**demo plumbing**) whose origin is the dedicated port `http://127.0.0.1:18080` and nothing else - the tunnel never fronts the 8080 dev instance or any other port on the box. As of 2026-10-28 the tunnel is **PREP ONLY**: the adversary gate verdict for today is RED (`finding/eom-adversary-t1t5-2026-10-28`), `cloudflared tunnel create/route/run` are hard-stopped until Erah calls cutover. Wiring plan: `eom/endpoint-surface/deploy-prep-cloudflare-demo.md`.

## Run it

```
node server.mjs                 # http://127.0.0.1:8080 (loopback bind; BIND_HOST to override)
PORT=3000 node server.mjs
NODE_ONE_PORT=18080 node ../launcher/launch.mjs   # public-origin demo instance: launch.mjs boots node-one
                                                   # on 127.0.0.1:18080 - the port cloudflared fronts.
                                                   # 8080 stays the local dev instance; the tunnel never sees it.
```

**Bind rail (F4).** A non-loopback `BIND_HOST` (anything outside `127.0.0.1` / `localhost` / `::1`) **refuses to boot** unless the operator sets `SEAMS_ALLOW_PUBLIC_BIND=I-know-what-this-means`, verbatim. With the hatch, the banner says **PUBLIC BIND - operator-acknowledged, NOT the ruled posture** and names the cloudflared requirement; it never claims loopback. The ruled posture keeps the bind loopback and lets the tunnel do the talking. `SEAMS_ALLOW_PUBLIC_BIND` is a boot rail, not a deployment default - see `eom/endpoint-surface/requirements.yaml` (`host_exposure_ruling.bind_rail`).

The **admin token** is never printed and never leaves the data dir: it lives in `data/admin-token.txt` (mode 0600), or set `ADMIN_TOKEN`. Open `/#/admin` once and paste it to enable "Restore this version" on old versions. See **Token custody** below for what holds that token today and what should hold it instead.

Rate limiting keys on the **socket peer address only**. `cf-connecting-ip` / `x-forwarded-for` are attacker-controlled and are never read (T1, smoke 2026-10-26) - including behind the demo tunnel, where the connector is not an authenticating proxy and its headers are treated as attacker-controlled like any other. Validation and gate refusals do not burn rate budget; only successful mutations charge (the peek/charge split). Admin revert **attempts** are the exception and charge up front - failed-token retries are the attack priced there.

**Measured behavior, stated honestly (matches the tests, not the wishlist):** writes and admin attempts charge exactly as before (peek/charge split, refusals burn nothing); **reads are now budgeted at origin** - `READ_LIMIT=300` per socket-IP per window plus `READ_GLOBAL_LIMIT=1500` all-sockets, answered `429` with `retry-after` **before** any body is served, charged only on responses under 400 (404/429/503 floods burn nothing). Setting both read knobs to `0` disables the read tier only - the loopback-dev escape, never a public posture. The shape is **RATIFIED and SHIPPED** (Erah go-public GO, end-of-October mission 2026-10-28); the numbers live in `eom/endpoint-surface/requirements.yaml` under `host_exposure_ruling.rate`. `launch.mjs` always boots node-one with the published shape (`INGEST_LIMIT=10 EDIT_LIMIT=10 GLOBAL_LIMIT=80 READ_LIMIT=300 READ_GLOBAL_LIMIT=1500`) unless the operator pins a knob explicitly - no demo ever boots under-published again (F3). One consequence of the no-header-trust ruling, stated plainly: behind the demo tunnel every public visitor arrives on the connector's loopback socket key, so the per-socket tiers govern direct/local clients and the **global buckets are the effective public ceiling**.

**Tunnel posture, one paragraph:** the approved exposure is a Cloudflare Tunnel for the month-end demo, labeled **demo plumbing** - it is wiring, not architecture. There is no reverse proxy and none may appear; `TRUSTED_PROXY` stays absent. Per the Switter lesson (the 2018 Cloudflare walk and the 2022 OSA episode that killed it), a single-vendor kill-switch is not an acceptable steady state: **moving off Cloudflare to a multi-posture setup is the later requirement**, tracked in the deploy-prep doc as an obligation, not a maybe.

**Seed text:** edit `seed.json` (`author`, `text`). It is used only when `data/log.jsonl` does not exist. To reseed, stop the server and delete `data/`. The current seed is Erah's poem.

## Token custody (bridge now, lease target)

**Bridge (today, measured):** the machinery process holds a capped temp token on-box - `data/admin-token.txt`, mode **0600** (or `ADMIN_TOKEN` in the operator's environment). Capped means scoped: it grants exactly one power (admin revert), it is never printed, never exported, never present in data payloads, and it is trivially replaceable. This is a bridge, not the destination.

**Target posture (ruled 2026-10-26):** the **owner** holds the root key on a hardware key (YubiKey - the Y1 hardware-signer seam; spike green 2026-08-13, HELD 2026-09-01, to be un-parked via the Seams launcher), and the machinery acts **only under bounded leases**. The **lease-over-root-key object** - a bounded grant signed at mint by the hardware key, so the root key never sits in machinery hands - is the documented target and a new-build: prefigured by the doorman leases and by human-vouch-at-mint, never yet defined, buildable in the launcher. When the launcher+Y1 mint lands, the on-box 0600 bridge retires. Until then this README is honest about the bridge: on this box, right now, the machinery holds the token.

## Send something in

```
node scripts/send-hello.mjs --replay        # hello handshake, node-key announce, one emit, one replay
node scripts/send-hello.mjs --url http://127.0.0.1:8080 --key key:your-node --text "..."
```

The script pins the wire version (`seams-wire/0.3-draft`), checks the A3-style echo the server gives back, sends the hello-world emit through the closed gate (kind `text` maps to `session-log` per the ruling, and the script asserts that rather than trusting it), and with `--replay` proves idempotence: the second send acks `duplicate:true` with the byte-identical receipt and the log does not grow.

## What it does

- Main page: the current text, a version line, and four buttons (Edit, Colour by author, Names, History).
- Saving needs a name. Names are case-insensitive, and the first spelling used is kept.
- Names: everyone who has edited, with edit count and how many of their words survive. Tapping one opens their **lineage**: their surviving words highlighted in the current text, each change they made (what they replaced, what they added) and what others later did to their words.
- History: every version, read-only, with colours if toggled. Nothing is deleted.
- Concurrent edits: if you saved from an old version, the server three-way merges when the changes are far apart, and asks you to reload when they touch.
- Limits: 10 saves per 10 min per socket-IP, 80 per 10 min overall, 10 emits per 10 min per socket-IP, 300 reads per 10 min per socket-IP, 1500 reads overall, 8000 characters, 40-character names, 64 KB bodies (`EDIT_LIMIT`, `INGEST_LIMIT`, `GLOBAL_LIMIT`, `READ_LIMIT`, `READ_GLOBAL_LIMIT`, `WINDOW_MS`).
- Ingest gate (`POST /api/ingest`, `GET /api/hello`): the closed join surface for wire-shaped emits - see `eom/endpoint-surface/requirements.yaml` for the requirements (hello / emit / export, the join gate, and the folded host/exposure ruling of 2026-10-26).
- Admin revert: adds a new version equal to an old one (original authorship restored), logged like any edit.
- `/api/export`: the log as JSON, also linked from the About page. **Public by the 2026-10-26 ruling** - the only export refusal is the 503 integrity gate below.

## How authorship works

Each save is split into words, spaces and punctuation, then diffed (longest common subsequence) against the current version. Matching tokens keep their original author and version; new tokens belong to the saver. Changes separated only by whitespace count as one change. Removed tokens are recorded with their original authors, which drives the lineage view.

## The ingest gate (build leg)

The accept set is exactly **{node-key, session-log}**. `text` and `page` payloads map to `session-log` at the gate (Erah ruling 2026-10-26) - the rails stay closed and no new wire kind is created. Everything else refuses fail-closed: unknown kinds (including transport-flavored `text/html` or a `headers` field - the documented text-with-header case), any `op` but `emit`, malformed `node_key`, provenance origins outside `authored|assisted|played`, and fork/remix (`consent_gate_unbuilt`, 501) until the consent layer exists. Idempotence is keyed on the payload hash (canonical body): a replay acks the ORIGINAL receipt, `duplicate:true`, across restarts. The registry records node keys and display names and **never an IP**. Bytes already deposited by another key ack `already_deposited`, never re-attributed.

## Storage and integrity

`data/log.jsonl` is append-only with a hash chain (`chain: {n, prev, hash}`) over a per-node salt, persisted in `chain-salt` and mirrored to `chain-anchor.json`. `content_hash`/`deposit_hash` are computed **once at append** and verified at load - a tampered log quarantines (with corrupt lines to `quarantine.jsonl`), sets `integrity.ok:false`, makes `/api/export` refuse with `log_integrity` (503), and is **never silently re-hashed** into cleanliness (T5a). Receipts persist to `receipts.jsonl`, node registry to `nodes.jsonl`.

### Export format

`/api/export` is `seams-attribution-log/0-eom.1`, echoing the wire `seams-wire/0.3-draft` (A3-style: every ingest/emit response and the hello handshake carry the version the server actually speaks). Entries are shaped after the `emit` fields (`kind`, `parents`, `derivation`, `creator_ref`, `provenance`, `use_terms`), with the build-leg wire-semantics fixes: kind vocabulary enforced at the gate, `parents` always `[]` (a version chain is not a derivation - ordering lives in the `chain` block), hashes opaque placeholders until the deposits-spec ruling lands, and `creator_verified:false` until the identity ruling lands. Export refuses outright on integrity failure; otherwise it is public (ruled 2026-10-26).

## Gaps compared with the protocol in design

- **No identity.** Names are typed, and anyone can use anyone's. No keys, signatures or accounts.
- **Retyped or moved text is credited to whoever typed it.** A word diff cannot tell a copy from an original, and a moved sentence appears as a delete plus an insert.
- **Diff artefacts.** A small edit can be credited oddly (common words may stay with the earlier author).
- **No per-aspect consent, revocation or payments.** One fixed grant: anyone may change, nobody is paid. Fork/remix emits are refused outright (501) rather than half-open.
- **Single process, one JSON-lines file.** No backups; copy `data/` if it matters.
- **Token custody is on a bridge, not at target.** Machinery holding the on-box 0600 token is the interim; owner-root-on-hardware + bounded leases is the ruled destination (see Token custody).

## Go-public surface (2026-10-28)

- **Landing page** (`GET /`): protocol-first - what the node is, what it is NOT (no payments, no vouches, no verification claims), a live `/api/hello` fetch rendered "fetched, not asserted", and the editor moved to `GET /text`. No inline script; the CSP stays `script-src 'self'` and `landing.js` is a served file.
- **Deterministic send + self-proof**: `node scripts/send-hello.mjs --selftest` boots throwaway loopback instances and checks every go-public claim (gate, idempotence, cross-key squat, read tier red/green, dev escape, write cap, bind rail, landing honesty) - exit 0 only when all nine checks pass.
- **Tunnel fingerprint**: `bash eom/endpoint-surface/cloudflared/verify-tunnel-fingerprint.sh` fetches the pinned cloudflared release checksum, compares the on-disk binary, and greps the ingress template so the only origin is `127.0.0.1:18080`. Creds stay out-of-tree (`~/.cloudflared/<TUNNEL-UUID>.json`, 0600); the template in git is de-credded.

## Tests

`npm test` covers the diff, attribution, merge, revert, persistence, export, the closed gate (including the text-with-header refusal), idempotent replay, the version echo, fork refusals, tamper quarantine and export refusal, and the T1 rate-limiting properties (socket keying, spoofed headers ignored, no burn on errors, successes charge, admin attempts charge up front, token never printed, token file 0600) - plus the go-public pass: read tier red/green (budgeted serves, 429 + retry-after before serving, error floods burn nothing, dev escape), the F4 bind rail (refusal names the hatch; acknowledged boot banners PUBLIC BIND, never loopback), the F3 published rate shape in the launcher child env (asserted via `/proc/<pid>/environ`), and the honest landing page (IS/IS-NOT copy, editor at `/text`, no forbidden claims).
