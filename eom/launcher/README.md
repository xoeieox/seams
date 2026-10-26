# Seams Launcher — EoM skeleton (build leg 2026-10-26, branch `eom-node-one`)

The minimal HUMAN client for a self-hosted Seams node: one tall window docked in a
corner (~380×640), two modes — **Manage** (Keys · Config · Parts · Conform · Hello ·
Baseline) and **Agent** (hand-off queue). It is built from Erah's Claude Design
handoff (canonical copy in [`design-handoff-2026-10-26/`](design-handoff-2026-10-26/),
byte checksums in `design-handoff-2026-10-26/CHECKSUMS.sha256`), direction **B
"quiet utility"** — tall window 2a, issue view 2c, agent queue 2d. Motion: none,
by design.

**The launcher is not a chat surface.** You never converse with your agent here.
An issue becomes a task, the task waits in a queue, you optionally add a one-line
goal, you press **Hand off**. That's the whole interaction.

## Run it

```
node eom/launcher/server.mjs                        # binds 127.0.0.1:4173, refuses anything non-loopback
# with the node running (default proxy target http://127.0.0.1:8080):
PORT=4173 NODE_ONE_URL=http://127.0.0.1:8080 node eom/launcher/server.mjs
```

Then open **http://127.0.0.1:4173/** in a browser. Zero dependencies, Node 18+.
Ops files it owns live under `OPS_DIR` (default `./ops/` next to the server):
`node.yaml`, `declarations.yaml`, `parts.json`, `agent-queue.md`, `agent-replies.md`.

## What is REAL (wired to the actual node-one server)

`server.mjs` is a loopback-only static server **and** a byte-verbatim proxy to
`eom/node-one/attributed-text/server.mjs` for the three endpoints the launcher
speaks: `GET /api/hello`, `GET /api/export`, `POST /api/ingest`. It refuses to
start if `NODE_ONE_URL` is not loopback. Nothing is mocked on this path:

- **Hello pins the wire.** The launcher pins `seams-wire/0.3-draft`; a server
  echoing anything else is refused at the rails — the launcher will not emit past
  a skew. The gate's advertised kinds must equal the closed set `{node-key,
  session-log}` or the rail shows skew.
- **Rails before emit.** No emit leaves the launcher before a hello this session
  confirmed pin + gate; quarantine pauses sending before the request is made
  (a "held by launcher" notice, explicitly *not* styled as a server refusal).
- **Refusals render VERBATIM** — name, code, and the server's own words
  (`consent_gate_unbuilt` renders as a built-later 501, never as breakage;
  fork/remix is disabled in the UI and the server refuses it too).
- **Receipts show opaque hashes as opaque**, exactly as received.
- The tests boot the real node-one server ephemerally, drive the launcher's
  proxy end-to-end, kill it, and verify with `ps` that it is gone.

## What is STUBBED / ASSERTED (and says so in the UI)

- **Reply-watcher**: reads `ops/agent-replies.md` and renders agent replies —
  always tagged `asserted`. The launcher never verifies an agent claim; only a
  fresh Conform or hello run turns an item verified.
- **Endpoint hand-off route: OUT OF SCOPE this month.** The design offered two
  routes; only the **file route** is built (`ops/agent-queue.md`, markdown:
  issue · evidence · optional goal, plus a clipboard fallback). The endpoint
  route needs a credential story (who holds the agent's URL+token, where it
  lives, what happens on leak) that Erah has not ruled on — see
  `docs/agent-handoff-open-questions.md` in the design handoff. There is no
  placeholder code for it: the card is disabled and says *not built · open
  question*.
- **Registration verification** is an export `nodes[]` cross-check, not a
  signature — hashes stay opaque placeholders until the deposits-spec ruling.
- Nothing is detected about your setup: the launcher asks three-way questions
  (none / sort of / yes) and believes the answer. It never scans your machine.

## Honesty rule (structural, in code)

Every claim row renders through `claimRow()`/`tag()` in `public/app.js` and must
carry one of exactly two labels:

- **verified** — a machinery check ran *this session* (fresh hello/export/
  conform result, byte-compare, or file read-back).
- **asserted** — the server or an agent merely says so.

`launcher-core.mjs` `claim(label, text, ok, note)` refuses to construct a claim
without a label. There is no code path that renders a claim bare.

## MUST-NEVERS honored here

- No payments surface anywhere (compensation is `none` in the wire's terms).
- No claims/vouches surface; `verified:true` attribution is never displayed —
  Baseline shows `creator_verified: false` as what it is.
- Fork/remix: disabled control + built-later copy; server-side `consent_gate_unbuilt` 501.
- No exposure/tunnel UI: the footer states `exposure: blocked-on-ruling`; the
  server refuses non-loopback binds outright.

## Layout of this directory

| file | role |
| --- | --- |
| `server.mjs` | loopback static server + verbatim proxy + ops-file/queue endpoints |
| `launcher-core.mjs` | pure logic: pins, gate checks, refusal render table, holds, queue markdown, conform gaps, config parse/render |
| `public/index.html` · `public/app.js` · `public/app.css` | the window |
| `test/launcher.test.mjs` | the launcher test suite (`node --test`) |
| `design-handoff-2026-10-26/` | canonicalized Claude Design handoff (8 files + CHECKSUMS) |

## Not yet claimable

This skeleton cannot claim: real key minting (public key is a local random ref,
not cryptographic registration), multi-node federation, consent/fork flows,
tunnelling or exposure of any kind, an agent endpoint transport, or that any
agent ever acted — replies are asserted forever until machinery confirms.
