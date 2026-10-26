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

## Run it — one command

```
node eom/launcher/launch.mjs     # starts (or reuses) node-one + the launcher window, loopback only
```

Open **http://127.0.0.1:4173/** — or install it as an app (see
[How an end user experiences this](#how-an-end-user-experiences-this-the-ladder-of-truth)).
`Ctrl-C` stops whatever this command started; a port already busy is reported as
*“already running — open the URL”*, never an `EADDRINUSE` stack trace. Knobs (all
optional): `PORT` (4173) · `NODE_ONE_PORT` (8080) · `OPS_DIR` · `NODE_ONE_DATA_DIR` ·
`NODE_ONE_URL` (expert: proxy to an already-running loopback node-one instead of spawning
one). On a remote box, port-forward first: `ssh -L 4173:127.0.0.1:4173 <user>@<launcher-box>`.

The two servers can still be run separately:

```
node eom/node-one/attributed-text/server.mjs        # binds 127.0.0.1:8080
node eom/launcher/server.mjs                        # binds 127.0.0.1:4173; refuses non-loopback NODE_ONE_URL
```

Zero dependencies, Node 18+. Ops files the launcher owns live under `OPS_DIR` (default
`./ops/` next to the server): `node.yaml`, `declarations.yaml`, `parts.json`,
`agent-queue.md`, `agent-replies.md`.

## How an end user experiences this (the ladder of truth)

**v0 today — download, one node command, a browser window.** Get the seed packet (clone or
download this repo), have **Node 18+ installed**, run one command, open the printed URL.
No accounts, no installs, nothing leaves the machine: everything binds 127.0.0.1 and the
launcher *refuses* any non-loopback node-one. v0 therefore genuinely **requires Node on
the device** — the honest bottom line of a zero-dep build with no packaged runtime.

**This pass — one command, an installable app window.** `launch.mjs` does both servers in
one entry (reusing what already runs, never crashing on a busy port), and the window is
now an installable web app: `manifest.webmanifest` (standalone display, design theme
colors, generated flame icons), a minimal app-shell service worker, and the
`apple-mobile-web-app-capable` meta so Safari opens a standalone window from the Dock.
Install paths: **Chrome/Edge ⌘-menu → “Install Seams Launcher” · Safari → Share →
“Add to Dock” (macOS) / “Add to Home Screen” (iOS) · Android ⋮ → “Install app”.** It lands
as its own icon and window — no browser chrome — pointed at the same loopback server;
`127.0.0.1` is a secure context, so installs work over plain http with no cert ceremony.
The service worker caches the **static shell only**, network-first: `/api`, `/ops`,
`/agent` and `/health` are never intercepted, cached, or replayed — a cached attribution
response would render a stale receipt as if it were current, and that would violate the
freshness-by-hash doctrine at the front door of the app.

**November — double-click.** A packaged `.app` / `.exe` / `.AppImage` with a bundled
runtime: **no Node needed, no terminal needed**, an icon in Applications that performs the
same loopback dance internally. That packaging removes exactly what v0 requires: the Node
install and the command line. The packager choice — **Tauri** (small binary, Rust shell,
system webview) vs **Electron** (bigger, self-contained webview, most-proven path) — is
**flagged as Erah’s decision**; the zero-dep vanilla posture (no bundler, no framework, no
build step — a packager would wrap `launch.mjs` + `public/` unchanged) keeps both doors open.

**The guided setup is not a separate wizard — it is the first-open window.** The living
README walkthrough *is* the guided setup, walking the same rails the tabs walk: **Keys**
(mint/declare the node key) → **Config** (`node.yaml` + declarations) → **Parts** (what you
have, what to grow) → **Conform** (check, see gaps) → **hello world to a peer** →
**Baseline** (the byte-frozen first export; opaque hashes arrive opaque). There is no
onboarding funnel that could drift from what the machinery actually does.

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
| `launch.mjs` | **the one command**: spawns+supervises node-one and the launcher (reuses busy ports cleanly), Ctrl-C reaps both (ps-verified) |
| `server.mjs` | loopback static server + verbatim proxy + ops-file/queue endpoints; friendly “already running” on a busy port, never a stack trace |
| `launcher-core.mjs` | pure logic: pins, gate checks, refusal render table, holds, queue markdown, conform gaps, config parse/render |
| `public/index.html` · `public/app.js` · `public/app.css` | the window |
| `public/manifest.webmanifest` · `public/sw.js` · `public/icons/` | PWA shell: standalone install, app-shell-only cache (never `/api`), generated flame icons |
| `scripts/make-icons.mjs` | regenerates the icons deterministically, zero deps (pure-zlib PNG encoder) |
| `test/launcher.test.mjs` | the launcher test suite (`node --test`) |
| `design-handoff-2026-10-26/` | canonicalized Claude Design handoff (8 files + CHECKSUMS) |

## Not yet claimable

This skeleton cannot claim: real key minting (public key is a local random ref,
not cryptographic registration), multi-node federation, consent/fork flows,
tunnelling or exposure of any kind, an agent endpoint transport, or that any
agent ever acted — replies are asserted forever until machinery confirms.
