# Agent hand-off: open questions (code side)

Captured from the design review, 2026-10-26. Design direction: **2a** (tall window, about 380×640, docked in a screen corner), with **2c** as the issue view and **2d** as the Agent queue.

## What's decided
- The launcher is not a chat surface. It doesn't talk with the agent. It only builds tasks and hands them off.
- Hand-off flow: you review an issue (gap / problem / message) → **+ queue for agent** → Agent tab → add an optional one-line goal → **Hand off**.
- It works with whatever agent setup the user already has. Wiring the agent in is the user's job, but the launcher should **walk them through it**.
- First open acts as a **living README**: a step-by-step setup walkthrough built on the same tabs. One step is "connect your agent".

## Hand-off routes (to be decided)
1. **Outbox file (simplest, works with any agent setup)**: the launcher writes a markdown file (e.g. `ops/agent-queue.md`) listing the issues, their evidence, and the goal. The user's agent (OpenClaw, Hermes, OpenCode, Claude Code, Codex…) checks the file on a schedule (heartbeat) and works it whenever it has capacity.
2. **Endpoint**: the launcher POSTs the packet to a URL the user supplies. That could be an OpenAI-compatible URL, Anthropic, or a local model server. Open question: is this the launcher's job at all, or should it stay with the user's agent setup?
3. **Copy**: manual fallback. The packet goes to the clipboard and the user pastes it wherever they want.

## Open questions
- File format: markdown only, or markdown plus a JSON sidecar that machines can read?
- How does the agent report back? A reply file (e.g. `ops/agent-replies.md`) that the launcher watches?
- Honesty rule: the launcher can't confirm an agent did anything. Agent reports show as **asserted**. Only a fresh Conform run or hello/export result turns an item **verified**.
- Can the launcher detect locally installed agent tools (Claude Code, Codex, Claude desktop), or should it only ask? Default: ask. Don't probe.
- Endpoint route: where do the credentials live? (They must stay out of the attribution log and the node registry.)
- Should queued tasks expire or re-escalate, the way declarations do?
- Launcher must-nevers still apply to anything handed off: no payments, no claims/vouches, no verified:true, fork/remix stays 501. (The `verified:true` rail bars launcher-authored labels only; the gateway's machine-made `creator_verified` is the ruling's meaning, verbatim - see `seams-launcher-spec.md`, C9/EOM-DEMO-UI-FIXWAVE-2026-10-28:
  > RULING (xErah, 2026-10-28, GO "Yes let's get these changes worked in" 13:37 PDT): creator_verified=true means the gateway verified an Ed25519 signature over the canonical body, by a registered key, at ingest - proof of key control, nothing more. It is NOT identity, NOT a vouch, and NOT consent; unsigned entries stay honestly labeled claims. No vouch layer, no identity claims, no payments enter through this surface.)
