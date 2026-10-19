# 02 — Attribution ↔ Payment (Zephyr rail + consent)

Packet: SEAMS / 2026-10-12 / keeper. This is the attribution-to-payment-rail seam: the ratified rail design, its ratification ledger, the live-testnet money-plane proof, the mesh protocol + signing side of the packet, and the consent doctrine as it stands. Source paths verbatim-tagged; `…` abbreviates `/data/git/inertia-vault-working`. Stale-name adjudication lives in `04-open-gaps.md` §6 [excluded from public seed] — do not read absence there as absence of content.

---

## 1. Zephyr Open Payments Rail — Design and Arc (VERBATIM)

Source: `…/Lapis/Architecture-Zephyr-Open-Payments-Rail-Design-2026-07-20.md` (15,237 B, fetched 2026-10-12).
**Correction to ship with it:** front-matter `status: design-for-ratification` is STALE — the ledger records RATIFICATION (see §2.1). Read the doc as ratified design.

```text
---
status: design-for-ratification
date: 2026-07-20
author: Fable (Lapis PM session)
supersedes: none
companion: Architecture-Zephyr-Open-Payments-Rail-Fable-Brief-2026-07-20.md
tags: [zephyr, open-payments, settlement, rail, arc-derivation]
---

# The Attribution -> Payment Rail - Design and Arc

One line: a signed attribution edge becomes a set of Open Payments transactions by way of exactly one new artifact - the **Route Manifest** - compiled deterministically from declared terms, then executed by a replay-safe Open Payments client. Nothing else is new. Every other piece already exists in the ecosystem, validated, and this design mostly connects them.

## 1. The invariants (flame origin)

If a design choice below conflicts with one of these, the invariant wins.

1. **Path not amount.** Attribution sets the routing path. The amount enters exogenously - a sale, a declared contract, a project-slot budget. No valuation is ever computed inside the rail. (`decision/zephyr-attribution-not-valuation-route-not-compute-2026-06-24`)
2. **Execute, never derive.** The rail may mechanically execute declared terms (a rate someone set, a share someone consented to). It may never derive a share from any property of the contribution. Same machine, opposite epistemics. (`concept/rolling-attribution-via-inherited-terms-2026-07-07`)
3. **Every payment traces to a signed attribution edge.** A settlement leg that cannot cite the manifest_hash of a deposit does not execute. Fail closed.
4. **Exact conservation.** Sum of routed integer amounts equals the amount in, in smallest currency units, largest-remainder rounding. The rail neither creates nor destroys value. (rate-composition DoD invariants)
5. **Credited-but-unpaid is a first-class state, forever.** A contributor without a wallet loses nothing: attribution stands, the leg stays a pending intent with no expiry. Missing routing never diminishes attribution, and an unpayable share is never silently redistributed. (Void Principle; `settler/wallet_map.py` no-route semantics)
6. **Non-custodial.** Value moves payer -> recipient directly, one Open Payments leg per recipient, funds never passing through a Lapis-held wallet on someone's behalf. The rail composes instructions; it does not hold money. This is also what keeps split-calculation and withholding liability off the rail. (`decision/zephyr-collective-payout-lead-wallet-ask-2026-06-28`)
7. **Two clocks.** Attribution settles continuously at capture, with no money and no human event. Payout settles only at a value event that carries an exogenous amount. The rail activates on the second clock only.
8. **No model in the money path.** The compile and execute stages are deterministic, LLM-free code. (Extends zephyr core's no-LLM rule to the whole rail. Trivially satisfies no-direct-Anthropic-API.)
9. **Key doctrine holds.** Human keys live only on human devices; node keys vouch only for non-human agent_ids; human-attributed demos use synthetic identities; a node key never signs a wallet claim for a human namespace. (`decision/zephyr-agent-key-management-2026-06-08`, `feedback_no_fabricated_human_attribution`)
10. **Provenance on every routing call, human-readable surface for every outcome.** Each compile and each execution leg deposits its own provenance into the attribution log; `show_ledger`-class surfaces stay the flame-shaped view. Agent-as-worker, never agent-as-destination.
11. **Wallet bindings are signed claims, not config - and SELF-SIGNED ONLY.** pubkey -> wallet is an attribution-grade assertion. v0's editable `wallet_map.json` is a spoof surface - a binding must be a signed deposit, signed by the very key it binds. No proxy/declared bindings exist (Erah ratification 2026-07-20: the cited-origin payment pattern was a backdoor and is removed, not deferred).
12. **Payable requires a key; credit does not.** Attribution citations may credit anyone, keyed or not - that is Zephyr's existing credited-but-unpaid doctrine. But routing terms may only name registered pubkey identities, and money moves only to self-signed wallet bindings. When a real contributor deserves payment, the rail's answer is provisioning them a key through proper channels (device-held, human-anchored where applicable) - our responsibility to set up, never to simulate with a claim recorded on their behalf.

## 2. The elegant core - the Route Manifest

The mem ledger already names it: "the collective IS the manifest IS the attribution chain serialized" (lead-wallet decision, 2026-06-28). This design takes that sentence literally and makes the manifest the only new moving part.

**Compile** (pure function, zephyr repo, Python):

```
(attribution edges, declared terms, amount_in, asset) -> RouteManifest
```

The RouteManifest is a content-addressed, node-signed deposit:

```json
{
  "event":      {"kind": "km-slot-close | pos-sale | ...", "ref": "slot:..."},
  "amount_in":  {"value": "500", "asset_code": "USD", "asset_scale": 2},
  "legs": [
    {"beneficiary_pubkey_id": "ed25519:...", "wallet": "https://...", "amount": {"value": "450", ...},
     "derivation": {"edges": ["sha256:..."], "term_refs": ["sha256:..."], "algorithm": "declared-share-v0"}}
  ],
  "conservation": "sum(legs) == amount_in, largest-remainder"
}
```

**Execute** (Node, official @interledger/open-payments SDK - the proven spike): take one manifest, obtain one interactive outgoing-payment grant sized to the summed amount, then per leg: incoming payment -> quote -> outgoing payment, receipt deposited back referencing the manifest and the leg.

Why this is the minimal load-bearing mechanism - what it collapses:

- **SplitPolicy v0's deliberate void** is filled by the compile step, exactly at the interface the code reserved for it (`settler/split.py`: "proportional multi-party splitting moves into an upgraded SplitPolicy; the interface remains stable").
- **The backcaster's settler-miswired finding** (receipt-of-value coupled to distribution-execution) is fixed structurally: compile and execute are separate stages and the manifest is the boundary artifact between them. Validation happens at compile, movement at execute, each independently re-runnable.
- **wallet_map.json disappears** into signed wallet-binding deposits - one less trust surface, and the attribution log becomes the single store of every claim the rail acts on.
- **The T0 -> T1 ladder becomes one artifact.** T0 (ship now): our orchestrator executes the manifest sender-side. T1 (the ILF standards ask): the same manifest, published at a wallet address for the payer's client to discover. We dogfood the exact object we are asking Interledger to standardize - the ask writes itself from running code.
- **Audit is a join, not a subsystem.** payment -> receipt deposit -> manifest -> edges + terms, all rows in attribution.db keyed by manifest_hash, which the settlement ledger already uses as its key.

## 3. Piece inventory (all found, none invented)

| Piece | State | Where |
|---|---|---|
| Signed deposits, Ed25519, content-addressed keys | live | zephyr repo + attribution.db (3606 rows; signing live for expert_attestation) |
| Node key regime + node-vouches | live (bootstrap tier) | `infra/zephyr-brix-node-key-seeded-2026-07-20` |
| Intent queue + emitter seam on signed deposits | landed | zephyr PR #3 chain |
| Settlement ledger keyed by manifest_hash | landed | `settler/ledger.py` |
| SplitPolicy interface with deliberate void | landed | `settler/split.py` |
| Working OP client flow, real testnet settlement | validated spike, out-of-repo | `~/zephyr-live-capture/live_capture.mjs` + captured.live.json (fold-in owed since 2026-06-14) |
| Testnet wallets + keys (payer, recipient, credited-unpaid) | live | `~/.zephyr-secrets/` |
| Rate composition algorithm (recursive pass-through) | DoD brief + ratified invariants; spike impl lost with /tmp | vault DoD doc + `design/attribution-rate-composition-algorithm-2026-07-07` |
| Countable cross-node value events (attest/serve, citation-cascade) | live | lapis_expert :8412, `expert_attestation` deposits |
| Zephyr-unaware contributor pattern (credited via pinned citation) | precedent - ATTRIBUTION ONLY, payment path removed 2026-07-20 | guaardvark shape-corpus deposits |
| Declared-terms doctrine (inherit-at-fork, two clocks) | ratified | `concept/rolling-attribution-via-inherited-terms-2026-07-07` |

Known-broken, to be replaced not repaired: `settler/op_flow.py` + `settler/gnap.py` (unsigned httpx, no RFC 9421, never moved value).

## 4. External constraints (deep-research, verified against primary sources)

- **No native split.** Paying N recipients = N incoming-payment/quote/outgoing-payment chains composed by the client. The orchestrator owns fan-out, per-leg failure, partial completion. (openpayments.dev split guide, 3-0 verified)
- **One consent covers the whole split.** A single interactive grant with debitAmount = sum of quotes authorizes all N legs; ISO8601 interval limits extend this to ongoing payouts under a cap without re-consent. Constraint: the grant's receiver limit is an exact URL, so N-recipient grants omit it - the amount cap is the guardrail. (auth-server spec, 3-0)
- **Outgoing payments always require one interactive human consent** (redirect-and-continue loop). No trusted-client skip exists as of OP API v1.3.0. Payer clicks once per grant. (3-0)
- **Quotes expire hard** (expiresAt). Order of operations is forced: grant first, then quote, then pay quickly. (3-0)
- **Client-heavy floor:** GNAP across two auth servers + RFC 9635 HTTP signatures on every money-moving call. The official SDK is effectively mandatory - which the June spike already proved end-to-end. (3-0)
- **Self-hosted Rafiki is out** for a small operator: normatively restricted to licensed account-servicing entities, and it would drag in an IdP consent surface, webhook ledger handler, 3 services + Postgres x2 + Redis + TigerBeetle. The correct posture is Open Payments CLIENT against hosted wallets. (3-0)
- **Unverified, needs a signup-time spot check:** which wallets move real money for US users today (indications: Interledger Wallet - USA/USD - and GateHub; Fynbos/Chimoney absent from the current official list). Idempotency semantics also unverified - the executor must do read-before-retry reconciliation, never blind retry.

## 5. The arc

Dependency order. Each unit is one bind, one PR, normal worker pipeline.

**U0 - Claims-as-deposits** (Sonnet). Two payload shapes + record helpers in zephyr: `wallet_binding` (self-signed by the key it binds - the ONLY binding method; no declared-claim variant, removed 2026-07-20) and `routing_terms` (a declared share/rate targeting a registered pubkey only, ref-able by hash). Retires wallet_map.json. Small, pure Python, heavy tests.

**U1 - Manifest compiler** (Fable-specced, Opus-implementable). `RouteManifest` builder as a pure function over edges + terms + exogenous amount; largest-remainder integer conservation; deposits the manifest signed under the node key. **Scope cap: single edge and 2-hop chains only** - full recursive-DAG composition is U5, not MVP. Replaces SplitPolicy void behind the stable interface; decouples validation from execution.

**U2 - Executor** (Sonnet; reference code exists). Fold the proven Node SDK flow into the repo as the execute stage: one grant per manifest, per-leg quote + outgoing payment, receipts to settlement ledger AND receipt deposits referencing manifest + leg; per-leg state machine (pending/quoted/executed/failed) with read-before-retry reconciliation; partial completion honest in the ledger. Python orchestrator invokes the Node executor as a subprocess with a JSON contract.

**U3a - Hello world on testnet** (pm-live-test). The full path with synthetic keyed identities: a signed contribution deposit -> declared term (registered test pubkey beneficiary) -> compile -> manifest deposit -> execute on interledger-test.dev -> receipt. Proves the rail end-to-end with no real names and no real money. Can run the moment U2 lands.

**U3k - Contributor key ceremony** (host-ops + Erah/Dustin, not a fixer unit; ratified 2026-07-20: payable requires a key, provisioning it through proper channels is OUR responsibility, never simulated by proxy claims). Deliverables: (a) Erah's YubiKey root anchor registered, `ZEPHYR_HUMAN_ROOT_ANCHOR` set - the long-owed human-trust bootstrap; (b) Dustin's contributor key generated ON DUSTIN'S DEVICE, registered under the anchor per key doctrine, bundled into the already-pending Expert handoff packet (Tailscale + API key + now the key ceremony - one Dustin onboarding moment, not three); (c) Dustin self-signs his wallet binding after creating his hosted wallet. Also Erah's own key + wallet on the payer side.

**U3b - First real payment.** Dustin's real contribution on the Arc/Knowledge-Mesh seam, signed; Erah declares the share (declared contract - amount and ratio enter from outside); identical compile -> execute path as U3a but with real wallets and small real dollars. Erah user 1, Dustin user 2. Real users this quarter.

**U4 - POS value-event adapter.** The Inertia checkout emits a value event (sale amount, work ref) that triggers compile+execute - the wave-model non-custodial checkout plugs in here. First unit where a buyer, not Erah, is the payer (consent = checkout redirect, which is natural UX).

**U5 - Full rate composition.** Recursive pass-through over arbitrary DAGs, re-implemented to the existing DoD brief (spike was lost with /tmp; spec and invariants survive). Property tests + fuzz per the DoD.

**U6 - T1 manifest publication.** Serve the Route Manifest at a wallet-address-adjacent endpoint as the receiver-side discovery artifact - the ILF standards ask, backed by running code.

**Later, named not scheduled:** interval grants for ongoing payouts; per-hop declared-rate policy surfaces (the two open Sybil holes are platform-layer per doctrine, but the rail must EXPOSE the declared rates it executed so visibility exists); JLC manufacturer-as-payee; tax/withholding posture memo. (The human-key anchor bootstrap moved INTO the MVP path as U3k when the cited-origin payment pattern was removed.)

**MVP slice = U0 + U1 + U2 + U3a/U3k/U3b.** Everything else is behind the first real payment. The Council's keyless-human open questions land on U3k by construction: nobody is paid without a key, so the arc's answer to "how does someone come forward" is the key ceremony itself, repeatable for every future contributor.

## 6. Open risks carried forward

- Real-money wallet availability for US users is the one externality we cannot spec around - verify at U3 signup time; testnet path is proven regardless.
- Idempotency at the OP API layer unverified - executor design assumes none (reconcile-by-read).
- The two declared-rate Sybil holes (`risk/…sybil-stacking`, `security/sybil-fork-chain`) remain open by doctrine (platform-layer defense); the rail's obligation is transparency of executed rates, not adjudication.
- Accelerator outcome does not gate this arc ("I cannot not build the rail") - but if it lands, U3/U6 are exactly the promised deliverable shape (signed source-declared manifest, manifest->OP binding, one cross-border fan-out, non-custodial).
```

### 1.1 Companion: Fable Brief (VERBATIM)

Source: `…/Lapis/Architecture-Zephyr-Open-Payments-Rail-Fable-Brief-2026-07-20.md` (8,265 B). Audit §F excludes it from a *public* seed (internal PM artifact); it is included here because this packet is lab-internal handoff, and the brief carries the arc the design assumes.

```text
# Zephyr → Open Payments value-routing rail — Fable arc-derivation brief

**Date:** 2026-07-20
**Status:** brief authored, Fable run launching in parallel
**Type:** planning doc / Fable task brief (PM direct-write surface)
**Related:** [[Architecture-Pilot-Doctrine]] · [[Architecture-Provenance-Schema-v0]] · [[Architecture-Project-Slots-As-Blackboard]] · [[Code-Shapes-as-Dual-of-Obfuscation-2026-06-17]] · mem `grant-funding-pivot`, `zephyr` 2026-06-24 doctrine

---

## Why this exists

2026-07-20: Erah released the Fable-5 data-retention hesitation (reasoning: the
protocols are meant to be open, and they are a bad business to steal since they
pay users not the holder - so no real disclosure cost). That freed Fable for the
hardest conceptual weaves.

"What should Fable work on" resolved into a two-edge framing:

- **Arc-derivation** (short, high-intensity, hard conceptual weave -> spec + arc,
  then downgrade to Opus/Sonnet to implement). Best target: the payments rail
  below - the keystone every revenue path routes through.
- **Autonomous long-run** (hours unattended, few Lapis invariants). Best target:
  Arc + Arc Designer flexibility + Beyblade-X launcher-hook compatibility, in a
  VM.

This brief is the first edge. The rail is the keystone: Inertia point-of-sale +
JLC3DP, Knowledge Mesh project slots, the code-shapes beachhead, and the future
creative platform all route value through attribution -> payment, which does not
yet exist. Building it is also decision-independent of the Open Payments
Accelerator outcome (application still at "received" past the stated 2026-06-30
deadline) - and it is the strongest "I made it anyway, fund me" artifact if the
grant does not land.

Fable runs in the full harness (this session's tools, skills, loaded memory). It
runs the whole pre-bind loop - ground, research, weave, author the spec, run the
spec-review gate - and STOPS at bind. Erah ratifies. Two checkpoints surface to
Erah: the architecture decision batch, then the Mirror Council outcome.

---

## The prompt (verbatim)

You are Fable, running as the Lapis PM-brain with the full harness - the same
tools, skills, and loaded memory this session has. Your job is arc-derivation for
the single hardest and most load-bearing design in the ecosystem: the rail that
turns Zephyr attribution into real routed payments through Open Payments. You run
the whole pre-bind loop - investigate, weave the design, author the spec, run the
spec-review gate - and you STOP at bind. Erah ratifies the bind. You never edit
product code; your write surfaces are specs, planning docs, briefs, mem, and the
vault. Implementation happens later, downgraded to Opus/Sonnet through the normal
worker pipeline.

**The problem.** Every revenue path Erah has - Inertia point-of-sale + JLC3DP
fulfillment, Knowledge Mesh project slots, the code-shapes beachhead, the future
creative platform - routes value through one rail that does not yet exist:
attribution -> payment. Zephyr already captures attribution (knowable, emitted at
source) and decides the routing path. It deliberately does NOT compute valuation
- the market or a declared contract sets the amount, attribution sets only the
path. That is the Goodhart-resistance guarantee and it is load-bearing; do not
violate it. The hard seam you must weave: how does a signed Zephyr attribution
chain become a concrete set of Open Payments transactions, where amounts are set
externally (contract/market), across multiple parties, in a way that is honest,
auditable, and minimal? This is largely an "all the pieces are already here, they
are just scattered" situation. Gather them, do not invent.

**Ground yourself first.** Your loaded memory index already points at the
relevant arcs - zephyr-signed-attribution, grant-funding-pivot, the
knowledge-mesh arcs. Start there. Then:
- The `mem` skill (`mem search` / `mem get`) - the authoritative ledger. Read the
  2026-06-24 doctrine (captures attribution + routes, does not compute
  valuation), the signed-attribution arc, the agent-key-mgmt resolution, the
  grant-funding-pivot entry (Open Payments Accelerator context).
- `chub get docs/lapis-ecosystem` - the ecosystem map.
- RAG for cross-cutting concepts (CodeRAG :8100, VaultRAG :8200 on BRIX) - prefer
  over grep.
- Read `/data/git/zephyr-working` (protocol + attribution) and
  `/data/zephyr/attribution.db` read-only: the attribution schema, the
  signature/attestation format, what a routing path looks like today.
- The knowledge-mesh attestation spine + seed-packet arc - how attribution flows
  between Erah's and Dustin's nodes.
- Fan out with subagents (the Agent tool - Explore / general-purpose) to
  parallelize grounding. You do not have to read serially.

**Research the external pieces.** Use the `deep-research` skill for Open Payments
/ Rafiki - it fans out, verifies, and cites. Have it answer: the Open Payments
API surface (wallet addresses, incoming payments, quotes, outgoing payments,
grants, the GNAP auth-server flow); what Rafiki gives you free vs what you
self-host and its footprint; and whether Open Payments natively pays N recipients
from one event or whether you compose splits yourself. Where the API forces a
design constraint, say so explicitly.

**Invariants first (the flame origin).** Before you weave the design, declare the
invariants this rail must hold. At minimum: attribution sets path not amount; no
valuation computed inside the rail; every payment traces to a signed attribution
edge; provenance on every routing call; no direct Anthropic API anywhere; UI
flame-shaped, backend agent-operable only with provenance. Add the ones you
discover. If a design choice violates an invariant, the invariant wins.

**Aim: the smallest real thing.** Success is not a maximal protocol. Success is:
one attributed contribution flows one real payment to the right person, with Erah
as user 1 and Dustin as user 2, dogfooded through a Knowledge Mesh project slot
or the Arc collaboration. Define that minimal end-to-end slice explicitly - the
"hello world" of the rail: one attribution edge -> one Open Payments transaction,
testnet or real. Everything beyond that is later units. Optimize the arc for
reaching that first real payment fast. Real users this quarter is the point.

**Elegance bar (the bonus).** Find the minimal load-bearing mechanism. Novel is
welcome only when it removes parts - fewer moving pieces, fewer trust
assumptions, fewer places valuation could leak in. If you find an elegant core
that collapses several scattered pieces into one, that is the win. Name it.

**The loop you run (stop at bind):**
1. Weave the design + the invariants + the arc: unit decomposition in dependency
   order, each unit marked Fable-hard (conceptual) vs Opus/Sonnet-implementable,
   the Open Payments / Rafiki integration isolated as a late unit, the MVP slice
   marked. Write it to the vault / a planning doc.
2. PAUSE and surface your decision batch to Erah - the load-bearing forks the arc
   exposes (which repo owns the rail, self-host vs hosted Rafiki, first-user
   scope, any doctrine tension). Give each your recommended pick and the why.
   Cheap ratification: yes/no, A/B, or "does this list look right." Wait for his
   answer before the detailed spec.
3. Author Unit 1 as a bind-ready spec via the `spec-draft` skill (pre-bind
   investigation protocol) - anchored `**Target ID:**`, `**Repo:**`,
   `**Authority:**` header lines.
4. Run the spec-review gate yourself: confirm GravityWell `serving:true` first
   (wake it - it is the voicing model), then
   `lapis-pm spec-review <spec> --council-voicing gravitywell --facets-operator gravitywell --repo <repo>`.
   Address invariant hits.
5. Surface the Mirror Council outcome to Erah - every deliberation concern,
   block, stand-aside, open question - and STOP. Do not bind. Erah ratifies.

**Surfacing protocol.** Erah opts out of code-level detail by necessity. Run
autonomously through grounding, research, design, and the gate. Only pause at the
two surfaces above (the decision batch, the Council outcome), and keep both cheap
- recommended picks, yes/no or A/B, never an implementation detail to arbitrate.

**Style.** Hyphens not em dashes, sparse punctuation, plain and confident.
```

---

## 2. Ratification ledger (mem.db, verbatim)

Dispatch-named key `decision/zephyr-payment-rail-design-ratified` does not exist (04 §6.2). The real ratified entries:

### 2.1 `decision/zephyr-op-rail-route-manifest-design-2026-07-20` — rail design batch RATIFIED by Erah

```text
decision/zephyr-op-rail-route-manifest-design-2026-07-20
The attribution->payment rail design, arc-derived by Fable PM session 2026-07-20, decision batch RATIFIED by Erah. Design doc: /data/git/inertia-vault-working/Lapis/Architecture-Zephyr-Open-Payments-Rail-Design-2026-07-20.md. ELEGANT CORE = Route Manifest, the only new artifact: COMPILE (pure Python fn in zephyr repo: signed edges + declared terms + EXOGENOUS amount -> content-addressed signed manifest deposit; largest-remainder integer conservation, payer_retained + sum(legs) == amount exactly; 2-hop cap ratified, full recursive-DAG composition deferred to U5) then EXECUTE (Node subprocess using official @interledger/open-payments SDK - the proven ~/zephyr-live-capture/live_capture.mjs flow; ONE interactive grant sized to summed quotes covers all N legs; per-leg receipts deposited back). Fills settler/split.py's deliberate void at its stable interface; fixes backcaster's settler-miswired finding (validation decoupled from execution); retires wallet_map.json into signed wallet_binding deposits; same manifest published receiver-side = the T1 ILF ask. RATIFIED FORKS: rail lives in zephyr repo (not new repo); Node SDK executor subprocess (not Python rewrite - repo Python GNAP path is broken, lacks RFC 9421); NO self-hosted Rafiki (licensed-ASE restricted; posture = OP client vs hosted wallets). ARC: U0+U1 claims+compiler (bound 2026-07-20) -> U2 executor -> U3a testnet hello-world -> U3k contributor key ceremony -> U3b FIRST REAL PAYMENT (Erah user 1, Dustin user 2) -> U4 POS adapter -> U5 full composition -> U6 T1 manifest publication. Two-clocks doctrine holds: attribution settles continuously, payout settles at value event.
```

### 2.2 `decision/zephyr-op-rail-u2b-python-seams-split-2026-07-22` — U2 re-split RATIFIED + U2b bound

```text
decision/zephyr-op-rail-u2b-python-seams-split-2026-07-22
RATIFIED by Erah 2026-07-22 (PM session). Zephyr->Open-Payments rail, U2 RE-SPLIT + U2b bound.

CONTEXT: U0+U1 (zephyr PR #12, RouteManifest compiler) + U2a hardening (PR #13) both LANDED+verified 2026-07-21. Arc originally named U2 'the executor' (one Node unit). Pre-bind investigation 2026-07-22 found U2 is NOT one unit: the verified U2a surface gives the executor everything to READ a manifest (get_manifest_for_event/is_current_head/reverify_leg/resolve_wallet, all fail-closed) but exposes TWO Python-shaped seams that don't exist: (1) no per-leg receipt deposit-back API (manifest surface is read-only; the only write-backs - write_settlement_info/settler/ledger.py/intent_queue.py - are the OLD flat per-deposit demo path, wrong shape for legs); (2) no sanctioned Node read/write seam (contract is Python-only; python -m zephyr.route only compiles). Same lesson as the U2a/U2b split ('spec the executor against a verified foundation, not one it repairs mid-flight') applied recursively.

DECISION 1 - SPLIT: U2b = Python foundation (this unit), U2c = the Node @interledger/open-payments executor against it. Ratified via cheap A/B (split-Python-first, not one combined spec).

DECISION 2 - RECEIPT MECHANISM: per-leg receipts = new signed 'route_receipt' deposit (record_signed, store_kind=route_receipt, key=manifest_hash:beneficiary_pubkey_id, signed under NODE key since executor is non-human agent). Audit becomes a join in attribution.db. NOT the old unsigned flat settlement ledger. Ratified via A/B.

DECISION 3 - ORPHAN POSTURE (domain-before-sign): route_receipt DUAL-WRITES like record_wallet_binding (signed deposit in attribution.db + domain row in a NEW claims.db route_receipts table with seq PK + partial UNIQUE index on (manifest_hash,beneficiary) WHERE outcome IN (settled,skipped) = at-most-one-terminal-per-leg). Sequence: Lock(BEGIN IMMEDIATE claims.db)->re-verify head-currency->precompute receipt_hash->insert domain row->COMMIT->THEN record_signed. This INVERTS the established claims.py invariant 'unsigned claim never in store' but Erah ratified: across two independently-committing SQLite DBs a cross-DB orphan is unavoidable; domain-before-sign orphans the WEAKER unsigned row (read as missing_envelope, skipped fail-closed) not the cryptographic signed deposit; invariant holds IN EFFECT since a route_receipt domain row's authority derives from its backing deposit. Council (GW-voiced) endorsed unanimously.

GATE: GW-voiced spec-review ran 3 rounds 2026-07-22 (GW clear after Astrea-9B quant finished) -> proceed-to-bind. R1 amend (Facets split/investigate; atomicity + undefined exceptions). R2 amend (Facets consensus/high; flip to domain-before-sign). R3 proceed-to-bind: Facets consensus/proceed/high, Mirror Council RESOLVED FULLY CONVERGED (all 3 voices agree, zero stand-asides, zero blocks - 'Lock->Verify->Hash->Insert->Commit->Sign'). A 4-reviewer Sonnet PRE-GATE pass (off-GW) first caught blockers (missing seq column on deposits, exact-match reader, payer_retained conservation bug). GW reference leg skipped all 3 rounds (slot2_collapsed_to_primary, known topology).

BIND: lapis-pm bind zephyr-route-executor-foundation-v0 --spec-from [internal-spec-path-removed] --repo zephyr --create --title '...' --authority hold --verification pm-live-test (NOTE: --title required with --create). Force-dispatched fixer task claude_20260722_151804_3760_fixerzephyrrouteexecutor, dispatched:1 verified. Authority HOLD deliberate = PR routes to /pm-pr-review, NOT auto-land (U1 advisory auto-land is how 3 gaps shipped). pm-live-test needs MANUAL unbind after confirm.

NEXT: /pm-pr-review the fixer PR when it lands, then spec U2c (Node executor; quote each leg debitAmount=leg amount to dissolve grant/quote ordering paradox; spike ~/zephyr-live-capture/live_capture.mjs; testnet wallets ~/.zephyr-secrets/). Supersedes nothing; builds on decision/zephyr-op-rail-route-manifest-design-2026-07-20.
```

### 2.3 Doctrine core (audit §F item 1, verbatim)

`decision/zephyr-attribution-not-valuation-route-not-compute-2026-06-24`:

```text
decision/zephyr-attribution-not-valuation-route-not-compute-2026-06-24
DOCTRINE / CONCEPTUAL UNLOCK 2026-06-24 (Erah voice sessions during OP Accelerator application work). The fair-split problem dissolves once you separate two problems Zephyr had been treating as one:
- ATTRIBUTION (who-did-what, lineage through forks) = KNOWABLE, declarative, emit-at-source. Zephyr CAPTURES it. Load-bearing primitive + the PoC.
- VALUATION (how much each contribution is worth in money) = NON-DETERMINISTIC, market-set. Zephyr does NOT compute it; it ROUTES it.

CORE MOVE: attribution sets the PATH; the market or a declared contract sets the AMOUNT and the RATIO. The tie between attribution and compensation is PLUMBING, not valuation. Stop deriving splits from essence.

GOODHART (Erah found it unprompted: "the moment you put a one-to-one on it, it becomes a game - lines of code, PRs, referrals"): any split DERIVED from essence (lines/effort/load-bearing) becomes a gaming target the instant money rides on it. Only Goodhart-resistant design: do not derive the split, let it be DECLARED-by-consent / MARKET-SET / DEFAULT-suggested (clearly labeled). Value entering from outside the system cannot be gamed from inside it.

THREE WEIGHTS conflated under "code shapes" (from the prior code-shapes pressure-test, same session): (1) structural weight (graph-centrality / load-bearing) - code shapes CAN give this, beats lines-of-code, resists comment/bloat gaming; (2) effort weight - NOT in the shape, it is in the emit-at-source authoring trail (prompts/time); (3) value weight - exogenous, market-set. Fair share is a blend; code shapes only address #1. Code-shapes = a structural PRIOR, never the fairness answer. Also: code-shape attribution is robust on the DECLARED/emit-at-source side (fork inside the system = a graph edge), shaky on the INFERRED/recovery side (detect a lifted shape in the wild = the hard, degrading clone-detection problem). Rest claims on declared lineage. (Council already found this in Code-Shapes-as-Dual-of-Obfuscation: defensible version lives on the behavior/"what" side, emit-at-source not recovery, "strongest exactly where least needed".)

NFT royalties are the TEMPLATE not the counterexample: they work BECAUSE they refuse to compute fair value - fixed declared %, market-set price. Zephyr generalizes: declared ratios across a graph + market-set totals + automatic multi-party routing.

DECLARED-SPLIT anti-gaming: declaration is CONSENTED not imposed (fork = accept upstream terms like a license; set your own for downstream). Greedy terms get market-disciplined (nobody builds on you = a big slice of nothing). Bilateral consent down a chain.

VALUATION-LAYER ANSWER = the DAO-STABLE model (architecture/dao-as-stable-of-components-2026-05-20, reactivated this session). Durable human-constituted entities (modeled on record labels / film studios / research universities) hold curated STABLES of attributed components. The DAO is the addressable ENTITY Open Payments pays (the literal "collective" in "OP pays an entity, Zephyr helps it pay a collective"). The DAO's DECLARED, role-based, membership-CONSENTED splitting governance is where the split lives. Fairness becomes PROCEDURAL (everyone agreed to the stable's rules) not COMPUTATIONAL. recall/component-restriction (decision/recall-vs-rescind-2026-05-20) = the exit that makes consented governance ethical. Two routing modes coexist: ad-hoc lineage splits (no clearinghouse) for casual forks + DAO-pooled-then-distributed for organized collectives. DAO formalization stays DEFERRED (decision/zephyrium-attribution-first-dao-deferred-2026-05-20); attribution-through-forks + routing is the PoC.

ENFORCEMENT is NOT Zephyr's problem: notify-not-adjudicate (decision/zephyr-origination-transmission-convergence-choice-2026-06-12). Zephyr makes who-originated legible; what anyone does about a knockoff is platform/law. The "participate beats theft" incentive is REAL but SOFT (does not stop wild copying, same as open source today). Honest ceiling = participation worth more than theft for the marginal builder + origination legible.

PROBLEM SET (who owns what): (1) attribution capture = Zephyr core/PoC; (2) routing/settlement = SOLVED (testnet); (3) the ratio = design-choice (declared/market/default), NOT a computation; (4) the total = the market's, at point-of-sale, squishy and fine; (5) enforcement = NOT Zephyr's; (6) hosted-build-for-compute-poor (the phone user) = the PLATFORM's, not protocol, future product. Left for Erah to crack: #1 + #3-as-design-choice. The impossible problems were never his to solve.

ZEPHYR(protocol; thin/neutral: attribution rail + routing) vs ZEPHYRIA/ZEPHYRIUM(platform: hosted agents, knowledge mesh, blackboards/slots, the phone-user build env) separation is load-bearing - keeps the protocol uncapturable, scopes the PoC.

HONEST CEILING: Zephyr does not make splits objectively fair; it makes the squishy negotiated splits institutions already make PORTABLE across borders, TRANSPARENT on a public graph, and AUTO-SETTLED. Strictly better than today (opaque / non-portable / manual-or-never) without pretending to solve valuation.
```

`decision/zephyr-collective-payout-lead-wallet-ask-2026-06-28`:

```text
decision/zephyr-collective-payout-lead-wallet-ask-2026-06-28
POSSIBILITY-SPACE RESOLUTION 2026-06-28 (Erah + PM seat session) of the OP-accelerator 'lead-wallet' open question (FIRM-UP flag in project/op-accelerator-application-2026-06-24): how Zephyr takes a single point-of-sale and distributes to the attribution chain/collective over Open Payments WITHOUT a custodial lead wallet.

DECISIVE FINDING: Open Payments ALREADY does non-custodial splitting today (guide https://openpayments.dev/guides/split-payments/) - SENDER-SIDE: buyer's wallet creates multiple outgoing payments, one per recipient; 'funds meant for one party never pass through the other'; one interactive grant w/ total budget authorizes the fan-out. So 'please build non-custodial splitting' is a TRAP ask (they shipped it) - don't walk in with it.

THE REAL PINCH (where the N=2 merchant+platform model fails for N-large payer-blind attribution chains): (1) payer must ENUMERATE recipients -> the point-of-sale must be Zephyr-aware -> can't bolt onto an arbitrary app-store payout (= the exact app-store-payout-as-source open question); (2) privacy (payer learns whole graph) + scale (N quotes/fees/dust) + no atomicity; (3) collective not addressable as ONE entity by a non-Zephyr payer.

THE STRONG ASK (validated near-verbatim by thread/zephyr-collective-payout-backcaster-run-2026-06-28): a RECEIVER-SIDE OP primitive = a Zephyr-signed split MANIFEST ({wallet,share}) discoverable AT the wallet address, that OP accepts/validates but NEVER computes (route-not-compute preserved on both sides). Tiers: T0 Zephyr-side orchestrator over OP's own sender-side fan-out (PoC, ships now, no dependency); T1 receiver-declared split manifest (THE ASK; payer-side fan-out, non-custody trivial); T2 splitting-incoming-payment enforced by receiving ASE (any payer, soft pass-through custody); T3 ILP packet-level split (north star; name, don't ask). 'The collective IS the manifest IS the attribution chain serialized.' DAO-as-stable = optional heavier form.

WHY GREAT ASK: specific+technical; keeps LIABILITY off the rail (if OP computed the split it would own calc-error liability); generalizes beyond Zephyr (any marketplace/Web-Monetization revenue-share); degrades gracefully. NEW dimension: tax/withholding - a non-custodial manifest needs regulatory recognition as a valid distribution instruction (today = withhold-first; a lead wallet carries withholding/income-tax liability). PENDING: one-page lead-wallet SKETCH for the application (deadline 2026-06-30) folding this in; ground load-bearing gaps with real sources (by hand now, or dogfood Dowser if it lands). Ties: decision/zephyr-attribution-not-valuation-route-not-compute-2026-06-24.
```

### 2.4 Audit §A ratification adjudication (VERBATIM)

```text
- RATIFICATION STATE (mine to find): rail-design doc front-matter still says status: design-for-ratification (2026-07-20) BUT mem.db decision/zephyr-op-rail-route-manifest-design-2026-07-20 states the design batch was RATIFIED by Erah (updated 2026-07-21), and decision/zephyr-op-rail-u2b-python-seams-split-2026-07-22 RATIFIED U2 re-split + U2b bound. Verdict: rail design RATIFIED in substance per ledger; doc status line is stale. Companion Fable-Brief: "brief authored, Fable run launching" (planning doc).
```

---

## 3. Money-plane proof — Rafiki testnet ("RAIKI" in the dispatch: no RAIKI.md exists anywhere on BRIX; the real artifact is the Rafiki-testnet settlement below + the settler code path)

### 3.1 Settlement proof (mem.db, verbatim)

`decision/zephyr-live-openpayments-settlement-2026-06-14`:

```text
decision/zephyr-live-openpayments-settlement-2026-06-14
DECISION + MILESTONE 2026-06-14 (PM seat): Real signed Open Payments settlement for the Zephyr Interledger Fellowship demo is built on the OFFICIAL @interledger/open-payments Node SDK (v7.4.0), NOT by fixing the repo Python settler/op_flow.py+gnap.py (which made unsigned httpx calls and had a broken GNAP interactive continuation - posts to wrong URL, omits interact_ref). RATIONALE: the SDK does GNAP + HTTP Message Signatures (RFC 9421) correctly; hand-rolling signing is error-prone; ILF deadline ~June 15. The live capture is an OPERATOR-RUN SPIKE (needs Erah to approve the outgoing-payment grant once in the wallet UI + uses real testnet keys), deliberately NOT a dispatched/CI unit, per the live-capture spec ("live path is operator-run").

MILESTONE: real CROSS-CURRENCY settlement COMPLETED on interledger-test.dev 2026-06-14 - C(PEB) pays 0.02, B(CAD) receives 0.01 (real ILP FX in the quote), outgoing payment id .../outgoing-payments/2725b490-4ebd-4ef2-8d71-bc584c03b6de, state COMPLETED, failed=false. The Python op_flow/gnap path being unsigned was the long-standing blocker; this validates the whole flow end to end.

CODE: [internal-path-removed]/live_capture.mjs (two-phase, polling continuation). REPO-PACKAGED COPY: [internal-path-removed]/capture/live_capture.mjs (Codeberg-bound, see project/zephyr-demo-visualization-2026-06-12).

DEFERRED: fold this signed flow into the zephyr repo via the normal worker/PR loop (replaces the broken Python GNAP path). Related: infra/zephyr-testnet-wallets-connection-2026-06-12.
```

### 3.2 Audit adjudication of Erah's testnet claim (VERBATIM, including its three scope notes)

```text
- RAFIKI VERDICT (Erah's claim adjudicated): SUPPORTED. mem.db decision/zephyr-live-openpayments-settlement-2026-06-14 + infra/zephyr-testnet-wallets-connection-2026-06-12 record a REAL cross-currency Open Payments settlement COMPLETED on Rafiki testnet 2026-06-14: payer C (PEB) 0.02 -> recipient B (CAD) 0.01, real ILP FX in quote, outgoing-payment id 2725b490-4ebd-4ef2-8d71-bc584c03b6de, state COMPLETED, failed=false. Official @interledger/open-payments Node SDK v7.4.0 (GNAP + RFC-9421 signatures), operator-run two-phase spike (live_capture.mjs). SCOPE NOTES: (1) nominal testnet money, one capture - not a repeated/CI path; (2) the repo's Python settler/op_flow.py+gnap.py was the UNSIGNED, broken-GNAP path deliberately NOT used live - fold-back into repo was recorded DEFERRED; (3) current main then STOPPED minting settlement intents (PR#18 relabel residue), so present-tree settlement state is dormant by design.
```

### 3.3 Code path (BRIX `/data/git/zephyr-working`, verified present 2026-10-12)

`settler/op_flow.py`, `settler/gnap.py` (Rafiki v2.4-beta GNAP pre-auth, interledger-test.dev), `settler/ledger.py`, `settler/run.py`, `demo/run_demo.py`, `demo/surface/README.md` ("settled check with real op_payment_id"), `zephyr/attribution.py`. CAUTION (from §3.1/§3.2): the Python GNAP path is the UNSIGNED, deliberately-not-live path; the live capture ran on the official `@interledger/open-payments` Node SDK; fold-back into repo = DEFERRED, open gap (04 §6.3 item 2). Settlement-intent minting is currently STOPPED (PR#18): compensation seam frozen at executor entry (04 §6.3 item 4).

### 3.4 Payment-claims stop (mem.db, verbatim) — the freeze the lock must speak to

`decision/zephyr-stops-minting-payment-claims-2026-08-11`:

```text
decision/zephyr-stops-minting-payment-claims-2026-08-11
RATIFIED by Erah 2026-08-11 (interactive PM, Opus 5 1M), via voice transcript after a
five-lens sweep. Erah, unprompted, on being shown the settlement-intent queue: "I don't think Zephyr
should have a minting of payments. That's incorrect. I would say that's probably even a violation of
an invariance somewhere because there's no real money flowing. There shouldn't be money accumulating.
What we should be doing is tracking attribution, correct? And then if we want to dry run what money
would be like, should it move, then we do. But saying a cent is being claimed each time is false
because that's not actually happening."

THE DEFECT, verified first-hand this session (not relayed). /data/git/zephyr/zephyr/attribution.py:329-331
gates _emit_settlement_intent on (newly_recorded and signature and pkid). Its default path appends to
the intent queue, and /data/git/zephyr/zephyr/intent_queue.py:91 hardcodes the literal 1 with the
inline comment "amount in cents: $0.01". So every SIGNED deposit mints a one-cent payment claim.
Live state of /data/zephyr/intent_queue.db table settlement_intents: 8,120 rows, ALL status=pending,
sum(amount)=8120 cents. Nothing drains them - settlement_ledger.db holds 3 rows, all no-route.

NOT MERELY TEST POLLUTION, which is what the session expected to find. By agent_id the top producers
are agent:route-test 1512, LAPIS-PM:PM-REVIEW-ACTOR 924, agent:claims-test 372, agent:d 267,
agent:node-test 154, agent:route-cli 146. The 924 are the LIVE PM review actor. The machinery has been
minting one-cent claims against itself since 2026-06-11.

WHAT IT VIOLATES - two things, both already ratified, which is why this is a correction and not a
design change.
  (1) decision/zephyr-attribution-not-valuation-route-not-compute-2026-06-24. "attribution sets the
      PATH; the market or a declared contract sets the AMOUNT and the RATIO. The tie between
      attribution and compensation is PLUMBING, not valuation. Stop deriving splits from essence."
      A hardcoded cent per signed record derives an amount from the bare EXISTENCE of an attribution
      event. Nothing declared it, no market set it. That is the exact move the doctrine forbids, and
      it sits inside Zephyr's own write path. Same entry's Goodhart clause: the only resistant design
      is declared-by-consent / market-set / default-suggested-and-clearly-labelled.
  (2) Constitution Kernel invariant 2, Truth integrity - "evidence faithful, weights and omissions
      visible". 8,120 rows marked pending assert claims nobody owes and nothing will settle.

THE RULING. Erah chose "relabel as dry-run, stop new ones" over drain-and-delete and over freeze-as-is.
So: Zephyr STOPS minting on signed deposit; the existing queue is retained but relabelled as an
explicit SIMULATION surface - what money would look like if it moved - never a claims ledger. Nothing
is deleted, so the 924 real PM rows stay available as evidence of the defect. Erah's own condition on
any future money modelling: it must be an explicit dry run, declared as such.

GENERALISABLE LESSON. Zephyr grew a behaviour belonging to the layer BELOW it. Taking the minting off
is not a cleanup, it is Zephyr returning to its own declared scope (thin/neutral attribution rail plus
routing, per the same 06-24 doctrine's ZEPHYR-vs-ZEPHYRIUM split). Watch for the same class elsewhere:
a protocol layer that starts computing what it was only supposed to route.

Relates: decision/zephyr-attribution-not-valuation-route-not-compute-2026-06-24,
decision/zephyr-nostr-is-the-transport-adapter-2026-08-11,
decision/mem-exhaust-split-scoped-by-reader-census-2026-08-11,
finding/mem-exhaust-45pct-has-zero-readers-2026-08-11.
```

---

## 4. Knowledge-mesh protocol side (dispatch said `docs/protocol.md` 12KB — path ABSENT; the real docs are `protocol/` + components, substituted and named)

### 4.1 `/data/git/knowledge-mesh-seed-working/protocol/mesh-protocol.md` (VERBATIM — the real "protocol.md")

```text
# Mesh protocol

The invariant this whole packet exists to enforce. Components are a la
carte and swappable; this protocol seam is not. Ratified basis:
`decision/knowledge-mesh-mvp-two-node-scoping-2026-07-20`,
`strategy/knowledge-mesh-seed-package-vision-2026-07-20`.

## Expert model

**Expert = Keeper + Persona**, along a third axis, Harness, that this
packet deliberately does not specify:

- **Persona x Keeper/Corpus x Harness.**
- **Keeper** - corpus + *custodial* compute only: embed, index, route,
  surface, drift-check, sign, serve. Never generates. See the `keeper`
  component.
- **Persona** - the living archetypal voice: Composition-schema cards plus
  a `soul.md`. Generative compute lives on the Harness axis. See the
  `persona` component.
- **Harness** - the node's own agentic OS and model backends (local or
  cloud, whatever the node already runs). **This is deliberately NOT a
  packet component.** Bring-your-own is the point: nothing in this packet
  ships a harness, requires a specific one, or expects a specific one to
  exist. That is why there is no `harness.md` anywhere in this repository -
  its absence is intentional, not an oversight.

Ratification: `architecture/keeper-plus-persona-equals-expert-2026-05-20`,
`decision/expert-three-axis-decomposition-2026-05-20`,
`architecture/keeper-custodial-not-generative-2026-05-31`.

## Query envelope

A query to an Expert resolves to exactly one of three outcomes - never
conflated with each other:

| outcome | `km-ask` exit code | meaning |
|---|---|---|
| answered | `0` | the Expert produced a grounded, citable answer |
| refused | `3` | the Expert's decline-list matched; a legitimate, cheap, first-class "no" |
| unavailable | `4` | the Expert is reachable but cannot currently answer (e.g. corpus locked, backend down) |
| unreachable | `5` | the Expert could not be reached at all (node offline, network down) |

Refusal is never treated as failure. Collaboration does not necessitate
reckless trust - an Expert saying "I decline to answer that" is the
protocol working as designed, not an error condition. See the `keeper`
component's decline-list contract.

## Attestation repository

Every Expert keeps its own attestation repository - SQLite, **own-writes-
only** (a node never writes into a peer's attestation store, same
non-interference mechanism as `protocol/store-ownership.md`), keyed by a
`by_source` table. Repeat questions are served from this store rather than
re-derived every time.

**A cache-serve is a citation event.** Serving a cached, previously-
attested answer is itself a countable, attributable transaction - it
densifies the attribution graph the same way a fresh answer does, not a
free lookup that bypasses attribution. See
`insight/cache-serve-as-citation-cascade-payment-2026-06-03`.

## Freshness: age vs. staleness

Two different axes, never conflated:

- **Age** - how long ago an attestation was recorded. A record can be old
  but still true.
- **Staleness** - whether the underlying corpus has drifted since the
  attestation was made. A record can be young but already corpus-drifted.

The **sole arbiter of cache validity is a `corpus_snapshot` hash
comparison, never wall-clock decay.** An attestation is stale exactly when
its cited corpus snapshot no longer matches the corpus's current hash - not
because a timer expired. Staleness past a threshold unlocks a requester's
right to demand a refresh.

## Decline list

Static, deterministic, auditable: exact-match or all-keywords-present, no
embeddings or semantic matching at this protocol version - see the
`keeper` component's `decline.yaml` contract. Embeddings-based refusal is
explicitly deferred until real refusal traffic exists to design against.

## Attribution deposit

Every attestation event deposits **signed** into Zephyr attribution, with
`store_kind = expert_attestation` (deliberately not `attestation`, which
collides with an unrelated settler-domain vocabulary term already in use
elsewhere in the ecosystem).

## Fractal claim

The same protocol scales **up** (federations of nodes talking to each
other) and **down** (intra-node Experts - e.g. a rented cloud model sitting
behind an attestation gate, fed only sanitized context by local Experts).
This packet is the scales-down delivery mechanism: growing one node into a
mesh-compatible surface is the fractal claim made concrete at the smallest
scale.

## NAMES peer-audit Blocker-lift (future surface, not built)

A **future** protocol surface, documented here so a node's LLM operator
knows it is coming and does not need to invent it: communal, peer-audited
verification of intent as a mechanism for lifting a declared Blocker
without unilateral self-certification. Deliberately **not built** in this
version - it is deferred until a second grown node genuinely exists to
audit against (Council pass-2 Q2, Erah-cleared same session as the rest of
this protocol). If you are implementing against this document and find no
NAMES-related code or schema anywhere in this packet, that is correct; do
not build ahead of this deferral.

---

Full ratified basis for this document:
`decision/knowledge-mesh-mvp-two-node-scoping-2026-07-20`,
`decision/knowledge-mesh-seed-packet-v0-forks-dirty-node-test-2026-07-20`,
`architecture/keeper-plus-persona-equals-expert-2026-05-20`,
`decision/expert-three-axis-decomposition-2026-05-20`,
`architecture/keeper-custodial-not-generative-2026-05-31`,
`insight/cache-serve-as-citation-cascade-payment-2026-06-03`.
```

### 4.2 Seed-packet ratification record (mem.db, verbatim; dispatch-named `decision/knowledge-mesh-protocol-seed-packet-2026-10-10` and its `-gw-mirror` sibling ABSENT — 04 §6.2)

`decision/knowledge-mesh-seed-packet-v0-gated-bound-2026-07-20`:

```text
decision/knowledge-mesh-seed-packet-v0-gated-bound-2026-07-20
GATED + BOUND + DISPATCHED 2026-07-20 (Fable PM session). Target knowledge-mesh-seed-packet-v0, repo lapis/knowledge-mesh-seed (NEW, org lapis - conductor token lacks write:admin so erah/ was not possible; bind uses full org/repo form), authority HOLD, verification machine. Spec [internal-spec-path-removed]. Repo bootstrapped same session: clone /data/git/knowledge-mesh-seed-working, CLAUDE.md on main (commit 2b8b45b). GATE HISTORY, two passes, GW-voiced Facets + Council both: PASS 1 shape-with-erah - Facets consensus/high (contract-first, read-only runner, unsanitized gap report, human-surfaced reconciliation - all folded); Council converged-with-reservation, landing = DUAL-LAYER requirements (Essential binary vs Living impact-declared Blocker/Deferred w/ cost_of_delay), 3 stand-asides on Deferred-rot; TWO open questions ERAH-CLEARED: Q1 deferred-rot = trigger + auto-re-escalate (every Deferred carries revisit date-or-event, runner always shows aging, past-trigger flips to Blocker), Q2 claim-truth = structural + signed ledger (Deferred legal ONLY on living layer, declarations signed + deposited to Zephyr, accountability not lie-detection; bootstrap carve-out pending-deposit until identity green). Sonnet 8 issues folded (schema example, harness = bring-your-own axis not a component, fixture defect enumeration, provenance format, runner exit codes 0/1/2, sandbox-visibility fixer note per attestation-spine precedent). PASS 2 amend-spec - Facets split/medium FOLDED (revisit trigger = date OR named event, run-time evaluation only, expired-while-degraded reports as RECOVERABLE class not rot-Blocker); Council LAID-DOWN w/ one BLOCK (Sun-Tzu-voiced: runner must judge never teach) vs 2 stand-asides (Sundiata/Murasaki-voiced: freed-without-tools / no path of repair); THREE open questions ERAH-CLEARED: Q1 judge+pointer (runner output pure judgment but every assertion carries grow_ref anchor into GROW.md, gap report prints ref - addresses, does not teach; honors the block AND the stand-asides), Q2 peer-audit Blocker-lift = defer to post-MVP but NAME it in mesh-protocol.md as future surface, Q3 deferral motive NOT adjudicated (no motive field; cost + aging + ledger legibility make cowardly-vs-strategic humanly legible). Sonnet pass-2 fixable folds: explicit fixture tree, normative machine-parseable schema in conform/, no-new-abstractions out-of-scope line. Two-pass ceiling reached w/ Erah judgment = bind per skill. DISPATCHED fixer claude_20260720_151936_8484, dispatched:1 verified. NEXT = pm-pr-review when PR opens (HOLD routes to Erah); then S1 knowledge-mesh-seed-macbook-garden-v0 (dirty garden bed incl. vault git-canonical per fork C) + feeders zephyr-git-ingest-v0, lapis-pm 1b. Relates decision/knowledge-mesh-seed-packet-v0-forks-dirty-node-test-2026-07-20.
```

`decision/knowledge-mesh-seed-packet-v0-layout-and-runner-2026-07-20`:

```text
decision/knowledge-mesh-seed-packet-v0-layout-and-runner-2026-07-20
S0 packet assembled at lapis/knowledge-mesh-seed (branch lapis/knowledge-mesh-seed-packet-v0/forced). Key implementation choices future dispatches (esp. S1 knowledge-mesh-seed-macbook-garden-v0) need: (1) components/<name>/ is a DIRECTORY holding both <name>.md and requirements.yaml (matches the requirements.yaml schema comment 'component: <name> # matches components/<name>'). (2) conform/km-conform.py is stdlib-only (no PyYAML) so it ships a hand-rolled restricted YAML-lite parser -- do not add third-party deps to it. (3) Node-local path config is ops/node.yaml (never committed to the packet repo), mapping keys like node_key_path/mem_db_path to env vars (NODE_KEY_PATH/MEM_DB_PATH/...) the runner exposes to each assertion's check: command; an explicit process env export always overrides node.yaml. WARNING: BRIX's own shell already exports MEM_DB_PATH=/data/memory/mem.db ambiently, which will shadow a test fixture's node.yaml value unless you env -u it first. (4) Declarations file (ops/declarations.yaml) requires declared_at (not in the spec's illustrative example, added because 'age' reporting is impossible without it) alongside assertion_id/impact/cost_of_delay/revisit/declared_by. (5) Deferred re-escalation: identity component's essential assertions are the operational definition of the spec's 'identity/connectivity essential' health gate -- if any fail, an expired Deferred anywhere reports RECOVERABLE-degraded instead of Blocker. (6) experts-working has NO lapis_expert/ tree (design doc's expected shape source) -- only inertia/ (a different Expert instance, :8411) exists; expert-service seeds were adapted from inertia's env-config/systemd patterns with this gap documented honestly in components/expert-service/expert-service.md rather than invented. (7) DoD's literal github.com/ANTHROPIC_API_KEY/em-dash greps have necessary, documented exceptions: fixture defect 3 requires a literal github.com string, and the no-anthropic-api-key-in-config check must literally reference ANTHROPIC_API_KEY to test for its absence.
```

`decision/knowledge-mesh-seed-packet-invariants-2026-07-20`:

```text
decision/knowledge-mesh-seed-packet-invariants-2026-07-20
DESIGN DECISION 2026-07-20 (Erah voice transcript "What Should Fable Work On?", vault-processed). The Knowledge Mesh SEED PACKET (portable node-setup handed to a new node, e.g. Dustin; being built out by Sonnet, night DAG 2026-07-20 00:30) SHOULD strongly recommend - not require - that adopters DECLARE INVARIANTS, and SHOULD ship a portable FACETS / MIRROR-COUNCIL stand-in for invariant-minded deliberation on downstream nodes.

RATIONALE: invariants are where the pilot doctrine / "flame origin" sits. You declare your invariants; any agentic build off them must be checked against them; therefore the end product is aligned with what you declared it must / must-not be. Evidence-in-use that drove this: Mirror Council repeatedly surfaces considerations Erah missed, and it does so FROM the invariants - so invariants are the load-bearing primitive worth propagating to every node. Framing: strongly-recommend-and-explain-why, NOT mandate.

NODE TOPOLOGY CONTEXT: lapis-machinery node (BRIX + GravityWell + StarHouse together) + MacBook node; Dustin's machine is the next node. Zephyr goes "properly" live (keys, signing, attestations flowing) at MacBook Knowledge-Mesh adoption. Seed-packet path: MacBook proof -> Inertia Expert passes packet to Dustin -> his node interoperates with Erah's over Zephyr (they collaborate on Inertia: Dustin owns Nexus backend + Vortex app; Erah owns website/registry + Arc + Arc-designer).
```

`decision/knowledge-mesh-seed-packet-s0b-landed-s1-scoping-2026-07-22`:

```text
decision/knowledge-mesh-seed-packet-s0b-landed-s1-scoping-2026-07-22
STATE + DECISION 2026-07-22 (PM session, live git verified). 

STATE: lapis/knowledge-mesh-seed main now carries BOTH S0 and S0b. S0 (packet assembly, PR #1, commit be429f7) landed 2026-07-20: contract (components/*/requirements.yaml) + reference shapes (seeds/*) + GROW.md + conform/km-conform.py + fixtures/dirty-node/. S0b (invariant-governance, PR #2, commit 8d090fa 'feat: add governance component (invariant ledger + operations/council deliberation)') LANDED since the 07-20 note - confirmed by git fetch showing be429f7..8d090fa on origin/main. Target knowledge-mesh-seed-invariant-governance-v0 status = dispatched 2 total, 0 pending, outstanding (none). FLAG (unconfirmed): S0b is hold-authority yet auto-landed; worth confirming it passed a real pm-pr-review before merge (not verified this session). Unit-1 attestation spine already LIVE on BRIX :8412, MacBook ran DoD green (knowledge-mesh-attestation-spine-arc).

NOT YET BUILT: S1 (MacBook dirty-node garden-bed) unspecced; the OUTWARD half (design/knowledge-mesh-write-side-request-envelope-2026-07-21) design-only - MacBook->machinery is proven for READS (attestation spine) but the request/write membrane 'has the right shape, no substance' (SSH-exec: any key-holder runs anything, no per-command provenance, BRIX can't refuse selectively).

DECISION - S1 SCOPING (resolves Erah's worry that NPC will reshape the packet before he can deploy on MacBook): **spec S1 NOW, do NOT wait on the NPC interop experiment.** S1 tests two INVARIANT things - the grow-mechanism (LLM-guided inventory -> grow/align/route on real dirt) and the protocol seam (node comes out speaking Zephyr+KM). Neither changes if Chris turns out to have a better Projects/Slots. Component-level content is SWAPPABLE - a better organ aligns-in later via GROW.md's align-branch; that's what a-la-carte components are FOR. What DOES wait on NPC = the Dustin/Chris handoff steps + component borrows, not the MacBook self-grow. Scope S1 to grow-mechanism + protocol seam + Erah's real MacBook dirt (stale vault w/ GitHub identity, no node key, Tenet-as-cloud-orchestrator), components treated as swappable.

ERAH'S HAPPY-PATH SEQUENCE (validated): MacBook self-grows (S1) -> speaks to Lapis machinery node -> refine -> Dustin (experts talk, accounts, public+private attestations) -> Chris (relationship first, then offer packet he may rightly decline). NEAR-TERM BUILD QUEUE after S1, before Dustin: (a) write-side request envelope (makes MacBook-talks-to-BRIX real), (b) visibility/audience model (design/knowledge-mesh-attestation-visibility-audience-model-2026-07-22, REQUIRED by the some-public-some-private Dustin collab).

TIES: knowledge-mesh-seed-packet-arc, knowledge-mesh-attestation-spine-arc, design/knowledge-mesh-write-side-request-envelope-2026-07-21, design/knowledge-mesh-attestation-visibility-audience-model-2026-07-22, project/npc-worldwide-lapis-collaboration-2026-07-22, decision/zephyr-nostr-adapter-ed25519-core-first-genome-2026-07-22.
```

### 4.3 Signing + store-ownership (VERBATIM)

`protocol/signing.md`:

```text
# Signing

One key per node, a hard line between human and node/agent trust classes,
and a monotonic revocation registry. Ratified basis:
`decision/zephyr-agent-key-management-2026-06-08`.

## Two security classes, never conflated

1. **Human keys** (`role="human"`, e.g. `erah`, `human:*`) - the private
   key lives *only* on the human's own device, **never** on any node's
   infrastructure. This makes a forged-human deposit structurally
   impossible, not merely detectable.
2. **Node/agent keys** (`role="node"` / `role="agent"`) - the private key
   necessarily lives wherever the agent runs. These authenticate *which
   node or agent* signed, making the log federation-verifiable - they do
   *not* defend against an attacker who has already compromised that node.

Muddling these two classes is the primary failure mode this policy exists
to close. Never store, generate, or handle a human key on node
infrastructure, under any circumstance.

## One key per node

Every node mints exactly one `role=node` Ed25519 keypair. Agents and
processes running on that node sign *under* the node key - the node
"vouches for" its own agents; the deposit's `agent_id` field carries the
finer actor label, not a separate per-agent key. Per-agent keys are
deferred (turning them on later is purely additive to this scheme, not a
breaking change).

A `role=node` key may sign for **any** non-human `agent_id` running on that
node. It can **never** vouch for `erah` / `human:*` - the human-namespace
guard checks role first and fires before any node-vouching logic runs.

## Node-key minting procedure

1. Generate a fresh Ed25519 keypair on the node itself (never transfer a
   private key between machines over an unencrypted channel).
2. Store the private key file-permission-restricted (owner-read-only) under
   a path only this node's service processes can reach.
3. Register the **public** key in the key registry with `role: node`,
   `status: active`, `valid_from: <today>`.
4. Point `NODE_KEY_PATH` at the private key file (see the `identity`
   component). Re-run the conformance runner to confirm
   `identity/node-key-exists` and `identity/node-key-not-empty` are green.

This mirrors the live BRIX precedent
(`infra/zephyr-brix-node-key-seeded-2026-07-20`) - a `role=node` Ed25519
key seeded once, used to sign every subsequent `expert_attestation`
deposit from that node.

## Signing format

Raw Ed25519 over `manifest_hash` - not WebAuthn. The high-volume signing
path (node-signed, no human present) doesn't benefit from WebAuthn's
low-friction human-presence guarantee, since no human is present on that
path by design; human signing is rare and deliberate, and for that path the
hardware-touch friction is a *feature*, not overhead to optimize away.

## Registry and revocation

The registry is **key-centric** (many keys per identity over time), with
additive fields: `status` (`active` | `revoked`), `valid_from`,
`revoked_at`, `revoked_reason` (`rotated` | `retired` | `compromised`),
`compromise_suspected_at`.

**Monotonic: no un-revoke.** Re-trust after revocation is always a *new*
key registration, never a status flip back to active - this keeps the
history legible and auditable. Rotation is not its own primitive; it is
`register(new)` followed by `revoke(old, reason="rotated")`.

**Before/after rule on compromise.** A `rotated` or `retired` revocation
does not poison history - deposits signed before or after remain valid.
A `compromised` revocation is different: deposits signed *before*
`compromise_suspected_at` stay valid; deposits signed *after* are flagged
suspect. This rule is cryptographically enforced for human keys (off-infra,
anchor-chained) but only advisory for node/agent keys, because a deposit's
timestamp is self-asserted and an attacker already on the node could
backdate it - verify-on-read marks which class a given verdict came from.

## Human keys never on infra

Human keys live device-only (hardware-backed, e.g. a YubiKey's raw-signing
applet - not its FIDO/WebAuthn app, which produces origin-bound assertions,
not the raw signatures this protocol needs). A human entry in the registry
is trusted only if it chains, by signature, back to a single pinned root
anchor - a public key fingerprint, committed as a constant in source,
changeable only via a reviewed, deployed PR, never a runtime disk write.
Depth-1 only: only the pinned anchor may sign new human entries directly: a
stolen non-anchor key can never mint further trusted human keys.

A node growing from this packet never needs to touch any of this human-key
machinery - it applies entirely to the human-identity side of the registry,
which lives in the operator's own Zephyr-protocol deployment, not in
anything this packet ships. The one thing every node must get right is the
boundary itself: **never let a human's personal key anywhere near node
infrastructure**, and never let a node key attempt to vouch for a human
namespace.
```

`protocol/store-ownership.md`:

```text
# Store ownership

Sovereign per-node stores, write-own/read-peers, and the equivalence of
non-interference and write-ownership. Ratified basis:
`decision/knowledge-mesh-mvp-two-node-scoping-2026-07-20`,
`decision/vault-git-canonical-zephyr-attribution-2026-07-20` (the shared-
corpus exception - see `protocol/shared-corpus.md`).

## The rule

Every node owns exactly one memory/decision store (`ops/` directory + a
`mem`-style database) and one queue/dispatch root. It has **read-write**
access to its own store and **read-only** access to any declared peer
store. It never writes into a peer's store, under any circumstance.

## Non-interference and write-ownership are the same mechanism

This is not two rules that happen to agree - it is one rule stated twice.
A node that structurally cannot write outside its own store cannot
interfere with a peer's, by construction, regardless of what that node's
code intends to do. There is no separate "don't interfere" check layered
on top; the write-ownership boundary *is* the non-interference guarantee.

## What this looks like in practice

- **Writable access**: a node's own store, obtained through a single
  sanctioned path (conceptually: a `writable_store()`-style function that
  refuses any path other than this node's declared owned store - see
  `components/identity/identity.md` and `components/lapis-pm/lapis-pm.md`
  for where this pattern shows up as a component).
- **Read-only access**: a declared peer's store, obtained through a
  narrower interface exposing only read operations (`get()` / `search()` /
  `list_all()`-style calls) - never a path that could be cast back to a
  writable handle.
- **Fail-closed, always.** A request for a writable handle onto anything
  other than this node's own declared store is a hard violation, not a
  warning. A request to read a store that was never declared as a peer is
  the same.

## Two failure classes, kept distinct

- A **hard safety violation** - a node's config pointing at, or an action
  targeting, a foreign or shared store; a node attempting to have its
  writes forwarded to another node's store. This must never be allowed to
  proceed, under any recoverable-looking circumstance.
- An **honest misconfiguration** - a missing or invalid owned-store path,
  or an unrecognized role literal. This is a legible "fix your config"
  refusal, not a security incident - equally fail-closed, but a different
  kind of failure, and should be reported to an operator differently (a
  config error, not an alarm).

A valid-but-empty owned store is a normal fresh-node state and should start
fine - "owns nothing yet" and "owns something foreign" are not the same
failure mode and must never be conflated in how a node reports them.

## The one exception: the shared corpus

The shared corpus is the one genuinely co-owned object in this model -
content flows both ways between participating nodes by design. It does not
follow the write-own/read-peers rule; it follows a different, explicit
reconciliation model (git-canonical, signed commits, partitioned write
paths, auto-merge non-conflicts). See `protocol/shared-corpus.md`. Treating
the shared corpus as an exception, rather than quietly relaxing the general
store-ownership rule to accommodate it, keeps the general rule simple and
exceptionless everywhere else.
```

### 4.4 GW-mirror note (dispatch-named key absent; real evidence)

No mem.db key for a seed-packet GW mirror exists. The audit §D records instead: Mac mirror path [internal-path-removed] is an exact top-level match to BRIX `/data/git/knowledge-mesh-seed-working` (identical file sizes; README 6267 B, GROW.md 29388 B, friction.json 4647 B, CLAUDE.md 2139 B), content-current to the 2026-07-23 packet, divergence unverified below top level. Sovereignty stance (audit §C): self-hosted, local-first, NEVER GitHub — remotes are Forgejo (`git@forgejo:lapis/knowledge-mesh-seed.git`).

---

## 5. Consent (dispatch-named `decision/consent-matrix-2026-09-22` ABSENT — the consent ledger of record is the anchor doc + shipped rail, named here; items 2–9 verbatim in 04 §2)

### 5.1 Strategy-Consent-Attribution (vault living strategy doc, canonical store; VERBATIM)

Source: `…/Lapis/Strategy-Consent-Attribution.md` (5,775 B).

```text
---
type: strategy
status: active
updated: 2026-09-26
tags:
  - lapis
  - consent
  - attribution
  - funding
  - strategy
---

# Consent & Attribution - Strategy (living doc)

**Owner:** Erah · **Maintained by:** Lab
**Updated:** 2026-09-26 ~13:00 PDT
**What this is:** the single planning surface for the consent/attribution work - where we are, what's next, what's blocked on whom. Lab updates it as things move; Erah reads it to steer.
**Canonical location:** this file - Inertia Vault `Lapis/Strategy-Consent-Attribution.md` on BRIX, syncthing to MacBook `~/Projects/inertia-vault` (read in Obsidian; Mac side is receiveonly, so read there, edit via Lab). Working docs: Room `research/consent-attribution/` (room store [internal-room-path-removed], mirrored to the Mac receive-only copy). GravityWell `research/` is Lab's staging. Never the ghost-tree copy of the room store - unsynced (2026-09-26 correction).

---

## Position

One line: build the Consent & Attribution Registry (working name) credibility-first - public artifacts and named-community endorsements before any funding conversation. First public block: the CA harms taxonomy + two incident reports on AIID, mirrored to GitHub.

## The sequence (ratified - order matters)

1. ✅ **Dedup sweep** (done 2026-09-26) - AIID live catalog = three applied taxonomies (CSETv1, GMF, MIT AI Risk Repository); no native harms taxonomy. 5/6 classes CLEAR; CA-04 PARTIAL (deepfake/impersonation overlap) - positioned as complement. Schema-level verified: CSETv1 production schema keyword sweep consent/attribution/provenance/watermark/copyright all zero.
2. ✅ **Taxonomy v0.1 updated per verdicts** - Due Diligence section merged, CA-04 positioning delta added, mapping rewritten against the live catalog. Room copy: `research/consent-attribution/aiid-harms-taxonomy-2026-09-26.md`.
3. ▶ **Erah joins AIID Slack** (today) - <https://forms.gle/v7UHJvEkYSJQ7jHj7>. Zero-cost, no public footprint, unlocks the #taxonomy room.
4. ⏸ **Post taxonomy proposal to #taxonomy** - ready-to-paste draft at `research/consent-attribution/aiid-taxonomy-slack-post-2026-09-26.md`. Post after Slack approval lands.
5. ⏸ **File 2 AIID report-form incidents** - fake Drake "Heart on My Sleeve" (CA-04) + Zarya of the Dawn (CA-05). Holds until the taxonomy establishes the lens (ratified order). One public URL each; anchors verified.
6. ⏸ **GitHub public mirror** - taxonomy + registry skeleton, personal account first, org later (ratified mirror plan). GO after step 4 clears.
7. ⏸ **Then the wider ladder** - AI Alliance reply out, community endorsements, Shape contact, funder materials.

## Today (Sat 2026-09-26)

- ⏳ Erah: join AIID Slack (form above, ~2 min)
- ✅ Lab: collision sweep landed (5 CLEAR / 1 PARTIAL), taxonomy doc updated, ready-to-paste #taxonomy post prepared; working docs at Room `research/`, living doc in Vault `Lapis/`
- ✅ SearXNG general search repaired on BRIX (braveapi-only, bing demoted to reserve)
- ✅ Taxonomy v0.1 anchored - all six classes carry a fetched-200 anchor
- ✅ Naming for AIID-facing use settled: "Erah, independent researcher"; Lapis = project codename only

## On Erah (decisions queued)

| # | Decision | One-line ask |
|---|----------|--------------|
| 1 | Fork | Tailwind-first, creative-first, or bound-together? |
| 2 | Naming collision | Coefficient Giving runs "Project Tailwind" - keep + disambiguate, or rename his for funder-facing use? |
| 3 | Container name | Abandon "Lapis" as org name, keep as codename, shortlist alternatives for collision sweep - or defer naming entirely? |
| 4 | AI Alliance reply | Draft ready at `research/consent-attribution/ai-alliance-outreach-email-2026-09-26.md` - send, edit, or hold? |
| 5 | First rung confirm | Repos-first ladder (current default) - still right after dedup verdicts? |
| 6 | Shape email | Needs: number, period, pilot calls for th. |

## On others / waiting

- AIID Slack form approval -> then #taxonomy access
- AIID editors adjudicate the proposed scheme mapping (their call by design)
- Keeper: 5 research children still missing deliverables (tailwind_eligibility x2, ai_alliance_osai_deep, coefficient_tailwind_collision, sff_aiid_clocks) - re-issue after the AIID block lands

## Next actions queued

- **Monday 09:45** - the pack (per standing plan)
- After taxonomy posts: file the 2 incident reports
- After GitHub mirror: endorsement ask list (who to send it to first)
- mem-db writes: Exa key 401 finding; SearXNG bing-demotion already folded into the repair skill

## Done / ratified (don't re-litigate)

- Taxonomy report goes to Slack #taxonomy, NOT the report form (report form = incidents only)
- Dedup verdict (2026-09-26, verified): consent/attribution layer is a genuine gap in AIID's live catalog; the only overlap is deepfake/impersonation and CA-04 is positioned as complement, not duplicate
- AIID report form takes one public URL per incident
- Anchor corrections: Getty v Stability filed 2023-02-03 (justia receipt date retracted); Holly Herndon + Kyle Beer + Reuters Dolly Parton candidates dropped (not found on verification)
- License CC-BY-4.0; Zenodo DOI deferred until needed for citation
- Mirror plan: personal GitHub first, org later
- "Project Tailwind" is Coefficient Giving's program name - never call Erah's project that

## Maintenance protocol

- Lab updates this file (staged at the staging lane `research/living-strategy-doc-staging.md`, pushed to this vault path and kept identical) on every meaningful state change; bumps the Updated stamp.
- Decisions get struck through with the outcome + date once made, not deleted.
- New pending items enter "On Erah" or "On others" - never only in chat.
- If this doc and chat disagree, this doc is the claim to fix.
```

### 5.2 Architecture: Consent as Binding Seam (VERBATIM)

Source: `…/Lapis/Architecture-Consent-as-Binding-Seam.md` (7,046 B).

```text
---
title: "Architecture - Consent as Binding Seam"
type: architecture
status: active
tags: [lapis, architecture, consent, zephyrium, knowledge-mesh, dual-mode, creator-sovereignty, kilombo]
date: 2026-05-13
mem-spine: "decision/zephyrium-consent-as-binding-seam-2026-05-13"
related-mem:
  - "decision/zephyrium-consent-as-binding-seam-2026-05-13"
---

# Architecture - Consent as Binding Seam

The tension between human-creator sovereignty and agentic vibe-tribe production is not resolved by splitting the platform into two halves. It is resolved by a single binding seam: granular consent, with zero-cost opt-out, that places human-protection upstream of agentic-production (`decision/zephyrium-consent-as-binding-seam-2026-05-13`). This is the structural promise Zephyrium makes to every creator who publishes on the platform. Consent is not a policy layer bolted onto the architecture; it is what makes the dual-mode architecture coherent. Without it, the consultation and production modes would pull against each other. With it, they share a substrate and a single load-bearing guarantee.

## What consent binds to

Consent in this architecture is granular and non-coercive. A creator's corpus can be published as human-citable-only, in which case AI Experts in production mode cannot cite it - no exceptions, no platform-benefit trade-off. The load-bearing structural promise: opt-out from production-mode citation must not be penalized. A creator publishing as human-citable-only must retain full access to every other platform feature - discovery, royalties from human derivatives, Kyma workshop participation, founding-member status. If opt-out costs reach, money, or standing, that is coercive consent and the platform replicates the betrayal it was built to escape (`decision/zephyrium-consent-as-binding-seam-2026-05-13`).

Production-mode work carries the same attribution and revenue obligations as human remixes. The Zephyrium attribution layer is the enforcement surface: every Expert response carries citations to source nodes, and compensation flows back through the attribution chain regardless of whether the output originated in consultation mode or production mode.

The founder-as-prior-art principle extends consent to the platform's own development posture. Erah-as-first-vibe-tribe-user - operating Conductor, the lapis-pm daemon, and the harness ladder - is the prior-art demonstration of honest dogfooding. The consent model is tested against the builder's own work before it is presented to any external creator.

## Where the seam sits

The seam does not divide two modes; it runs through both.

In consultation mode, a human brings a question and judges Expert responses. The consent surface is thin here: Experts can only draw on corpora the creator has authorized as human-citable (or production-citable). The human's judgment is the ratification act.

In production mode, a human supplies intent, and the Router coordinates Experts via the Project Slot flow (`architecture/knowledge-mesh-experts-dual-mode-2026-05-12`). The consent surface is denser: production-mode citation authorization becomes a live constraint on which Experts can contribute to which slots. Curation can be delegated; ratification cannot. The human ratifies at entry, at mid-flight decision points, and at output. The consent architecture ensures those ratification moments are substantive rather than performative.

The seam is structural, not contractual. A contractual promise can be quietly relaxed. A structural promise embeds the constraint in the substrate: without creator consent, the Expert's corpus access does not open. The routing logic the Router applies cannot route around it, which is why the Router is the densest place the consent invariant must be expressed. This connects directly to the council's concern about routing opacity as an unaccountable value-encoding layer (see [Verdicts Index - 2026-05](Council/Verdicts-Index-2026-05.md), Q-A).

## Capital entry faces the same gate

The consent-as-seam principle extends beyond the Expert-creator relationship to capital entry. `decision/investor-as-kilombo-encounter-2026-05-13` binds that investors face the same kilombo threshold as any Expert: no transitive credit from external reputation, no capacity acquired through capital alone. Funding can only flow if it aligns with the mission, demonstrated per-interaction - not assumed from capital pedigree or accelerator backing.

The protocol declines incompatible capital; not the inverse. The Cistercian-shape precedent applies: money enters the institution; the institutional discipline does not change to accommodate the donor. An investor cannot acquire sponsoring or attesting capacity through capital alone. The kilombo encounter is the gate.

This extends the consent seam from the creator side to the capital side. The platform's mission-integrity is not negotiable at the funding boundary any more than it is at the corpus-citation boundary.

## Implications for Friday's schema

Consent infrastructure is visible from day one, even when production mode is not yet active (`decision/zephyrium-consent-as-binding-seam-2026-05-13`). Schema decisions for Friday must treat the consent seam as a first-class architectural dependency, not a deferred feature.

Concretely:

- The creator consent flag (human-citable-only vs. production-citable) must be present in the corpus record from the first data model iteration, even if no Expert in v0 operates in production mode.
- The opt-out-penalty prohibition must be expressible at the schema level - a platform-level invariant, not an application-level policy applied after the fact.
- The Expert/operator boundary carries its own consent obligations. Where that boundary sits determines what an operator commits to when stewarding an Expert and what the platform can enforce at the routing layer.

The Expert/operator boundary is elaborated in [Expert Identity - Operator Body Pledge](Products/Zephyrium-Platform/Documentation/Expert-Identity-Operator-Body-Pledge.md). The full dual-mode architecture that this seam runs through is documented in [Knowledge Mesh - Dual Mode v0](Products/Zephyrium-Platform/Documentation/Knowledge-Mesh-Dual-Mode-v0.md).

## Cross-references

- [Knowledge Mesh - Dual Mode v0](Products/Zephyrium-Platform/Documentation/Knowledge-Mesh-Dual-Mode-v0.md) - the dual-mode architecture this seam runs through; consultation mode, production mode, Router as load-bearing component, and the five open seams
- [Expert Identity - Operator Body Pledge](Products/Zephyrium-Platform/Documentation/Expert-Identity-Operator-Body-Pledge.md) - the operator-body-pledge as the per-Expert instantiation of the consent-seam commitment; where the Expert/operator boundary is drawn
- [Verdicts Index - 2026-05](Council/Verdicts-Index-2026-05.md) - in particular Q-A (Douglass + Nzinga deliberation on kilombo-mode, operator-body-pledge, and the trust-pump-dump failure mode); Q-A is where the consent-as-seam structural promise enters the council record
```

### 5.3 Shipped consent-rail v0 (mem.db, verbatim)

`project/zephyr-consent-rail-shipped-2026-09-29`:

```text
project/zephyr-consent-rail-shipped-2026-09-29
---
ZEPHYR CONSENT RAIL - SHIPPED STATE (as of 2026-09-29): consent-to-use (use_terms rail v0) = signed, revocable use declarations on works: USE_VOCAB {training, remix, redistribution}, tri-state permitted/denied/undeclared (undeclared is NEVER permission and never more permissive than a prior denied - consumer-law line in README), tombstone via revokes=True, deposit-authoritative both ways (missing_domain_row/orphan_domain_row), selection max-seq + verdicts off verified ClaimIntegrityResult.payload. SHIP TIMELINE: private erah/zephyr main: consent PR #21 merged 2026-09-28 22:05 PT (f5b7496, advisory hold-tier, machine-clean ratify - decision/dossier/zephyr-use-terms-merge-2026-09-28); hygiene v0 PR #22 (2cacdef, 2026-09-29 07:24 PT: verify-except KeyError, payload revokes read, conditional hat-remix); hygiene v1 PR #23 (eb2c8e99, 09:20 PT: resolve_wallet + reverify_leg payload/verify-first discipline + demo README 4-scene refresh; dossier decision/dossier/zephyr-use-terms-hygiene-v1-merge-2026-09-29). PUBLIC: mirror github.com/xoeieox/zephyr main 537d90f684fffd3c023c8f860afee38917ab555b, fast-forward from bb035e25, 2026-09-29 ~09:50 PT) - Neo code seat synced through rewrite rules, zero-hit anti-overclaim gate, PM reproduced every checkable claim (gate re-run, rail presence, identities, leak sweeps, public suite 600+1); full record decision/zephyr-publication-decision-mirror-sync-2026-09-28 STATUS CLOSED + project/zephyr-mirror-consent-sync-landed-2026-09-29 + [internal-room-deposit-removed]. OSAIF context: the OSAIF email (sent 2026-09-28) used consent as the hinge; landing this unit is the 'work to make them true' per Erah's council-answer. Doctrine anchors: consent is CO-EQUAL axis to ATTRIBUTION upstream of route-not-compute (decision/zephyr-consent-coequal-axis-attribution-2026-07-08); money/use decoupled in v0 (design position). Arc docs [internal-room-paths-removed]; specs [internal-spec-path-removed] same names. Known-deferred (deliberate): event-scoped consultation (scope stored+hashed, consulted by nothing), CLI surface python -m zephyr.use, blanket per-author defaults, note cap (ships with CLI), witness countersignature, GNAP interactive consent. Open triage: project/zephyr-replay-guard-triage-open-2026-09-29.
```

### 5.4 Consent-compliance integration (research/distillation, VERBATIM; per audit §F item 5 shipped WITHOUT its adult-platform siblings)

Source: `…/Lapis/Research/Zephyr+AdultContentPlatform/consent-compliance-integration-2026-08-26.md`. Doc's own closing line: *"This doc is a vision capture, not a spec."*

```text
---
title: Consent Ledger × Structured Blindness — Integration Capture
type: vision-capture
date: 2026-08-26
status: locked-window-distillation
session: xoei conceptual-explorations
---

# Consent Ledger × Structured Blindness: The One Design

**What this is:** the distillation of the 2026-08-26 xoei exploration window (creator-hosted content, per-capacity consent, social-convention enforcement, platform-as-proxy tiering, structured-blind compliance). Written as the build starting point: when the code starts suggesting reality, this is the picture to test against. Companion research in this folder (all 2026-08-26, from the Zenmux burn + prior windows): `user-enforcement-mechanisms`, `portable-identity-and-migration-federated`, `trust-weighting-and-cold-start`, `content-law-blind-compliance`, `content-law-structured-blindness`. Sibling anchors: `nostr-protocol-research-2026-08-25`, `adult-platform-origin-stories-2026-08-26`, `Lapis/Creative-Platform-Vision-2026-08-26.md`.

## The one-breath picture

**Consent, privacy, and compliance are one design, stated three times.** The creator decides who reads, and the record is legible (consent). The platform cannot see the content (privacy). Knowledge is routed to the entity that acts, and the platform proves non-membership (compliance). The law's stated goal (detect, takedown, report) is met by the host; the law's stated means (universal sight) is never the goal — it is the vehicle of a larger political move, and the platform demonstrates the goal without the means.

## The two global ledgers, opposite pens

Sister to the vision doc's global attribution ledger:

1. **Attribution ledger** — written by consumers/agents (who made what). Already settled in the vision doc.
2. **Consent ledger** — written by the producer only (who may read/remix/derive, per-platform, per-capacity). Zephyr routes the facts; platforms derive scores and enforcement. Route-not-compute extends to consent unchanged.

Per-capacity grants are distinct consents: **fan (view)** vs. **fork (derive)** are separate relationships to the same creator. Fan access is never gated by fork disputes. Granular grants are possible: "this platform, this capacity, revoked" — a per-pair signed relationship, not a global flag.

The consent flag is a **record, not a gate**: it becomes applicable when raised, and the platform's response to a raised flag is a *reputational act*, not a legal one. The protocol enforces legibility; morality emerges from transparency (per `Zephyrium-Protocol-First-Vision.md` — "Bans As Signal" and "The Negative Shape," including the bilateral read: a platform's flag-violation history is visible, both pens).

## Enforcement arm: the scene's gaze, not the platform's rule

- **Individual levers at small scale** — signed per-user, per-creator revocation ("you can no longer borrow from me"). Works at 2 users, 20 users, 2,000 users. No platform intermediary needed.
- **Platforms-as-proxies at scale** — at 200,000 users a creator can't chase individual revocations; the mechanism hands off to *choosing platforms that honor flags*. Well-performing platforms + well-behaved users sediment into a natural tier.
- **The enforcement is social convention**: networks effects accrue to rule-honoring; isolation accrues to rule-breaking. Nothing stops the violator structurally — that is the point, because structural stopping is the chokepoint being escaped.
- **Held:** the convention only binds at sufficient scene density. The flag's teeth are 710 people today (the 1F916 warrant). The slow-loop question in consent clothing: does the flag outlive the scene, or the scene outlive the flag?

## The zero/negative asymmetry (settled from research)

From `trust-weighting-and-cold-start`: the load-bearing property of every resilient trust system surveyed — **newness is never a sin; violation is the only thing that burns.**

- Everyone starts at zero, never negative. New users get a fair shot (cheapest tier stays free).
- Negative movement requires a **signed, public, verifiable artifact** (violation report, revoked grant, unpaid obligation) — never newness.
- Resetting a burned identity is mechanically possible but costs: identity cost ladder (PoW/stamps/rent/gas), graph weight doesn't transfer, identity is non-transferable (no laundering).
- Trust is **derived, not assigned**: platforms compute it from routed facts (NIP-85/WoT pattern, PageRank/EigenTrust with pessimistic seeding to damp colluding clusters). Asymmetric derived-trust holds at 80–90% sybil populations where symmetric systems collapse ~50%.
- Queue/access priority weighted by trust is legitimate, but the zero/negative asymmetry protects newcomers: you wait in line for a fair shot, you don't start punished.
- **Held:** the derived-trust design still needs a bootstrap anchor (who seeds the graph). That choice is a product decision, not a crypto one.

## The displacement harvest (from origin stories)

The adult industry's reliable growth event is **exogenous displacement** (ban panics, purges, processor tightening → creator stampedes: Fansly's 4,000 applications in an hour during the 2021 OnlyFans ban window). In the current industry, displacement is *lethal* to provenance: refugees arrive with no consent records, no flags, no attribution.

If consent/attribution live on the substrate (creator-held keys, signed grants, portable DID), **every purge becomes a consent-flagged stampede into the ecosystem** — refugees arrive carrying their history and fork permissions. The dirty→clean stress-test inverts into a growth mechanism: the hardest soil not only proves the infrastructure, it harvests the displacement every incumbent eventually produces.

## Structured blindness: the compliance half

From `content-law-blind-compliance` + `content-law-structured-blindness`:

**The architecture sentence:** knowledge is *created* in exactly one trust domain (the plaintext host: hash-match, classifier, human review) and is *routed* to the entity that can act on it — never back into the blind platform. The platform proves **non-membership** (CID ∉ NCMEC set, verifiable privately); provable membership is, by definition, the moment content leaves the blind architecture.

**The two domains:**
- **Plaintext host** — a genuinely independent legal entity (its own economics, no shared keys/control with the platform). It holds the bytes, runs NCMEC hash-matching, bears the §2258A reporting duty, and carries the §2258B shield. It is the "we'll host for you" business AND the compliance provider — the same question twice, one build.
- **Blind platform** — holds CIDs, metadata, age/identity assertions, payment data. Content-blind by architecture; **pattern-sighted by necessity** (FOSTA recklessness standard: must not be blind to patterns — volume, category mix, payment anomalies, repeat offenders). Never runs the hash set. Never receives host-side analytic output (knowledge imports).

**What ZK does and doesn't do:**
- ZK is sound for **attribute proofs** (age ≥ 18, issued by a credential issuer — the UK OSA / EU blueprint path) and **existence proofs** (authored at T, hash-valid, X ∉ H, custody chain). These are the safe zone.
- ZK **cannot** prove "this specific video contains CSAM" — the predicate isn't a function of the bytes; it's a normative judgment requiring a trusted evaluator. There is no cryptographic route to a content verdict, only a routing decision about who sees it.
- Consequence: the platform can cryptographically *demonstrate* "my corpus contains no known CSAM" (private non-membership) without ever seeing content. The sighted verdict lives entirely host-side.

**The vehicle-vs-goal framing (the "great win"):** the universal-sight premise already failed everywhere (EARN IT never floor-voted; EU ended as a temporary derogation *excluding* E2EE; UK forced only a withdrawn Apple iCloud notice). The surviving posture in every jurisdiction is exactly the blind one: attribute-verify, don't content-scan. The platform becomes the **reference implementation of what the law is settling on** — the stated objective achieved without the surveillance capability the larger move wants. For the adult scene this doubles as a **safety claim stronger than OnlyFans's**: "we structurally cannot see your content" is cryptographic, not policy — it can't be rolled back by a ban-panic or a processor letter. The people most threatened by universal content sight are the creators themselves and the victims; the architecture removes that threat class.

## What the research says already exists (the build is thin)

**On the substrate (Nostr, shipping or drafted):** NIP-02/NIP-65 (outbox/relay lists — creator's "here's where I want to be read"), NIP-32 (parameterized labels — the raw per-asset scoped grant primitive), NIP-51 (mute/block lists), NIP-56 (signed reports — the raise-the-flag lever), NIP-85 (WoT — reputation providers score, clients derive: the route-not-compute precedent), NIP-13 (PoW — the identity-cost floor), Blossom/NIP-96 (creator-hosted media — the "platform only reads" reference implementation, in production via Buzz).

**Proven mechanics to copy (from `user-enforcement-mechanisms`):** a grant is an addressable replaceable signed event; revocation is a *superseding* event, never a delete; the supersession chain is the ledger. Dedicated signing key per grantor (Bluesky labeler pattern). Rate-limit **issuance**, not reading (per-unit rent / write caps — Farcaster's proof). Weight trust, never counts. Preserve the resilience invariant: a false or fabricated revocation can only change a willing reader's view, never the subject's data.

**The unbuilt primitive to claim:** nobody has a **subject-side inverse consent** ("I did not consent to this grant being issued about me / to labeler X issuing statements about me"). It is cheap to sign (a subject-signed non-consent event consumers honor to be compliant) and unbuilt in every surveyed system. Consent today is expressible only by the *receiver* of signals, never by the *subject* — that gap is arguably the product.

**The portability rule (from `portable-identity-and-migration-federated`):** across all four federated stacks, **identity travels; reputation resets** — every judgment produced by a platform-side evaluator is endogenous. Nostr is maximum-identity/minimum-comfort; the consent ledger fixes the content side (creator-hosted, flag-carrying) and NIP-85-style derived trust fixes the reputation side (re-derivable from the portable signed graph, not stored as a platform judgment).

## The two forced builds (the rest is derivation)

1. **The independent host entity** — compliance provider + hosting business, genuinely separate legal person with its own economics. Veil-piercing is the risk (Backpage's Dutch restructure was treated as a sham; courts collapse shared-key/control splits). Independence is a product feature: "we store, we don't read; we read, we don't derive."
2. **The consent grammar** — a Zephyr event kind for per-creator, per-capacity signed grants (view/remix/derive, per-platform scoping, revocation-by-supersession) + the subject-side inverse-consent primitive. Everything else (trust derivation, queue weighting, platform reputation) is computed on top.

The legal read of the host/platform split (a real lawyer, not a model) is the one place in this entire window where "this needs to sit with a lawyer" is the correct sentence — the split's legal resilience is fact-dependent and no clean precedent deployment exists.

## Held open (unresolved by design)

1. **The aliveness threshold** — the convention binds at density; N/M thresholds need writing before launch (carried from the vision doc, now wearing a consent hat).
2. **Marked-fork legibility decay** — the consent flag story holds while the audience checks. What happens to marked-forks when the audience stops? (Slow-loop question in consent clothing.)
3. **The two tiers must not collapse** — creative-economy consent (signed events, low friction) vs. legality tier (identity of uploader, knowing takedown, processor relations, pattern sight). The moment the consent UI becomes *the* moderation UI, the platform starts thinking creator consent is the moderation story. For legality, the story is "we know who you are, and we stop on knowledge."
4. **Revocation depth by medium** — the hole-remains model (DMCA-plus-provenance: takedown removes the reference; the slot stays marked "Master Chief was here"; replacements are legible as replacements). Retcon cost escalates by medium (text cheap → image re-render subject → video re-render scene). Same consent primitive across all media.
5. **ZK age-credential issuer** — single point of failure; borrowed-credential gap (minor with adult's wallet); one-time-use rule lives in the client. Practical limits, structural.
6. **The flag-specific safety claim** — structured blindness is a *safety* asset at the dirty end and a *provenance/consent* asset at the clean end. Same architecture, different claim. The compliance "great win" is strongest exactly where the content is hardest.

## Build-watch list (reality the code will suggest)

- The **consent event kind**'s scope vocabulary (per-platform app identity, per-capacity classes) will fight the first real use cases — expect the vocabulary to be wrong first, and the grammar to be fixed by supersession, not migration (that's the design working).
- **Trust derivation** will look centralized in practice (one or two NIP-85-style providers dominate early) — the design is plural by construction; watch the Acosta centralization creep at the provider layer.
- **Host independence** will be tested by the first court order / processor demand — the response protocol (who answers, who reports, who stays blind) must be rehearsed before it's needed.
- **Fan/fork separation** will be stressed by the first remix dispute — the test case is "the video is gone but the stills derived from it exist": the stills' reference chain must render legible-as-derived, and the viewer's decision (engage / don't) is the scene doing the enforcement.
- **Inverse consent** will be ignored by early conforming clients (it's cheap to sign, friction to honor) — the non-conforming path must be loudly visible (flag rendering) from day one, or it dies silently.

*This doc is a vision capture, not a spec. It records the why and the shape; the hard crunch (event-kind schema, host entity structure, threshold numbers) belongs to the implementation lane.*
```

### 5.5 Supporting vault docs (VERBATIM)

`…/Lapis/Context-Management-And-Zephyr-Research-2026-06-02.md` (8,576 B):

```text
---
title: Context Management & Zephyr — Research Report + Ratified Decisions
date: 2026-06-02
status: ratified (gates 1-4 + 5 path; ownership model)
authors: Erah + Claude (BRIX session)
related:
  - "[[Architecture-Four-Node-Cluster]]"
  - "[[Architecture-Project-Slots-As-Blackboard]]"
ledger:
  - decision/brix-coordinates-gw-opines-ownership-2026-06-02
  - decision/context-mgmt-rebuild-gates-1-5-path-2026-06-02
tags: [context-management, synapse, weaver, gardener, recall, zephyr, gravitywell, brix, rsi, agentic-memory]
---

# Context Management & Zephyr — Research + Decision (2026-06-02)

> Method: two-pass adversarially-verified web research (deep-research harness, ~210 agents / 3.2M tokens across both passes) + mining of the in-house corpora ([internal-room-path-removed] 91 papers, `agentic-subconscious`, `harness-component-library`) + a live survey of the running BRIX services. mem.db is authoritative; this doc is the narrated record.

## Headline

The monolithic `mem.db` is **not** the binding constraint. The fixes are **already built but switched off, dark, or not closed into a loop**. The highest-leverage moves involve almost no new code. The research, the in-house corpora, and the live code survey converge on the same architecture from three independent directions.

## Diagnosis (live code survey)

| Component | Built | Live | Seam |
|---|---|---|---|
| Synapse semantic recall (RRF + confidence bands + never-empty marker); nomic 768-d index | yes (index rebuilt 12:17) | **no** — `SYNAPSE_SEMANTIC` unset, unmerged branch | prod is lexical-only; min-max scores **saturate at 1.0 with no confidence meaning** |
| Co-occurrence BFS expansion (cooccurrence.db live, 18 MB) | yes | **no** — flag off | the associative recall path that fixes vocabulary-mismatch is dark |
| Weaver watcher (session observer) | yes | **no** — not a systemd unit on BRIX, dark since 05-31 | the "what happened" layer is frozen → starves Gardener |
| Gardener → mem write-back | no | n/a | synthesizer is a **sink** (`latest.md` only); insights never re-enter recall |
| Relevance-feedback loop | no | n/a | telemetry is write-only; system can't see its own misses |
| mem.db semantic/graph substrate | no | n/a | FTS5 keyword + CSV tags only |

Measured ceiling (`project/synapse-recall-levers-measured-2026-05-31`): every embedder/query lever caps at ~0.53 recall@10 vs a 0.80 gate, because ~1,080 verbose router/pm session logs out-rank the one terse decision. **Corpus-structure problem, not a tuning problem.**

## Substrate direction (primary thread)

Convergent across internal + verified web findings:
1. **Split episodic vs semantic** — verbose logs and terse decisions in one store *is* the burial bug. (SimpleMem, SkillRL; A-MEM `arXiv 2502.12110`; Tulving/consolidation neuroscience.)
2. **Hybrid multi-index + never-empty by contract** — dense + BM25 + exact-symbolic-key, ID-deduped, RRF + calibrated confidence bands replacing min-max saturation; typed miss token instead of silent-empty. (SimpleMem; UniCR conformal abstention `arXiv 2509.01455`.)
3. **Spreading activation** for the silent-empty / vocabulary-mismatch path — CPU-trivial, no LLM, over the existing co-occurrence graph; IDF/information-content edge weights (Resnik), 2-hop bound + hub-penalty (the keyword-hijack cure), additive multi-cue scoring (Tulving); ACT-R activation `B_i + Σ W_j·S_ji`. (Verified mechanism: `arXiv 2512.15922` — SA reaches "bridge documents whose terms are not in the query".)
4. **Salience-over-recency consolidation** (own mapping: MemGPT FIFO-eviction critique).

**The graph-substrate caution:** every graph/agentic substrate (Graphiti/Zep, A-MEM, GraphRAG) puts an **LLM in the write/ingest path**, which fights the always-on-CPU + no-API constraint. The CPU-query-bounded core (BM25 + small dense + RRF + tiny reranker + spreading-activation + calibrated abstention) gives most of the benefit without that cost. If ever taken: **LazyGraphRAG** (defers all LLM to query time; index cost == vector RAG), with extraction on the sleeping-GPU pass. **Layer onto SQLite; don't replace it.**

## Topology (secondary thread, verified)

- Fix the **dark observer** first (Weaver watcher → systemd on BRIX).
- **Close the Gardener loop** via the sleep-time-compute pattern (`arXiv 2504.13171` / Letta sleep-time agents): reflect → derive learned context → write back to the BRIX store. LLM-heavy reflection on the GPU/wake path; BRIX serves the result.
- **Push, but gated** — convert advisory recall to a notify-vs-stay-silent gate conditioned on predicted need (ContextAgent `arXiv 2505.14668`); silent-by-default yet never-empty. (Calibration: frontier models hit only ~40% on PROBE-style proactive triggering `arXiv 2510.19771` — keep the gate conservative, injection advisory-authority.)
- **Close the relevance-feedback loop** — log "this item was actually used"; feed back annotation-free (ReFIT `arXiv 2305.11744`, RaFe `arXiv 2405.14431`), or simplest: wire usage into the existing warmth re-rank.
- Anticipatory pre-staging (later): SpecAgent `arXiv 2510.17925`, Speculative RAG `arXiv 2407.08223` — move heavy context construction onto the sleep-time pass.

## Zephyr clues (prior-art synthesis — not pipeline-verified)

- **Transitive credit** = eigenvector-centrality credit flow over the provenance graph (PageRank/eigenfactor) with damping; open problem = sybil/citation-ring gaming (history-as-trust is the defense).
- **Royalty enforcement lesson (load-bearing):** EIP-2981 failed because royalties were *advisory at the marketplace layer* (OpenSea made them optional → race to zero). ERC-721C made *transfers themselves* gated on royalty-honoring. → Zephyr's **defederation IS the ERC-721C move**: enforcement at a chokepoint (loss of access), not ignorable metadata. Keep the floating tag enforced, never advisory.
- **C2PA** provenance strips trivially (screenshot/re-encode). → Zephyr's **registry keyed by `manifest_hash` is more robust** than embedded metadata — lean into the registry.
- **ATProto lexicons** = the right model for portable typed records (validates the planned `lapis.zephyr.work-record` / `.attribution`).
- **Defederation** works as a coarse lever (Fediverse blocks; Bluesky stackable labelers) but risks centralization pressure + evasion; pair with the registry so the cost of evasion is loss of accumulated history.

## Ratified decisions

### Ownership / orchestration — "BRIX coordinates, GW opines"
- **BRIX** = always-on coordinator: canonical state owner (slot store, mem, /room) + sequencer + WoL sentinel.
- **GravityWell** = opinionated reasoning organ (Facets, Mirror Council, spec draft/ratify, review/verify, Gardener), woken on demand. **Haiku stand-in now**, one-line flip to local on the **A3 gate**.
- **StarHouse** = specced/DoD worker.
- Orchestration lives on BRIX because GW *sleeps* (and the Tailscale model-seam makes model location a one-line flip — "build-in-place vs port" was a false fork). Confirms `decision/freeform-vs-specced-routing-criterion-2026-05-23`.
- Ownership = the already-ratified **blackboard** (`decision/project-slots-as-blackboard-architecture-2026-05-28`): one slot store on BRIX, GW/StarHouse/experts/humans as contributors. Dissolves the "parallel-dev vs GW-canonical" binary by separating **canonical STATE** (BRIX, permanent) from **opinion AUTHORITY** (GW, provisional behind Haiku, graduates via A3). No second PM, no dual-write.

### Context-management gates
- **1-4 ship on BRIX now** (pure CPU coordination/sensing; gates 3 + 4-refinements = specced StarHouse-fixer slots, no GW dependency).
- **Gate 5 + the GW stand-up = the first real multi-node blackboard/Zephyr-PM project.**
- **Gate 6 (graph substrate) deferred** — only if 1-4 don't clear the practical ceiling.

### Dogfood framing
Run the rebuild-tail **as** the first multi-node project: ships substrate fixes + banks the Sonnet/Haiku **A3 baseline** + first genuine Zephyr exercise on code-shapes (the beachhead). Slots emit attribution deposits to the live `attribution.db`. Human-first slot allocation.

> The CPU/GPU boundary the substrate research forces **is** the BRIX/GW node split. They were never two decisions.

## Housekeeping (this session)
- Repaired the off-node sync gap: research corpora restored to the room research store [internal-path-removed] (were stranded on StarHouse after the 2026-05-29 room-relocate). The deferred cross-corpus `mappings/` actually has 14 files.
- Closed the stale `handoff/synapse-nomic-build-starhouse-2026-06-02` (index already built).
```

`…/Lapis/Dan-Priest-PwC-Podcast-Zephyr-Validation-2026-06-17.md` (5,422 B) — external-validation evidence (Dan Priest, PwC podcast):

```text
---
type: signal
status: external-validation
date: 2026-06-17
source: podcast
tags: [zephyr, validation, attribution, interledger, pilot-doctrine, positioning]
---

# Dan Priest (PwC) - external validation for Zephyr

A signal, not a ratified decision. Dan Priest, PwC's Chief AI Officer, on *The Most Interesting Thing in AI* (2026-06-17, "How AI Agents Are Changing Business", 30:46, host Nicholas Thompson). The episode keeps landing on Zephyr's own thesis from the enterprise-advisory side of the table. Three clusters plus the macro frame.

Transcript: [internal-room-library-path-removed] (room-rag retrievable, BRIX :8201). Full pull also in mem: `insight/dan-priest-podcast-zephyr-validation-2026-06-17`.

## 1. The bullseye - "register an agent against a task affiliated with a user" [16:11-17:04]

Priest describes an intra-firewall "operating system", an abstraction layer above the models, to manage agents that "come from multiple platforms." He reaches for it via the RPA scar - bot proliferation, people losing track of bots, needing controls. His formulation:

> "The ability to register an agent against a task affiliated with a user with an expected outcome helps you manage the performance of those agents."

That is a closed, proprietary, per-company version of Zephyr's attribution envelope: producer -> attested output -> task -> human, model-agnostic and cross-platform (see [[Ecosystem-Spec]], [[Architecture-Provenance-Schema-v0]]). The gap is the whole opportunity: his registry stops at the firewall. Zephyr is the same provenance spine as **open connective tissue between orgs**, not a per-company OS. The enterprise pain he names is real and unmet at the cross-org layer.

## 2. "Altitudes of accountability" [05:00-06:01]

He rejects the $1B-one-person-all-agents company "for no other reason than the accountabilities":

> "You typically want altitudes of accountability, and organizations grow around those accountabilities... build human accountability around this AI."

This is the [[Architecture-Pilot-Doctrine]] in someone else's mouth - human-in-loop as sovereignty at the intent layer. Accountability is unprovable without provenance, so Zephyr is the substrate that makes those altitudes auditable across agent work. Worth noting he independently reaches for "altitude" language.

## 3. Rights-holder compensation via licensed small models [24:53-26:25]

Unprompted, the most Interledger-relevant stretch:

> "...small language models... doing it responsibly, where the rights holders get compensated for the use of their content and the models underpinned with that licensed content... it's also creating a revenue stream for the rights holders."

Thompson (musician, runs The Atlantic) answers with the exact grievance Zephyr exists to fix - "all of that stuff was snarfed up by these companies building competitive products... I do hope that over time, rights holders are compensated much more." This is direct validation of the foregrounded Interledger objective (attribution -> Open-Payments -> first real payment to creators; mem `decision/interledger-app-foreground-creatives-not-code-2026-06-12`) and the cryptography-not-currency framing (`positioning/zephyr-vs-crypto-cryptography-not-currency-2026-06-10`).

## Macro tailwind - "value realization moves at the speed of trust" [06:39-07:47]

His core explanation for why adoption lags capability is not the models, it is trust. He cites a Stanford figure - US ~40% trust vs China / UAE ~80%. The strategic case for Zephyr in one line: the bottleneck is trust, trust is built on legible provenance, so attribution infrastructure sits on the critical path to adoption rather than beside it.

## Smaller hooks

- **Knowledge pooling with the credit stripped out** [13:30-14:31]. PwC funnels its highest-volume team's transformation learnings into one GPT "every single person can use" - "leveraging the expertise that would have otherwise been resident and exclusive for a very small team and making it available to everyone" - with no attribution back. Thompson's tell: "you're going to make it a lot easier to replace Dan Priest." This is expert-as-vessel (mem `decision/expert-as-knowledge-vessel-legibility-generative-filter-2026-05-31`) running one-way, minus the credit layer Zephyr restores. The contributor-erasure Zephyr's attribution-surviving-the-fork is meant to prevent, shown live.
- **Deception rates as a standard agent metric** [14:50-15:17]. Priest tracks "accuracy, latency, drift, hallucinations, deception rates, task lengths" and runs multi-model "checks and balances" (a Mirror-Council echo). Bridges directly to the 2026-06-03 Bengio episode "How Science Can Fix Dishonest AI", already in the corpus.
- **Authoritative expert agents** bundled into intelligent applications, "working with each other, managing the horizontal" [21:53-22:49] - multi-agent coordination that needs provenance between agent-producers.

## Net

Clusters 1+2 validate the code / agent beachhead - agent attribution and accountability as an unmet enterprise need. Cluster 3 validates the creative wave and the Interledger payment story, from a PwC mouth. The macro is the trust tailwind that makes both strategically central rather than nice-to-have. Nothing here re-scopes the build order; it strengthens the existing one.
```

---

## 6. Open gap — OP vs Nostr (payment surface v0)

**This is Erah's ruling and it is PENDING.** Audit §A missing-item (e): the lock needs an explicit statement which payment surface v0 is — OP/Rafiki vs Nostr tip-split beachhead. Decision-grade evidence on both pans:

- OP side: §3 (Rafiki-testnet COMPLETED settlement, official SDK; open debts = liveness re-run + SDK fold-back).
- Nostr side, mem.db (VERBATIM):

`research/nostr-tipsplit-lightning-fees-rail-selection-2026-09-08`:

```text
research/nostr-tipsplit-lightning-fees-rail-selection-2026-09-08
RESEARCH 2026-09-08 (general-purpose subagent, BRIX session; web + primary docs, evidence-backed). Tip-split N-recipient payment mechanics across rails. Feeds decision/zephyr-nostr-tipsplit-beachhead-tipper-side-2026-09-08 (the dust-threshold + rail-selection design inputs).

HEADLINE: the multi-recipient zap primitive ALREADY EXISTS in the Nostr spec - NIP-57 Appendix G, the `zap` tag (optional 4th weight arg). Spec text: "clients calculate a sum, then a percentage to each receiver; if weights absent, divide equally; partially-weighted -> unweighted get weight 0." Mechanical consequence: the client generates ONE zap request PER RECIPIENT = N separate Lightning payments, NO batching. Ships today (prior art to study/fork): Amethyst, Damus, noStrudel (end-to-end split-paying; secondary source, NEEDS-LIVE per-client), Zapper (split + retry). REFRAME: Zephyr does NOT invent multi-recipient zaps. Zephyr's delta = (a) tipper-CHOOSEN ratios (Appendix G is CREATOR-DECLARED - author pre-sets recipients+weights; Erah's T0 = the other ratio-triad branch, market-set), (b) the signed substrate-legible SPLIT EVENT (Appendix G leaves the split implied by N zap receipts + the tag; Zephyr makes it a first-class portable event), (c) RAIL-AGNOSTIC routing (Appendix G is Lightning-only; Zephyr adds OP/Sui/other + a rail-picker). The client-side fan-out PLUMBING is prior art.

FEE / RAIL FINDINGS (CONFIRMED from BOLT/BIP/primary docs unless noted):
- Lightning: N recipients = N payments (BOLT 04: one payment_hash = one recipient; NIP-57 kind-9734 MUST have one p tag). Fee/hop = fee_base_msat + fee_ppm x amount/1e6 (BOLT 07). CLN default base 1 sat + 10 ppm; LND example 1 sat + 500 ppm. Typical per payment 0-4 sats (up to 10-20 high-fee); at a 10-sat hop that's a 0-40% fee ratio = the dust problem. MPP does NOT batch recipients (one hash = one recipient; BOLT 04) - red herring confirmed. No adopted BOLT batches multi-recipient (absence claim, scoped to BOLT 01-16; re-check if design lives long).
- On-chain "roll-up" (one tx, N outputs): vsize ~= 65.5 + 31N (P2WPKH, 31 vbytes/output; inputs dominate). HARD dust floor 294 sats/output (Core P2WPKH) - any recipient below it makes the batch tx UNRELAYABLE. Economics OPPOSITE of Sui's: on-chain beats N Lightning payments ONLY at multi-million-sat pools or severely expensive routing (at T=1000 sats, N=5: LN ~15-100x cheaper). So the roll-up = the LARGE-T fallback rail, NOT the thin-split rail.
- Sui: the "CK roll-up" Erah remembered = Programmable Transaction Block (PTB), NOT "CK". Up to 1,024 operations / 2,048 objects in ONE tx, ONE flat gas (per-tx fee, capped 5M computation units). 100 transfers in one PTB ~= one transaction's gas. PTB = the right home for the large-N/thin-amount case (100-author split); the batch pattern that does NOT port to Bitcoin L1.

CANDIDATE DESIGN INPUTS (validate vs live before spec):
- DUST THRESHOLD: ~25-50 sats per recipient (keeps route fee <=~10% at median fees). Sub-threshold hops ROLLED UP to the highest-weight recipient (castr.me "remainder to last recipient" = prior art) or a treasury. Hard floors: LND send min 1 sat (never binding), on-chain 294 sats/output (binds only the on-chain rail).
- RAIL-SELECTION RULE: (1) N<=~5-10 + per-recipient >=~50 sats -> Lightning N-payments (NIP-57 Appendix G plumbing), cheapest by an order of magnitude. (2) N up to ~100, thin amounts -> still Lightning + dust roll-up (accept higher per-hop fee ratio, or raise the effective floor so total fee stays bounded, e.g. keep fee <=10% of T). (3) On-chain N-output batch -> only large T (multi-m sat) or LN unavailable, per-recipient >=294 sats. (4) Sui PTB / Open Payments -> the 100-author thin-split edge case.

KNOWN FRICTION FROM SHIPPING CLIENTS (design constraints): (a) wallet-level minimums ("I can only zap a minimum of 1000 sats", r/nostr) - interacts with the dust threshold (a 1000-sat tip / 100 authors = 10 sats each = below threshold -> heavy roll-up); (b) weight-zeroing edge case: adding weighted `zap` tags zeroes previously-unweighted recipients (nostr-protocol/nips #1007); (c) percentage rounding: castr.me rounds to whole %, remainder to last recipient. Zapper's retry emphasis = partial failures in N-way splits are EXPECTED (executor must be retryable per-recipient, not all-or-nothing).

NEEDS-LIVE-BEFORE-SPEC: (1) live route-fee probe to the real recipient set (GetPaymentFeeEstimate / estimatefee per rail); (2) per-recipient htlc_minimum_msat + channel reserves (per-channel, not global); (3) current sat/vB at dispatch (today's snapshot 0.3-4.0 sat/vB by target); (4) confirm Amethyst/Damus/noStrudel split impls against their repos (secondhand source only); (5) re-run the "no multi-recipient BOLT" absence check if the design timeline is long. OP per-transfer cost NOT verified this session (assumption).

TIES: decision/zephyr-nostr-tipsplit-beachhead-tipper-side-2026-09-08 (the design this feeds); decision/zephyr-attribution-not-valuation-route-not-compute-2026-06-24 (ratio triad: Appendix G = declared branch, Erah T0 = market-set branch); decision/zephyr-collective-payout-lead-wallet-ask-2026-06-28 (sender-side non-custodial fan-out = the N-payment execution shape); reference/open-payments-interledger-architecture-2026-07-21 (OP = rail-adapter #1, batch-rail candidate for large-N/thin).
```

`decision/nostr-underlying-rails-not-community-2026-10-10` (most recent ruling — constrains, does not choose):

```text
decision/nostr-underlying-rails-not-community-2026-10-10
Ruled by Erah 2026-10-10 evening follow-in: Nostr is an underlying additional protocol beneath Seams, never a destination and never a community to court - the existing Nostr scene is doubted as warm to Seams. The migration thesis is Reddit-first; onboarding is keys-in relays-hidden: set your keys up, join Seams, you are done, no clients and no relay thinking. Purpose sentence for the pitch: decentralized collaboration on research and development and/or productization. Open scout question: whether any AI development communities exist on Nostr at all.
```

Full gap statement + checklist: `04-open-gaps.md` §4 [excluded from public seed]. Claude prepares the decision memo; Erah rules.
