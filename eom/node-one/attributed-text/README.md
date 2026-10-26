# One page of text, with attribution

A demo of the attribution part of Seams. One page of text anyone can edit. Every save is logged, and every word keeps the name of whoever wrote it. Consent is "all changes", compensation is none.

Zero dependencies, Node 18+.

This copy is the **EoM build leg** (node-one, branch `eom-node-one`): the kit plus the build-GO items of 2026-10-26 - a fail-closed ingest gate for wire-shaped emits, an append-only hash chain with load-time quarantine, and the T1 pre-exposure hardening. It runs **local/loopback only**; exposure is a separate ruling.

## Run it

```
node server.mjs                 # http://127.0.0.1:8080 (loopback bind; BIND_HOST to override)
PORT=3000 node server.mjs
```

The **admin token** is never printed and never leaves the data dir: it lives in `data/admin-token.txt` (mode 0600), or set `ADMIN_TOKEN`. Open `/#/admin` once and paste it to enable "Restore this version" on old versions.

Rate limiting keys on the **socket peer address only**. `cf-connecting-ip` / `x-forwarded-for` are attacker-controlled and are never read (T1, smoke 2026-10-26). Validation and gate refusals do not burn rate budget; only successful mutations charge. There is no tunnel guidance here on purpose - the exposure posture waits for the host/exposure ruling.

**Seed text:** edit `seed.json` (`author`, `text`). It is used only when `data/log.jsonl` does not exist. To reseed, stop the server and delete `data/`. The current seed is Erah's poem.

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
- Limits: 10 saves per 10 min per socket-IP, 80 per 10 min overall, 30 emits per 10 min per socket-IP, 8000 characters, 40-character names, 64 KB bodies (`EDIT_LIMIT`, `INGEST_LIMIT`, `GLOBAL_LIMIT`, `WINDOW_MS`).
- Ingest gate (`POST /api/ingest`, `GET /api/hello`): the closed join surface for wire-shaped emits - see `eom/endpoint-surface/requirements.yaml` for the requirements (hello / emit / export and the join gate).
- Admin revert: adds a new version equal to an old one (original authorship restored), logged like any edit.
- `/api/export`: the log as JSON, also linked from the About page.

## How authorship works

Each save is split into words, spaces and punctuation, then diffed (longest common subsequence) against the current version. Matching tokens keep their original author and version; new tokens belong to the saver. Changes separated only by whitespace count as one change. Removed tokens are recorded with their original authors, which drives the lineage view.

## The ingest gate (build leg)

The accept set is exactly **{node-key, session-log}**. `text` and `page` payloads map to `session-log` at the gate (Erah ruling 2026-10-26) - the rails stay closed and no new wire kind is created. Everything else refuses fail-closed: unknown kinds (including transport-flavored `text/html` or a `headers` field - the documented text-with-header case), any `op` but `emit`, malformed `node_key`, provenance origins outside `authored|assisted|played`, and fork/remix (`consent_gate_unbuilt`, 501) until the consent layer exists. Idempotence is keyed on the payload hash (canonical body): a replay acks the ORIGINAL receipt, `duplicate:true`, across restarts. The registry records node keys and display names and **never an IP**. Bytes already deposited by another key ack `already_deposited`, never re-attributed.

## Storage and integrity

`data/log.jsonl` is append-only with a hash chain (`chain: {n, prev, hash}`) over a per-node salt, persisted in `chain-salt` and mirrored to `chain-anchor.json`. `content_hash`/`deposit_hash` are computed **once at append** and verified at load - a tampered log quarantines (with corrupt lines to `quarantine.jsonl`), sets `integrity.ok:false`, makes `/api/export` refuse with `log_integrity` (503), and is **never silently re-hashed** into cleanliness (T5a). Receipts persist to `receipts.jsonl`, node registry to `nodes.jsonl`.

### Export format

`/api/export` is `seams-attribution-log/0-eom.1`, echoing the wire `seams-wire/0.3-draft` (A3-style: every ingest/emit response and the hello handshake carry the version the server actually speaks). Entries are shaped after the `emit` fields (`kind`, `parents`, `derivation`, `creator_ref`, `provenance`, `use_terms`), with the build-leg wire-semantics fixes: kind vocabulary enforced at the gate, `parents` always `[]` (a version chain is not a derivation - ordering lives in the `chain` block), hashes opaque placeholders until the deposits-spec ruling lands, and `creator_verified:false` until the identity ruling lands. Export refuses outright on integrity failure.

## Gaps compared with the protocol in design

- **No identity.** Names are typed, and anyone can use anyone's. No keys, signatures or accounts.
- **Retyped or moved text is credited to whoever typed it.** A word diff cannot tell a copy from an original, and a moved sentence appears as a delete plus an insert.
- **Diff artefacts.** A small edit can be credited oddly (common words may stay with the earlier author).
- **No per-aspect consent, revocation or payments.** One fixed grant: anyone may change, nobody is paid. Fork/remix emits are refused outright (501) rather than half-open.
- **Single process, one JSON-lines file.** No backups; copy `data/` if it matters.

## Tests

`npm test` covers the diff, attribution, merge, revert, persistence, export, the closed gate (including the text-with-header refusal), idempotent replay, the version echo, fork refusals, tamper quarantine and export refusal, and the T1 rate-limiting properties (socket keying, spoofed headers ignored, no burn on errors).
