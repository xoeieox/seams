# 04 — Open Gaps (protocol lock)

Packet: SEAMS / 2026-10-12 / assembled by keeper (dispatch "Seams packet builder v2", sources-restored run).
Role of this file: the complete, honest list of everything standing between the lab's current state and a protocol lock — plus the stale-source register for this dispatch itself.

---

## 1. Protocol-lock gap list — VERBATIM from the protocol assembly audit (run 2, hardened)

Source (GW): `/home/jellyfish/openclaw-workspace/reports/2026-10-12-protocol-assembly-audit.md`
sha256 verified 2026-10-12: see line below (matches dispatch-expected prefix `f9454f34...`).

Audit sha256:
`f9454f34a503e2f1dc287555ec4e475a2344fb8354463e9a3c8641d130bb1736`

### 1.1 "EXISTS vs MISSING to lock the protocol" — audit §A, verbatim

```text
- EXISTS vs MISSING to lock the protocol: exists = doctrine invariants (12, incl. path-not-amount, exact conservation, non-custodial, credited-but-unpaid, self-signed wallet bindings), RouteManifest compiler + hardening + executor foundation landed as code+specs, witnessed checkpoint log, consent rail v0, real testnet settlement proof, public repo (Apache-2.0, github.com/xoeieox/zephyr @c539ac1x lineage). Missing / open = (a) front-matter status flip of the rail-design doc to ratified; (b) signed SDK flow fold-back into repo replacing broken Python GNAP path (recorded DEFERRED 2026-06-14, no later landed key found); (c) U3k contributor key ceremony: Erah YubiKey root anchor + ZEPHYR_HUMAN_ROOT_ANCHOR, Dustin device-generated key (status of completion (unverified) - no landed key found); (d) settlement-intents stop = compensation seam frozen at executor entry; (e) forward-name/brand decisions for Seams (2026-09-08) postdate the rail doc - lock needs explicit statement which payment surface v0 is (OP/Rafiki vs Nostr tip-split beachhead).
- (unverified): Rafiki testnet wallet liveness today (June-era capture, not re-run); commit-date of HEAD (~09-29 per dispatch, not re-derived).
```

### 1.2 Audit §C flags (Claude-safety of the seed packet), verbatim

```text
- CLAUDE-SAFE AS-IS: YES with two flags. Grep sweep found zero personal identifiers, zero secrets - only REPLACE_ME_* env-template placeholders and the DoD's own no-ANTHROPIC_API_KEY check text (friction.json). Flags: (a) NO LICENSE file in repo - open-protocol publishing needs one; (b) CLAUDE.md carries an internal pointer (@chub: conductor/lapis-ecosystem) - harmless but internal-flavored. Content is contract+shapes+process, GitHub-free by design.
- (unverified): whether km-conform.py currently runs green against any live node.

## D. Mac probes (node 50225c8756..., top-level only)
```

### 1.3 Audit GAPS section, verbatim and complete

```text
## GAPS
- "decision_gems" namespace: literal key prefix absent from mem.db; sampled closest family (pm/brief-gem/*, decision/gems-are-doorways...). Name ambiguity only.
- Rail-design doc front-matter still design-for-ratification while ledger records ratification - contradiction recorded, not edited (read-only).
- U3k key ceremony completion, OP-SDK fold-back (DEFERRED since 06-14), and current Rafiki wallet liveness: no later landed evidence found; all (unverified).
- disclosure ruling items (Steam primary source; upvotes number) open by the ruling's own terms.
- Mac probes top-level only (per dispatch); README head-reads of LivingWorld/knowledge-mesh-seed Mac copies not done - content-equivalence asserted by identical sizes/top-level names only.
- Strategy-Consent-Attribution.md content not head-read this run (existence verified via store map).
- No errors encountered; no call failed twice.

```

---

## 2. Consent items 2–9 (awaiting ratify)

Source: BRIX `/room/research/consent-attribution/zephyr-seams-anchor-2026-09-29.md` (fetched verbatim 2026-10-12).
Status: items 1 and 10 Erah-signed; items 2–9 below are the open consent register.

### 2.1 Status preamble (verbatim)

```text
Status tags: RATIFIED = Erah-signed; DRAFT = Lab-drafted today, awaiting ratify; (unverified) as marked.
```

### 2.2 Items 2–9 (verbatim)

```text
2. **Remix vs fork** (DRAFT, (unverified)). Both are derivation events over pinned hashes. Remix = in-lineage derivation keeping the attribution edge; needs derive capability + upstream consent check. Fork = new lineage root; needs fork capability; marked-fork legibility attaches. Roadmap item 1 names the capability split view vs derive vs fork; shipped v0 vocab is {training, remix, redistribution} - wording reconciliation open. Source: roadmap item 1; consent-rail shipped key.
3. **Content-addressing for the LEDGER, not the bytes** (DRAFT; ratified ancestor position). Store = torrent model: tracker + swarm + optional origin; identity and transport separate; a store deleting removes only its own copy; stores are interchangeable commodity infrastructure. Source: corpus-hosting-addressing map; Creative-Platform-Vision-2026-08-26 (strategy/creative-platform-vision-2026-08-26, three-stores-by-owner).
4. **Identity** (DRAFT). Self-sovereign creator keypairs; platforms cannot sign outbound - the creator's key signs what propagates; platforms filter inbound. Source: consent-rail resolve_wallet/self-signed-bindings (roadmap invariant list); user-enforcement-mechanisms-2026-08-26.
5. **Consent grammar** (DRAFT; v0 primitives shipped). Per-creator/per-capacity signed grants; view vs derive vs fork distinct consent capabilities; subject-side inverse consent; revocation-by-supersession, never delete. Shipped: USE_VOCAB tri-state, undeclared is NEVER permission; tombstone via revokes=True, deposit-authoritative both ways. Source: project/zephyr-consent-rail-shipped-2026-09-29; consent-compliance-integration-2026-08-26; roadmap item 1.
6. **Log-not-chain** (DRAFT). Ledger = receipts + attestations, no global consensus; ledger keeps hashes, not bytes - "kept for the ledger, not the bytes." Source: wind doctrine + ledger-as-repo (established, payment-rails map header); defederation map A1 (Zephyrium-Protocol-First-Vision.md, merged 2026-04-15, commit e86b8a8).
7. **Enforcement: judge/jury/executioner separated** (DRAFT; mechanism exists, oldest anchors 2026-04-15 / 05-19 / 05-22). Flag = evidence (anyone); platform = judge (any single platform, voluntary); market discount = executioner (aggregates naturally). Defederation severs propagation edges, not already-copied bytes; defederated stores miss revocations -> drift into constructive violation with public receipts (legal-mechanism angle). Mob guard: zero/negative asymmetry. Residual threat: too-big-to-defederate. Story-law 09-17: "you do not break a story, you starve it and feed another." Source: 2026-09-29-defederation-consent-mechanism.md.
8. **Propagation topology** (DRAFT). Presence permissionless; propagation gated by federation edges. Cold-start = vouch(es) from good-faith platforms; reputation-weighted hash reports (immunology); quarantine-then-investigate. Data topography = fixed ledger (origin) + curated canals (platform views); filtering can dim, cannot unlog. Vouching is edge-level, not global-admission (anti-cartel; gravity-not-walls). Source: defederation map; decision/seams-relay-hosting-direction-2026-09-01; roadmap item 6.
9. **Economic levers** (DRAFT). 710-citizen lesson: availability != usage - measure usage (710 citizens, one payout, 1.50 USDC). x402 = interface layer, never split mechanism (09-08 ruling); rich-channel; micro-grant filing status unrecorded (unverified). Payment rails chosen for moral-policing resistance; Mollie/Mastercard case is the reference, no Stripe/PayPal deplatforming-history research in corpus (absence G1). Source: corpus-payment-rails map.
```

### 2.3 Open decisions register (verbatim, from the same anchor)

```text
## Open decisions register
| # | Decision | State | Where it lives |
|---|---|---|---|
| 1 | Consent grammar ratification (view/derive/fork scope + naming) | roadmap item 1, stage-C | Erah's Friday dossier nod; spec draft in stage-A |
| 2 | Remix/fork wording vs shipped USE_VOCAB {training, remix, redistribution} | unreconciled | item 2 above; reconcile at grammar ratify |
| 3 | Aliveness threshold N/M + dead-threshold + falsification instrument | sims running, ratify pre-launch, never silently post-launch | roadmap item 7; held-open #1 consent-compliance-integration |
| 4 | x402 micro-grant filing status | (unverified) no filing record in corpus | payment-rails map G.7 |
| 5 | 27B window / keystone pairing (flashnext-fixer-trial-v0 + night-keystone-v0; flip-gate: flash-next holds seat -> queue, do not fire) | LIVE FREEZE; seat-holder unprobed this run | roadmap header + Stage B gate |
| 6 | Too-big-to-defederate residual threat | named, no mechanism | defederation map C; item 7 above |
| 7 | Stablecoin issuer-freeze hedge (the unnamed hedge) | roadmap item 8, design draft stage | current-aim-consolidation OQ14 |
| 8 | Relay provider pick + OP wallet signup + LN fund (stage-C singles) | external-world, Erah clicks once | roadmap items 4/5/6 |

```

---

## 3. Key-certificate verification

Pending verification items: the U3k contributor key ceremony (Erah YubiKey root anchor + `ZEPHYR_HUMAN_ROOT_ANCHOR`, Dustin device-generated key) is **(unverified) — no landed completion key found** in mem.db (audit §A, item (c)). Related ratified anchor record, verbatim from mem.db:

### 3.1 `decision/yubikey-root-multi-anchor-first-two-keys-2026-08-04` (mem.db, verbatim)

```text
decision/yubikey-root-multi-anchor-first-two-keys-2026-08-04
RATIFIED 2026-08-04 (Erah, jellyfish PM session, after the four-lens sweep finding/yubikey-hardware-root-sweep-no-second-root-is-the-fork-2026-08-04).

DECISION 1 - MULTI-ANCHOR SCHEMA CHANGE COMES FIRST, THEN TWO YUBIKEYS. Erah chose "two YubiKeys, schema change first" over shipping a single-key hardware root. Rationale: it is the ONLY option that lets the software root actually be destroyed. Today registry.py has a single `ZEPHYR_HUMAN_ROOT_ANCHOR: str | None` read once at import and a strict depth-1 walk (registry.py:445-509) - no anchor list, no previous-anchor grace, no cross-signing, no threshold, no rotate()/supersede(), and `registered_by` is a single dict that structurally cannot hold two vouches. A PIV private key is non-exportable by construction, so a single hardware root has NO backup and cannot have one. Without multi-anchor, the only disaster-recovery plan is keeping erah-root.key alive on BRIX - a fully-privileged root readable by every service on the box, i.e. exactly the doctrine violation the whole effort exists to close. Erah declined that trade.
CONSEQUENCE - THE ARC GAINS A UNIT AND REORDERS:
  Y0 (NEW, first) = registry multi-anchor support: accept a SET of pinned anchors, keep depth-1, keep the additive tier (948 self_asserted entries must stay self_asserted, never invalid). Schema/verification only, no hardware.
  Y1 = hardware signer seam + detached prepare/sign/apply vouch flow + import-only mint (`--public-key-hex`, explicit `--assurance-tier`).
  Y2 = the ceremony itself (Erah's deliberate acts at the token), enrolling TWO YubiKeys, second kept OFFSITE.
  Plus the owed cross-repo packet doc PR (protocol/signing.md + components/identity/identity.md), which still defines NO tier vocabulary and still says a node "never needs to touch any of this human-key machinery".
Second-key enrollment is the point of Y0; without it Y2 cannot enroll a spare.

DECISION 2 - VERIFY THE MACBOOK BEFORE WRITING THE SPEC. Erah chose live verification over speccing on a contradicted document. The unit's premise is that signing happens on the MacBook; the /room/MacBook/ docs contradict each other on whether zephyr is even installed there, carry an `archetypes_core` blocker marked BLOCKING with a prescribed fix never confirmed, and mention no PIV tooling anywhere. If the MacBook is not ready the fallback is signing on BRIX where the software key already lives - which would defeat the unit's purpose. So readiness is a FACT TO ESTABLISH, not a precondition to assume.

CARRIED INTO THE SPECS (all sweep-proven this session, see the finding):
- assurance_tier MUST be set explicitly and asserted on the real entry; registry.py:152 defaults role=human to "hardware", so an unset tier yields root_tier="hardware" with no hardware behind it (proved in a scratch registry).
- Add a length check before verify_manifest; a 44-byte pubkey RAISES ValueError rather than returning False (proved), and PIV returns SPKI DER not raw 32 bytes.
- `apply` must re-derive the canonical target from the live entry and verify before writing; set_registered_by verifies nothing and overwrites unconditionally.
- prepare must emit sha256(target) and apply must recompute it - the trailing-newline hazard is real and untested.
- Add ~/.zephyr/human-root/ to _prod_guard_blocks' prefix list; the fixer runs as `jellyfish` and can read Erah's real root, and there is a prior key-escalation incident.
- New test files must declare their own autouse _scratch_env fixture; zephyr has NO conftest.py and a forgetful test runs against /data/zephyr/keys.
- Hardware dependency ships as an OPTIONAL extra imported inside the sign subcommand only; zephyr is on lapis-expert's PYTHONPATH and a module-scope import failure would stop that service starting.
- Revocation is a CLEAN FOLLOW-ON, not an ordering trap: proved that after the pin flip the NEW root can revoke the old.
```

Companion (mem.db, verbatim): `decision/zephyr-y0-registry-multi-anchor-bound-anchor-revocation-is-a-noop-2026-08-04` — exists; verify revocation semantics before any lock checklist cites it.

**Action for the lock:** produce landed evidence of (a) the U3k ceremony completion, (b) current Rafiki wallet liveness (June-era capture never re-run — audit (unverified)), (c) the OP-SDK signed-flow fold-back replacing the broken Python GNAP path (DEFERRED since 2026-06-14, no later landed key found).

---

## 4. OP vs Nostr ruling — PENDING (Erah's call)

The protocol lock needs an explicit statement of which payment surface v0 is: **Open Payments / Rafiki (interledger)** vs **Nostr tip-split beachhead** (audit §A missing-item (e)). Nothing in the ledger rules this. The most recent ruling on the Nostr side, verbatim from mem.db:

### 4.1 `decision/nostr-underlying-rails-not-community-2026-10-10` (mem.db, verbatim)

```text
decision/nostr-underlying-rails-not-community-2026-10-10
Ruled by Erah 2026-10-10 evening follow-in: Nostr is an underlying additional protocol beneath Seams, never a destination and never a community to court - the existing Nostr scene is doubted as warm to Seams. The migration thesis is Reddit-first; onboarding is keys-in relays-hidden: set your keys up, join Seams, you are done, no clients and no relay thinking. Purpose sentence for the pitch: decentralized collaboration on research and development and/or productization. Open scout question: whether any AI development communities exist on Nostr at all.
```

Evidence on the OP side of the scale: the Rafiki-testnet settlement proof is embedded in `02-attribution-payment.md` (mem.db `decision/zephyr-live-openpayments-settlement-2026-06-14`).

---

## 5. LICENSE absent from the knowledge-mesh seed repo

Verified 2026-10-12: `/data/git/knowledge-mesh-seed-working/` carries **no LICENSE file** (full file listing checked; audit §C flag (a) confirms). The zephyr code repo DOES (Apache-2.0 added in commit `c539ac1`). Open-protocol publishing of the seed packet needs an explicit license decision + LICENSE file first. Secondary flag (audit §C): `CLAUDE.md` in the seed repo carries an internal pointer (`@chub: conductor/lapis-ecosystem`) — harmless, but strip or scrub for the public packet.

---

## 6. Stale-source register (this dispatch's verification — honest ledger)

The v2 dispatch named sources that do not exist on disk as stated. All were probed (`find`/`git ls-files`/`grep` across `/data/git`, `/room`, `/data/memory`; direct sqlite3 key queries). Nothing below was silently dropped; where real content exists under a different path, the packet uses it and says so.

### 6.1 File paths

| Named in dispatch | Verified status 2026-10-12 | Real content location |
|---|---|---|
| `/data/git/zephyr[/working]/RAIKI.md` | **ABSENT** — no file named RAIKI anywhere on BRIX | "Rafiki" is the Interledger testnet server (interledger-test.dev); its evidence lives in mem.db (`decision/zephyr-live-openpayments-settlement-2026-06-14`) and in-repo `settler/op_flow.py`, `settler/gnap.py`, `demo/` (→ 02) |
| `PROTOCOL.md` | **ABSENT** | Real protocol docs: `/data/git/knowledge-mesh-seed-working/protocol/{mesh-protocol,invariants,signing,store-ownership,shared-corpus}.md` (5, not 3) (→ 01, 02) |
| `PRODUCT.md` | **ABSENT** | Product inventory = GW `reports/2026-10-12-vaultscan-product-cards.md` (14 product cards, run today) |
| `STRATEGY.md` | **ABSENT** | Stand-in: vault `Lapis/Seams-Business-Strategy-Synthesis-2026-08-25.md` (69,792 B) (→ 03) |
| `specs/` (12 docs) | **ABSENT from repo** | `/room/planning/specs/` holds the real zephyr spec series (23 files on disk; audit counts the same family as 24). Four essentials embedded verbatim in 01 |
| `protocol/` (3 docs, in zephyr repo) | **ABSENT from repo** | See km-seed `protocol/` above |
| `docs/` (3 docs) | **ABSENT** | — |
| `whitepaper/` | **ABSENT** (find across /data/git + /room empty) | — |
| `tests/` | **PRESENT** — 26 test files + conftest (inventory in 01) | `/data/git/zephyr[-working]/tests/` |
| km-seed `README` | **PRESENT** (6,267 B, BRIX+Mac top-level identical per audit §D) | `/data/git/knowledge-mesh-seed-working/README.md` |
| km-seed `SEED-DECISIONS` | **ABSENT** | Decision record lives in mem.db `decision/knowledge-mesh-seed-packet-*` family (2026-07-20/22, 6 keys) (→ 02) |
| km-seed `docs/protocol.md` (12KB), `docs/spec.md`, `docs/{agent,economics,identity,mesh}.md` | **ABSENT — no docs/ dir at all** | Actual layout: `README.md CLAUDE.md GROW.md protocol/ components/{identity,expert-service,governance,lapis-pm,keeper,persona,shared-corpus}/ conform/ seeds/ scripts/ fixtures/` (git ls-files verified) (→ 01, 02, 03) |
| km-seed `seed_packet.yaml` | **ABSENT** | Packet contract = `components/*/requirements.yaml` + `conform/` (schema embedded in 01) |
| GW `research/vault-scan-2026-10-12/02-product-cards.md` + `00-prelude.md` | **ABSENT at stated path** | Real: GW `reports/2026-10-12-vaultscan-product-cards.md` (24,368 B) + `reports/2026-10-12-vaultscan-store-domain-map.md` (10,116 B) — used instead |
| vault Lapis 6 docs (rail design, Fable brief, Strategy-Consent-Attribution, Consent-as-Binding-Seam, Context-Management, Dan-Priest) | **ALL PRESENT** — fetched verbatim (7,046–15,237 B each) | `/data/git/inertia-vault-working/Lapis/` (→ 02) |
| harvest `2026-10-12-i-want-it-now-harvest.md` | **PRESENT** (46,413 B) | `/data/git/inertia-vault-working/Lapis/Transcripts/harvests/` (→ 03) |
| GW audit report | **PRESENT**, sha256 `f9454f34...` verified against dispatch expectation | `reports/2026-10-12-protocol-assembly-audit.md` (→ §1 verbatim here) |

### 6.2 mem.db keys (BRIX `/data/memory/mem.db`, table `memories`) — 0 of 9 exact matches

Every dispatch-named key was queried by exact key AND by broadened LIKE on key+content. All nine exact keys **do not exist**. Verified real equivalents (each embedded verbatim at the arrow):

| Dispatch-named key (ABSENT) | Real key(s) used instead | Landed in |
|---|---|---|
| `decision/zephyr-payment-rail-design-ratified` | `decision/zephyr-op-rail-route-manifest-design-2026-07-20` (RATIFIED by Erah) + `decision/zephyr-op-rail-u2b-python-seams-split-2026-07-22` (RATIFIED U2 re-split) | 02 |
| `finding/raiki-testnet-money-plane-live-2026-09-18` | `decision/zephyr-live-openpayments-settlement-2026-06-14` — real cross-currency Rafiki-testnet settlement COMPLETED (outgoing-payment id 2725b490-4ebd-4ef2-8d71-bc584c03b6de) | 02 |
| `decision/zephyr-protocol-freeze-until-2026-09-24` | **No equivalent found** (LIKE %freeze% hits only claude-queue/swap-freeze infra rows, unrelated). GAP: protocol-freeze decision is not in the ledger; treat protocol status as governed by the audit's open items above | — |
| `decision/knowledge-mesh-protocol-seed-packet-2026-10-10` | `decision/knowledge-mesh-seed-packet-v0-gated-bound-2026-07-20`, `-layout-and-runner-2026-07-20`, `-invariants-2026-07-20`, `-s0b-landed-s1-scoping-2026-07-22` (+`-v0-forks-dirty-node-test`); no 2026-10-10 seed-packet key exists | 02 |
| `decision/knowledge-mesh-protocol-seed-packet-gw-mirror-2026-10-10` | **No equivalent found** (no %mirror% × %seed/packet% rows). Audit §D documents the Mac mirror top-level equivalence instead | 02 (note) |
| `decision/seams-anchor-decision-2026-10-04` | `zephyr/anchor-2026-09-29` (the anchor key; content embeds the doctrine one-liners + open decisions, verified live) + `decision/erah-rulings-2026-10-04-batch{,-2,-3}` (dated same day, unrelated batch) | 02/04 |
| `finding/seams-anti-patterns-experiment-2026-10-04` | **No equivalent found** (no anti-pattern key; content LIKE %anti-pattern% hits are unrelated). GAP line stands | — |
| `decision/consent-matrix-2026-09-22` | Consent ledger of record = the seams anchor doc's 10-item doctrine (§2 above; items 1,10 ratified, 2–9 open) + `project/zephyr-consent-rail-shipped-2026-09-29` (shipped v0 rail, verbatim in 02) | 02/04 |
| `decision/lapis-scope-consultation-forever-gate-2026-09-18` | **No equivalent found** (closest: `project/knowledge-mesh-consultation-mode-v0-skeleton-drafted-2026-05-13`, a v0 skeleton, not a gate ruling). GAP line stands | — |

### 6.3 Standing (unverified) debts carried into the lock checklist

1. Rafiki testnet wallet liveness today — June-era capture, never re-run (audit §A).
2. OP-SDK signed-flow fold-back into the repo — DEFERRED since 2026-06-14, no landed key after.
3. U3k contributor key ceremony completion — no landed key (§3).
4. Settlement-intents stop (PR#18) means the compensation seam is frozen at executor entry — any lock must state whether v0 ships with settlement minting off (audit §A item (d)).
5. Rail-design doc front-matter still reads `status: design-for-ratification` while the ledger records ratification — the flip to `ratified` is an open doc-write (read-only audit could not edit).
6. km-conform.py green against a live node — (unverified) (audit §C).
7. Disclosure-ruling items (Steam primary-source policy text; the "230 some odd upvotes" number) open by the ruling's own terms (audit §B; harvest 2026-10-12).
8. Free-tier freeze ruling ("the free tier never changes, it's always what you're going to give away for free, absolutely forever") has no home doc yet — belongs in the economics doc's trust-mechanism section (audit §B; → 03).
9. Platform purpose/services/user-model/flow/design checklist assigned in the 2026-10-12 harvest, not yet executed (→ 03).

