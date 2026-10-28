# AGENTS.md — the agent's door (Seams launcher packet)

You are an agent working inside an unpacked seams-launcher packet. The launcher is NOT a chat
surface: it never talks to you and never runs you. It leaves work where your heartbeat looks
(`ops/agent-queue.md`); you leave results where its watcher reads (`ops/agent-replies.md`).
If you can read a file on this machine, you know what to do and do it — without asking questions.

## The queue, in one breath
- Inbox: `ops/agent-queue.md`. Entries look like `## T-000 <title>` with `- source:`,
  `- evidence:`, `- status: open`. Work entries whose status is `open`.
- Every fresh entry carries a **brief** — it is self-sufficient on purpose:
  `- brief-goal:` one line of what to do; `- brief-pointers:` packet-relative files to read
  FIRST (this door, `README.md`, node docs — the agent's brain lives in the packet docs);
  `- brief-accept:` the done-check, verifiable by reading files or curling loopback ports;
  `- honesty:` the footer below, on every brief.
- Entries written before the brief doctrine (2026-10-27) may have no brief: work them from
  title + evidence + `README.md`. Never invent a brief retroactively; append-only is the rule.
- Outbox: append ONE line per finished task, `ack T-000 — <one line about what you did>`, to
  `ops/agent-replies.md`. That append is the only writing you owe the launcher.

## Honesty labels (structural, not vibes)
- `asset-asserted only` on a brief means: the launcher wrote that text from the human's queue-time
  tab context and verified NOTHING. Treat it as direction, not as fact.
- `verified` belongs to machinery alone — a fresh conform run on the launcher, a hello/export
  result. NEVER write `verified:true`, never label your own ack verified, never touch status
  lines of tasks you did not run. An ack is asserted forever until a machine run says otherwise.
  This rail is about what YOU may author - it never suppressed the gateway's own machine-made
  `creator_verified` arriving verbatim in export bytes. Its meaning is the recorded ruling
  (constraint C9, EOM-DEMO-UI-FIXWAVE-2026-10-28), verbatim:
  > RULING (xErah, 2026-10-28, GO "Yes let's get these changes worked in" 13:37 PDT): creator_verified=true means the gateway verified an Ed25519 signature over the canonical body, by a registered key, at ingest - proof of key control, nothing more. It is NOT identity, NOT a vouch, and NOT consent; unsigned entries stay honestly labeled claims. No vouch layer, no identity claims, no payments enter through this surface.

## Where the truth lives in this packet
- `README.md` — the human's setup path; `node launch.mjs` is the one command (starts node-one and
  the launcher together, loopback only, Ctrl-C reaps both).
- Node docs: `node-one/attributed-text/README.md` (what the node is),
  `node-one/attributed-text/server.mjs` (the API exactly as implemented — the source of truth),
  `node-one/attributed-text/seed.json` (the kit seed the Parts tab grows from).
- Launcher logic (read-only for you): `launcher-core.mjs` (pins, refusal table, queue markdown),
  `server.mjs` (the endpoints incl. `/agent/queue` and its pointer lint); contract history:
  `design-handoff-2026-10-26/docs/`.

## NEVER (must-nevers; violating one fails the seed gates, not merely review)
- **Loopback only.** Everything speaks to 127.0.0.1. Never bind, dial, or fetch anything
  external — no external calls at all. Exposure is blocked-on-ruling and there is deliberately
  no exposure UI to configure.
- **No money, no claims.** No payments surface (compensation is `none` in the wire's terms); no
  claims/vouches; `verified:true` attribution is never displayed (by the launcher - the gateway's
  machine-made `creator_verified` rides export verbatim; see the C9 ruling quoted in the honesty
  labels section above); fork/remix stays 501
  (`consent_gate_unbuilt`) — built-later, not broken, so never "fix" it by wiring consent.
- **Zero dependencies.** Never `npm install` into the packet; everything runs on bare node.
  (Dev-only exception: the Tauri icon/build flow via the package.json scripts.)
- **Write discipline.** Beyond your own scratch space, the only file you write is the ack append
  in `ops/agent-replies.md`. Never rewrite queue entries or T- ids, never edit ops config files
  (`ops/parts.json` etc. belong to the human's launcher UI), never touch `MANIFEST.sha256`,
  `CHECKSUMS.sha256`, or anything under `design-handoff-2026-10-26/`.
- **Deterministic bundles.** The Mac bundle is byte-deterministic by doctrine (node-only packer,
  pinned clocks). Never re-pack by hand; run `scripts/make-mac-bundle.sh` and let the sha256
  sidecar speak.
- **Red gates are the answer.** If a gate (`npm test`, pytest scrub, MANIFEST) is red, paste it;
  do not skip, delete, or work around a gate.
