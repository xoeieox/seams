# Seams launcher: source spec (as given)

Design the initial view of "the launcher", the minimal client of the Seams protocol. A person uses it to set up and manage their node presence WITHOUT an agent conversation. It is the T1 opening asset: the way a human joins a network where agents are the workers.

## Wire contract the launcher talks to
Verified 2026-10-26, branch eom-node-one. wire = seams-wire/0.3-draft. Export format = seams-attribution-log/0-eom.1. Accept kinds = exactly {node-key, session-log}; text/page payloads are mapped to session-log AT the gate (2026-10-26 ruling). No third kind exists.

### 1. HELLO: GET /api/hello
Unauthenticated join handshake. The response:
- Echoes the wire version the server speaks. The launcher PINS it and refuses to speak past a skew.
- Advertises the closed kind gate exactly.
- Reports integrity state: ok vs QUARANTINED.

UI requirement: a joining node must SEE the rails before it emits, and must see a quarantine warning before it ever sends into a corrupted log.

### 2. EMIT: POST /api/ingest
One wire-shaped deposit through the join gate. Refusals are part of the contract. Each has a NAME the launcher shows verbatim:

| Refusal | Code | Notes |
|---|---|---|
| unknown_op | 400 | |
| bad_node_key | 400 | |
| unknown_kind | 400 | unknown kinds and text-with-header shapes are refused, never defaulted |
| consent_gate_unbuilt | 501 | any fork or remix attempt; the consent layer doesn't exist yet. Explain as "not yet built", not as an error |
| parents_on_original | 400 | |
| bad_origin | 400 | origin must be authored, assisted or played |
| already_deposited | 409 | identity squatting: identical bytes from another key. NEVER re-attributed |
| empty | 400 | |
| too_long | 413 | over 8000 chars |
| too_big | 413 | body over 64KB |
| bad_content | 400 | base64 |

- **Idempotence:** keyed on the payload hash. A replay gets duplicate:true with the ORIGINAL receipt, byte-identical, and grows nothing.
- **Receipt:** carries OPAQUE hashes (payload_hash, content_hash, deposit_hash), computed once at append. Display them as opaque identifiers; never re-derive or prettify them.
- **Node registry:** stores node_key, who, first_seen and seen. It NEVER stores an IP.
- **Rate limits:** keyed on the socket peer only. Validation and gate refusals do NOT burn the budget; only successes and admin attempts charge.

### 3. EXPORT: GET /api/export
The whole append-only attribution log, wire-shaped.
- **Entries carry:** op, kind, v, ts, content_hash, deposit_hash, parents, derivation, creator_ref, creator_verified (always false for now), provenance, use_terms.
- **Chain state:** n, prev and hash sit alongside the wire fields, NOT inside them.
- **parents:** ALWAYS []. A version chain is not a derivation; ordering lives in the chain block. A client must not infer lineage from parents.

## What the launcher must let the user do
1. **KEYS:** mint a node key, register its public half in the key registry (role: node, status: active, valid_from), and rotate it later. Visual invariant: HUMAN keys and NODE keys are two distinct classes, never visually merged.
2. **CONFIG:** edit two files:
   - ops/node.yaml: the path-to-env map.
   - ops/declarations.yaml: accepted deviations with revisit dates. Expired items visibly re-escalate on their own.
3. **COMPONENTS:** the component checklist (identity, keeper, persona, expert-service, shared-corpus, lapis-pm optional, governance), plus endpoint-surface (hello + emit + export). Each component has a three-way triage:
   - none → grow from seed
   - different → align
   - one-to-one → route
4. **CONFORM:** run the conformance runner and render the gap report, each gap with its grow_ref pointer. States: green / gap / dated-declared.
5. **HELLO WORLD:** the scripts/send-hello.mjs flow, made human:
   1. Hello handshake, which pins the wire echo.
   2. Node-key announce.
   3. One emit. The launcher ASSERTS the gate mapped text → session-log and shows the receipt.
   4. Replay proof: duplicate:true, byte-identical, log unchanged.
6. **BASELINE:** view and export the node's first truthful baseline JSON, which is the /api/export payload itself. Preserve the honesty labels: creator_verified:false, opaque hashes, public sha256 (not wire-v0).

## Integrity as a first-class UI state
When a log is tampered with:
- export refuses with 503 log_integrity
- hello reports QUARANTINED
- corrupt lines sit in quarantine.jsonl

The launcher renders quarantine as a visible, honest state (what is quarantined, why, what still works). It doesn't hide it.

## Character
A small window with controls, text fields and checklists: an honest tool-era window. Not a dashboard, not a notification center, not a chat. A flame-shaped UI for a human; agents are workers, never the destination.

**Honesty rule:** anything displayed shows whether it is verified or merely asserted. The UI never makes a claim the machinery doesn't make.

## Constraints this month (must-never)
- No payments.
- No claims or vouch surfaces.
- No verified:true attributions.
  - Launcher-side rails stand exactly as written: this forbids the launcher (or any agent in
    it) from ever fabricating or flipping a `verified:true` attribution. It never barred the
    gateway's own machine-made `creator_verified`, displayed verbatim from the export. The
    pre-keys reading was stale (keeper grounding report, constraint C9); the ruling that
    crossed it, verbatim and attributed (EOM-DEMO-UI-FIXWAVE-2026-10-28):
    > RULING (xErah, 2026-10-28, GO "Yes let's get these changes worked in" 13:37 PDT): creator_verified=true means the gateway verified an Ed25519 signature over the canonical body, by a registered key, at ingest - proof of key control, nothing more. It is NOT identity, NOT a vouch, and NOT consent; unsigned entries stay honestly labeled claims. No vouch layer, no identity claims, no payments enter through this surface.
- Fork and remix paths show as built-later (501), not as broken.
- Exposure posture (bind/TLS/proxy) is intentionally blocked-on-ruling. The launcher doesn't design for a public deployment yet; it designs the local truth.
