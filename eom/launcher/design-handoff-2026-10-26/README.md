# Handoff: Seams Launcher

## Overview
The launcher is the minimal human client of the Seams protocol. It's a small desktop window, docked in a screen corner, that lets a person join a network as a node and manage it without an agent conversation. It has two modes:
- **Manage**: you do the work by hand.
- **Agent**: you queue issues for your own agent harness to work on.

The launcher never chats with the agent. It writes tasks to a file the agent's harness watches.

Read `docs/seams-launcher-spec.md` first: it holds the wire contract and the must-nevers. Then read `docs/agent-handoff-open-questions.md`, which lists unresolved code-side decisions.

## About the design files
The files in this bundle are **design references built in HTML**. They're prototypes that show the intended look and behavior, not production code to copy. The task is to **recreate the design in the target environment**. A small native-feeling desktop window fits well: Tauri, Electron or Wails, or a local web page served by the node. Use that environment's own patterns. All server responses in the prototype are **simulated**. Wire it to the real `/api/hello`, `/api/ingest` and `/api/export`.

To view the prototype, open `prototype/Seams Launcher.dc.html` in a browser, served from that folder (`support.js` must sit next to it). It reads three settings:
- `theme`: light / dark
- `integrity`: ok / quarantined, to simulate the quarantine state
- `startInSetup`: whether it opens on the setup walkthrough

## Fidelity
**High fidelity.** Final layout, colors, type, copy and interaction model. Recreate it closely. The `exploration/` folder holds earlier wireframes and the rejected visual directions (A = classic bevel, C = instrument). They're context only. The chosen direction is **B, "quiet utility"**.

## Window
- **Size:** fixed 380 × 640 px. Docked bottom-right of the screen with a 20px inset. Height clamps to the viewport minus 40px.
- **Frame:** background `--bg`, 1px `--line2` border, 9px radius, shadow `0 10px 30px rgba(20,20,15,.18)`.
- **Layout:** a vertical stack, top to bottom. Only the body scrolls:
  1. Title bar
  2. Rails strip
  3. Quarantine banner (conditional)
  4. Tab bar (Manage only)
  5. Scrolling body
  6. Footer
- **Motion:** none. No animation anywhere, by design.

### Title bar (padding 8px 10px 8px 12px, bottom border `--line`)
- "Seams Launcher": 13px, weight 600.
- **Manage / Agent N** segmented control, shown in tab view only:
  - Container: background `--seg`, 2px padding, 6px radius.
  - Active segment: background `--sel`, 4px radius, `inset 0 1px 0 var(--hi), 0 1px 1px rgba(0,0,0,.08)`.
  - N is the queued count, in `--accent`, weight 600.
- In setup view, the segmented control is replaced by `setup X/7` (mono 11px, `--ink3`).
- **?** button (22×22, 5px radius, 1px `--line2`, background `--btn`) reopens the setup walkthrough.
- **◐** button, same style, toggles light/dark.

### Rails strip (always visible; background `--bar`, padding 6px 12px, mono 11px `--ink2`, gap 12px, all items nowrap)
- `wire 0.3-draft ✓ pinned`. "✓ pinned" is in `--ok`.
- `gate 2 kinds`. Its tooltip shows the exact set `{node-key, session-log}`.
- Integrity, right-aligned:
  - ok: `integrity ok` in `--ok`.
  - quarantined: `QUARANTINED ›` in `--bad`, weight 600. Clicking it opens the Integrity issue view.

### Quarantine banner (quarantined only)
- A full-width button: background `--badBg`, bottom border `--bad`.
- Text: "**Log quarantined**  Sending is paused.  Details ›". It opens the issue view.

### Tab bar (Manage mode; padding 6px 8px, gap 2px)
- Six equal tabs: Keys · Config · Parts · Conform · Hello · Baseline.
- Each tab is a 12px label over a 10px, weight-600 status badge.
- Active tab: background `--sel`, 5px radius, weight 500, same inset highlight as the segmented control.
- Badges:

| Tab | Badge |
|---|---|
| Keys | `none` / `unreg` (`--warn`) · `✓` (`--ok`) |
| Config | `! N` expired declarations (`--bad`) · `✓` |
| Parts | `triaged/7` (`--ok` when complete) |
| Conform | `—` · `N gap` (`--warn`) · `green` (`--ok`) |
| Hello | `—` · `✓` · `paused` (`--bad` when quarantined) |
| Baseline | log entry count · `503` (`--bad` when quarantined) |

### Footer (padding 7px 12px, top border `--line`, 11.5px)
- **Setup view:** [Skip to tabs] · `local only`.
- **Inside a setup step:** ‹ All steps · "setup step N of 7" · [Next step ›]. On the last step the button reads [Finish].
- **Otherwise:** `local only · log n {N}` · `exposure: blocked-on-ruling` (mono 10.5px `--ink3`).

## Screens

### 1. Setup walkthrough (first open, the "living README")
- **Heading:** "Join the network as a node." (17px, 600, letter-spacing -.01em).
- **Subline** (12.5px `--ink2`): "You set it up here. Agents do the work later. Every step can be done by hand or handed to your agent."
- **Seven steps.** Each row has an 18px circle, a weight-500 title and a description:

| # | Title | Description | Opens |
|---|---|---|---|
| 1 | Rails | see what the server accepts before you send | Hello tab |
| 2 | Keys | mint the node key that identifies this node | Keys tab |
| 3 | Agent | where your agent picks up work | Agent mode → Route |
| 4 | Config | paths and accepted deviations | Config tab |
| 5 | Parts | what you have, what to grow | Parts tab |
| 6 | Conform | check, see gaps | Conform tab |
| 7 | Hello world | first deposit + baseline | Hello tab |

- **Step states:**
  - Done: `--ok` filled circle with ✓.
  - Current (the first one not done): `--accentBg` filled circle, row raised to background `--panel` with a 1px `--line2` border, 7px radius, plus a primary **Start** button.
  - Pending: outlined circle, `--ink3` text, "open ›" hint.
- Every row is clickable.
- **Done when:**

| Step | Done when |
|---|---|
| Rails | always |
| Keys | key minted and registered |
| Agent | route saved |
| Config | no expired declarations |
| Parts | all 7 triaged |
| Conform | runner has been run |
| Hello world | replay proven |

### 2. Keys
- **Node key box:** 1px `--line2`, **3px radius** (deliberately square), background `--panel`. Header tag `NODE KEY`: mono 10px, letter-spacing .1em, inverted (`--ink` background, `--bg` text, 2px radius).
  - Empty: copy plus a primary **Mint node key** button.
  - After minting:
    - The full public key in mono 11px, word-break all.
    - A grid of role `node` · status (`active`, or `active · not registered yet` until registered) · valid_from as an ISO timestamp.
    - A primary **Register public half** button (until registered) and **Rotate**.
  - Once registered: "Registered · server accepted node-key" with an **asserted** tag, plus the deposit_hash.
  - Rotated keys list below as `retired`.
- **Human keys box:** a **different visual class, never merged with node keys**. 1px `--line`, **14px radius** (rounded), outlined pill tag `HUMAN KEYS`. Copy: "Never listed with node keys and never managed from here."

### 3. Config
- Underline sub-tabs: `node.yaml` | `declarations.yaml !` (the red ! appears while any declaration is expired). Active tab: weight 500, 2px `--ink` underline.
- **node.yaml:** a two-column grid of path key (mono) → env var (an editable input: mono 12px, 1px `--line2`, 5px radius). Rows: server_url → SEAMS_URL, log_path → SEAMS_LOG, registry_path → SEAMS_REGISTRY, quarantine_path → SEAMS_QUARANTINE. The footer shows `ops/node.yaml · saved HH:MM`.
- **declarations.yaml:** one card per declaration.
  - **Active:** dashed `--line2` border, "revisit YYYY-MM-DD".
  - **Expired** (re-escalates on its own):
    - Card: solid `--bad` border on `--badBg`, state "expired DATE · re-escalated" in `--bad` weight 600.
    - Actions: **Renew +30 days**, **Resolved** (removes it), and **+ Queue for agent**.
  - Below the cards: **+ Add declaration**, then a note that expired items appear in Conform as gaps.

### 4. Parts (components triage)
- **Rows:** identity, keeper, persona, expert-service, shared-corpus, lapis-pm (optional), governance.
- **Row anatomy:**
  - Status icon: ✓ in `--ok` when triaged, ○ untriaged, – skipped.
  - Name, plus "· choice" in `--ink3`.
  - At right, either:
    - the next-step chip "Grow from seed" / "Align" / "Route" (background `--seg`, 5px radius), or
    - a status: "not triaged" in `--warn`, "skipped", or "declared · revisit MM-DD" (governance, while its declaration is active).
- **Expanding a row:** clicking a row expands a card (`--panel`, 1px `--line2`, 7px radius) containing:
  - The question "Do you already have {name}?".
  - Three buttons: **No → grow**, **Sort of → align**, **Yes → route**, plus **Skip** for optional parts. The selected one is filled `--accentBg` with white text.
  - **+ Queue for agent**.
- **endpoint-surface:** below the list, checkboxes for hello / emit / export.
- **Open item:** per the review, choosing "Sort of → align" should eventually open a solve or align flow. That's out of scope for this pass.

### 5. Conform
- **Not run:** explainer copy and a primary **Run conformance** button.
- **After a run:** three stat columns, each a number at 18px/600 over a label:
  - green (`--ok`)
  - gap (`--warn`)
  - dated-declared (`--ink2`)
- **Gap cards:** 1px `--warnLine`, background `--panel`. Each shows its title, the `grow_ref → …` pointer in mono 10.5px, and a **+ Queue** button.
- **Declared cards:** dashed.
- **No gaps:** an all-green message appears instead of gap cards.
- **Footer:** **Run again** · `last run HH:MM · local`.
- **The runner produces gaps for:**
  - an unregistered key
  - untriaged parts
  - parts marked "none" (missing; grow from seeds/…)
  - endpoints that are off
  - expired declarations

### 6. Hello (the send-hello.mjs flow)
Four numbered steps. The circle states match setup: done ✓ `--ok`, current `--accentBg`, pending outlined.
1. **Hello handshake · GET /api/hello**: a **Say hello** button. Result: "Echo 0.3-draft matches the pin. Gate is exactly {node-key, session-log}. Integrity: ok/QUARANTINED", with a **✓ verified** tag.
2. **Announce node key · kind node-key**: an **Announce** button, or "Mint a node key first, in Keys." Result: "Accepted by the gate." with an **asserted** tag.
3. **Emit one deposit · POST /api/ingest**:
   - Inputs: a textarea (default "hello, network"), origin radios (authored / assisted / played) and a char counter `N / 8000` (turns `--bad` above 8000).
   - Buttons:
     - **Emit** (primary).
     - **+ Queue for agent**, which queues the message instead of sending it.
     - A disabled dashed **Fork / remix · not yet built**, with tooltip `consent_gate_unbuilt 501`. It's shown as built-later, not as an error.
   - **Refusal box** (`--bad` border on `--badBg`): the refusal name verbatim in mono (e.g. `too_long 413`), a plain explanation, and the footnote "Refusals don't count against your rate budget."
   - **Launcher holds**, shown the same way but labelled "held by launcher · Not a server refusal. Nothing was sent.", when:
     - the log is quarantined
     - hello hasn't run yet
   - **Receipt card:** "Gate mapped text → session-log" with a **✓ checked** tag. Below it, payload_hash, content_hash, deposit_hash and n in full in mono 10.5px, then "Hashes are opaque, shown exactly as received." Never truncate or reformat the hashes.
4. **Replay proof**: a **Replay** button. Result: three rows, each **✓ verified**:
   - `duplicate: true`
   - "Receipt byte-identical to original"
   - "Log unchanged · n X → X"

### 7. Baseline
- **Header:** `GET /api/export · N entries` · `seams-attribution-log/0-eom.1`.
- **Honesty labels:**
  - `creator_verified: false`, on every entry for now.
  - "Hashes opaque, public sha256", not wire-v0.
  - `parents: []`, with "order is in the chain block".
- **JSON preview:** a mono `<pre>`, max-height 220px, scrolling. It shows the export payload, with the chain block {n, prev, hash} **alongside** the entry, not inside it.
- **Actions:** **Save baseline.json**.
- **Quarantined:** a `503 log_integrity` panel instead: "No baseline is shown, because it wouldn't be truthful.", plus a link to the issue view.

### 8. Integrity issue view (quarantine)
Reached from the rails strip or the banner. It has a breadcrumb "‹ Back / Integrity", then:
- **Red card:** "Log quarantined" with a dashed **reported by hello** tag. Copy: "Sending is paused. The launcher won't emit into a corrupted log."
- **What:** quarantine.jsonl and its lines with reasons, in a mono box.
- **Why it matters:** export refuses with 503.
- **Still works / Blocked**, as two columns:
  - Still works: Keys · Config · Parts, Conform (local), Hello (read-only).
  - Blocked: Emit (paused), Export (503).
- **Hand to agent card** (1px `--accentLine`): it lists what gets attached, with **+ Queue "repair log"**.

### 9. Agent mode
Sub-tabs: **To hand off · N** | **Handed off · N** | **Route**.
- **To hand off:**
  - A route line: "→ ops/agent-queue.md".
  - Queue items, each a checkbox card with title, mono evidence and its source screen. The border shows the source: `--bad` for Integrity, `--warnLine` for Conform and Config, `--line2` otherwise. Unchecked items sit at 60% opacity.
  - A one-line **Goal** input (optional).
  - **Write N tasks to outbox** (primary; disabled until a route is set) and **Copy**.
  - A collapsible **Packet preview** showing the markdown.
- **Handed off:** one card per task ID showing "Written to outbox" with **✓ verified** (the launcher wrote the file), and the reply line with **asserted**. Note: "Agent replies stay asserted. An item turns verified only after Conform or hello confirms the fix."
- **Route:** "Where does your agent pick up work?", then three radio cards:
  - **Outbox file** ("works with any agent"; inputs for the outbox and replies paths; a collapsible heartbeat instruction to paste into the agent).
  - **Endpoint** ("not built · open question"; it can't be saved).
  - **Copy only**.
  - **Save + write test task** writes T-000. It shows "written ✓ verified", then the agent's reply as **asserted** (simulated after 2.5s).

## Interactions and rules
- **Verified vs asserted tags** appear everywhere a claim is shown:
  - **✓ verified**: mono 10px, 1px solid `--ink3`, 4px radius. Only for what the launcher itself checked (pin match, byte-identical replay, the file it wrote).
  - **asserted**: same, but a dashed border and `--ink3` text. For what the server or agent says.
- **+ Queue for agent** buttons sit on every issue. Once queued, the label changes to "✓ Queued". Items are de-duplicated by title.
- **Refusals** always show the server's name verbatim.
- **Fork/remix** is always shown as "not yet built", never as an error.
- No payments, claims, vouches or verified:true attributions. (Launcher-side authorship rails;
  the gateway's own machine-made `creator_verified` is displayed verbatim from export - the C9
  ruling, verbatim, EOM-DEMO-UI-FIXWAVE-2026-10-28:
  > RULING (xErah, 2026-10-28, GO "Yes let's get these changes worked in" 13:37 PDT): creator_verified=true means the gateway verified an Ed25519 signature over the canonical body, by a registered key, at ingest - proof of key control, nothing more. It is NOT identity, NOT a vouch, and NOT consent; unsigned entries stay honestly labeled claims. No vouch layer, no identity claims, no payments enter through this surface.)
- **No exposure UI:** exposure is blocked-on-ruling.
- **Motion:** none. No transitions or animation.

## Outbox packet format (draft; see open questions)
```
# seams tasks

goal: get to green before Friday

## T-001 grow shared-corpus
- source: Conform
- evidence: grow_ref → seeds/shared-corpus
- status: open
```
The heartbeat line for the agent reads: "Every 30 min: read ops/agent-queue.md. Work any task with status: open. Append "ack T-xxx" or a short result to ops/agent-replies.md. Don't edit the outbox."

## State (see the logic class in the prototype)
- **Navigation:**
  - `view` (setup | tabs), `mode` (manage | agent), `tab`, `agentSub`.
  - `setupFrom`: the step index while walking through setup.
  - `issueOpen`.
- **Theme:** the user's choice, persisted.
- **Keys:** `nodeKey {pub, from}`, `registered`, `regHash`, `oldKeys[]`.
- **Config:** `env[]`, `decls[] {id, note, revisit}`. Expired means `revisit < today`.
- **Parts:** `parts {id: none|different|one|skip}`, `surface {hello, emit, export}`.
- **Conform:** a `conform` snapshot `{at, green, gaps[], decl[]}`.
- **Hello:**
  - `shook`, `text`, `origin`.
  - `receipt`: the server receipt, stored verbatim.
  - `refusal`, `replayed`.
  - `logN`: the export n.
- **Integrity:** from hello (`ok` | `QUARANTINED`). It gates emit and baseline.
- **Agent:**
  - `queue[] {title, detail, source, checked}`, `sent[] {tid, …, reply}`, `goal`.
  - `route` (outbox | copy | null), the outbox and replies paths, `test` state.

## Design tokens

| Token | Light | Dark |
|---|---|---|
| --desk (behind window) | #e4e3df | #0f1011 |
| --bg (window) | #f6f6f4 | #1d1e20 |
| --bar (rails strip) | #efefec | #18191b |
| --panel (cards, inputs) | #ffffff | #25262a |
| --seg (segmented track, chips) | #e9e9e6 | #2a2b2e |
| --sel (active tab/segment) | #ffffff | #3b3c41 |
| --line | #e1e0dc | #2e2f33 |
| --line2 | #d6d5d0 | #3a3b3f |
| --ink | #1c1c1a | #e8e8e5 |
| --ink2 | #55544f | #b4b4ae |
| --ink3 | #8a8982 | #7d7d77 |
| --btn | #ffffff | #2f3034 |
| --hi (button top highlight) | #ffffff | rgba(255,255,255,.07) |
| --accent (text/links) | oklch(0.5 0.13 255) | oklch(0.76 0.11 255) |
| --accentBg (primary fill) | oklch(0.5 0.13 255) | oklch(0.56 0.13 255) |
| --accentLine | oklch(0.8 0.06 255) | oklch(0.45 0.1 255) |
| --ok | oklch(0.52 0.12 150) | oklch(0.74 0.12 150) |
| --okBg | oklch(0.96 0.03 150) | oklch(0.3 0.04 150) |
| --warn | oklch(0.58 0.13 75) | oklch(0.78 0.12 80) |
| --warnLine | oklch(0.84 0.08 75) | oklch(0.45 0.07 80) |
| --bad | oklch(0.55 0.17 27) | oklch(0.72 0.14 25) |
| --badBg | oklch(0.96 0.02 27) | oklch(0.28 0.04 27) |

- **Type:**
  - IBM Plex Sans (UI): 400, 500 and 600.
  - IBM Plex Mono (data, hashes, paths, tags): 400 and 500.
  - Sizes: 17 (screen headings), 15 (sub-headings), 13 (base), 12.5, 12, 11.5, 11, 10.5, 10 (tags and badges). Line-height 1.45.
- **Radius:** 9 (window), 7 (cards), 6 (buttons, inputs), 5 (small buttons, tabs), 4 (tags), 3 (node key box), 14 (human key box).
- **Spacing:** body padding 10–12px. Gaps between controls 4, 6, 8, 10 and 12px.
- **Buttons:**
  - **Primary:** `--accentBg` fill, white text, weight 500, no border, `inset 0 1px 0 rgba(255,255,255,.22), 0 1px 1px rgba(0,0,0,.12)`.
  - **Secondary:** `--btn` fill, 1px `--line2`, `inset 0 1px 0 var(--hi)`.
  - **Queue:** transparent fill, 1px `--accentLine`, `--accent` text.
  - **Disabled:** opacity .45.

## Assets
None. No images or icons; the only glyphs are text characters (✓ ○ ◐ ◐ – ✕ › ‹ →).

## Files
- `prototype/Seams Launcher.dc.html`: **the hi-fi interactive prototype (source of truth)**. Its logic class holds every state rule above.
- `prototype/support.js`: the runtime needed to open the prototype in a browser. It isn't part of the design.
- `exploration/Launcher Wireframes.dc.html`: wireframe rounds 1 to 3. The chosen structure is 2a + 2c + 2d + 3a–3d.
- `exploration/Launcher Hi-fi.dc.html`: the three visual directions. B was chosen; A ranked second and C last.
- `docs/seams-launcher-spec.md`: the source spec (wire contract, capabilities, must-nevers).
- `docs/agent-handoff-open-questions.md`: open code-side questions about agent hand-off routes, the reply format and the endpoint route.
