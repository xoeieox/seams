# 01 — Protocol Core

Packet: SEAMS / 2026-10-12 / keeper. The protocol proper — doctrine invariants, the Route-Manifest spec chain, the mesh-protocol invariant seam, the conformance contract, the code+tests surface. This is what Claude builds to. Path adjudication (dispatch names RAIKI.md / PROTOCOL.md / specs/ / whitepaper/ — all ABSENT from the zephyr repo; the real core is below) lives in `04-open-gaps.md` §6.1. The attribution→payment seam docs are in `02`; lock gaps in `04`.

---

## 1. Lock status

- Dispatch-named `decision/zephyr-protocol-freeze-until-2026-09-24`: **no such mem.db key** (04 §6.2) — there is no ledgered protocol freeze. Protocol status is governed by the audit's open items (04 §1) plus the practical freeze below.
- The live practical freeze: current main **stopped minting settlement intents** (PR#18 `stop-minting-settlement-intents-v0`, "relabel residue") — compensation seam frozen at executor entry **by design**, so present-tree settlement state is dormant. The lock must state whether v0 ships settlement minting ON or OFF (04 §6.3 item 4).
- Zephyr repo: `/data/git/zephyr-working` (132 files, branch main; audit §A). Public mirror lineage `github.com/xoeieox/zephyr` (Apache-2.0, added in commit `c539ac1` — verified locally: HEAD `c539ac1 Add Apache-2.0 license, NOTICE, README`).
- Doctrine one-liners anchor (mem.db `zephyr/anchor-2026-09-29`, verbatim digest): items 1 & 10 Erah-signed; 2–9 Lab-drafted awaiting ratify (full text 04 §2).

---

## 2. The zephyr repo README (VERBATIM — the repo's own protocol face)

Source: `/data/git/zephyr/README.md` (fetched 2026-10-12):

```text
# zephyr

Zephyr protocol, previously known as Zephyrium

Zephyr is a node-collaboration work-record substrate: an attribution log
plus deposit envelope. This repo is the in-vitro instance of the Zephyr
envelope and rides `archetypes_core.provenance` for provenance primitives.

## Layout

- `zephyr/` - core package: attribution log, claims, deposit, intent
  queue, registry, key minting, signing, routing.
- `settler/` - settlement leg: event log, ledger, GNAP flow helpers,
  operation flow, wallet map.
- `scripts/show_ledger.py` - inspect a local ledger.
- `fixtures/`, `demo/` - demo setup and key fixtures.
- `tests/` - test suite.

## Run / inspect

Python >= 3.10; runtime deps: `cryptography`, `httpx`.

```bash
pip install -e .
pytest
```

## License

Apache License 2.0 - see `LICENSE` and `NOTICE`.
```

---

## 3. The spec chain — `/room/planning/specs/` (VERBATIM, four essentials)

Real spec home (dispatch's `specs/12 docs` in-repo: ABSENT; the directory holds 23 zephyr-series files, e.g. `zephyr-agent-identity-anchor-v0.md`, `zephyr-signed-attribution-foundation-v0.md`, `zephyr-build-signed-envelope-v0.md`, `zephyr-aggregation-v0.md`, `zephyr-byte-serving-v0.md`, `zephyr-refund-v0.md`, `zephyr-vouch-v0.md`, `zephyr-human-node-vouch-v0.md`, the `zephyr-t4-*` series, `zephyr-stop-minting-settlement-intents-v0.md`, the `zephyr-use-terms-*` series, and the four embedded below). The audit's candidate manifest names exactly these four as the protocol-side essentials.

### 3.1 `zephyr-route-manifest-v0.md` — claims-as-deposits + RouteManifest compiler (rail U0+U1)

```text
---
spec_id: zephyr-route-manifest-v0
---
# Spec: zephyr-route-manifest-v0 - claims-as-deposits + RouteManifest compiler (rail U0+U1)

**Target ID:** `zephyr-route-manifest-v0`
**Repo:** `zephyr`
**Authority:** advisory (pure-additive Python module + tests, no service, no host ops, no settler changes)
**Verification:** tests-only (full suite via `python3 -m pytest tests/`; live payment path arrives in U2/U3)

## Context

First code unit of the attribution -> payment rail. Design + arc:
`/data/git/inertia-vault-working/Lapis/Architecture-Zephyr-Open-Payments-Rail-Design-2026-07-20.md`
(decision batch ratified by Erah 2026-07-20: rail lives in zephyr; Node SDK executor is a LATER
unit; compiler capped at 2 hops. AMENDED same day: the originally-proposed cited-origin payment
pattern was REMOVED by Erah - payable requires a registered key; contributor key provisioning
through proper channels is a named prerequisite unit for the first real payment).

Doctrine this unit executes, never violates:
- Route-not-compute (`decision/zephyr-attribution-not-valuation-route-not-compute-2026-06-24`):
  attribution sets the PATH, declared terms set the RATIO, the amount is EXOGENOUS. Nothing in
  this unit derives a share from any property of a contribution.
- Execute-declared-terms-only (`concept/rolling-attribution-via-inherited-terms-2026-07-07`).
- Void Principle: a beneficiary without a wallet is credited-but-unpaid, never dropped, never
  redistributed.
- Key doctrine (`decision/zephyr-agent-key-management-2026-06-08`): node keys never sign for
  human-namespace agent_ids; synthetic identities in all tests/demos.

This unit is PURE PYTHON, additive only. No settler changes, no Open Payments calls, no network,
no LLM (zephyr hard rule), no new pip dependencies, no DB schema migration (new payloads ride the
existing deposits columns: provenance_json + store_kind + target_key).

## Baseline

Author against **remote main `dd33f78`** ("feat(zephyr-demo): rebuild to 3-act purchase model
(schema 1.2)", PR #11). The local `-working` clone is 4 PRs behind; the fixer's isolated clone
tracks remote main, which already includes: `derived_from` nullable column on `deposits` +
`provenance["derived_from"]` passthrough (the lineage edge this compiler consumes),
`settler/event_log.py`, and the rebuilt 3-act demo. Do not touch any of those.

## Deliverables

### D1 - `zephyr/claims.py` (new module)

Two claim kinds, each recorded through the existing `record_signed()` chokepoint
(`zephyr/attribution.py:627` - signature verified by investigation; `store_kind` and `key` are
recorder-side columns, not part of the hash). Import `archetypes_core` only function-locally,
matching `record_signed`'s own convention.

**Storage - claims domain store (attestation-spine precedent).** attribution.db stores only the
provenance ENVELOPE; payloads live in domain stores. `zephyr/claims.py` therefore owns a claims
store: SQLite at `ZEPHYR_CLAIMS_DB` (default `/data/zephyr/claims.db`), WAL, tables:

```sql
wallet_bindings(manifest_hash TEXT PRIMARY KEY, subject TEXT, wallet_address TEXT,
                revokes INTEGER, note TEXT, summary TEXT, recorded_at TEXT);
routing_terms(manifest_hash TEXT PRIMARY KEY, subject TEXT, beneficiary_pubkey_id TEXT,
              share_bps INTEGER, basis TEXT, scope TEXT, declared_by TEXT, note TEXT,
              summary TEXT, recorded_at TEXT);
route_manifests(manifest_hash TEXT PRIMARY KEY, event_ref TEXT, payload_json TEXT,
                summary TEXT, recorded_at TEXT, supersedes TEXT);
```

One signing act, two homes (exactly as the attestation spine does it): each record helper calls
`record_signed` FIRST; only on success does it insert the domain row (deposit failure -> raise,
no domain row - an unsigned claim can never exist in the store). The `summary` string is stored
in the domain row because it is hashed into manifest_hash but is not an attribution.db column.

**Integrity bind on read (tamper-proof consumption).** When the compiler consumes a claim it
MUST: (1) load the domain row (absent when the deposit demands one ->
`RouteTamperError(failure_mode="missing_domain_row")`); (2) load the deposit envelope for its
manifest_hash from attribution.db (absent -> `RouteTamperError("missing_envelope")`);
(3) recompute the canonical hash and require it to equal the stored manifest_hash, else
`RouteTamperError("hash_mismatch")`. The canonical algorithm, stated here so no external file
read is needed: `hashable = json.dumps({"payload": payload_dict, "provenance": prov_dict,
"summary": summary}, sort_keys=True, separators=(",", ":"))` with `prov_dict` = the envelope
dict minus its `manifest_hash`, `signature`, `pubkey_id` keys, then
`"sha256:" + sha256(hashable.encode("utf-8")).hexdigest()` - byte-for-byte what
`archetypes_core.provenance._canonical_json`/`to_lapis_return` do (the fixer SHOULD call
`archetypes_core.provenance` helpers rather than reimplement, but the algorithm above is the
normative contract either way); (4) require `verify_row(...).status == "verified"` on the
envelope - any other status raises `RouteTamperError` with the status as failure_mode. This
makes the claims store untrusted cache, the signed deposit the sole authority.

**Wallet binding** - SELF-SIGNED ONLY (ratified by Erah 2026-07-20: no proxy/declared wallet
claims for unkeyed parties - that backdoor does not exist in this rail. Payable requires a
cryptographic identity. When a real person deserves payment, the answer is provisioning them a
key through proper channels - a separate named unit and our responsibility - never a claim
recorded on their behalf.)

```python
def record_wallet_binding(
    *,
    subject: str,                 # pubkey_id - MUST equal the signing key's own pubkey_id
    wallet_address: str,
    agent_id: str,                # recording identity, synthetic/agent namespace
    revokes: bool = False,        # omitted in payload input -> treated as False
    note: str = "",
    signer=None, registry=None, recorder=None,   # injectable, default to singletons
    timestamp: str | None = None,
) -> dict:                        # record_signed's return dict
```

Payload (under top-level key `"wallet_binding"`):

```json
{"wallet_binding": {
   "subject": "<pubkey_id>",
   "wallet_address": "https://...",
   "revokes": false,
   "note": ""}}
```

Rules (enforced in the helper, ValueError on violation):
- The resolved signer's own `pubkey_id_str` MUST equal `subject` (the helper reads it from the
  injected-or-singleton `AgentSigner`, the same object that will sign the deposit - so the
  self-check and the signature come from one key by construction). A key binds only itself;
  no other binding method exists. This closes the wallet_map spoof surface AND makes the
  proxy-binding backdoor inexpressible at the API - there is no field with which to bind
  someone else.
- `wallet_address` must parse as https URL.
- Recorded with `store_kind="wallet_binding"`, `key=subject`, `summary` one-line human string.
- `revokes` defaults to False when omitted from a stored payload; readers MUST treat a missing
  field as False (explicit, to prevent implementation variance).
- Revocation is append-only: a later deposit with `revokes: true` for the same subject tombstones
  earlier bindings. No row is ever mutated.

**Routing terms** signature mirrors `record_wallet_binding` exactly (same injectables, same
`timestamp=` passthrough, same return shape), with the payload fields below as keyword args.

**Resolution** - `resolve_wallet(subject: str, *, store=None, log=None, registry=None) -> str | None`
(injectables default to singletons, same pattern as `record_signed`). Latest (by `recorded_at`,
tie-break manifest_hash ascending) non-revoked wallet_binding for `subject` from the claims
store, integrity-bound per the read procedure above (recompute hash + `verify_row` ==
"verified"); None if absent or revoked. Unverified or tampered bindings are never resolved
(fail closed - money must not follow an unverifiable claim).

Payload (under top-level key `"routing_terms"`):

```json
{"routing_terms": {
   "subject": "<manifest_hash of the contribution deposit this term routes for>",
   "beneficiary_pubkey_id": "<pubkey_id>",
   "share_bps": 4000,
   "basis": "declared-contract",
   "scope": "event:<ref>" | "standing",
   "declared_by": "<agent_id string, required>",
   "note": ""}}
```

Rules: `beneficiary_pubkey_id` must be a REGISTERED pubkey_id (present in the PubkeyRegistry at
record time - hard ValueError otherwise; a term may only name a beneficiary who already holds a
key, per the same Erah ratification: attribution citations may credit anyone, but routing terms
target only cryptographic identities. Facets divergence resolved on the ratification's side:
NO pending-identity soft state - key provisioning precedes term declaration, and the friction
is the signal that the key ceremony is owed); `share_bps` integer in [0, 10000]; `basis` fixed
`"declared-contract"` in v0 (the value is a DECLARED ratio - the helper takes it as given and
validates bounds only; it must contain no logic that could compute a ratio from anything);
`scope="standing"` marks an inheritable pass-through term on a work; `scope="event:<ref>"`
binds the term to one value event. Recorded with `store_kind="routing_terms"`, `key=subject`.

### D2 - `zephyr/routing.py` (new module) - the compiler

Exceptions (defined in this module, exact hierarchy):

```python
class RouteCompileError(ValueError):
    """Compile refused. Message format: '<reason>: <offending manifest_hash or field>'."""

class RouteDepthExceeded(RouteCompileError):
    """Lineage deeper than the ratified 2-hop cap. Message names the deposit whose
    derived_from + standing term would extend the route beyond depth 2."""

class RouteReplayConflict(RouteCompileError):
    """A route_manifest already exists for this event_ref with DIFFERENT content.
    Message names both manifest_hashes. Recompiling identical inputs is NOT a
    conflict (idempotent return); same event with changed amount/terms is."""

class RouteTamperError(RouteCompileError):
    """Integrity-bind failure on a consumed claim (Facets mandate: distinguish
    active tamper / corruption from logic errors). Carries `failure_mode`, one of:
    'hash_mismatch' (domain payload does not re-hash to its deposit),
    'signature_invalid', 'unknown_key', 'revoked_key', 'unsigned' (verify_row
    statuses), 'missing_envelope' (domain row with no attribution.db deposit),
    'missing_domain_row' (deposit with no claims-store row when one is required).
    Message names the manifest_hash and the failure_mode."""
```

```python
def compile_route_manifest(
    *,
    event_kind: str,          # e.g. "km-slot-close", "demo-sale"
    event_ref: str,           # opaque event id, becomes target_key
    subject: str,             # manifest_hash of the sold/paid work's deposit
    amount_value: int,        # exogenous, integer smallest units - NEVER computed here
    asset_code: str,
    asset_scale: int,
    log, registry, signer,    # injectable, defaulting to singletons like record_signed does
    agent_id: str,            # recording identity (synthetic/agent namespace)
    timestamp: str | None = None,   # injectable for deterministic tests
) -> dict:                    # {"manifest_hash", "pubkey_id", "signature", "newly_recorded", "manifest"}
```

Compile stages, strictly in order (validation fully precedes the deposit - validation and
execution are decoupled by design; this function never moves money):

0. **Replay guard - allocation immutable, resolution current (Council block resolution).**
   The manifest payload commits to BOTH layers: the allocation layer (event, amount_in, legs'
   beneficiary_pubkey_id + amount + derivation, payer_retained, depth - derived from terms and
   lineage) and the resolution layer (each leg's wallet_address + leg_status - derived from
   current bindings). Every compile recomputes both, then queries the claims store for the
   latest route_manifest with this `event_ref`:
   - No prior manifest -> record new.
   - Would-be payload byte-identical to the latest (byte-identity defined as equality of the
     canonical serialization: `json.dumps(payload, sort_keys=True, separators=(",", ":"))`) ->
     return it, `newly_recorded=False`
     (idempotent - a compile NEVER returns a routable claim it did not just re-verify, because
     resolution was recomputed on this call).
   - Allocation layer identical, resolution layer changed (a binding was created, revoked, or
     re-pointed since) -> record a NEW manifest whose payload carries
     `"supersedes": "<prior manifest_hash>"`; the prior stays in the append-only log as the
     truth of its moment; the latest-for-event_ref is the only executable one. The terrain
     stays current without reopening allocation.
   - Allocation layer differs -> `RouteReplayConflict` naming both manifest_hashes. One
     event_ref allocates at most once - double-allocation is structurally impossible at the
     compiler.
   Executor contract (U2, normative here): the executor MUST re-run the resolution check per
   leg at execution time and refuse any leg whose binding is revoked or no longer verified -
   fail closed at both layers; a stale `routable` never pays.
1. **Gather.** `log.get(subject)` for the subject deposit envelope (its `derived_from` read
   from the envelope/column); from the CLAIMS STORE, all routing_terms rows with
   `subject == subject` and scope `"standing"` or `"event:<event_ref>"`, each integrity-bound
   per the D1 read procedure; the parent's `"standing"` routing_terms the same way. Zero
   standing terms on the parent is valid and simply yields no pass-through leg.
2. **Verify consumed claims - bound to exact content.** Every deposit consumed (subject, each
   term, each wallet binding resolved later) must have `verify_row(...).status == "verified"`,
   where `verify_row` is called on the row AS LOADED in this compile - the signature check runs
   over the stored manifest_hash, which commits to the exact payload bytes (canonical-JSON hash,
   `archetypes_core.provenance` lines 403-415). The manifest's `derivation.term_refs` /
   `edge_refs` record precisely those consumed manifest_hashes, so the emitted manifest is
   cryptographically bound to the exact claim content it compiled from - re-verification of the
   chain is a pure read. Any non-"verified" status -> `RouteCompileError` naming the offending
   manifest_hash. Fail closed: every leg of every payment must trace to a SIGNED, VERIFIED
   attribution edge.
   **Replay binding:** a routing_terms deposit is consumed ONLY when its `terms.subject` equals
   this compile's `subject` (or the parent, for the standing pass-through term) - a term
   recorded for work X can never be replayed onto work Y because subject-match is part of the
   gather predicate, and the subject is itself a content-addressed manifest_hash.
3. **Validate terms.** Direct terms: sum of `share_bps` over the event's direct terms must be
   <= 10000, each in [0, 10000]; duplicate (subject, beneficiary) terms -> `RouteCompileError`.
   Pass-through: at most ONE standing term on the parent in v0 - two or more ->
   `RouteCompileError` (a chained pair of single-pass-through terms may not be composed to
   simulate deeper lineage). Depth enforcement (**2-hop cap, ratified**): if the parent deposit
   itself carries `derived_from` AND any standing routing_terms exists for that grandparent
   subject -> `RouteDepthExceeded`. Legs may derive from the subject's direct terms plus one
   parent pass-through, nothing deeper, and the check is structural (inspects the actual
   lineage + terms present in the log), not an argument the caller can vary.
4. **Allocate - exact integer conservation.** Buckets = each direct-term beneficiary (its
   share_bps) + an implicit payer-retained bucket (10000 - sum_bps). Allocate `amount_value`
   across buckets by largest-remainder: floor each exact share (`(amount_value * bps) // 10000`,
   integer math), then distribute the remaining units one each to buckets sorted ASCENDING by
   the total ordering key `(-remainder_numerator, is_payer_bucket, beneficiary_pubkey_id)` where
   `remainder_numerator = (amount_value * bps) % 10000` and `is_payer_bucket` maps to integer
   0 for beneficiary buckets, 1 for the payer bucket - i.e. larger exact remainder first;
   on EXACTLY equal remainders, beneficiary buckets first (0 < 1), among them lexicographically
   ascending `beneficiary_pubkey_id`, payer bucket strictly last (its third key is the empty
   string but the comparison never reaches it - `is_payer_bucket` already ordered it last).
   Concrete tie example: amount 3, bps {A: 2500, B: 2500, C: 2500} -> floors 0/0/0, remainders
   all 7500, payer remainder 7500: the 3 units go to A, B, C in id order; payer_retained 0. This ordering is total and
   deterministic; two implementations of this spec must produce byte-identical allocations for
   any input. Then apply the single
   pass-through hop: for the leg(s) whose beneficiary is the subject's contributor and where the
   parent standing term (rate r bps) applies, split that leg by the same largest-remainder rule:
   parent receives r bps of the leg amount, original beneficiary keeps the rest. INVARIANT
   (test-enforced): payer_retained + sum(leg amounts) == amount_value exactly, every amount a
   non-negative integer, for every input. The compiler never creates, destroys, or rounds value
   away.
5. **Resolve wallets.** Per leg, `resolve_wallet(beneficiary_pubkey_id)`. Missing binding ->
   `wallet_address: null` (Python `None`, serializing to JSON `null`),
   `leg_status: "credited-unpaid"` (Void Principle: leg stays in the
   manifest at full amount; a later executor unit skips it and it remains pending; it is never
   dropped or redistributed). Resolved -> `leg_status: "routable"`.
6. **Emit + deposit.** Manifest payload (top-level key `"route_manifest"`):

```json
{"route_manifest": {
   "schema": "zephyr-route-manifest-v0",
   "event": {"kind": "...", "ref": "...", "subject": "sha256:..."},
   "amount_in": {"value": 500, "asset_code": "USD", "asset_scale": 2},
   "payer_retained": 300,
   "legs": [
     {"beneficiary_pubkey_id": "ed25519:...",
      "amount": 180, "wallet_address": "https://... | null",
      "leg_status": "routable | credited-unpaid",
      "derivation": {"term_refs": ["sha256:..."], "edge_refs": ["sha256:..."],
                     "algorithm": "declared-split+single-passthrough-v0"}}],
   "depth": 1}}
```

   `edge_refs` is NORMATIVE, not decorative (Facets lineage-binding mandate): it MUST be
   exactly `[subject_manifest_hash]` for direct legs and
   `[subject_manifest_hash, parent_manifest_hash]` in that order for pass-through legs - so the
   manifest cryptographically commits to the exact lineage context it compiled under, and a
   term verified under one lineage cannot be silently re-applied under a reordered or different
   chain (the manifest bytes, and therefore its hash and signature, change with the lineage).
   The top-level payload additionally carries `"supersedes": "<manifest_hash>"` when and only
   when this manifest replaces a prior one for the same event_ref under the stage-0 rule
   (absent otherwise, never null).

   Recorded via `record_signed(payload, agent_id=..., tool="zephyr:route-compile",
   store_kind="route_manifest", key=event_ref, summary=..., timestamp=timestamp)`.
   Determinism (test-enforced): identical inputs incl. injected timestamp -> byte-identical
   payload -> identical manifest_hash -> `newly_recorded=False` on recompile (INSERT-OR-IGNORE
   idempotency comes free from the recorder). Leg order: direct legs by `beneficiary_pubkey_id`
   ascending, pass-through leg(s) immediately after their source leg.

Worked example (normative, use in tests): amount 500, direct terms {D: 4000 bps, M: 2500 bps},
parent standing term on D's work {P: 1000 bps}. Buckets: D 200, M 125, payer 175. Pass-through
on D's leg: P gets 20, D keeps 180. Final: payer_retained 175, legs D=180, M=125, P=20; total
500 exact.

### D3 - CLI

`python -m zephyr.route` implemented as `zephyr/route.py` with a `main()` + `if __name__ ==
"__main__"` block (exactly the `zephyr/deposit.py` structure - that file is the template).
Argparse mirror of `zephyr/deposit.py` conventions: `--event-kind
--event-ref --subject --amount --asset-code --asset-scale --agent-id [--key <signer key path>]`;
prints the compile result JSON (manifest + manifest_hash + newly_recorded) to stdout, exit 1 with
a one-line stderr message on RouteCompileError/RouteDepthExceeded.

### D4 - Docs

CLAUDE.md: one short section documenting the two claim kinds + the compiler under the existing
Rules/vocabulary style, explicitly restating: the compiler executes declared terms and computes
nothing about worth; store_kinds `wallet_binding`, `routing_terms`, `route_manifest` join the
observed-vocabulary list.

## Non-goals (explicit, for the reviewer)

- NO changes under `settler/` (the executor unit U2 replaces op_flow/gnap with the proven Node
  SDK flow and consumes manifests; wallet_map.json retires THEN, not now).
- NO full-DAG rate composition (U5 re-implements the recursive pass-through DoD; this unit's
  2-hop cap is a ratified scope decision, enforced by `RouteDepthExceeded`).
- NO payment execution, no OP/GNAP/network code, no changes to `demo/run_demo.py`,
  `fixtures/`, `settler/event_log.py`, or the deposits schema (no new columns; `derived_from`
  is consumed read-only, never repurposed).
- NO human-key or anchor work (Dustin self-signed identity is a later named unit).
- NO proxy/declared wallet bindings and NO cited-origin beneficiaries - REMOVED by Erah's
  ratification 2026-07-20, not deferred. Attribution citations may still credit anyone
  (unchanged, elsewhere in zephyr); this rail routes money only to registered keys with
  self-signed wallet bindings. Provisioning a real contributor's key through proper channels
  (device-held, human-anchored where applicable) is a separate named unit in the design doc and
  a prerequisite for the first real payment - our responsibility to set up, never to simulate.

## Acceptance criteria

Test files: `tests/test_claims.py`, `tests/test_routing.py`, AC-numbered per repo convention
("Coverage map" docstring). All fixtures build fresh `AttributionLog`/`PubkeyRegistry`/
`AgentSigner` in `tmp_path` (repo pattern, `test_attribution_signed.py:39-54`); synthetic
identities only (`agent:route-test`, `agent:claims-test`); no writes outside tmp dirs.

- **AC1** self wallet_binding: record under a tmp key, `resolve_wallet` returns it; recorded row
  `verify_row` == verified.
- **AC2** binding is self-only: `record_wallet_binding` with a signer whose pubkey_id !=
  subject raises; there is no parameter with which to record a binding for another party
  (asserted by signature inspection in the test - no `method`/`declared_by`/`subject_kind`
  accepted).
- **AC3** routing_terms bounds: share_bps -1 and 10001 raise; event-scoped direct terms summing
  > 10000 raise at compile; duplicate (subject, beneficiary) raises; a `beneficiary_pubkey_id`
  absent from the registry raises at record time.
- **AC4** conservation: for a parametrized grid (amounts 1, 2, 3, 499, 500, 501, 999999,
  1000003; bps sets incl. {3333, 3333, 3334}, {1, 1, 1}, {9999}, {5000, 5000}, and the
  exact-tie set {2500, 2500, 2500} on amounts 3 and 7) - payer_retained + sum(legs) == amount
  exactly, all amounts >= 0, largest-remainder matches a brute-force exact-rational reference
  implemented independently in the test, and tie-cases assign remainder units in the specified
  total order (beneficiaries lexicographic, payer bucket last).
- **AC5** the normative worked example above verbatim (500 -> 175/180/125/20); a 3-hop chain
  (parent's parent has a standing term) raises `RouteDepthExceeded`; TWO standing terms on the
  parent raise `RouteCompileError` (chain-attack guard).
- **AC6** missing wallet binding -> leg present, full amount, `leg_status="credited-unpaid"`,
  `wallet_address` null - AND the other legs' amounts + payer_retained are byte-identical to
  the fully-bound compile of the same inputs (an unresolved wallet never degrades allocation,
  only leg_status).
- **AC7** determinism + idempotency: two compiles with identical inputs and injected timestamp
  produce identical manifest_hash, second returns `newly_recorded=False`.
- **AC8** fail closed: an UNSIGNED routing_terms deposit (recorded in observe mode without
  signature) causes compile to raise, naming the offending manifest_hash.
- **AC9** CLI happy path: end-to-end against tmp DBs via env vars
  (`ZEPHYR_ATTRIBUTION_DB`/`ZEPHYR_KEYS_DIR`/`ZEPHYR_AGENT_KEY_PATH`/`ZEPHYR_CLAIMS_DB`),
  valid JSON on stdout.
- **AC10** `record_wallet_binding`/`record_routing_terms` with a human-namespace `agent_id`
  raise (inherited from `record_signed`'s guard - test confirms the guard holds through the new
  helpers).
- **AC11** replay binding: a verified routing_terms deposit whose `terms.subject` is work X is
  NOT consumed when compiling an event for work Y (Y's compile with only X-terms present yields
  zero legs, full payer_retained).
- **AC12** replay guard: recompiling the same `event_ref` with identical inputs returns the
  existing record (`newly_recorded=False`, no second route_manifest row for that event_ref);
  recompiling the same `event_ref` with a different amount raises `RouteReplayConflict` naming
  both manifest_hashes, and no new row is recorded.
- **AC13** tamper detection: edit a routing_terms domain row's `share_bps` directly in the
  claims store (bypassing the helper) - compile raises `RouteTamperError` with
  `failure_mode="hash_mismatch"` naming that manifest_hash; a claims row whose deposit is
  absent from attribution.db raises `RouteTamperError("missing_envelope")`; an unsigned
  consumed deposit raises `RouteTamperError("unsigned")` (AC8 asserts this specific mode too).
- **AC14** resolution supersession (Council block resolution): compile with a bound wallet
  (leg routable) -> revoke the binding -> recompile: a NEW manifest is recorded carrying
  `supersedes` = the first manifest_hash, allocation-layer fields byte-identical, the leg now
  `credited-unpaid` with null wallet; a third identical compile is idempotent on the new
  manifest (`newly_recorded=False`). The first manifest remains in both stores untouched.

## Definition of Done

1. All ACs green via `python3 -m pytest tests/` **from the clone root** (NOT bare `pytest` -
   the host has an editable zephyr install whose `.pth` would shadow the clone; `python3 -m`
   puts the clone first on sys.path). Full suite passes, not only the new files.
2. `git diff --stat` touches only: `zephyr/claims.py`, `zephyr/routing.py`, `zephyr/route.py`
   (or `__main__` wiring for the CLI), `tests/test_claims.py`, `tests/test_routing.py`,
   `CLAUDE.md`, and optionally the one-line store_kind help string in `zephyr/deposit.py:35`
   (the only two vocabulary surfaces in the repo are that help string and CLAUDE.md - verified
   by investigation; no separate registry file exists).
3. No new entries in `pyproject.toml` dependencies; no imports beyond stdlib +
   existing zephyr modules + function-local `archetypes_core.provenance`.
4. PR opened against main via the forgejo helper (`create_pr(repo='zephyr', ...)`, token from
   `/data/agents/config/conductor.env`), branch `feat/route-manifest-v0`.

## Fixer notes

- Clone tracks remote main `dd33f78` - `derived_from` exists as a deposits column and a
  provenance-dict key there; read it via the recorded provenance dict (`provenance_json` or the
  `derived_from` column, either is acceptable; do not write it).
- `archetypes_core` resolves via a host-global editable install
  (`/home/jellyfish/.local/lib/python3.12/site-packages/__editable__.archetypes_core-0.1.0.pth`
  -> `/data/git/archetypes-core`); no pyproject change needed and none permitted.
- `to_lapis_return` accepts `timestamp=` - thread the compiler's injectable timestamp through
  `record_signed(**prov_kwargs)` for AC7 determinism; without injection it defaults to now and
  the hash changes every run.
- `summary` is hashed into manifest_hash but is NOT a deposits column - never rely on reading
  it back from the DB.
- Amount arithmetic: integers only, no float, no Decimal division shortcuts - integer
  `(amount * bps) // 10000` plus explicit remainder handling (repo has zero float money and
  this unit must keep it that way).
```

### 3.2 `zephyr-route-manifest-hardening-v0.md`

```text
---
spec_id: zephyr-route-manifest-hardening-v0
---
# Spec: zephyr-route-manifest-hardening-v0 - supersedes-chain integrity + executor contract surface (rail U2a)

**Target ID:** `zephyr-route-manifest-hardening-v0`
**Repo:** `zephyr`
**Authority:** hold (modifies the landed money-path compiler; no network, no service, no host ops, no secrets, no value movement)
**Verification:** tests-only (full suite via `python3 -m pytest tests/` from the clone root; live payment path arrives in U2b/U3)

## Context

Rail unit U2a. Design doc: `/data/git/inertia-vault-working/Lapis/Architecture-Zephyr-Open-Payments-Rail-Design-2026-07-20.md`
(decision `decision/zephyr-op-rail-route-manifest-design-2026-07-20`, RATIFIED 2026-07-20; the cited-origin
payment pattern was REMOVED the same session - payable requires a registered key, no pending-identity state).

U0+U1 landed as zephyr PR #12 (`9b66e6d`, merged to main `1f67ce6`). Its authority was `advisory`, so it
auto-landed without a human review gate. Post-hoc verification 2026-07-21 confirmed all five load-bearing
constraints are genuinely implemented - two-layer manifest, payable-requires-key, claims domain store with
integrity bind, exogenous amount with largest-remainder conservation, 2-hop cap - and found three defects,
all of which the U2b executor would build directly on top of. **This unit closes those three and lands the
re-verification surface the executor needs. It ships no payment code.**

The arc splits U2 deliberately: U2a (this unit) hardens the compile side in pure Python; U2b folds in the
Node `@interledger/open-payments` executor. U2b is specced against a verified foundation, not one it has to
repair mid-flight.

Doctrine this unit executes, never violates:

- **Route, never compute.** The amount is exogenous. No share is derived from attribution essence
  (`decision/zephyr-attribution-routes-not-values-2026-06-24`). Nothing in this unit reads content to size a leg.
- **Payable requires a key; credit does not.** Money moves only to self-signed wallet bindings; routing terms
  may only name registered pubkey identities. Credited-but-unpaid is a first-class permanent state and an
  unpayable share is NEVER silently redistributed (Void Principle).
- **Fail closed at both layers.** A settlement leg that cannot cite the manifest_hash of a verified deposit
  does not execute. A stale `routable` never pays.
- **No model in the money path.** Compile and execute are deterministic, LLM-free code
  (extends zephyr core's no-LLM rule; trivially satisfies the no-direct-Anthropic-API rule).
- **Synthetic identities only** in tests and demos; node keys never sign for human-namespace agent_ids
  (`decision/zephyr-agent-key-management-2026-06-08`).

Hard constraints: pure Python, stdlib + existing zephyr modules + function-local `archetypes_core.provenance`
only. No network calls. No new dependencies. No deposits-schema migration. No LLM. Integer money arithmetic
only - no float, no Decimal division shortcuts.

## Baseline

Author against **remote main `1f67ce6`** ("Merge pull request 'feat(zephyr-route-manifest-v0): claims domain
store + RouteManifest compiler' (#12)"). The fixer's clone tracks remote; the local `-working` tree may be
stale or dirty and is not the reference.

Remote main already contains `zephyr/claims.py` (546 lines), `zephyr/routing.py` (429 lines), `zephyr/route.py`
(73 lines), `tests/test_claims.py`, `tests/test_routing.py`, and the `derived_from` + `event_log` + 3-act demo
work from PRs #8-#11. This unit MODIFIES `claims.py` and `routing.py` and EXTENDS both test files. It does not
touch `demo/`, `fixtures/`, `settler/`, or the deposits schema.

## Deliverables

### D1 - Walk the supersedes chain (`zephyr/claims.py`)

**The defect.** `latest_route_manifest_for_event` (`claims.py:204-215`) selects the head with
`max(rows, key=lambda r: (r["recorded_at"], r["manifest_hash"]))`. `recorded_at` is caller-supplied
(`routing.py:425` passes `timestamp or now`, and `timestamp` is an injectable compiler argument). The
`supersedes` column is written (`routing.py:401`) and persisted (`routing.py:426`) but **never read**. So two
manifests for one `event_ref` with equal injected timestamps resolve by hash ordering, and a superseded
manifest can become the head again. AC14 sidesteps this by using strictly increasing timestamps. This is the
revocation hole the Mirror Council blocked round 3 on, re-entering through a side door: a resurrected head
carries the pre-revocation resolution layer, so a revoked binding becomes routable again.

**The fix.** Head selection becomes a chain walk over the `supersedes` edges, not a sort. Timestamps stop
being load-bearing for correctness.

New/changed on `ClaimsStore`:

```python
def route_manifest_chain_for_event(self, event_ref: str) -> list[dict]:
    """All manifests for event_ref ordered oldest -> newest by supersedes edges.

    Raises RouteChainError on any malformed chain. Empty list if none.
    """

def latest_route_manifest_for_event(self, event_ref: str) -> dict | None:
    """The unique chain head - the manifest no other manifest supersedes.

    Raises RouteChainError rather than guessing when the chain is malformed.
    """
```

Head derivation, normative:

1. Load all rows for `event_ref`. If none, return `None`.
2. Build `superseded = {r["supersedes"] for r in rows if r["supersedes"]}`.
3. `heads = [r for r in rows if r["manifest_hash"] not in superseded]`.
4. Exactly one head -> return it. **Zero heads -> `RouteChainError("cycle")`. More than one head ->
   `RouteChainError("forked_chain")` naming every candidate hash.** Never pick one.
5. Additionally validate reachability: walking `supersedes` back from the head must visit every row exactly
   once and terminate at the unique row whose `supersedes` is NULL. Otherwise `RouteChainError("orphaned")`
   (a row for this event_ref not on the head's chain) or `RouteChainError("multiple_roots")`.

`RouteChainError` carries `.failure_mode` in `{"cycle", "forked_chain", "orphaned", "multiple_roots",
"supersedes_not_head"}` and `.event_ref`. **Define it in `zephyr/claims.py` and re-export it from
`zephyr/routing.py`** - not the reverse, and this is not the fixer's choice. Import graph verified against
`1f67ce6`: `routing.py` imports `claims.py` (`routing.py:175-179`), so defining the exception in `routing.py`
and importing it back into `claims.py` would be a cycle. `attribution.py` imports neither module and mediates
nothing here. It must remain importable as `zephyr.routing.RouteChainError`, since `zephyr.routing` is the
executor's entry module.

**Write-side guard (this is what makes the chain well-formed by construction).** `insert_route_manifest` must
reject a fork at write time: if any manifest already exists for the `event_ref`, the incoming `supersedes`
MUST equal the current head's `manifest_hash`. Otherwise raise `RouteChainError("supersedes_not_head")` and
insert nothing. The first manifest for an `event_ref` must have `supersedes` NULL. Note the existing
`INSERT OR IGNORE` (`claims.py:196`) makes re-inserting an identical `manifest_hash` a no-op - preserve that,
and check the guard only for a genuinely new hash, so the idempotent-recompile path (`routing.py:375-384`)
still returns `newly_recorded=False` without raising.

**Atomicity (Council round-1 finding, technical-integrity + trickster).** The write-side guard is a
check-then-insert and is therefore a TOCTOU window: two concurrent compiles for one `event_ref` can each read
the same head, each pass the guard, and both insert - forging exactly the fork the guard exists to prevent, and
leaving the store permanently unreadable (`RouteChainError("forked_chain")` on every subsequent call, fail-closed
but wedged). Head read and insert MUST execute inside a single `BEGIN IMMEDIATE` transaction on the existing
`self._conn`, committed or rolled back as a unit, so the write lock is held across both. The existing
`self._lock` is in-process only and does not protect against a second process - and the compiler is reachable
from the CLI, so a second process is real.

Error handling inside that transaction, specified rather than left to judgment:
- `RouteChainError` (the guard firing) -> roll back, re-raise unchanged. This is a correct refusal, not a fault.
- `sqlite3.OperationalError` with "database is locked" -> roll back and retry the whole read-check-insert with
  bounded backoff (5 attempts, 50ms doubling). Exhausted -> re-raise. `BEGIN IMMEDIATE` acquires the write lock
  up front, so contention surfaces here rather than mid-transaction; set a connection `timeout` as well.
- `sqlite3.IntegrityError` -> roll back and re-raise. It means the schema guarantee was violated, which is a bug,
  not a race to absorb.
- Anything else -> roll back and let it propagate unchanged. Never swallow, never convert to a return value.

Never leave a partial insert under any of these paths.

**Defense in depth: enforce the invariant in the schema too** (round-4: `technical-integrity` and `transmuter`
converged on this independently). The application guard is necessary but it lives in code a future edit can
bypass; put the structural guarantee where the engine enforces it:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS route_manifests_chain_unique
    ON route_manifests(event_ref, COALESCE(supersedes, 'ROOT'));
```

`COALESCE(supersedes, 'ROOT')` is load-bearing: SQLite treats NULLs as distinct in a UNIQUE index, so a bare
`UNIQUE(event_ref, supersedes)` would happily admit two NULL-supersedes roots - the `multiple_roots` case. The
expression form collapses them and makes a second root a constraint violation at the engine level. SQLite has
supported indexes on expressions since 3.9, which is well below any version in play here.

With this index in place, a fork raises `sqlite3.IntegrityError` even if the application guard is somehow
bypassed. The guard still runs first and still raises `RouteChainError("supersedes_not_head")`, because it gives
the caller a precise semantic reason rather than an opaque constraint failure - the index is the backstop, not
the primary signal. Add the index in the same migration path as D1b's rebuild.

`recorded_at` remains a recorded field for audit. It is no longer read by any selection logic anywhere.

### D1b - The same defect in wallet-binding resolution (`zephyr/claims.py`)

**Found while verifying D1; not in the original defect set and arguably the more dangerous of the two.**
`resolve_wallet` selects the effective binding with `max(rows, key=lambda r: (r["recorded_at"], r["manifest_hash"]))`
(`claims.py:537`) - the identical caller-supplied-timestamp pattern as `latest_route_manifest_for_event`. Here the
consequence is direct: this call decides **which wallet address receives money**. A binding recorded with an equal
or backdated `recorded_at` can make a superseded address win the max, redirecting payment to a wallet the subject
has already moved away from. Timestamps are caller-supplied through the same injectable path used for test
determinism, so this needs no attacker - a buggy or replayed caller reaches it.

Wallet bindings are latest-wins with append-only revocation tombstones; they carry no `supersedes` chain and this
unit does not add one. Instead, make ordering **store-assigned rather than caller-asserted**: add a monotonic
`INTEGER PRIMARY KEY AUTOINCREMENT` sequence column (`seq`) to the claims tables, assigned by SQLite on insert and
never settable by a caller. `resolve_wallet` selects the highest non-revoked `seq` for the subject. `recorded_at`
becomes audit-only here too.

This is a claims-store-internal schema change (`claims.db`), NOT a deposits-schema change - `attribution.db` is
untouched. `claims.db` currently holds only U0/U1 development rows. The migration is a distinct, explicitly ordered step and
must be idempotent across repeated opens:

1. `CREATE TABLE IF NOT EXISTS` carries `seq` for a fresh store.
2. For an existing store, run `PRAGMA table_info(<table>)` and check whether `seq` is present. **Only if absent**,
   `ALTER TABLE ... ADD COLUMN seq INTEGER`. Re-running must be a no-op, never an error.
3. Backfill existing rows in `recorded_at` order, then ensure subsequent inserts assign `seq` monotonically.
4. Run the whole migration inside the same connection setup path that already creates the schema, so opening a
   store twice in one process is safe.

**Migration strategy is DECIDED, not the fixer's choice** (round-3: all Facets personas plus Sonnet HIGH
converged on this, and the ambiguity was the finding). SQLite explicitly forbids adding an
`INTEGER PRIMARY KEY AUTOINCREMENT` column to an existing table, so step 2 above is only reachable for a plain
`INTEGER` column. Take the **transactional table rebuild**:

**The primary-key collision, which the rebuild must resolve.** All three claims tables currently declare
`manifest_hash TEXT PRIMARY KEY` (`claims.py:52,63,76`). SQLite permits exactly one PRIMARY KEY per table, and
`AUTOINCREMENT` is legal only on an `INTEGER PRIMARY KEY`. So `seq` cannot simply be appended - the rebuilt table
must make `seq` the primary key and demote `manifest_hash` to `TEXT NOT NULL UNIQUE`:

```sql
CREATE TABLE wallet_bindings_new (
    seq             INTEGER PRIMARY KEY AUTOINCREMENT,
    manifest_hash   TEXT NOT NULL UNIQUE,
    ...
);
```

This preserves every existing guarantee. `INSERT OR IGNORE` conflict resolution fires on any uniqueness
constraint, not only on a PRIMARY KEY, so the idempotent-recompile path (`routing.py:375-384`, `claims.py:196`)
behaves identically. Lookups by `manifest_hash` still hit a unique index. Apply the same shape to all three
tables so the module stays internally consistent, even though only `wallet_bindings` and `route_manifests` have
ordering semantics today.

1. Inside a single `BEGIN IMMEDIATE` transaction: `CREATE TABLE <name>_new` with the full target schema per the
   shape above; `INSERT INTO <name>_new (<explicit column list, seq omitted>) SELECT ... FROM <name> ORDER BY
   recorded_at, manifest_hash` so `seq` is assigned by SQLite in a deterministic, documented order; `DROP TABLE
   <name>`; `ALTER TABLE <name>_new RENAME TO <name>`; recreate every index including the D1 unique index.
   Commit. Note that a fresh store gets this schema directly from `CREATE TABLE IF NOT EXISTS` and never rebuilds.
2. Guard the whole rebuild with the `PRAGMA table_info` check so it runs at most once and repeat opens are no-ops.
3. `PRAGMA foreign_keys` is not enabled on this store; confirm before the drop and state it in the PR body.
4. **A half-upgraded schema must be impossible** (round-6 Council open question). SQLite DDL is transactional, so
   the `CREATE` / `INSERT...SELECT` / `DROP` / `RENAME` / index-recreation sequence commits or rolls back as one
   unit - never leaving `<name>_new` orphaned or `<name>` dropped. If the database file is locked by another
   process, `BEGIN IMMEDIATE` fails at the START of the migration, before any DDL runs; apply the same bounded
   backoff as D1 (5 attempts, 50ms doubling) to acquiring that lock, and on exhaustion raise with the store
   unmodified. Assert this in AC13d by holding a competing write lock across a migration attempt and confirming
   the store is byte-identical afterwards.

Rejected alternative, for the record: a plain `INTEGER` column populated from `MAX(seq) + 1` at insert time. It
is only safe if every such read-then-write sits inside the same `BEGIN IMMEDIATE` transaction as its insert, and
that is precisely the D1 race re-introduced in a second location where a future edit could silently drop it.
Let SQLite own monotonicity.

A round-5 reference review proposed exactly that rejected alternative, on the reasoning that `AUTOINCREMENT`
cannot be added to an existing table. That reasoning applies to `ALTER TABLE`, not to a rebuild: the rebuild
creates a **new** table, where `INTEGER PRIMARY KEY AUTOINCREMENT` is legal at creation, and subsequent inserts
autoincrement normally because the table was created that way. The rebuild path stands. Do not substitute the
`MAX(seq) + 1` pattern.

Apply the same `seq` ordering to `list_wallet_bindings_for_subject` and any other latest-wins selection in the
module. Grep for `max(rows` before finishing - the spec asserts there are exactly two such sites
(`claims.py:213`, `claims.py:537`); if a third exists, fix it and say so in the PR body.

### D2 - Raise `missing_domain_row` (`zephyr/routing.py`)

**The defect.** `RouteTamperError.failure_mode` documents `missing_domain_row` (`routing.py:61`) but nothing
raises it - zero occurrences across `claims.py`, `routing.py`, and both test files. The gather stage iterates
*from* claims-store domain rows (`routing.py:203-212`), so a signed `routing_terms` deposit whose domain row
has been deleted is silently invisible: it drops out of the compile, the allocation changes, and no tamper
signal fires. That is precisely the deletion attack the failure mode was named for, and it is a *silent
allocation change* - the worst class, because the manifest still looks internally consistent and still signs.

**The fix.** Invert the iteration direction so the signed envelope set is authoritative, not the domain store.

In the gather stage, for each subject whose terms are being consumed:

1. Query the attribution log for all deposits of `store_kind` `routing_terms` (and, in `_resolve_wallet`, all
   `wallet_binding` deposits) for that subject. **The deposit set is the authority on what claims exist.**
2. For every such deposit, require a corresponding domain row in the claims store keyed by `manifest_hash`.
   A missing row raises `RouteTamperError("missing_domain_row")` naming that `manifest_hash` and the subject.
3. Then proceed with the existing integrity bind on each row.

**The query surface does not exist yet, and this is the one place the unit must touch `attribution.py`**
(round-1 finding). `deposits` has a `store_kind` column and a `deposits_store` index (`attribution.py:54,63`),
and the claims helpers record with `key=subject` (`claims.py:396,489`) - but `AttributionLog.recent()` filters by
`store_kind` ONLY (`attribution.py:363-381`), with no `key` predicate. So add one additive, read-only method:

```python
def list_by_store_kind_and_key(self, store_kind: str, key: str) -> list[dict]:
    """All deposits for (store_kind, key), oldest first. Read-only; no verification."""
```

**Return shape:** full row dicts, the same shape `recent()` already returns - the caller needs `manifest_hash`,
`signature`, and `pubkey_id` to run the integrity bind, so a subset would force a second query per row. Verify
nothing here; verification stays in the bind path where it already lives.

**Column name:** the deposits column is `target_key`, NOT `key` (`attribution.py:54`, verified against
`1f67ce6`). The SQL predicate is `WHERE store_kind = ? AND target_key = ?`. The claims helpers pass
`key=subject` as the `record_signed` keyword argument, which lands in the `target_key` column - do not let the
argument name mislead you into the wrong SQL.

Constraints on that addition: additive only - no change to any existing method's behaviour or signature, no
deposits-schema column, no new index, no migration. It reuses the existing `deposits_store` index and filters
`key` in SQL. A linear scan within a `store_kind` is acceptable at this scale; note the cost in a comment.
`attribution.py` is added to the diff allowlist for this method and nothing else.

Revoked claims are tombstoned append-only, so a revoked-then-superseded deposit legitimately has a domain row
and is filtered by the existing verification path, not by absence. Absence is always tamper.

### D3 - Registry enforcement at compile time (`zephyr/routing.py`)

**The defect.** The registered-beneficiary invariant is enforced only in the `record_routing_terms` helper
(`claims.py:463-468`). `compile_route_manifest` never calls `reg.lookup()` on any `beneficiary_pubkey_id`.
A `routing_terms` deposit written via `record_signed` directly plus a `ClaimsStore.insert_routing_terms` call
yields a fully integrity-bound term naming an unregistered key, and it compiles into a leg. The integrity bind
proves the payload was signed and matches its envelope - it says nothing about registry membership. Separately,
**registry revocation of a beneficiary between record time and compile time is never detected at all.**

The money invariant does still hold today (an unregistered beneficiary cannot reach `leg_status="routable"`,
because that needs a self-signed wallet binding, which needs a real key). But "routing terms target registered
pubkeys only" is currently a helper-level convention, not a compiler-level guarantee, and U2b's executor is
entitled to assume the compiler enforced it.

**The fix.** In the compile stage that consumes terms, for every `beneficiary_pubkey_id`:

- `registry.lookup(beneficiary_pubkey_id) is None` -> `RouteTamperError("unknown_key")` naming the key and the
  term's `manifest_hash`. Fail the whole compile; do not drop the leg (a dropped leg is a silent allocation
  change, per D2's reasoning).
- The key is present but **revoked** -> the beneficiary keeps its allocation but the leg resolves to
  `leg_status="credited-unpaid"`, `wallet_address=null`. **This is a resolution-layer outcome, not a compile
  failure.** Revoking a key must never diminish or redistribute attribution (Void Principle), and it must never
  pay. Confirm against the existing `_resolve_wallet` path (`routing.py:340`) and reuse it rather than
  duplicating the fail-closed logic.

The distinction is load-bearing and must be preserved exactly: an **unknown** key is tamper (the term should
never have been recordable), a **revoked** key is a legitimate lifecycle state (the term was valid when made).

### D4 - Executor contract surface (`zephyr/routing.py`)

U2b must not reimplement head selection, envelope parsing, or per-leg re-verification - reimplementation is
how the round-3 Council block would return. Expose three helpers, all pure reads, no writes:

```python
def get_manifest_for_event(event_ref, *, store=None, log=None, registry=None) -> dict | None:
    """The head manifest for event_ref, envelope-verified and parsed.

    Returns None if no manifest exists. Returns a dict with keys:
      manifest_hash, manifest (parsed payload), pubkey_id, signature, supersedes.
    Raises RouteTamperError if the head's own envelope fails the integrity bind,
    RouteChainError if the chain is malformed. Never returns an unverified manifest.
    """

def is_current_head(event_ref, manifest_hash, *, store=None) -> bool:
    """True iff manifest_hash is the chain head for event_ref right now.

    The executor calls this immediately before moving value. A manifest that was
    the head when the run started may have been superseded by a revocation since.
    """

def reverify_leg(manifest, leg, *, store=None, log=None, registry=None) -> dict:
    """Re-run the full resolution check for one leg at execution time.

    Returns {"payable": bool, "wallet_address": str | None, "reason": str}.
    payable=True requires ALL of: leg_status=="routable" in the manifest, a currently
    verified non-revoked self-signed wallet_binding for the beneficiary, and the
    freshly resolved address EQUAL to the leg's recorded wallet_address. Any mismatch
    returns payable=False with reason in {"not_routable", "binding_revoked",
    "binding_unverified", "address_changed", "unknown_key"} - it does not raise.
    A stale routable never pays.
    """
```

Resolving the round-2 ambiguities explicitly, since U2b is specced against these signatures:

- **`store=None` / `log=None` / `registry=None` mean "use the process singleton"** in all three helpers -
  `get_claims_store()`, `get_recorder()`, `get_registry()` respectively - matching the injectable-with-singleton-
  default convention already used throughout `claims.py` and `routing.py`. Tests always inject.
- **`get_manifest_for_event` RAISES `RouteChainError` on a malformed chain; it does not return `None`.** `None`
  means exactly one thing: no manifest exists for this `event_ref`. A malformed chain is never reported as
  absence - silently reading a corrupt store as "nothing to pay" is the failure mode the whole unit exists to
  prevent, and it would read to the executor as a legitimately empty result.
- **`reverify_leg`'s `reason` enum is closed and exhaustive:** `{"ok", "not_routable", "binding_revoked",
  "binding_unverified", "address_changed", "unknown_key"}`. `reason == "ok"` iff `payable is True`. Any condition
  not expressible in that set is a bug, not a new reason - do not widen the enum silently; if a case genuinely
  does not fit, stop and report.

`reverify_leg` returning rather than raising is deliberate: partial completion must be honest in the ledger,
so the executor needs to skip one leg and continue, not abort the run. Tamper (as opposed to an
unpayable-but-legitimate leg) still raises `RouteTamperError` from the underlying bind.

**Human-legible diagnostic (Council round-2 stand-aside, Murasaki).** A wedged store must be inspectable by a
human, not only fatal to a machine - the objection was that a fork with no recovery path is "a monument to
cruelty." Add one non-raising read-only function:

```python
def describe_manifest_chain(event_ref, *, store=None) -> dict:
    """Human-readable chain diagnostic. NEVER raises on a malformed chain.

    Returns {"event_ref", "rows": [...], "heads": [...], "roots": [...],
             "well_formed": bool, "failure_mode": str | None}.
    """
```

`rows` MUST carry the **raw** `manifest_hash`, `supersedes`, `recorded_at` and `seq` values exactly as stored,
unreconstructed and unsorted-by-inference (round-7 finding). The reconstructed interpretation lives in `heads`
and `roots`; the raw edges live in `rows`. A human debugging a wedged store needs to see where the application's
reading of the chain and the literal table contents disagree - if the diagnostic only ever shows the
reconstruction, a logic bug that hallucinates a valid path is invisible in the exact situation the tool exists
for. Show the terrain, not only the map.

This is the surface a human reads when `RouteChainError` fires. The fork must be *visible*, not merely fatal.
Fail closed AND fail legible.

**Wedged-state recovery is out of scope BY DESIGN, not by omission** (Council round-3: three stand-asides on
exactly this; ratified by Erah 2026-07-21). The reasoning, which belongs in `CLAUDE.md` rather than only here:
a repair tool for a forked chain IS a chain-rewrite tool - the capability to change which wallet gets paid,
which is precisely the capability this unit exists to deny. Once the D1 write guard and its `BEGIN IMMEDIATE`
transaction land, a fork is unreachable through any supported code path; reaching one requires direct database
tampering, and an actor with that access is not meaningfully constrained by the absence of a repair CLI. So the
fence has no gate on purpose, because a gate in this particular fence is a key to the vault. What the unit owes
the human is legibility - `describe_manifest_chain` - not an automated remedy. If a fork is ever observed in
practice, that observation, not this speculation, should shape the recovery unit.

Define `__all__` in both `zephyr/routing.py` and `zephyr/claims.py` naming the public surface, so the
executor's import contract is explicit rather than conventional.

### D5 - Close the test gaps

- **End-to-end conservation.** The AC4 grid (`tests/test_routing.py:241-256`) tests `_largest_remainder`
  directly on synthetic buckets and never asserts conservation on compiled manifest output. Add a compile-level
  parametrized assertion over the same grid: `payer_retained + sum(leg["amount"]) == amount_value` exactly, on
  the actual manifest payload, including cases that exercise the pass-through split (`routing.py:305-317`),
  which is a second allocation currently absent from the grid entirely.
- **A genuinely independent oracle.** `_brute_force_allocate` (`tests/test_routing.py:228-238`) is presented as
  an independent reference but replicates the implementation's own sort key
  `(-remainder, 1 if is_payer else 0, id or "")` and its `id()`-based bump-set construction. It structurally
  cannot catch a tie-ordering deviation. Rewrite it to derive ordering from the SPEC's stated total order
  (beneficiaries lexicographic by pubkey_id, payer bucket last) using exact `Fraction` arithmetic, with no
  reference to implementation internals and no use of `id()`.

### D6 - Docs

Update `CLAUDE.md` in the style of the existing route-manifest section: the supersedes chain is now walked and
forks are rejected at write time inside a single `BEGIN IMMEDIATE` transaction; **`recorded_at` is audit-only and
never selects anywhere** - manifests select by chain head, wallet bindings by store-assigned `seq`, and a
caller-supplied timestamp can no longer influence which wallet gets paid; the three executor helpers are the
supported U2b entry points. Include the wedged-state posture from D4 in full - that repair is deliberately
manual because a chain-repair tool is a chain-rewrite tool - so a future reader finds a decision there rather
than a gap. Restate the executor contract sentence verbatim from the U0/U1 spec: the
executor MUST re-run the resolution check per leg at execution time and refuse any leg whose binding is revoked
or no longer verified - fail closed at both layers; a stale `routable` never pays.

## Non-goals (explicit, for the reviewer)

- NO payment execution, NO Open Payments / GNAP / network code, NO Node subtree, NO `package.json` - all U2b.
- NO changes to `settler/` (including the known-broken `settler/op_flow.py` and `settler/gnap.py`, which U2b
  replaces, not this unit), `demo/`, `fixtures/`, `zephyr/event_log.py`, or the deposits schema.
- NO new deposits columns, NO index migration, NO `derived_from` repurposing - it stays read-only. **The `seq`
  column in D1b is a `claims.db` change, not a `deposits`/`attribution.db` change** - the two schemas are distinct
  and only the former is in scope. `attribution.py` gains one read-only query method and no schema change at all.
- NO change to the allocation math itself. Largest-remainder, the tie ordering, the 2-hop cap and the worked
  example are all landed and correct; this unit only adds assertions over them.
- NO change to `leg_status` vocabulary, the manifest payload shape, or `manifest_hash` computation. **A compile
  of unchanged inputs against unchanged claims must produce a byte-identical manifest_hash before and after
  this unit** - AC10 asserts exactly this.
- NO fix to `fixtures/setup_demo.py:196` writing real `contributor_NN` keys into `/data/zephyr/keys/` on every
  suite run. Pre-existing, out of scope, tracked separately.

## Acceptance criteria

Test files: extend `tests/test_claims.py` and `tests/test_routing.py`, AC-numbered per repo convention
("Coverage map" docstring). All fixtures build fresh `AttributionLog`/`PubkeyRegistry`/`AgentSigner` in
`tmp_path` (repo pattern, `test_attribution_signed.py:39-54`); synthetic identities only (`agent:route-test`,
`agent:claims-test`); no writes outside tmp dirs. Every persistent store redirected by env var
(`ZEPHYR_ATTRIBUTION_DB`/`ZEPHYR_KEYS_DIR`/`ZEPHYR_AGENT_KEY_PATH`/`ZEPHYR_CLAIMS_DB`) with
`_reset_claims_store()` between cases.

- **AC1** chain walk beats timestamps: compile a manifest, revoke the binding, recompile - **with both
  manifests injected the IDENTICAL `recorded_at` timestamp**, and with the second manifest's hash sorting
  lexicographically BELOW the first. `latest_route_manifest_for_event` returns the second (the chain head), not
  the first. This case fails against main `1f67ce6` and is the regression proof for D1.
- **AC2** fork rejected at write: insert a manifest, then attempt to insert a second whose `supersedes` is NULL
  (and separately, one whose `supersedes` names a non-head hash) - each raises
  `RouteChainError("supersedes_not_head")` and **no row is inserted** (asserted by row count).
- **AC3** malformed chains fail closed, never guess: hand-construct in the store (bypassing the helper) a
  two-head set -> `RouteChainError("forked_chain")` naming both candidate hashes; a two-row cycle ->
  `RouteChainError("cycle")`; a row for the event_ref not reachable from the head -> `RouteChainError("orphaned")`;
  two NULL-supersedes roots -> `RouteChainError("multiple_roots")`. In every case the error carries `.event_ref`.
- **AC4** idempotent recompile still works: a third identical compile on the new head returns
  `newly_recorded=False` and raises nothing (the write-side guard must not break `routing.py:375-384`).
- **AC4b** fork guard is atomic under concurrency (round-1 Council finding): drive `insert_route_manifest` for one
  `event_ref` from two threads AND from two OS processes against the same `claims.db` file, each attempting a
  distinct new manifest whose `supersedes` names the same head. Exactly one succeeds; the other raises
  `RouteChainError("supersedes_not_head")`. Afterwards `latest_route_manifest_for_event` returns a single valid
  head and `route_manifest_chain_for_event` does not raise - i.e. the store is not wedged into a permanent
  `forked_chain`. The two-process case is the one that matters: it is the only one the in-process `self._lock`
  cannot cover. Use `subprocess` with `ZEPHYR_CLAIMS_DB` pointed at a shared `tmp_path` file.
  **The threading case must genuinely exercise the race** (round-3 finding): construct a SEPARATE `ClaimsStore`
  instance per thread against the same file, so each holds its own connection and its own `self._lock`. Sharing
  one instance would let the in-process mutex serialize the threads and the test would pass against buggy code.
  State in the test docstring which lock each case is proving: threads prove per-connection isolation, processes
  prove the SQLite write lock.
- **AC4e** the schema backstop holds independently of the application guard: bypassing `insert_route_manifest`
  entirely, attempt a direct SQL insert of a second manifest for one `event_ref` carrying an already-used
  `supersedes` value - `sqlite3.IntegrityError` is raised by the unique index. Separately, a direct insert of a
  second NULL-`supersedes` root for one `event_ref` also raises (this is the case a bare `UNIQUE(event_ref,
  supersedes)` would silently admit, and is the reason for the `COALESCE` form). Assert the index exists by name
  in `sqlite_master`.
- **AC4c** wallet-binding resolution ignores caller timestamps (D1b): bind subject -> wallet A, then bind subject
  -> wallet B with an `recorded_at` timestamp injected EQUAL to A's, and separately with one injected EARLIER than
  A's. In both cases `resolve_wallet` returns **B** (the later-inserted binding, by store-assigned `seq`), never A.
  Then revoke B: `resolve_wallet` returns `None`, NOT a fallback to A - fail closed, latest-only, no walking back
  down the stack. This case fails against main `1f67ce6` and is the regression proof for D1b.
- **AC4d** `seq` is not caller-settable: assert `insert_wallet_binding` (and the routing-terms equivalent) accept
  no `seq` parameter by signature inspection, and that a `seq` key present in a payload dict is ignored rather
  than honoured. Assert `seq` values are strictly increasing across successive inserts.
- **AC5** missing domain row is tamper: record a valid `routing_terms` claim, then DELETE its domain row from
  the claims store directly, leaving the signed deposit in `attribution.db` - compile raises
  `RouteTamperError` with `failure_mode="missing_domain_row"` naming that `manifest_hash`. Assert explicitly
  that the compile does NOT instead succeed with a smaller leg set. Same case for a deleted `wallet_binding`
  domain row. Fails against main `1f67ce6`; regression proof for D2.
- **AC6** unregistered beneficiary is tamper: write a `routing_terms` deposit via `record_signed` plus a direct
  `insert_routing_terms`, naming a `beneficiary_pubkey_id` absent from the registry - compile raises
  `RouteTamperError("unknown_key")` naming the key. Assert the leg is NOT silently dropped and no manifest row
  is recorded.
- **AC7** revoked beneficiary is NOT tamper: a term whose beneficiary key was registered at record time and
  revoked before compile - the compile SUCCEEDS, the leg is present with its full allocation,
  `leg_status="credited-unpaid"`, `wallet_address` null, AND the other legs' amounts plus `payer_retained` are
  byte-identical to the same compile with the key unrevoked. Revocation must never redistribute (Void Principle).
- **AC8** `reverify_leg` refuses a stale routable: compile with a bound wallet (leg routable), capture the
  manifest, then revoke the binding - `reverify_leg` on that captured leg returns
  `{"payable": False, "reason": "binding_revoked"}`. Separately: rebind the subject to a DIFFERENT wallet
  address -> `payable=False`, `reason="address_changed"` (the recorded leg address no longer matches the freshly
  resolved one). Neither case raises.
- **AC9** `is_current_head` catches mid-run supersession: capture the head hash, revoke a binding to force a
  recompile, then `is_current_head(event_ref, captured_hash)` is `False`; on the fresh head it is `True`.
- **AC10** no behavioural drift. Note the constraint that shapes this AC: a `manifest_hash` is NOT reproducible
  across runs, because it commits to beneficiary `pubkey_id`s derived from freshly generated Ed25519 keys. A
  pinned cross-commit hash literal is therefore impossible and must not be attempted. Assert invariance in three
  achievable parts instead:
  1. **Golden payload.** Compile the worked example (amount 500, direct terms {D: 4000 bps, M: 2500 bps}, parent
     standing term on D's work {P: 1000 bps} -> payer_retained 175, legs D=180, M=125, P=20, total 500 exact)
     with an injected timestamp. Normalize the run-varying fields (every `pubkey_id`, `signature`, and any
     `manifest_hash`) to stable placeholders by a documented substitution, then assert the normalized payload is
     byte-identical to a golden JSON literal pinned in the test. This catches any drift in payload shape,
     key order, allocation, or leg vocabulary.
  2. **Hash is a pure function of payload.** Assert `manifest_hash == ` an independently recomputed canonical hash
     of the payload, using the algorithm as documented in the U0/U1 spec (sorted keys, separators `(",", ":")`,
     UTF-8, sha256) written out in the test rather than by calling the implementation's own helper.
  3. **Same-tree determinism.** Two compiles with identical inputs, identical key material and identical injected
     timestamp produce an identical `manifest_hash`, and the second returns `newly_recorded=False`.

  Additionally, as a manual check reported in the PR body and NOT as a test assertion: run the worked example on
  clean `1f67ce6` before making any code change and confirm the normalized payload matches the golden literal you
  pinned. If it does not, stop and report rather than adjusting the golden to fit.
- **AC11** conservation end-to-end: over the AC4 grid (amounts 1, 2, 3, 499, 500, 501, 999999, 1000003; bps sets
  incl. {3333, 3333, 3334}, {1, 1, 1}, {9999}, {5000, 5000}, exact-tie {2500, 2500, 2500} on amounts 3 and 7),
  asserted on **compiled manifest payloads**: `payer_retained + sum(leg["amount"]) == amount_value` exactly, all
  amounts >= 0, including configurations that exercise the pass-through split.
- **AC12** the oracle is independent: `_brute_force_allocate` is rewritten to use exact `Fraction` arithmetic
  and the spec's stated total order (beneficiaries lexicographic by pubkey_id, payer bucket last), with no
  reference to implementation internals and no `id()` use (asserted by inspection in the test's docstring plus
  a case where a deliberately perturbed tie ordering makes the oracle disagree). **The ordering key is total**
  (round-6 Council open question): `pubkey_id` is an identity, so two distinct beneficiary buckets cannot share
  one, and the payer bucket is disjoint by construction and always sorts last. There is no residual tie for the
  oracle to break arbitrarily. If the fixer finds a way to construct two buckets with an identical `pubkey_id`,
  that is a compiler bug in term consumption - stop and report it rather than teaching the oracle to tolerate it.
- **AC13b** malformed chain is never reported as absence: with a hand-forked store, `get_manifest_for_event`
  raises `RouteChainError("forked_chain")` and does NOT return `None`. Assert explicitly that the return value is
  not `None` by asserting the raise - an executor reading a corrupt store as "nothing to pay" is the exact silent
  failure this unit exists to prevent.
- **AC13c** the diagnostic never raises: `describe_manifest_chain` returns a dict for every malformed case in AC3
  (fork, cycle, orphan, multiple roots) without raising, reporting `well_formed=False` and the matching
  `failure_mode`, and listing every candidate head. On a well-formed chain it reports `well_formed=True` and a
  single head. Assert it raises under no input.
- **AC13d** migration is idempotent and preserves every guarantee: open a store built WITHOUT `seq` (constructed
  by hand at the old `1f67ce6` schema, with rows present), confirm it upgrades in place; then open it again and
  confirm the second open is a no-op that neither raises nor re-backfills. Assert backfilled `seq` values follow
  `recorded_at` order, that post-migration inserts continue monotonically from the backfilled maximum **without
  any application-side `MAX(seq)+1` computation** (SQLite assigns it), that no row was lost or duplicated by the
  rebuild, and that `INSERT OR IGNORE` on a duplicate `manifest_hash` is still a silent no-op now that
  `manifest_hash` is `UNIQUE` rather than `PRIMARY KEY`.
- **AC13** public surface pinned: `zephyr.routing.__all__` and `zephyr.claims.__all__` exist and contain the
  three executor helpers plus `describe_manifest_chain`, `RouteTamperError`, `RouteChainError`,
  `compile_route_manifest`, `resolve_wallet`.

## Definition of Done

1. All ACs green via `python3 -m pytest tests/` **from the clone root** (NOT bare `pytest` - the host has an
   editable zephyr install whose `.pth` would shadow the clone; `python3 -m` puts the clone first on sys.path).
   Full suite passes, not only the new files. **If the full suite exceeds 10 minutes or appears to hang, do NOT
   silently narrow scope** - record the hang in `friction.json` with the offending test id and report it in the
   PR body.
2. `git diff --stat` touches only: `zephyr/claims.py`, `zephyr/routing.py`, `zephyr/attribution.py` (the single
   additive read-only method in D2 and nothing else), `tests/test_claims.py`, `tests/test_routing.py`,
   `CLAUDE.md`, and `friction.json`. No other path.
3. No new entries in `pyproject.toml` dependencies; no imports beyond stdlib + existing zephyr modules +
   function-local `archetypes_core.provenance`. `Fraction` is stdlib (`fractions`) and is test-only.
4. AC10 passes, and the PR body reports the manual clean-baseline payload check from AC10's closing paragraph.
   If the normalized payload changed, stop and report rather than re-pinning the golden to fit.
5. PR opened against main via the forgejo helper (`create_pr(repo='zephyr', ...)`, token from
   `/data/agents/config/conductor.env`), branch `feat/route-manifest-hardening-v0`. PR body summarises which of
   the three defects each AC proves closed.

## Fixer notes

- Clone tracks remote main `1f67ce6`. The local `/data/git/zephyr-working` tree may be stale or dirty - never
  read design intent from it.
- `python3 -m pytest tests/`, never bare `pytest` (see DoD 1). This is the single most common false-green on
  this repo.
- `archetypes_core` resolves via a host-global editable install
  (`/home/jellyfish/.local/lib/python3.12/site-packages/__editable__.archetypes_core-0.1.0.pth` ->
  `/data/git/archetypes-core`). No pyproject change needed and none permitted. **Known trap from the U0/U1
  dispatch:** if the worktree sets `PYTHONUSERBASE` to a worktree-local `.pyuserbase`, that `.pth` is NOT
  auto-processed - copy `__editable__.archetypes_core-0.1.0.pth` and
  `__editable___archetypes_core_0_1_0_finder.py` into `$WORKTREE/.pyuserbase/lib/python3.12/site-packages/`.
  Untracked, not part of the diff.
- `get_claims_store()` re-reads `ZEPHYR_CLAIMS_DB` at singleton (re)creation, so `monkeypatch` +
  `_reset_claims_store()` genuinely isolates. `get_recorder()`/`get_registry()` in `attribution.py`/`registry.py`
  have the identical latent gotcha and are NOT fixed here - construct those with explicit paths in fixtures.
  A test that skips this writes to the real `/data/zephyr/claims.db`.
- Running the full suite writes real `contributor_NN` keys into `/data/zephyr/keys/` via
  `fixtures/setup_demo.py:196`. Pre-existing, out of scope, do not fix - but do not let your own tests add to it.
- `summary` is hashed into `manifest_hash` but is NOT a deposits column - never rely on reading it back.
- `to_lapis_return` accepts `timestamp=` - thread the injectable timestamp through `record_signed(**prov_kwargs)`
  for determinism. AC1 depends on being able to inject two IDENTICAL timestamps, which the current code path
  already supports.
- Amount arithmetic: integers only. `Fraction` appears in the test oracle only, never in `zephyr/`.
```

### 3.3 `zephyr-route-executor-foundation-v0.md`

```text
---
spec_id: zephyr-route-executor-foundation-v0
---
# Spec: zephyr-route-executor-foundation-v0 - per-leg receipt deposits + execution-state store + Node read/write seam (rail U2b)

**Target ID:** `zephyr-route-executor-foundation-v0`
**Repo:** `zephyr`
**Authority:** hold (adds money-path bookkeeping the Node executor will drive; no network, no OP calls, no value movement, no secrets, no host ops in THIS unit)
**Verification:** tests-only (full suite via `python3 -m pytest tests/` from the clone root; the live testnet payment path arrives in U2c/U3a)

## Context

Rail unit **U2b**. Design doc: `/data/git/inertia-vault-working/Lapis/Architecture-Zephyr-Open-Payments-Rail-Design-2026-07-20.md`
(decision `decision/zephyr-op-rail-route-manifest-design-2026-07-20`, RATIFIED 2026-07-20).

The arc originally named U2 "the executor." Pre-bind investigation (2026-07-22) found the executor is not one
unit: the verified U2a surface gives the executor everything it needs to *read* a manifest (head selection,
`is_current_head`, per-leg `reverify_leg`, `resolve_wallet` - all fail-closed, confirmed at file:line), but it
exposes **two seams that do not exist yet, and both are Python**:

1. **No per-leg receipt deposit-back API.** The manifest contract surface is read-only. Nothing writes an
   executed-leg receipt back against a RouteManifest leg. The only write-backs that exist
   (`write_settlement_info`, `settler/ledger.py`, `intent_queue.py`) are the *old flat per-deposit* demo path,
   keyed per-deposit with a hardcoded $0.01 nominal - they do not fit the manifest/leg model. Invariant 10
   (provenance on every routing call) requires each executed leg to deposit its own provenance.

2. **No sanctioned read/write seam for a Node process.** The contract is Python-only. `python -m zephyr.route`
   compiles (via flat arguments, no subcommands today) but has no `get_manifest_for_event` /
   `is_current_head` / `reverify_leg` surface. A Node executor would otherwise reimplement chain-walk head
   selection, the integrity bind (recompute canonical `manifest_hash`, match the envelope), and `seq`-based
   wallet resolution - and would have to match `archetypes_core.provenance._canonical_json` byte-for-byte.
   That is a footgun.

**This split mirrors the U2a/U2b split Erah ratified 2026-07-21** ("spec the executor against a verified
foundation, not one it repairs mid-flight"). U2b (this unit) builds those two Python seams and verifies them in
isolation. **U2c** then folds in the Node `@interledger/open-payments` executor against a foundation it never has
to repair. **This unit ships no payment code and makes no network call.** (Split + `route_receipt` mechanism
ratified by Erah 2026-07-22, `decision/zephyr-op-rail-u2b-python-seams-split-2026-07-22`.)

Doctrine this unit executes, never violates:

- **Route, never compute.** Amount is exogenous; nothing here reads content to size a leg
  (`decision/zephyr-attribution-routes-not-values-2026-06-24`).
- **Payable requires a key; credit does not.** A receipt is written for every terminal leg outcome including
  `credited-unpaid` (skipped) - attribution never diminishes because a leg was unpayable (Void Principle). A
  `settled` receipt may only be written for a leg whose manifest `leg_status` is `routable`.
- **Fail closed at both layers.** A receipt cannot be written for a leg that does not cite a manifest_hash
  present as the *current verified head*; the seam propagates `RouteChainError` / `RouteTamperError` as distinct
  exit codes so the caller STOPS on a wedged store rather than guessing.
- **Every payment traces to a signed attribution edge.** The `route_receipt` is itself a signed deposit,
  keyed by `manifest_hash`, so audit is a join in `attribution.db`, not a subsystem.
- **No model in the money path.** All code here is deterministic, LLM-free (trivially satisfies
  no-direct-Anthropic-API).
- **Key doctrine holds.** The `route_receipt` is signed under the **node key** - the executor is a non-human
  agent and node keys vouch only for non-human agent_ids (`decision/zephyr-agent-key-management-2026-06-08`).
  The CLI exposes no `--signer`/key override on `record-receipt`, so a production caller structurally cannot
  sign as anything but the node key. Node **never signs**; all signing stays in Python behind the seam.
- **Synthetic identities only** in tests; node keys never sign for a human-namespace agent_id.

Hard constraints: pure Python, stdlib + existing zephyr modules + function-local `archetypes_core.provenance`
only. **No network calls. No `@interledger/open-payments`. No Node code in this unit.** No new Python
dependencies. **No `attribution.db` (`deposits`) schema migration** - the `route_receipt` rides the existing
`deposits` table via `record_signed`, exactly as `wallet_binding` and `routing_terms` do. Adding a new
`route_receipts` **domain table in `claims.db`** IS in scope (this unit mirrors `record_wallet_binding`'s
dual-write: signed deposit in `attribution.db` PLUS a domain row in `claims.db`). Integer money arithmetic only -
no float, no `Decimal` division shortcuts.

## Baseline

Author against **remote main `0bca707`** ("Merge pull request 'fix(zephyr-route-manifest-hardening-v0):
supersedes-chain integrity + executor contract surface' (#13)"). The fixer's clone tracks remote; the local
`-working` tree may be stale or dirty and is not the reference.

Remote main already contains `zephyr/claims.py` (950 lines), `zephyr/routing.py` (655 lines), `zephyr/route.py`
(73 lines, single flat-argument compile CLI, no subparsers), `zephyr/attribution.py` (832 lines),
`tests/test_claims.py`, `tests/test_routing.py`. This unit **adds** a `route_receipts` domain table + a receipt
write/read API to `claims.py`, **adds** a new execution-state store module `zephyr/route_exec.py`, **restructures**
`zephyr/route.py` into the Node seam, and **extends/adds** test files. It does not touch `demo/`, `fixtures/`,
`settler/`, `intent_queue.py`, or the `deposits` schema.

### Verified contract surface this unit builds on (do not re-derive, do not reimplement)

- `record_signed(payload, *, agent_id, tool, store_kind, key, recorder=None, ...)` - the one signing act
  (`attribution.py:648`). The `deposits` **column is `target_key`, the parameter is `key`** (mapped in the same
  `INSERT`, `attribution.py:304-320`, column literal at :306-307, value bound at :317). Never name the column `key`.
- **`record_wallet_binding` (`claims.py:720`) is the structural template.** It (1) calls `record_signed` FIRST,
  (2) only on success calls `store.insert_wallet_binding(...)` (`claims.py:786`) to write the `claims.db` domain
  row. Its `AttributionLog` param is named **`recorder`** (`claims.py:729`), NOT `log`. `record_routing_terms`
  (`claims.py:803`) is the same shape. Mirror BOTH the dual-write and the `recorder=` naming.
- `list_by_store_kind_and_key(store_kind, key)` (`attribution.py:400`) is an **EXACT** `target_key = ?` match
  ordered `recorded_at ASC` - there is no prefix/`LIKE` read method on `AttributionLog`. Do not assume one.
- The `deposits` table has **no `seq` column** (PK `manifest_hash`, index on `recorded_at`). `seq` exists only on
  `claims.db` domain tables (`wallet_bindings`/`routing_terms`/`route_manifests` all `seq INTEGER PRIMARY KEY
  AUTOINCREMENT`); `resolve_wallet` selects the latest binding by `max(rows, key=seq)` (`claims.py:941`), never by
  `recorded_at`. Any "latest wins" ordering in this unit MUST rest on a `seq` column in the new `route_receipts`
  domain table, never on `deposits.recorded_at` (the U2a incident: `recorded_at` ordering is unsafe under a
  caller-supplied timestamp; see the CLAUDE.md seq section and `test_u2a_ac4c_*`).
- `get_manifest_for_event(event_ref)` -> verified head `{manifest_hash, manifest, pubkey_id, signature,
  supersedes}` or `None` (`routing.py:507`). `None` means *absent only*; a malformed chain RAISES
  `RouteChainError`.
- `is_current_head(event_ref, manifest_hash)` -> `bool` (`routing.py:544`).
- `reverify_leg(manifest, leg)` -> `{payable, wallet_address, reason}`, does not raise for an unpayable-but-legit
  leg; tamper raises `RouteTamperError` (`routing.py:561`). `reason` enum:
  `{ok, not_routable, binding_revoked, binding_unverified, address_changed, unknown_key}`.
- Exceptions: `RouteChainError` (`.failure_mode` in `{cycle, forked_chain, orphaned, multiple_roots,
  supersedes_not_head}`, `.event_ref`), `RouteTamperError` (`.failure_mode` in `{unsigned, invalid, unknown_key,
  revoked_key, suspect, hash_mismatch, missing_envelope, missing_domain_row}`).
- Stores re-read env on creation (`get_claims_store`, `claims.py:597`). Env: `ZEPHYR_CLAIMS_DB`
  (default `/data/zephyr/claims.db`), `ZEPHYR_ATTRIBUTION_DB` (default `/data/zephyr/attribution.db`).

## Deliverables

### D1 - The `route_receipt` signed deposit + `route_receipts` domain table + write/read API (`zephyr/claims.py`)

`route_receipt` is a **dual-write**, mirroring `record_wallet_binding` exactly: a node-signed deposit in
`attribution.db` PLUS a domain row in a new `claims.db` table. The domain table is what makes "latest terminal
per leg" a real, monotonic, crash-order-consistent operation (it has a `seq`), what makes the reader queryable by
`manifest_hash`, and what enforces single-terminal-per-leg atomically.

**New exceptions this unit defines** (Sonnet gate finding - referenced everywhere, must be declared):
- `RouteReceiptError(ValueError)` in `zephyr/claims.py`, alongside the existing `RouteChainError` pattern
  (`claims.py:258`) and re-exported from `zephyr.routing` if needed to avoid an import cycle. Carries a
  kwarg-only `.failure_mode` in `{unknown_manifest, not_head, no_such_leg, not_routable, amount_mismatch,
  outcome_conflict}`. Importable by `zephyr/route.py` and tests.
- `LegStateError(Exception)` in `zephyr/route_exec.py`, carrying kwarg-only `.from_state` and `.to_state` (the
  attempted illegal edge) for a legible message and test assertions.

**Migration strategy (DECIDED, not fixer-chosen - per the U2a lesson).** `route_receipts` is purely **additive**:
it is born with its `seq` column, so it needs NO seq-backfill and NO table rebuild (unlike U2a's retrofit of
`seq` onto pre-existing tables via `_migrate_add_seq`). Create it idempotently in `ClaimsStore`'s schema-init
path (the same place `_SCHEMA` creates `wallet_bindings`/`routing_terms`/`route_manifests`) with
`CREATE TABLE IF NOT EXISTS route_receipts (...)` AND `CREATE UNIQUE INDEX IF NOT EXISTS
route_receipts_terminal_unique ...`. Do not touch `_TABLE_REBUILD_SPECS` or `_migrate_add_seq` - this table
requires neither. An existing `claims.db` gains the table+index on next store open; a fresh DB gets it at init.

**New table `route_receipts` (`claims.db`), mirroring `wallet_bindings`:**
```
CREATE TABLE IF NOT EXISTS route_receipts (
  seq                    INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_hash          TEXT NOT NULL,        -- the ROUTE manifest this leg belongs to (cited), not the receipt's own hash
  beneficiary_pubkey_id  TEXT NOT NULL,
  outcome                TEXT NOT NULL,        -- settled | failed | skipped
  op_payment_id          TEXT,
  sent_value             INTEGER,
  sent_asset_code        TEXT,
  sent_asset_scale       INTEGER,
  leg_status             TEXT NOT NULL,        -- routable | credited-unpaid (copied from the leg)
  reason                 TEXT,                 -- reverify reason enum (skipped) / error class (failed) / NULL (settled)
  receipt_hash           TEXT NOT NULL UNIQUE, -- the receipt deposit's own content hash (record_signed return)
  recorded_at            TEXT NOT NULL
);
-- At most ONE terminal (settled|skipped) receipt per leg; failed rows are unconstrained (retryable).
CREATE UNIQUE INDEX IF NOT EXISTS route_receipts_terminal_unique
  ON route_receipts(manifest_hash, beneficiary_pubkey_id)
  WHERE outcome IN ('settled', 'skipped');
```

Add `ClaimsStore.insert_route_receipt(...)` (parallel to `insert_wallet_binding`) that INSERTs the domain row
inside a **`BEGIN IMMEDIATE`** transaction, so the "is there already a terminal receipt?" check and the write are
one atomic critical section (the partial unique index is the backstop; the transaction is the guard - same
discipline as `_insert_route_manifest_txn`). A terminal INSERT that violates the partial unique index is caught
and mapped to the idempotency/​conflict logic below, never surfaced as a raw `sqlite3.IntegrityError`.

**Atomic head-currency reconciliation, domain-BEFORE-sign (Facets hardening, gate rounds 1-2).** The fail-closed
head check and the domain-row write MUST be one critical section - a manifest supersession must not land between
them. Because `route_manifests` and `route_receipts` both live in `claims.db`, this is genuinely atomic on a
single connection. **Ordering (Facets round-2 consensus): the atomic claims.db transaction runs and COMMITS
BEFORE `record_signed` is invoked**, so no signed audit artifact can ever exist without backing verified state.
Exact sequence:
1. Preliminary validation + a cheap fail-fast head check (`get_manifest_for_event(event_ref)`).
2. Compute the canonical `receipt_hash` deterministically via the same `archetypes_core.provenance`
   canonicalization `record_signed` uses (it is content-addressed over `{payload, provenance, summary}` and does
   NOT depend on the Ed25519 signature), so the domain row can carry `receipt_hash` before signing.
3. `BEGIN IMMEDIATE` on claims.db → re-assert head-currency (re-read the `route_manifests` head for `event_ref`
   on the same connection; cited `manifest_hash` still head, else abort → `RouteReceiptError(not_head)`) →
   enforce terminal-uniqueness (partial index / explicit check; conflict → `outcome_conflict`, exact-repeat →
   idempotent return) → INSERT the domain row with the precomputed `receipt_hash` → COMMIT.
4. Only after the commit, `record_signed` writes the matching deposit to attribution.db (it recomputes the
   identical `receipt_hash`; assert equality).

This makes an **orphan signed deposit impossible**. The only residual failure (a crash between step 3's commit
and step 4) leaves an **inert orphan DOMAIN ROW** whose `receipt_hash` has no envelope yet - `verify_route_receipt_row`
returns `missing_envelope`, so `route_receipts_for_manifest` SKIPS it fail-closed; it never reads as a valid
receipt and no money moved (U2b performs no payment). **Orphan rows are never cleaned up** - there is no cleanup
mechanism and none is in scope; they are permanently inert by the fail-closed read path. The LIVE payability
re-check (`reverify_leg`) still belongs to U2c immediately before each real send; U2b closes the head-currency
race, which is the part that lives in this unit.

**Write API:**
```python
def record_route_receipt(
    *, event_ref: str, manifest_hash: str, beneficiary_pubkey_id: str,
    outcome: str,                       # "settled" | "failed" | "skipped"
    op_payment_id: str | None = None,
    sent_value: int | None = None, sent_asset_code: str | None = None, sent_asset_scale: int | None = None,
    reason: str | None = None,
    agent_id: str,
    signer=None, recorder=None, store=None, log=None, registry=None, timestamp: str | None = None,
) -> dict:
```

- **`event_ref` is required** (the executor already holds it from its earlier `get-manifest` call). It is what
  makes the fail-closed head check a direct `get_manifest_for_event(event_ref)` call - do NOT try to derive
  `event_ref` from `manifest_hash` (there is no store method for it, and trusting `AttributionLog.get(...)`'s own
  `verified` flag is NOT head verification).
- **`route_receipt` `store_kind`.** `record()`/`record_signed` treat `store_kind` as an **opaque label** (no
  whitelist validation - confirmed at `attribution.py:304-320`), so the dual-write is NOT rejected by an
  unregistered kind. Still add `route_receipt` to the `--store-kind` help string in `zephyr/deposit.py` (alongside
  `wallet_binding` / `routing_terms` / `route_manifest`) for **documentation parity** - do not add new runtime
  validation.
- **Default signer = the node key.** `record_route_receipt`'s `signer` defaults to `get_signer()` (the existing
  process singleton `record_signed` uses), which in production is the node key loaded from the host-configured
  path; tests inject a synthetic `AgentSigner`. The `record-receipt` CLI exposes no `--signer`/`--key` flag, so a
  production caller structurally cannot sign as anything but the node key.
- Signed payload (`record_signed`, `store_kind="route_receipt"`, `key=f"{manifest_hash}:{beneficiary_pubkey_id}"`).
  **Exact param → JSON mapping** (load-bearing for `_canonical_json`/signature determinism): `sent_amount` is a
  nested object assembled from the three separate params -
  `sent_amount = {"value": sent_value, "asset_code": sent_asset_code, "asset_scale": sent_asset_scale}` when
  `outcome == "settled"`, and **`sent_amount = null`** otherwise (never a partial object). All other payload
  fields map 1:1 from the params.
  ```json
  {"route_receipt": {
    "manifest_hash": "<cited route manifest_hash>",
    "beneficiary_pubkey_id": "ed25519:...",
    "op_payment_id": "https://.../outgoing-payments/... | null",
    "sent_amount": {"value": <int>, "asset_code": "USD", "asset_scale": 2},   // null unless outcome == settled
    "leg_status": "routable | credited-unpaid",
    "outcome": "settled | failed | skipped",
    "reason": "not_routable | binding_revoked | ... | <error class> | null"
  }}
  ```
- **Signed under the node key.** `signer` defaults to the node signing key (same default `record_signed` uses);
  injectable for tests with a synthetic key.
- **Fail closed against the manifest (fail-closed, invariant 3).** Before writing, resolve the head with
  `get_manifest_for_event(event_ref)` and require ALL of: (a) a head exists (`None` -> `RouteReceiptError`,
  `failure_mode="unknown_manifest"`); (b) its `manifest_hash` equals the cited `manifest_hash`
  (else `failure_mode="not_head"` - a superseded/stale hash never receipts); (c) the head manifest contains a leg
  whose `beneficiary_pubkey_id` matches (else `failure_mode="no_such_leg"`). A `RouteChainError` /
  `RouteTamperError` from the head lookup **propagates unchanged** (never swallowed, never reported as success).
- **Amount/leg-status integrity.** For `outcome="settled"`: `op_payment_id` MUST be non-null AND all three of
  `sent_value`/`sent_asset_code`/`sent_asset_scale` MUST be non-null (any subset null -> `ValueError`); the cited
  leg's manifest `leg_status` MUST be `"routable"` (else `RouteReceiptError`, `failure_mode="not_routable"` - no
  paying a credited-unpaid leg); and `sent_value` MUST EQUAL the leg's manifest `amount` with matching
  asset_code/scale (else `RouteReceiptError`, `failure_mode="amount_mismatch"` - the U2c design pins
  `debitAmount = leg amount` in the payer asset, so an exact match is correct and no FX/partial-send divergence is
  in scope for U2b; this makes conservation a *write-time* invariant, not just a test). For `outcome="skipped"`:
  amounts MUST be null and `reason` MUST be non-null (a reverify reason). For `outcome="failed"`: amounts MAY be
  null and `reason` SHOULD carry the error class.
- **Idempotency vs conflict (reconcile-by-read).** `settled`/`skipped` are terminal. If a terminal receipt
  already exists for `(manifest_hash, beneficiary_pubkey_id)`:
  - an **exact repeat** (same `outcome`, same amounts, same `op_payment_id`, same `reason`) writes nothing and
    returns the existing receipt with `newly_recorded=False`;
  - a **conflicting** terminal submission (different `outcome`/amount/op_payment_id) RAISES `RouteReceiptError`,
    `failure_mode="outcome_conflict"` - silently absorbing a `settled` over a prior `skipped` (or vice versa) is
    exactly the double-pay-class bug this unit exists to catch. (This mirrors `compile_route_manifest`'s stage-0
    replay guard: byte-identical = no-op, divergent = raise.)
  A `failed` receipt is NOT terminal; multiple `failed` rows may accrue and a later terminal receipt supersedes
  them. "Latest terminal per leg" is unambiguous because the partial unique index guarantees at most one.
- Returns `{"receipt_hash": <the receipt deposit's own content hash>, "pubkey_id", "signature",
  "newly_recorded": bool, "receipt": {...payload...}}`. (Name it `receipt_hash`, distinct from the cited route
  `manifest_hash`, to avoid the two-hashes confusion.)

**Read API:**
```python
def route_receipts_for_manifest(manifest_hash: str, *, store=None, log=None, registry=None) -> list[dict]:
```
Backed by a new raw store method `ClaimsStore.list_route_receipts_for_manifest(manifest_hash) -> list[dict]`
(returns the raw `route_receipts` domain rows for that `manifest_hash`); the module-level
`route_receipts_for_manifest` does the per-leg selection + integrity re-verification on top. It queries the
`route_receipts` **domain table** by `manifest_hash` (NOT `list_by_store_kind_and_key`, which is exact-match on a
single leg key and cannot enumerate a manifest's receipts). Returns one entry per leg - the latest terminal
receipt if present, else the latest `failed` - each `{beneficiary_pubkey_id, outcome, op_payment_id, sent_amount,
leg_status, reason, receipt_hash, seq}`, selected by `max(seq)`. For each returned row, re-verify the
corresponding deposit envelope via **`verify_route_receipt_row(row, *, log=None, registry=None) ->
ClaimIntegrityResult`** (new, mirroring `verify_wallet_binding_row` at `claims.py:703`: recompute the canonical
`manifest_hash` from the domain-row content, require it to match the attribution.db envelope AND
`verification_status == "verified"`; never raises, returns the `ClaimIntegrityResult` dataclass with
`ok`/`failure_mode`/`payload`/`envelope`). SKIP any row whose result is `ok == False` **for ANY `failure_mode`
(including `missing_envelope`, which is exactly the orphan-domain-row case)** - do not raise (mirror
`resolve_wallet`'s fail-closed read style), log the skip with its `failure_mode`, and continue.

### D2 - Per-leg execution-state store (`zephyr/route_exec.py`, new module)

The crash-safe working state that makes reconcile-by-read possible. Distinct from D1: **D1 is the immutable,
authoritative signed audit record; D2 is disposable mutable working state** the Node executor advances leg by leg
and reads on restart to avoid a blind retry. **Authority rule (normative, state it in D5): a D1 terminal receipt
is always authoritative over D2 state.** D2 exists only to avoid re-quoting/re-submitting while a leg is still in
flight; it is never the source of truth for "is this leg done."

- New SQLite store, env `ZEPHYR_ROUTE_EXEC_DB` (default `/data/zephyr/route_exec.db`), singleton via
  `get_route_exec_store()` that **re-reads the env on creation** (match `get_claims_store`, `claims.py:597`),
  plus a `_reset_route_exec_store()` test hook mirroring the claims-store reset so tests get isolation across
  `tmp_path` env swaps. Its own DB file, NOT `claims.db` - claims.db is append-only signed deposits; this is
  mutable transactional working state and must not pollute it. Schema created idempotently
  (`CREATE TABLE IF NOT EXISTS`) at store init.
- Table `leg_execution`, PK `(manifest_hash, beneficiary_pubkey_id)`:
  `manifest_hash TEXT NOT NULL, beneficiary_pubkey_id TEXT NOT NULL, state TEXT NOT NULL, quote_id TEXT,
  outgoing_payment_id TEXT, attempt INTEGER NOT NULL DEFAULT 0, last_error TEXT, updated_at TEXT NOT NULL,
  PRIMARY KEY (manifest_hash, beneficiary_pubkey_id)`.
- **State machine (the ONLY legal edges - D4's exhaustive-transition test asserts exactly this set):**
  - `(absent) -> pending` via `claim_leg`
  - `pending -> quoted` via `record_quote`
  - `quoted -> submitted` via `record_submitted`
  - `submitted -> settled` via `record_settled` (terminal)
  - `pending | quoted | submitted -> failed` via `record_failed` (non-terminal)
  - `pending | quoted -> skipped` via `record_skipped` (terminal; a leg reverify found unpayable before submit)
  - `failed -> pending` via `claim_leg` (re-claim; increments `attempt`). **A re-claimed leg must traverse the
    full `pending -> quoted -> submitted` path again; there is NO `pending -> submitted` shortcut** even if an
    `outgoing_payment_id` is already persisted (reconcile-by-read of that payment happens in U2c before
    re-quoting; U2b just refuses the illegal edge).
  - No transition out of `settled`/`skipped` (terminal). Every other edge raises `LegStateError`.
- Every setter accepts an injectable `timestamp: str | None` and writes `updated_at` from it (tests pin the
  clock; never call `datetime.now()` in a spot a test cannot pin). `record_submitted` persists
  `outgoing_payment_id` **before** any terminal transition, so a crash mid-send is recoverable by GET-ing that
  payment (in U2c), never by re-creating it.
- Every setter is a read-check-write inside a single **`BEGIN IMMEDIATE`** transaction (TOCTOU guard between two
  executor processes).
- API: `claim_leg`, `record_quote(quote_id)`, `record_submitted(outgoing_payment_id)`, `record_settled`,
  `record_failed(error)`, `record_skipped(reason)`, `get_leg_state(...) -> dict | None`,
  `legs_for_manifest(...) -> list[dict]` (class `LegExecutionStore` + module-level convenience fns).

### D3 - The Node read/write seam (`zephyr/route.py`, restructure)

Restructure the current single flat-argument CLI into `argparse` **subcommands**. Add a **`compile` subcommand
byte-identical in flags and behavior to today's bare invocation** (`--event-kind --event-ref --subject --amount
--asset-code --asset-scale --agent-id [--key]`), and make `compile` the **default when no subcommand is given**,
so existing callers are unaffected. **Every subcommand emits a single JSON document on stdout; human logs go to
stderr; the exit code encodes the error class.** All signing and all chain/integrity logic stays here - Node
calls these and never touches keys, canonical JSON, or SQLite directly.

Subcommands:
- `get-manifest --event-ref REF` -> JSON of `get_manifest_for_event` (the verified head) or `null`.
- `is-head --event-ref REF --manifest-hash MH` -> `{"is_current_head": bool}`.
- `reverify-legs --event-ref REF --manifest-hash MH` -> `[{"beneficiary_pubkey_id", "payable", "wallet_address",
  "reason"}, ...]`, running `reverify_leg` for every leg of the named head. **If `--manifest-hash` is not the
  current head** (`is_current_head` false), exit `12` with `failure_mode="not_head"` and reverify nothing - the
  executor must re-fetch before acting. Exception mapping for this subcommand (and all read subcommands): a
  `RouteChainError` from the head lookup → exit `10`; a `RouteTamperError` raised by `reverify_leg` itself
  (e.g. `missing_domain_row`, `hash_mismatch`) → exit `11`; the `not_head` pre-check → exit `12`. None are
  swallowed into a generic handler (the trickster "friction-as-signal" condition).
- `leg-claim | leg-quote | leg-submit | leg-settle | leg-fail | leg-skip` - thin wrappers over D2, each taking
  `--manifest-hash --beneficiary` plus the state-specific arg, returning the resulting `leg_execution` row.
- `record-receipt --event-ref REF --manifest-hash MH --beneficiary PK --outcome {settled|failed|skipped}
  [--op-payment-id ID --sent-value V --sent-asset-code C --sent-asset-scale S --reason R] --agent-id AID` ->
  writes the signed `route_receipt` via D1, returns the deposit dict. **Signing happens here, in Python. No
  `--signer`/`--key` flag - production callers cannot override the node key.**

Exit-code contract (document it in the module docstring AND in CLAUDE.md):
`0` ok; `10` `RouteChainError` (wedged store - caller STOPS, does not pay); `11` `RouteTamperError`;
`12` `RouteReceiptError` / `LegStateError` (bad caller request, incl. `not_head`); `2` usage error.
On exit `10/11/12` the stdout JSON is `{"error": "<class>", "failure_mode": "<mode|null>", "detail": "<msg>"}`.
**Exit `2` (argparse usage error) is exempt from the stdout-JSON rule** - argparse's native usage message on
stderr + exit 2 is acceptable; do NOT require a custom `ArgumentParser.error()` override. (State this exemption in
D5 and the docstring so a caller does not expect a JSON body on `2`.) **Any other unexpected exception**
(`OSError`, an unclassified `ValueError`, etc.) exits `1` with a human-readable message on stderr and no JSON
envelope - only the three named error classes get the structured stdout body.

### D4 - Tests (`tests/test_claims.py`, `tests/test_route_exec.py` new, `tests/test_route_cli.py` new)

Heavy, per zephyr convention. All against scratch DBs (`tmp_path`, env-injected) and synthetic Ed25519 keys -
never `/data/zephyr/*`, never a real node key. **Assert end-to-end behavior, not helpers in isolation** (U1
shipped 3 gaps because tests asserted helpers directly). Cover at minimum:
- **D1:** receipt dual-writes (deposit + domain row) and round-trips through `route_receipts_for_manifest`;
  `settled` requires non-null op_payment_id AND all three amount fields (each subset-null case raises
  `ValueError`); `settled` against a `credited-unpaid` leg raises `not_routable`; `settled` with `sent_value` !=
  the leg's manifest amount raises `amount_mismatch`; terminal idempotency (exact-repeat `settled`/`skipped`
  writes no second row, returns `newly_recorded=False`); **terminal conflict** (`settled` after a prior `skipped`,
  or differing amount) raises `outcome_conflict`; `failed` then `settled` supersedes and the domain-table partial
  unique index still holds; receipt against a superseded/stale `manifest_hash` raises `not_head`; receipt for a
  `beneficiary_pubkey_id` absent from the head raises `no_such_leg`; a `RouteChainError` from a wedged chain
  propagates (not swallowed); `route_receipts_for_manifest` returns latest-terminal-per-leg by `seq` and skips a
  tampered receipt; **two concurrent terminal writes for one leg** - the partial unique index + `BEGIN IMMEDIATE`
  let exactly one win, the other maps to idempotent-return or `outcome_conflict`, never two rows.
- **D2:** every legal edge in the state table succeeds; every illegal edge raises `LegStateError` (including
  `pending -> submitted` shortcut, any transition out of a terminal state, and re-claim path correctness);
  `claim_leg` idempotent; `record_submitted` persists `outgoing_payment_id`; re-claim after `failed` increments
  `attempt`; concurrent-writer TOCTOU (`BEGIN IMMEDIATE`) - two writers, one deterministic winner.
- **Cross-store reconcile (the disagreement combos D5 names authoritative):** `(D2=submitted, D1=none)` after a
  crash is a legal recoverable state; `(D2=settled, D1=none)` is legal (receipt write is a separate step);
  `(D2=none/pending, D1=terminal)` - the D1 terminal receipt wins, the leg is done regardless of D2; `(D2=failed,
  D1=settled)` - a legitimate late-supersede. Assert the "authoritative order" rule holds for each.
- **D3:** each subcommand emits a single valid JSON document on stdout and nothing else on stdout; exit codes
  `10/11/12` fire on the right error classes; `2` on a missing required arg; `reverify-legs` on a non-head hash
  exits `12 not_head`; `record-receipt` produces a verifiable signed deposit; **no key material or token ever
  appears on stdout or stderr**.
- **Conservation end-to-end (AC12):** build a manifest with `payer_retained > 0` AND at least one `skipped`
  (credited-unpaid) leg AND at least one `settled` leg. Construction recipe: declare `routing_terms` whose
  `share_bps` sum to LESS than 10000 (the shortfall becomes `payer_retained`); give one beneficiary a valid
  self-signed `wallet_binding` (→ `routable`, will be `settled`) and another beneficiary a registered pubkey but
  NO wallet_binding (→ `credited-unpaid`, will be `skipped`); compile at a non-trivial `amount_value`. After
  receipting, assert
  `payer_retained + sum(settled leg.amount) + sum(skipped leg.amount) == amount_in.value`, where each leg's
  amount is read from the **manifest** (`legs[].amount`) joined to receipts by `beneficiary_pubkey_id` (a
  `skipped` receipt's own `sent_amount` is null by design), and additionally assert each `settled` receipt's
  `sent_value == that leg's manifest amount`. This is a whole-manifest join that catches a per-leg over/under-pay,
  not an aggregate that a compensating error could slip through.

### D5 - Docs

- Module docstrings on `record_route_receipt`, `route_receipts_for_manifest`, `route_exec.py`, and each new CLI
  subcommand stating the Python-owns-signing / Node-calls-the-seam boundary.
- A short **"Executor seam (U2b)"** section in the repo `CLAUDE.md` covering: the exit-code contract (and the
  exit-`2` exemption); the Python-signs-never-Node rule; `ZEPHYR_ROUTE_EXEC_DB`; the **authoritative order**
  (D1 terminal receipt > D2 exec-state); the reconcile-by-read guarantee (terminal receipts immutable and
  single-per-leg via the partial unique index; `record_submitted` persists the payment id before confirmation);
  and the note that D3's `reverify-legs` result and D1's `record-receipt` call are NOT cross-validated inside U2b,
  so **U2c MUST re-run `is_current_head` + `reverify_leg` immediately before each terminal write** (U2b enforces
  head-currency and leg-status at receipt time, but cannot re-check live payability it doesn't perform).

## Acceptance criteria

1. `record_route_receipt` **dual-writes**: a node-signed `route_receipt` deposit via `record_signed`
   (`store_kind="route_receipt"`, `key="{manifest_hash}:{beneficiary_pubkey_id}"`, no `deposits`-schema change)
   AND a `route_receipts` domain row in `claims.db`. The domain write runs inside a `BEGIN IMMEDIATE`
   transaction that **re-asserts head-currency on the same connection before inserting** (a supersession landing
   after the pre-check aborts the txn with `RouteReceiptError(not_head)`); `RouteReceiptError` and `LegStateError`
   are defined in `claims.py` / `route_exec.py` respectively; `route_receipts` is created additively (no rebuild,
   no seq-backfill).
2. A `settled` receipt with a null `op_payment_id` or any null among `sent_value`/`sent_asset_code`/
   `sent_asset_scale` raises `ValueError`.
3. A receipt whose cited `manifest_hash` is not the current verified head raises `RouteReceiptError(not_head)`;
   one whose `beneficiary_pubkey_id` is absent from the head raises `RouteReceiptError(no_such_leg)`; one with no
   head at all raises `RouteReceiptError(unknown_manifest)`.
4. A `settled` receipt against a leg whose manifest `leg_status != "routable"` raises
   `RouteReceiptError(not_routable)`; a `settled` receipt whose `sent_value` != the leg's manifest `amount`
   (or mismatched asset) raises `RouteReceiptError(amount_mismatch)`.
5. Terminal idempotency vs conflict: an exact-repeat terminal receipt writes no new row and returns
   `newly_recorded=False`; a conflicting terminal submission raises `RouteReceiptError(outcome_conflict)`; a
   `failed` receipt is superseded by a later terminal receipt; the `route_receipts_terminal_unique` partial index
   guarantees at most one terminal row per leg.
6. `RouteChainError` / `RouteTamperError` raised by the head lookup propagate out of `record_route_receipt`
   unchanged - never swallowed, never reported as success.
7. `route_receipts_for_manifest` queries the `route_receipts` domain table by `manifest_hash`, returns the latest
   terminal (else latest failed) per leg by `max(seq)`, skips integrity-failed receipts without raising, and logs
   each skip.
8. `route_exec.py` persists the leg state machine in its own DB (`ZEPHYR_ROUTE_EXEC_DB`), never in `claims.db`;
   the singleton re-reads the env on creation; every illegal transition raises `LegStateError`; `record_submitted`
   persists `outgoing_payment_id` before any terminal transition; every setter uses `BEGIN IMMEDIATE`.
9. `python -m zephyr.route compile|get-manifest|is-head|reverify-legs|leg-*|record-receipt` each emit a single
   JSON document on stdout and honor the exit-code contract (`0` ok; `10/11/12` with the JSON error envelope;
   `2` usage exempt). `compile` is the default subcommand and preserves today's flags/behavior. `reverify-legs`
   on a non-head hash exits `12 not_head`. No key material or token ever reaches stdout/stderr; `record-receipt`
   exposes no signer/key override.
10. All new/changed code is pure Python, makes zero network calls, imports no `@interledger/*` and no new
    dependency, and contains no Node/JS/TS file. No `attribution.db` (`deposits`) schema migration.
11. `python3 -m pytest tests/` is green from the clone root; the new tests use only scratch DBs and synthetic keys.
12. The conservation end-to-end test passes on a manifest with `payer_retained > 0` and both a `settled` and a
    `skipped` leg: `payer_retained + sum(settled leg.amount) + sum(skipped leg.amount) == amount_in.value`
    (leg amounts read from the manifest, joined to receipts by `beneficiary_pubkey_id`), AND each `settled`
    receipt's `sent_value` equals its leg's manifest amount.

## Fixer traps (from prior zephyr rounds)

- Run `python3 -m pytest tests/` NOT bare `pytest` (a `.pth` shadow breaks bare invocation).
- `archetypes_core` (for `_canonical_json`) arrives via a host-global editable install; import it
  function-locally exactly where the existing modules do, never add it as a dependency.
- The `deposits` column is `target_key`; the `record_signed`/`record()` parameter is `key`. Do not rename either;
  do not add a `key` column; do not add a `seq` column to `deposits` (there is none - all "latest wins" ordering
  in this unit rests on the new `route_receipts.seq`, never on `deposits.recorded_at`).
- `list_by_store_kind_and_key` is EXACT-match on `target_key`; it cannot enumerate a manifest's receipts. Use the
  new `route_receipts` domain table (queried by `manifest_hash`) for `route_receipts_for_manifest`.
- Mirror `record_wallet_binding` fully: `record_signed` FIRST, then the domain-table insert; name the
  `AttributionLog` param `recorder=` (not `log=`).
- `record_signed` is the ONLY signing act - do not hand-roll Ed25519 or canonical JSON in the receipt path.
- CLI JSON assertions in tests MUST check individual fields (`event_ref`/`manifest_hash`/`outcome`/etc.), never
  full-document equality against a hardcoded golden dict - `pubkey_id`/`signature`/`receipt_hash` are freshly
  generated per synthetic key and are NOT stable across runs (the U2a AC10 lesson).
- Author against remote `origin/main` `0bca707`; ignore the local `-working` tree state.
- No `datetime.now()` in a spot a test cannot pin - thread an injectable `timestamp` through D1 and D2.
```

### 3.4 `zephyr-use-terms-consent-v0.md` — the consent-rail spec (shipped as f51d21e + PR#21 + hygiene #22/#23)

```text
# Spec: zephyr-use-terms-consent-v0 - consent-to-use: signed, revocable use declarations on works

**Target ID:** `zephyr-use-terms-consent-v0`
**Repo:** `zephyr`
**Authority:** hold (claims.db schema change + new store_kind vocabulary + public README surface)
**Consumer:** the OSAIF / AI Alliance outreach - the OSAIF email went out 2026-09-28 with consent as the hinge (`decision/osaif-email-final-2026-09-28`, mem.db); the public mirror `github.com/xoeieox/zephyr` (Apache-2.0, public since 2026-09-28; full tree incl. `demo/`, live-checked 2026-09-28) mentions consent zero times in its top-level README and ships no consent-bearing claim kind. Until this lands, the public consent pitch has no shipped referent. The first wired consumer is the demo's remix step (D2) - this unit must not be a verdict seam without a consumer.

## Ground this spec stands on (verified live 2026-09-28, code audit at c539ac1 == origin/main == /data/git/zephyr-working HEAD; suite baseline: 547 tests collected by `pytest --collect-only -q`, 371 `def test_` definitions - DoD 1 uses the collected count)

- **Claim kinds today:** `wallet_binding`, `routing_terms`, `route_manifest`, `route_receipt` (vocabulary at `zephyr/deposit.py:33-36`). No use/permission claim kind exists. Top-level `README.md` consent-word count: 0 (verified at c539ac1). Note: `demo/README.md:89`/:199 and `demo/surface/index.html:581`/:858 already use the word "consent" in the **Open-Payments payment-grant sense** - a different word-sense; the mirror ships the full tree, so any public claim about what the repo does or does not say must be scoped to the top-level README, and the new README section must disambiguate the two senses.
- **The pattern to mirror is the wallet_binding rail, exactly.** Anchors, re-pinned against c539ac1 by the many-eyes panel 2026-09-28 (all in `zephyr/claims.py` unless noted): `ClaimsStore` :321 (WAL PRAGMA :330, `_SCHEMA` executescript :331, `_migrate_add_seq` call :333, def :226); `insert_wallet_binding` :337-360 (`INSERT OR IGNORE` :350); `list_wallet_bindings_for_subject` :357; sibling subject indexes :92/:107; `insert_routing_terms` :366-403; `insert_route_manifest` loud-insert pattern (identical-row no-op check BEFORE the guard, `IntegrityError` re-raised never absorbed) :420-458; `verify_claim` :917 (never raises; consumes the domain row's `summary` column as hash input :938); `_wallet_binding_payload` :948-956 (binds exactly subject/wallet_address/revokes/note); `verify_wallet_binding_row` :977; `record_wallet_binding` :1064-1140 (self-sign check :1088-1093); `record_routing_terms` :1147-1240 (scope grammar validation :1183-1186); `resolve_wallet` :1243-1295 (selection is `max(rows, key=seq)` over ALL rows :1285, integrity-check of that single row :1287, revokes check :1291; deferred `RouteTamperError` import :1264-1265; tamper raise form :1277-1280 `RouteTamperError(f"missing_domain_row: {mh} (subject={subject})", failure_mode="missing_domain_row")` - the ctor is `(message, *, failure_mode)`, routing.py:91); `record_signed` chokepoint `zephyr/attribution.py:759`; `list_by_store_kind_and_key` `zephyr/attribution.py:511`; revoked-key polarity `zephyr/attribution.py:685-693` (`rotated`/`retired` -> `verified`; `compromised`/reason-missing -> fail); transparency leaves are `(seq, manifest_hash)` pairs (`attribution.py:495-509`) - the deposits table's `store_kind`/`target_key` columns are OUTSIDE Merkle coverage. Test conventions `tests/test_claims.py`: fixtures defined :79-89 (`tmp_log`, `tmp_registry`, `tmp_claims_store`), AC-numbered tests from :105; mirrors :178 (no-proxy introspection - forbidden set at :182 is `{"method", "declared_by", "subject_kind", "on_behalf_of", "proxy"}`), :267/:281 (ac10), :461 (idempotent no-op), :586/:602 (ac4c), :634/:649 (ac4d). Demo: scene hooks `demo/run_demo.py:256`/:297/:339 (act-1/2/3), but the functional remix is `make_signed_deposit(... derived_from=manifest_original ...)` at **:288** (inside act-2, before its scene hook) - the consent consult's anchor is :288, not the scene gap.
- **Standing ratifications carried in as text, not mem names:**
  - Self-signed only (ratified 2026-07-20, `record_wallet_binding` docstring :1064-1081, condensed from): *"A key binds only itself: the resolved signer's own pubkey_id_str MUST equal subject. There is no parameter with which to bind a wallet on behalf of another party - the proxy/declared-wallet backdoor does not exist in this rail."*
  - Void Principle (CLAUDE.md:70/:132, verbatim): *"credited-but-unpaid, never dropped, never redistributed"* - and its revocation twin: revocation is a legitimate lifecycle state, never a redistribution event.
  - Route-not-compute (`zephyr/routing.py:8-11`, verbatim): *"attribution sets the PATH, declared terms set the RATIO"*; every bps figure comes from a routing_terms deposit someone signed; the compiler computes nothing about worth.
  - Selection law (condensed from CLAUDE.md:76-77 and :105 - two separate lines stitched, grep accordingly): head/latest is store-assigned `seq`, never a sort; `recorded_at` is audit-only, never load-bearing for selection, anywhere.
  - CLAUDE.md redlines: no LLM calls ever; synthetic identities in all tests/demos (never `erah` or any real human); DB migrations additive; append-only log; human private keys never on BRIX/StarHouse.

## Scope statement (what this spec is vs its neighbors)

**v0 is work-level use declarations:** a rights holder's signed key declares, per work (identified by its `manifest_hash`), which uses are permitted, which are denied, and revokes prior declarations - with the machine reporting declarations and adjudicating nothing about permission. Named OUT and not to be widened in here: character/scene/environment creative-use consent (Erah's ruling 2026-09-28: not now; belongs to the social layer, alongside the harms-log-is-social doctrine); any enforcement/DRM (the substrate reports; downstream actors honor - this unit never blocks an action it cannot witness); rights-holder adjudication (`declared_by` is attribution of the declaration, never proof of entitlement - disputes go to the social layer); interactive consent at transaction time (GNAP redirect); witness countersignature; any `python -m` CLI (the `zephyr.route`/`zephyr.transparency` exit-code pattern is the precedent for when it comes).

## Design decisions (each with reason; reviewers: attack these first)

**DD1 - Subject is the work's `manifest_hash`.** Validated as exactly `sha256:` followed by 64 lowercase hex characters - the real hash shape this ecosystem produces (`claims.py:914` `"sha256:" + hashlib.sha256(...).hexdigest()`; `demo/run_demo.py:77`; the demo's own `manifest_original` at :204 carries the prefix) - BEFORE any decode or DB write (input-validation discipline, CLAUDE.md transparency section). A bare-64-hex gate would reject every real work hash and force an implementer to strip the prefix, storing a subject no other component produces and breaking federation of the consent record against the work it names. No existence check in attribution.db: the work may live on another node - federation forbids coupling the consent record to the deposit record's presence. A consent record for a nonexistent work is inert, not a defect.

**DD2 - Self-declared only, structurally.** `record_use_terms` has **no `declared_by` parameter at all** - the value is derived internally as `declared_by = s.pubkey_id_str` after signer resolution, exactly as `record_wallet_binding` treats the signer as the only declarant (claims.py:1088-1093 precedent; the wallet_bindings table has no caller-settable declarant column either). There is no parameter with which to declare use terms on another party's behalf: the proxy backdoor must not exist *by absence of any parameter from which a non-self `declared_by` could survive*. `test_ac2` mirrors `test_ac2_no_proxy_binding_parameter_exists` (test_claims.py:178) **with the forbidden set verbatim, `declared_by` included**: `{"method", "declared_by", "subject_kind", "on_behalf_of", "proxy"}` - the introspection test passes precisely because the parameter does not exist. (A caller-supplied `declared_by` checked only at runtime was rejected at pre-gate: it would make Invariant 5's "structural" claim false and the mirror test vacuous.)

**DD3 - Closed vocabulary.** Module-level `USE_VOCAB = ("training", "remix", "redistribution")` (Erah 2026-09-28: these three are the bottom line; creative-scene consent stays out). Unknown tokens rejected at declare time with a ValueError listing the vocabulary. `scope` reuses the routing_terms grammar verbatim (`"standing"` or `"event:<ref>"`; validation mirrors the real grammar check at claims.py:1183-1186) - no new grammar is invented here - and additionally rejects bare `"event:"` with an empty ref. **v0 ruling (panel-fold, 2026-09-28): `scope` is stored, hashed into the payload, and NOT consulted by `resolve_use_terms`/`check_use`** - a declaration is active regardless of scope; the README must not imply event-scoping ships (it is a known-deferred next unit).

**DD4 - Tri-state reporting: the permission-void.** `check_use(subject, use, ...) -> str` with the closed enum `{"permitted", "denied", "undeclared"}`. A declaration row (`revokes=False`) carries `allowed_uses: list[str]` and `denied_uses: list[str]` - both subsets of `USE_VOCAB`, disjoint, union non-empty (overlap or empty-union is a write-time ValueError; this validator applies ONLY to `revokes=False` rows - see DD5's tombstone contract). A use not covered by the active declaration is `"undeclared"` - never silently permitted, never silently denied. This is the SplitPolicy void mirrored to permission: *the machine makes no claim about what you may do - it proves what was declared, and the absence of a declaration is itself visible.* A downstream consumer (the demo remix step in v0) decides what `"undeclared"` means for its activity; Zephyr never does.

**DD5 - Revocation is an additive tombstone, history-preserving.** `revokes: bool` exactly like `wallet_bindings.revokes` (column claims.py:87, insert param :343): a later declaration with `revokes=True` supersedes prior ones for that subject. **Tombstone row contract (panel-fold, 2026-09-28): a tombstone MUST have `allowed_uses == denied_uses == []`** - it declares nothing, it withdraws; DD4's validator exempts it (DD4 applies only to `revokes=False` rows), so no semantically meaningless permission is ever signed into the tombstone's hash and payload. Rows are never updated or deleted - append-only. After revocation, `check_use` reports `"undeclared"` (absence of an active declaration), NOT `"denied"` - consent withdrawn is not consent to refuse; `"denied"` must be affirmatively declared. What was true while consent stood stays verifiable forever (same semantics as `verify_row`'s `rotated`/`retired` handling, attribution.py:685-693). A tombstone later superseded by a fresh `revokes=False` declaration re-activates consent correctly because selection is pure seq-max (DD8).

**DD6 - Latest-wins by store-assigned `seq`, from birth.** The `use_terms` table defines `seq INTEGER PRIMARY KEY AUTOINCREMENT` in its own DDL - no `_migrate_add_seq` rebuild dance needed because the table is new (that dance exists only because SQLite cannot ADD an AUTOINCREMENT column later; the precedent is claims.py:226 and CLAUDE.md U2a). `recorded_at` is stored and audit-only; a backdated declaration must not change selection - tests mirror `test_u2a_ac4c_*` (test_claims.py:586/:602) and `test_u2a_ac4d_*` (:634/:649).

**DD7 - Deposit-authoritative BOTH WAYS, one signing act, two homes.** `record_use_terms` mirrors `record_wallet_binding`: build the payload dict per DD8's pinned shape, call `record_signed(...)` (attribution.py:759) with `tool="zephyr:use-terms"`, `store_kind="use_terms"`, `key=subject`; then `ClaimsStore.insert_use_terms(...)` keyed by `result["manifest_hash"]`. `zephyr/deposit.py` `--store-kind` help string gains `use_terms` (:33-36). **Forward direction (deposit-authoritative):** resolution/check iterate the deposit set via `AttributionLog.list_by_store_kind_and_key("use_terms", subject)` and raise, for a deposit lacking its domain row, `RouteTamperError(f"missing_domain_row: {mh} (subject={subject})", failure_mode="missing_domain_row")` - copy the call form at claims.py:1277-1280 verbatim; the ctor is `(message: str, *, failure_mode: str)` (routing.py:91). Import `RouteTamperError` deferred from `zephyr.routing` exactly as `resolve_wallet` does (claims.py:1264-1265, the comment says why: routing.py imports claims.py). **Reverse direction (panel-fold, 2026-09-28):** for every row returned by `list_use_terms_for_subject`, require the matching deposit to exist with `store_kind == "use_terms"` and `target_key == subject`; violation raises `RouteTamperError(f"orphan_domain_row: {mh} (subject={subject})", failure_mode="orphan_domain_row")`. Without it, a writer who re-tags a tombstone's deposit `store_kind` and deletes its domain row erases a revocation into a benign `"undeclared"` - the transparency log cannot see it (leaves cover `(seq, manifest_hash)` only, attribution.py:495-509; `store_kind`/`target_key` are plain columns). State the residual honestly in the docstring: a writer on both DBs who *re-tags* (rather than deletes) can still erase a declaration invisibly; Merkle audit detects row deletion, not tag mutation. A deleted domain row for a still-deposited declaration is tamper, not absence.

**DD8 - Integrity bind: pinned payload, exact selection algorithm, fail-closed, never fall back, never raise.** `_use_terms_payload()` + `verify_use_terms_row()` build on `verify_claim` :917. **Pinned payload shape (panel-fold, 2026-09-28 - the single load-bearing line of the rail):** `_use_terms_payload(row)` returns exactly
`{"use_terms": {"subject": row["subject"], "declared_by": row["declared_by"], "allowed_uses": <parsed list>, "denied_uses": <parsed list>, "scope": row["scope"], "revokes": bool(row["revokes"]), "note": row["note"] or ""}}`
- every verdict-affecting column is inside the signed envelope (the 4-field sibling at :948-956 is a shape precedent, NOT a field list; an omitted field is DB-flippable while verify stays ok). `resolve_use_terms`/`check_use` MUST adjudicate the verdict from `ClaimIntegrityResult.payload`, never from raw domain-row columns.
**Selection algorithm (mirrors the executable `resolve_wallet` at :1285-1292, not the prose):** selection is the seq-max row for the subject over ALL rows (tombstones included); that single row is the only candidate. If it fails `verify_use_terms_row` -> `"undeclared"`; else if `revokes` -> `"undeclared"`; else tri-state from its allowed/denied as read from the verified payload. No older row is ever consulted - *fail closed; never fall back to an older binding when the latest is untrustworthy* (condensed from claims.py:1250-1256). A filter "latest non-revoked" wording is wrong: skipping tombstones re-grants permission after revocation. **Never raise:** `verify_use_terms_row` catches `json.JSONDecodeError` on the uses columns and returns `ClaimIntegrityResult(False, "malformed_uses_json", ...)` (the raw-`json.loads` precedent `_route_manifest_payload` :973-974 crashes - do not mirror that). Every non-ok integrity result (missing_envelope / hash_mismatch / revoked_key / malformed_uses_json) logs a WARN with manifest_hash + distinct failure_mode, so tamper is never a silent `"undeclared"`. Honesty over availability.

**DD9 - Schema is purely additive.** `use_terms` joins `_SCHEMA` (claims.py:~40-220) with `CREATE TABLE IF NOT EXISTS`; opening an existing claims.db creates the table - no migration, no touch to any existing table or column. Columns: `seq` (PK, DD6), `manifest_hash TEXT NOT NULL UNIQUE` - **this is the consent's own deposit envelope hash from `record_signed`, never the work hash (the work hash is `subject`); multiple declarations/tombstones for one work therefore coexist as distinct rows** - `subject TEXT NOT NULL`, `declared_by TEXT NOT NULL`, `allowed_uses TEXT NOT NULL` (JSON list), `denied_uses TEXT NOT NULL DEFAULT '[]'` (JSON list), `scope TEXT NOT NULL`, `revokes INTEGER NOT NULL DEFAULT 0`, `note TEXT NOT NULL DEFAULT ''`, `summary TEXT NOT NULL`, `recorded_at TEXT NOT NULL`. Plus `CREATE INDEX IF NOT EXISTS use_terms_subject ON use_terms(subject);` - every sibling indexes subject (:92/:107); `check_use` is the hot per-query path. **Insert mode:** mirror `insert_route_manifest`'s loud pattern (claims.py:420-458), NOT `INSERT OR IGNORE` - re-inserting byte-identical content is an explicit no-op check BEFORE the write; an existing row at the same `manifest_hash` with ANY differing column raises `sqlite3.IntegrityError` loudly, never absorbed (bare OR IGNORE would let a pre-seeded row at a predictable future envelope hash silently swallow the real declaration). `seq` is not caller-settable (proved by test, mirror :634).

**DD10 - The incident guardrail is shape-only, stated honestly.** `use_terms.subject` is validated as a `sha256:` work-hash shape; the gate proves **shape, not work-ness** - the rail cannot distinguish the hash of a person (`sha256(email)` is shape-identical) from the hash of a work, and `is_human_namespace` (registry.py:101-105) applies to `agent_id` only, firing on no hash-shaped value. So the U3 human-namespace refusals (`test_ac10_*`, test_claims.py:267/:281) reduce to DD1's format gate plus CONVENTION: the privacy guarantee rests on synthetic-identity discipline (all tests/demo/README, CLAUDE.md `feedback_no_fabricated_human_attribution` - the 2026-06-07 incident guardrail) and on a README line telling consumers never to populate `note` with personal data. No ac10-twin table is needed.

## Interface (exact; pins the executor contract)

```python
# zephyr/claims.py - additions
USE_VOCAB: tuple[str, ...]  # ("training", "remix", "redistribution")

class ClaimsStore:
    def insert_use_terms(self, *, manifest_hash: str, subject: str, declared_by: str,
                         allowed_uses: list[str], denied_uses: list[str], scope: str,
                         revokes: bool, note: str, summary: str, recorded_at: str) -> None: ...
    def list_use_terms_for_subject(self, subject: str) -> list[dict]: ...

def record_use_terms(*, subject: str, allowed_uses: list[str],
                     denied_uses: list[str] | None = None,
                     scope: str = "standing", agent_id: str,
                     revokes: bool = False, note: str = "",
                     signer: "AgentSigner | None" = None,
                     registry: "PubkeyRegistry | None" = None,
                     recorder: "AttributionLog | None" = None,
                     timestamp: str | None = None) -> dict: ...  # record_signed's return dict
    # NO declared_by parameter (DD2): derived internally as s.pubkey_id_str.
    # Tombstone call shape: revokes=True with allowed_uses == denied_uses == [] (DD5).

def resolve_use_terms(subject: str, *, store: "ClaimsStore | None" = None, log=None,
                      registry: "PubkeyRegistry | None" = None) -> dict | None: ...
    # Returns None when no active (non-revoked, integrity-ok) declaration exists, else the
    # PINNED consumer-visible shape read from the verified ClaimIntegrityResult.payload:
    # {"subject", "declared_by", "allowed_uses", "denied_uses", "scope", "revokes",
    #  "seq", "manifest_hash", "verification"}
    # declared_by MUST be present in the return: the entitlement cross-check is the
    # consumer's job (consent squatting - a third party CAN declare on any work hash;
    # the machine reports WHO declared, never who was entitled).

def check_use(subject: str, use: str, *, store: "ClaimsStore | None" = None, log=None,
              registry: "PubkeyRegistry | None" = None) -> str: ...
    # -> "permitted" | "denied" | "undeclared" (closed enum; DD8 selection algorithm)

def verify_use_terms_row(row: dict, *, log=None, registry=None) -> ClaimIntegrityResult: ...
    # never raises (DD8: malformed JSON -> ClaimIntegrityResult(False, "malformed_uses_json", ...))
```

Conventions: keyword-only args like every sibling; JSON lists stored as canonical JSON text; `__all__` in claims.py updated (it pins the supported surface per CLAUDE.md). `check_use` rejects an unknown `use` argument with ValueError listing `USE_VOCAB` (never tri-states an unknown token).

## Deliverables (one PR, two units)

**D1 - claims unit.** `zephyr/claims.py`: schema, `insert_use_terms`/`list_use_terms_for_subject`, `record_use_terms`, `resolve_use_terms`, `check_use`, `_use_terms_payload`, `verify_use_terms_row`, `__all__`. `zephyr/deposit.py`: vocabulary string. New `tests/test_use_terms.py` mirroring `tests/test_claims.py` fixtures and AC naming. Minimum ACs:
- ac1 round-trip: declare -> resolve -> verify; re-record identical row is a no-op (mirror `test_u2a_ac4_idempotent_insert_is_a_noop` :461; pin `timestamp=` explicitly so the envelope is byte-identical and the no-op branch, not the IGNORE branch, fires). A same-`manifest_hash` row with ANY differing column raises `IntegrityError` (DD9's loud insert - the OR IGNORE footgun test).
- ac2 self-sign chokepoint: `record_use_terms` signature has NO `declared_by` parameter - introspection with the mirror's forbidden set verbatim INCLUDING `declared_by` (test_claims.py:182 `{"method", "declared_by", "subject_kind", "on_behalf_of", "proxy"}`); the stored `declared_by` equals the resolved signer's `pubkey_id_str` (derived, DD2).
- ac3 vocabulary: unknown token / overlapping allowed+denied / empty union (on a `revokes=False` row) all raise with the vocabulary named in the message; a tombstone (`revokes=True`, both lists empty) passes the validator (DD4 exemption).
- ac3b scope grammar: non-conforming scope raises (mirror claims.py:1183-1186); bare `"event:"` with empty ref raises; an `event:<ref>` declaration is still consulted as active (DD3 ruling - scope never affects selection in v0).
- ac4 tri-state: permitted, denied, undeclared each reachable and distinct from the others; unknown `use` argument raises.
- ac5 revocation: tombstone (both lists empty) -> subsequent check_use is `"undeclared"`; the tombstone itself verifies; history stays verifiable (prior row still verifies ok for its era); re-declaring after a tombstone re-activates (seq-max over ALL rows, DD8); the old-permitted-never-resurfaces case is pinned: with a tombstone as seq-max, no query path consults the older row.
- ac6 selection law: backdated `recorded_at` does not change which declaration is active (mirror :586/:602); `seq` not caller-settable, strictly increasing (:634/:649).
- ac7 tamper: deposit without domain row raises `RouteTamperError` with `failure_mode="missing_domain_row"` naming the hash; **domain row whose deposit was re-tagged (store_kind flipped) raises `failure_mode="orphan_domain_row"`, NOT a benign `"undeclared"`**; latest integrity-fails -> `"undeclared"`, no fallback to older (:1250-1256 rule); `denied_uses` cell tampered to invalid JSON -> check_use returns `"undeclared"` with no exception escaping and a WARN naming the failure_mode (DD8 never-raise).
- ac8 revoked declared-by key, BOTH directions (attribution.py:685-693 polarity): key revoked reason=`compromised` (post-window) or reason-missing -> verify surfaces the status and check_use reports `"undeclared"`; key revoked reason=`rotated`/`retired` (clean retirement) -> the declaration's tri-state STANDS (this is DD5's "what was true while consent stood stays verifiable forever"; an unqualified fail-closed here would contradict it). Also assert the README consumer-law sentence ships (D2): a work that ever had a `denied` declaration is never treated more permissively because key revocation turned it `"undeclared"`.

**D2 - demo + docs.** `demo/run_demo.py`: a consent scene (new scene id `act-1b-consent`, following the `start_scene` convention at :255-275) between act-1-deposit and act-2-remix: User A declares `{allowed_uses: ["remix"], denied_uses: ["training"]}` on the original's manifest_hash; **the remix consult is anchored immediately BEFORE the functional remix - the `make_signed_deposit(... derived_from=manifest_original ...)` call at :288**, not the scene hook at :297** (anchoring to the scene gap can land after the remix is already deposited). Consumer behavior per outcome, all three pinned: `permitted` -> remix proceeds; `denied` -> remix skips with a logged scene beat; `undeclared` -> remix skips (conservative default for the v0 consumer). The third-party training-bot is a **net-new actor** (no training surface exists in the demo today - panel-verified) with its own scene beat: consults `check_use(original, "training")`, denied -> skips; on a revoked-declarator-key flip to `"undeclared"` it also skips (never honors undeclared above denied - see the consumer-law line below). Extend `tests/test_demo_e2e.py` asserting all three outcomes distinctly, new tests named `test_demo_consent_*`. `README.md`: a consent-of-use section - what shipped (signed self-declarations over a closed vocabulary `{training, remix, redistribution}`, tri-state reporting, revocation without erasure, Merkle-auditable), the machine-makes-no-claim posture on permission, **one REQUIRED entitlement-disclaimer sentence (lifted near-verbatim from this spec's Scope: "declared_by is attribution of the declaration, never proof of entitlement - disputes go to the social layer"; consumers must cross-check `declared_by` against the work's creator before honoring `permitted` - the machine reports WHO declared, never who was entitled)**, one honest next-units line (character/scene consent, witness countersignature, event-scoped terms), a disambiguation line separating this use-consent from the Open-Payments payment-grant "consent" beats already in `demo/README.md:89`/:199, and a line telling consumers never to populate `note` with personal data. BANNED phrases in README text (DoD 4 greps them): "consent registry", "verify who consented", "enforce", "adjudicat" - the sent OSAIF email used the first two about a rail that cannot make good on them; the README must not inherit the overclaim. No claim anywhere that the machine adjudicates permission or rights.

## Invariants (reviewer checklist)

1. No LLM calls, no network in zephyr/ (CLAUDE.md redline).
2. Append-only: zero UPDATE/DELETE on claims tables; revocation is additive.
3. `recorded_at` never load-bearing for selection anywhere in the new rail.
4. Synthetic identities only - no real human in any test/fixture/docstring/demo line.
5. No-proxy posture structural: the parameter does not exist, proven by introspection test.
6. `check_use` fails closed on integrity failure; never falls back; never redistributes.
7. Zero diff in any file outside: `zephyr/claims.py`, `zephyr/deposit.py`, `demo/run_demo.py`, `README.md`, `tests/test_use_terms.py`, `tests/test_demo_e2e.py`. Existing claim kinds, the routing compiler, the U2b executor contract, and the transparency log are untouched.
8. Registry consulted in the verify path per the `verify_wallet_binding_row` precedent.
9. New dependency count: zero (stdlib + existing `archetypes_core.provenance` envelope only).

## Definition-of-Done

1. Full pytest suite green on BRIX at the PR head (fresh run in the branch worktree per the salvage rule; baseline verified this session at c539ac1: **547 tests collected** by `pytest --collect-only -q` - the "371" figure is `def test_` definitions, parametrization inflates collection; report `547 + N` with N stated against the AC list, zero new skips/fails).
2. `python -m zephyr.deposit --help | grep -o use_terms` non-empty (the vocabulary is free help text at `zephyr/deposit.py:35-36`, no `choices=`, so this checks the exact shipped surface).
3. The consent scene runs under `tests/test_demo_e2e.py` and asserts permitted/denied/undeclared distinctly; check is `pytest tests/test_demo_e2e.py -k consent -v` (new tests are named `test_demo_consent_*`).
4. README consent section merged, mechanically checked: (a) the entitlement-disclaimer sentence, the next-units line, and the **consumer-law sentence** - stating that `undeclared` is never permission and is never more permissive than a prior `denied` declaration - are all present (checklist, all three quoted in the PR body; consumer-law line folded post-re-gate per Erah's "work to make them true", 2026-09-28, trickster stance run `2026-09-28-202922-c37f07`); (b) `grep -Eio 'consent registry|verify who consented|enforce|adjudicat' README.md` returns nothing; (c) the consent vocabulary in README is exactly `{training, remix, redistribution}` (scope: top-level README.md only - `demo/README.md` pre-existing Open-Payments "consent" beats are out of scope, see Grounding note).
5. File-diff scope gate: `git diff --name-only $(git merge-base origin/main HEAD) HEAD` equals the D1/D2 list exactly (two-dot `main..HEAD` can diff a wrong base on a behind-origin branch).
6. Fixer self-review against CLAUDE.md Rules section, quoted in the PR body; PR body also reports `tests/test_demo_e2e.py` wall time before/after the consent scene (panel live-check item; the file has no runtime bound today).

## Gate state (2026-09-28) and the council re-gate obligation (PM side - MUST land before ratify, NOT part of the fixer's PR)

Pre-bind gate ran twice, flashnext-voiced, post-doorman-fix deploy (14:12 and 14:15 PT; runs `2026-09-28-141215-1725ff`, `2026-09-28-141505-6a6882`):
- **Council leg: infra park, both runs, gate-classified "not a spec objection."** Signature: entity selection falls back to `operator_class='gravitywell'`, GW wake refused `state=gw_flashnext_window` (sglang holds the GPU for the PM's own seat; waking the GW lane would kill it - the fleet's own GPU mutex), `on_wake_fail='park'`, no silent paid fallback. This is the known flashnext-solo park class: council-voicing-flashnext end-to-end proof is still open (`decision/flashnext-gate-first-deliberation-2026-09-28`: "council-voicing proof pending"; fix halves: doorman serving-axis chain LANDED today as agents-core #375 - the wake-guard half is the queued registry-named-posture spec). The gate's "same failure twice -> stop and inspect" rule was honored: root cause established from the ledger + the doorman deploy timestamps + the park message, not guessed.
- **Facets leg: self-declared unreliable, 3 consecutive today** (incl. this morning's doorman gate) - persona JSON parse failures + `codebase_surface_denied` grounding; the single substantive stance (transmuter, run 1) converges with the panel's README-honesty fold (H7). Last night's clean facets run shows the shape works when the lane is calm.
- **Re-gate obligation (DoD-0, mirrors today's doorman-chain precedent `pm/bind/doorman-flashnext-serving-admission-chain-2026-09-28` - "council re-runs post-merge, council verdict must land before ratify"):** once the fleet posture admits the council leg (GW lane wakeable without colliding with the dispatching seat, or council-voicing-flashnext proof landed via the registry-named-posture chain), re-run the full gate on the final spec text; the Council must complete (not error) before `lapis-pm ratify` on the PR; facets re-rolls at least once in that window. A council BLOCK/OPEN-QUESTION at that point returns the target to amend-spec or to Erah, per the spec-review skill.
- **RE-GATE EXECUTED 2026-09-28 20:29 PT (post registry-named-posture-v0 chain - DoD-0 SATISFIED):** runs `2026-09-28-202922-c37f07` (facets) / `2026-09-28-202922-dcc175` (council). Council SUBMITTED and deliberated on flashnext voicing (voicing=selection_voicing=flashnext, no degrade, paid_spend false, 9 turns, 3.6 kB synthesis) and **laid down** - a reasoned withholding (2 agree, 1 block), not an infra park. Facets thin again (technical-integrity + transmuter blank, `codebase_surface_denied` recurs - facets-working side, parity tail); the single substantive stance (trickster, inferred): fold a mechanically-checked README consumer-law line + register the mirror gate locator. Gate recommendation was shape-with-erah; surfaced in full.
- **Erah's answers to the laid-down council (2026-09-28, carried in as text - the five open questions):** (1) OSAIF email wording: **"Wording stands, and we work to make them true"** - the consent pitch stays; this unit landing is the making-true. (2) README binding downstream consumers against consent-squatting: **"Not possible at this stage"** - the entitlement-disclaimer sentence is the honest artifact; no mechanism promised. (3) Council verdict as hard gate: **"Questions are fine to be visible, we proceed"** - bind and dispatch are GO with the open questions standing visible in-record; the laid-down is not treated as a blocker. (4) Tamper vector: answered at code level (design note below). (5) Mirror banned-term gate: it is the anti-overclaim gate on the mirror push (zero-hit grep for `consent registry|verify who consented|enforce|adjudicat` on new content, run through Neo's rewrite rules) - honesty discipline about our own public claims, not content censoring; owner + locator caveat already recorded in §Post-land.
- **Design note on the Q4 tamper vector (file:line, this session):** neither re-tag-after-deposit nor deposit-twice is a code path - the ONLY UPDATE in `attribution.py` touches `provenance_json` (:595), and `INSERT OR IGNORE` on the `manifest_hash` primary key (:397-399) makes a second deposit of the same manifest a silent no-op; a re-tag therefore requires a RAW write to attribution.db (ledger-host tamper class). Where a re-tag CAN land: an index consumer using `list_by_store_kind_and_key` ("Read-only; no verification", :511-512) could miss the deposit, and DD7's both-ways checks must catch every matching-direction corruption (re-tag to nobody's key -> orphan_domain_row loud; re-tag onto another row's key -> verify_claim envelope mismatch loud; claims row loses its deposit -> missing-side loud). Permission verdicts are structurally immune: `check_use`/`resolve_use_terms` mirror `resolve_wallet` (claims.py:1283-1290 - seq-max over the claims.db DOMAIN rows + `verify_claim` envelope binding), never the deposits index. Residual: enumeration/audit helpers can be starved by a raw-DB adversary - the same adversary that can reach the Merkle anchor; artifact self-certification cannot cover its own host, and that boundary stays visible rather than promised away.

## Post-land (NOT part of this PR - recorded so the PM does not lose the thread)

Public mirror sync `github.com/xoeieox/zephyr`: port the merged diff through the mirror rewrite rules, re-run the zero-hit banned-term gate on new content, push. Owner: Neo (code seat), post-merge, per the publication decision recorded 2026-09-28. **Locator caveat (panel-fold, 2026-09-28): `mirror-audit/rewrite-rules/` and the banned-term gate command do not resolve on the BRIX side** - absent from the zephyr working tree, `/room`, and mem (re-grepped by the mechanisms' own names; the publication decision itself also has no mem key). Before land, Neo supplies the concrete locator (workspace path or repo) for the rewrite rules and the gate command, and the publication decision gets registered to mem, so the PM land-step can verify the mirror sync actually ran (zero-hit gate output quoted in the deposit).

## Known-deferred (for the pre-gate panel to confirm as deliberate)

CLI surface (`python -m zephyr.use`); blanket per-author default terms (v0 is per-work only); event-scoped consultation (`check_use` grows an event-ref argument when event-scoping ships - v0 stores+hashes scope but never consults it, DD3's ruling, not an omission); TDM/training-registry query surface; witness countersignature wiring; GNAP interactive consent; consent metadata in the settlement path (money and use stay decoupled in v0 - a use declaration never gates a payment leg, and this decoupling is a design position, not an omission); `note` length cap (the signed envelope makes tamper evident, so the residual PII risk is signer-side - a cap ships with the CLI unit).

## Investigation checklist (spec-draft canon)

- [x] Function signatures verified against c539ac1 (== origin/main == working tree), line-quoted above
- [x] Extension points identified: `record_signed` chokepoint, `_SCHEMA`, `list_by_store_kind_and_key`, verify_* family
- [x] No forbidden files touched (Invariant 7 + DoD 5); CLAUDE.md Rules encoded as Invariants
- [x] Dependencies: none added (verified against claims.py imports; stdlib only)
- [x] Timeout constants: N/A (no executor/HTTP surface in this unit)
- [x] Architecture constraint honored: structural decoupling preserved (zephyr imports nothing from mem-server/weaver/lapis-pm)

## Many Eyes pre-gate findings
> Pre-gate review input, not authored spec content. Panel: many-eyes-review 2026-09-28, seat flashnext/Qwen3.8-Flash-Next-NVFP4-SSD-Stream (GW:30000, registry-healthy), spec rev 0 -> rev 1 (this fold), gate runs `2026-09-28-141215-1725ff` + `2026-09-28-141505-6a6882` (both: facets degraded-by-parse-flake, council infra-park - see the Gate state section; neither leg registered a content objection). Voices treat these as claims to confirm or refute against the code, not as spec requirements. Lenses: correctness (general), security (verify), ops-legibility (explore), performance (verify), dispatched serially per the seat ops cap (max 2 streams, flashnext-solo). Every BLOCKER/HIGH below was confirmed by the PM's own file:line reads at c539ac1 this session; the anchor-drift cluster and the declared_by contradiction were each reported independently by 3 lenses (convergence signal).

### BLOCKER (addressed in rev-1)
- **B1 (correctness; confirmed)** DD1's 64-lowercase-hex gate rejects every real work hash - all ecosystem manifest hashes carry the `sha256:` prefix (`claims.py:914`, `demo/run_demo.py:77`, the demo's own `manifest_original` at :204). The demo consent scene would raise on its first call or an implementer would strip the prefix and break federation. Fixed: gate = `sha256:` + 64 lowercase hex.
- **B2 (correctness + security closure-check; confirmed)** DD4's disjoint/union-non-empty validator applied to all rows made DD5's tombstone unwritable (tombstone carries no affirmative permission content), and the tombstone's row shape was never pinned; the wallet precedent does not resolve it (its tombstone carries a real `wallet_address`, validated unconditionally :1095-1099). Fixed: tombstone MUST be `allowed_uses == denied_uses == []` with `revokes=True`; DD4 validator applies only to `revokes=False` rows.

### HIGH (addressed in rev-1)
- **H1 (correctness; confirmed)** DD8's "latest non-revoked" wording inverted the executable selection at `claims.py:1285-1292` (which takes seq-max over ALL rows, integrity-checks that row, then checks `revokes`): read literally, tombstones are filtered before selection and an older `permitted` declaration resurfaces after revocation - fail-OPEN, the exact attack revocation exists to prevent. Fixed: DD8 now states the algorithm verbatim-in-effect; ac5 pins old-permitted-never-resurfaces.
- **H2 (security; confirmed)** The signed payload's field list was unpinned ("build payload dict {...}, mirror :948") - and the sibling binds only 4 fields (`_wallet_binding_payload` :948-956). Any verdict-affecting column left out of the envelope is DB-flippable while `verify_use_terms_row` stays ok. Fixed: DD8 pins the exact 7-key payload; adjudication reads `ClaimIntegrityResult.payload`, never raw domain columns.
- **H3 (security + correctness, converging; confirmed)** A caller-supplied `declared_by` parameter contradicted Invariant 5's "structural, proven by introspection" claim and broke the ac2 mirror - the pinned forbidden set at `test_claims.py:182` includes `declared_by`, so verbatim mirroring fails and dropping it makes the test vacuous. Fixed (security's stronger resolution): parameter removed, `declared_by` derived internally from the signer, forbidden set kept verbatim.
- **H4 (correctness; confirmed)** ac8's unqualified "fail-closed on revoked declared-by key" contradicted `verify_row`'s actual polarity (`attribution.py:685-693`: `rotated`/`retired` -> `verified`) and DD5's own "what was true while consent stood stays verifiable forever". Fixed: `compromised`/reason-missing -> `"undeclared"`; `rotated`/`retired` -> tri-state STANDS; both directions asserted.
- **H5 (security)** Consent squatting: any registered key can sign `allowed_uses:["training"]` over anyone's work hash and every integrity check passes (by DD1 design - entitlement is social-layer, correctly). But the unpinned `resolve_use_terms` return shape left consumers with no way to link-check the declarator. Fixed: return shape pinned incl. `declared_by`; README carries the REQUIRED entitlement-disclaimer sentence + consumer cross-check law.
- **H6 (security; premise confirmed live)** The deposit-authority check was one-directional. Leaves are `(seq, manifest_hash)` pairs (`attribution.py:495-509`), so deposits-table `store_kind`/`target_key` columns sit OUTSIDE Merkle coverage: re-tag a tombstone's deposit + delete its domain row and a revocation erases into a benign `"undeclared"` invisibly to audit. Fixed: DD7 reverse check -> `orphan_domain_row` (named ac7 test) + docstring states the re-tag residual honestly.
- **H7 (ops)** README honesty vs the already-sent OSAIF email, which used "consent registry" and "verify who consented" for a rail that proves only `declared_by == signer`. D2's content list required an anti-adjudication guard but not the entitlement disclaimer, and DoD 4 screened only for presence of bad phrases, not absence of good ones. Fixed: required disclaimer sentence, banned-phrase grep gate in DoD 4, two-senses disambiguation line (`demo/README.md:89`/:199 carry Open-Payments "consent").

### MEDIUM (folded in rev-1)
- **M1 (security)** The raw-`json.loads` precedent (`_route_manifest_payload` :973-974) means a tampered JSON cell would crash out of `verify_*_row`, escaping `verify_claim`'s never-raises guarantee (:922-923) - fail-open-by-crash into whatever the consumer's except-block does. Fixed: never-raise, `malformed_uses_json` integrity-fail, distinct WARN failure_modes so tamper is never a silent `"undeclared"`.
- **M2 (security over correctness - inter-critic conflict, resolved for security)** correctness proposed mirroring `INSERT OR IGNORE` (`claims.py:350`); security showed the rail's own louder precedent, `insert_route_manifest` (:420-458: identical-row no-op check BEFORE the guard, `IntegrityError` re-raised never absorbed), is strictly safer - bare OR IGNORE silently absorbs a same-hash-different-content collision, so a pre-seeded row at a predictable future envelope hash swallows the real declaration. Decision: loud pattern (DD9, ac1 gains the differing-column case).
- **M3 (correctness + ops)** `scope` was stored, validated, hashed - and consulted by nothing: an `event:<ref>` declaration would silently govern the standing tri-state forever. v0 ruling pinned: stored+hashed, never consulted; bare `event:` empty-ref rejected; README must not imply event-scoping ships; known-deferred entry added.
- **M4 (ops)** D2's consult anchored the scene hook (:297), but the functional remix is the signed deposit at **:288** - a scene-gap anchor can land after the remix is already deposited; the remix's `denied`/`undeclared` branches were undefined and the training-bot is net-new (`grep training demo/` zero hits, re-grepped by name). Fixed: anchor :288, three outcomes + bot behavior + scene id `act-1b-consent` pinned.
- **M5 (ops + performance)** DoD 1-5 rewritten to command-level checks; the suite baseline corrected (see Live-checks); DoD 5 two-dot diff could diff a wrong base on a behind branch -> merge-base form; `tests/test_demo_e2e.py` before/after wall time moves to the PR body.
- **M6 (ops)** Post-land mirror-sync pointer unresolvable BRIX-side (`mirror-audit/rewrite-rules/` and the banned-term gate: zero hits across working tree, /room, mem, re-grepped by mechanism names) - locator + publication-decision mem registration made a pre-land item for Neo.
- **M7 (performance)** DD9 omitted the subject index every sibling defines (`wallet_bindings_subject` :92, `routing_terms_subject` :107) while `check_use` is the hot per-query path on an append-only table; `CREATE INDEX use_terms_subject` added (parity fix - no v0-scale urgency, honest LOW-grade).

### LOW (folded / known-deferred)
- Anchor-drift cluster re-pinned in the Grounding block: executescript :331 (was :333), `_migrate_add_seq` call :333 (was :328) / def :226, self-sign check :1088-1093 (was :1085-1092), scope grammar :1183-1186 (was :1210-1214), deferred import :1264-1265 (was :1274-1275), fixtures :79-89 (were folded into the :105-306 test range), tamper raise must copy the call form :1277-1280 (`ctor is (message, *, failure_mode)` - the spec's `RouteTamperError("missing_domain_row", ...)` shorthand reads as a positional failure-mode and would TypeError).
- Quote fidelity: three quotes presented as verbatim were condensed/stitched (the self-sign docstring excision, the U2a two-line stitch, DD8's tense-changed join) - re-marked "condensed from" with real locations (CLAUDE.md:70/:132/:76-77/:105, claims.py:1076-1081/:1250-1256); semantically faithful, grep-recoverability was the defect.
- DD10 reworded honestly: the format gate proves shape, not work-ness (`sha256(email)` is shape-identical; `is_human_namespace` registry.py:101-105 fires on `agent_id` only) - privacy rests on synthetic-identity discipline + a README note-hygiene line; `note` cap deferred with the CLI unit.
- Interface hygiene: `denied_uses: list[str] | None = None` (was `list[str] = ()`, a tuple default under a list annotation); `seq` non-settable test kept.

### Live-checks executed (PM-side, this session)
- `pytest --collect-only -q` at c539ac1: **547 collected** (the "371" was the `def test_` definition census, independently counted by two lenses - parametrization inflates collection; DoD 1 now pins the collected number).
- `github.com/xoeieox/zephyr` fetched live: mirror ships the FULL tree (`demo/`, `tests/`, `settler/`, 53 commits) - so the "consent zero mentions" claim is true only of the top-level README; Consumer/Grounding/DoD-4 scoped accordingly.
- `ZEPHYR_SIGNING_MODE`: default `observe` (attribution.py:379); no override in `/data/agents/config` or `/etc/default` - the M2 pre-seed race's unsigned-occupancy variant is not gated at the env level; the new rail's only record path goes through `record_signed` with a real signer, so the residual is acceptable for v0 and named.
- Transparency leaves confirmed as `(seq, manifest_hash)` (attribution.py:495-509) - H6's "tags outside Merkle" premise true, not inferred.

### Panel notes
- Three lenses independently verified the same executable patterns as correct-and-mirrorable (`resolve_wallet` :1285-1292, the loud insert :420-458, the revoked-key polarity :685-693): the risk lived entirely in the spec's paraphrases, not in the rail. Rev-1 replaces paraphrases with algorithm-level text.
- No lens found the design wrong: the permission-void, self-declaration-by-absence, append-only tombstone, and machine-makes-no-claim posture all survived adversarial contact; the fold sharpens enforcement (structural no-proxy, pinned payload, bidirectional tamper check) without adding adjudication the rail must not do.
```

---

## 4. Mesh-protocol + invariant seam (km-seed repo; dispatch's `protocol/3 docs` — the dir holds 5, the two protocol-of-record embedded here, the other three in 02 §4.3/§4)

### 4.1 `protocol/mesh-protocol.md` (VERBATIM) — the invariant the packet exists to enforce

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

### 4.2 `protocol/invariants.md` (VERBATIM) — invariant-as-primitive, ledger + deposit seam

```text
# Invariants

What an **invariant** is in this mesh, why it is the primitive worth
carrying to every node, and how its ledger and deposit seam work. See the
`governance` component (`components/governance/governance.md`) for the
checkable contract and the `operations` / `council` lenses that read this
ledger.

## What an invariant is

An invariant is a node's own declared **must** or **must-not** - a
statement about what any agentic build on this node is required to do, or
forbidden from doing, regardless of how convincingly a given task seems to
argue otherwise in the moment. It is not a style preference, a config
default, or a runbook step; it is the thing the node considers
non-negotiable enough to check every agentic build against.

Ratified basis: `decision/knowledge-mesh-seed-packet-invariants-2026-07-20`
- the driving decision. The packet strongly-recommends-not-requires
adopters declare invariants, and ships a portable, generically-named lens
pair (`operations` / `council`, see the `governance` component) that
deliberates from them.

## Why this is the primitive worth propagating (flame-origin / pilot doctrine)

The evidence that drove this design: a deliberation grounded in a node's own
declared invariants repeatedly surfaces considerations the author of an
agentic build missed - not because the reviewer is smarter, but because it
is checking against something concrete and pre-committed rather than
improvising judgment in the moment. This is where **pilot doctrine**
(human-in-the-loop at the intent layer) actually sits in this mesh:
invariants ARE the intent layer. A node's human operator decides, in a
quiet moment, what this node must never do; every later agentic build gets
checked against that earlier, calmer decision rather than re-litigating it
under the pressure of whatever task is in front of it at the time. That is
the "flame origin" this packet exists to protect - the load-bearing human
judgment, captured once and propagated everywhere the node's agentic work
runs.

You declare your invariants; any agentic build off them gets checked
against them; therefore the end product stays aligned with what you
declared it must, or must not, be.

## The ledger artifact (node-local, never committed)

The invariant ledger lives at `INVARIANTS_PATH` (see `conform/schema.md` for
the node.yaml key and env var) and is, like `ops/declarations.yaml`,
**never committed to this packet repo** - it belongs to the node being
grown, not to the packet. `seeds/governance/invariants.yaml.template` ships
the ledger's SHAPE only (a marker plus one illustrative `must` and one
illustrative `must-not` entry) - never canned invariants, the same stance
`seeds/persona/soul.md` takes for voice.

```yaml
invariants:
  - id: <kebab, unique>
    kind: must            # must | must-not
    statement: "<the actual invariant, in your own words>"
```

## Zephyr deposit seam (optional, mirrored on declarations)

Depositing an invariant ledger's history into Zephyr attribution follows
the exact same seam `ops/declarations.yaml` already uses (see
`components/identity/identity.md` §Bootstrap carve-out): pending until this
node's `identity` and zephyr-facing components are both green, at which
point it deposits signed and any `pending-deposit` records get
retroactively deposited. **This packet does not build the ingest reader** -
the git/declarations-to-Zephyr reader is a separate, unbound feeder target
in the `zephyr` repo, the same honest gap the `lapis-pm` component names for
its own `zephyr-git-ingest-v0` feeder. Any Python this packet ships that
touches zephyr uses the dynamic-import seam, never a static `import
zephyr...` - there is none in this component; this section documents the
seam's shape for a future feeder to fill, it does not implement one.

## Revision is expected, not rot

Mirror Council (run 2026-07-20-213414-daaccc) converged on this with a
reservation worth stating plainly: the runner can enforce the *structure*
of declaration and record the gap, but it cannot see the *soul's* honesty -
a rigid demand for declaration risks rewarding the actor who only revises
an invariant once caught (theater of compliance). This packet's design
answer:

- **Revising an invariant is a first-class, non-punitive act.** There is no
  invariant-stability assertion anywhere in
  `components/governance/requirements.yaml`, and there will not be one -
  the runner never treats a revised or removed invariant as rot or a
  defect. Admitting an invariant was wrong and revising it is expected and
  virtuous behavior, a higher good than static consistency for its own
  sake.
- **Motive is never adjudicated.** Consistent with this packet's
  declarations-file stance (`GROW.md` §Essential vs. living, and what a
  declaration is), the runner prices and dates the debt -
  `cost_of_delay`, `revisit`, age, the deposited record - and leaves
  genuine-correction-vs-strategic-pivot legible to a *human* reading that
  record. The runner never tries to guess which one it was. Naming the
  "theater of compliance" failure mode here, explicitly, is the point - a
  system that pretended it could detect honest-vs-caught revision would be
  lying about what it can actually see.

This resolves the Council's cost-of-delay-as-burden concern by making
revision cheap, and defers the harder question - detecting honest vs.
caught revision - to the human reading the record, by ratified design, not
by an unbuildable machine motive-detector.

## Operations vs. council read this ledger differently

Both lenses in the `governance` component can reference this ledger, but
only `council` actually reads it (`reads: invariants`) - `operations` reads
node/operational state instead (`reads: node-state`). See
`components/governance/governance.md` §Operations vs. council: two distinct
lenses, never merged, for why these stay two distinct questions.
```

### 4.3 `conform/schema.md` (VERBATIM) — the conformance contract

```text
# Conformance schemas

Three file schemas the conformance runner (`conform/km-conform.py`) reads.
This document is normative; the YAML examples in `GROW.md` and the
component docs are illustrative. Where they disagree, this document wins.

All three files use the same restricted YAML subset the runner's built-in
YAML-lite reader implements: block mappings, block sequences (including
inline `- key: value` sequence-of-mapping items), inline flow lists
`[a, b]`, quoted and bare scalars, and `#` comments. No anchors, no flow
mappings, no multi-line scalars, no tabs. See the docstring at the top of
`conform/km-conform.py` for why (zero third-party dependencies - PyYAML is
unavailable on a bare foreign node).

## 1. `requirements.yaml` (one per `components/<name>/`)

### Dual-layer semantics

Every assertion is tagged `essential` or `living` - this is the core
judgment the whole contract rests on:

- **`essential`** - identity, keys, store integrity, and similarly
  structural properties. A failing essential assertion is a **Blocker**,
  unconditionally. No declared intent can soften it; there is no way to
  mark an essential gap as accepted.
- **`living`** - personas, configurations, data layouts, and similarly
  legitimately-variable properties. A failing living assertion requires an
  entry in the node's declarations file (§2) to avoid being a Blocker. An
  **undeclared** living-layer failure is a Blocker by default - silence is
  never a pass.

### Judge, not teacher

The runner's output is pure judgment - it never generates remediation
advice. Every assertion carries a `grow_ref` anchor, and the gap report
prints that ref next to every gap it reports. The path of repair ships
inside the packet itself (`GROW.md` and the component docs), one pointer
away; the runner addresses, it does not teach.

### JSON Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "requirements.yaml",
  "type": "object",
  "required": ["component", "assertions"],
  "additionalProperties": false,
  "properties": {
    "component": {
      "type": "string",
      "pattern": "^[a-z][a-z0-9-]*$",
      "description": "Must exactly match the containing directory name, components/<component>/."
    },
    "assertions": {
      "type": "array",
      "minItems": 1,
      "items": { "$ref": "#/definitions/assertion" }
    }
  },
  "definitions": {
    "assertion": {
      "type": "object",
      "required": ["id", "description", "check", "expect", "layer", "grow_ref"],
      "additionalProperties": false,
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^[a-z][a-z0-9]*(-[a-z0-9]+)*$",
          "description": "kebab-case, unique within the component"
        },
        "description": { "type": "string", "minLength": 1 },
        "check": {
          "type": "string",
          "minLength": 1,
          "description": "A read-only shell command, executed via `sh -c` with cwd set to the packet repo root. Must never write, delete, or mutate anything on the node it inspects."
        },
        "expect": {
          "type": "object",
          "required": ["exit"],
          "additionalProperties": false,
          "properties": {
            "exit": { "type": "integer", "minimum": 0, "maximum": 255 },
            "stdout_match": {
              "type": "string",
              "description": "Optional. A regex; if present, check's combined stdout must match it (re.search) in addition to the exit code matching."
            }
          }
        },
        "layer": { "type": "string", "enum": ["essential", "living"] },
        "mode_hints": {
          "type": "array",
          "items": { "type": "string", "enum": ["grow", "align", "route"] },
          "description": "Optional. Which GROW.md interview modes this assertion is relevant to."
        },
        "grow_ref": {
          "type": "string",
          "pattern": "^GROW\\.md#[a-z0-9-]+$|^components/[a-z0-9-]+/[a-z0-9-]+\\.md(#[a-z0-9-]+)?$",
          "description": "An anchor into GROW.md or a components/*.md doc where the fix for a failing instance of this assertion is documented."
        }
      }
    }
  }
}
```

## 2. Declarations file (node-local, default `$NODE_ROOT/ops/declarations.yaml`)

**Never committed to this packet repo** - it belongs to the node being
grown, not to the packet. The runner only *reads* it; authoring a
declaration is the node's LLM/human's act, and depositing it into Zephyr
attribution is the node's own zephyr-facing seam (see
`components/identity/identity.md` §Bootstrap carve-out) - the runner does
neither.

### Field notes

- **`declared_at`** is required by this schema even though the governing
  spec's illustrative example omits it. It fills a real gap: the spec
  requires the runner to "always list Deferred items with age," and age is
  not computable without a declaration timestamp. Documented here as
  filling that gap deliberately, not as a silent schema drift.
- **`revisit`** is a trigger: either an ISO date (`YYYY-MM-DD`) or the name
  of an event. Only a parseable ISO date is auto-evaluated against
  wall-clock time at run time; a named-event trigger never auto-expires -
  the runner cannot detect an event occurring, only a human confirming it
  did (by editing the declaration once it has).
- **`status`** is optional and defaults to `deposited` for reporting
  purposes if absent. Use `pending-deposit` only during the identity
  bootstrap carve-out described above.
- **`impact: blocker`** on a living-layer failure means the node agrees
  it's a real, uncushioned gap - not fixed yet, but not disguised as
  "deferred" either. It still reports as a Blocker; declaring it just
  records the acknowledgment.

### JSON Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "declarations file",
  "type": "object",
  "required": ["declarations"],
  "additionalProperties": false,
  "properties": {
    "declarations": {
      "type": "array",
      "items": { "$ref": "#/definitions/declaration" }
    }
  },
  "definitions": {
    "declaration": {
      "type": "object",
      "required": ["assertion_id", "impact", "cost_of_delay", "declared_at", "revisit", "declared_by"],
      "additionalProperties": false,
      "properties": {
        "assertion_id": { "type": "string", "description": "Must match a requirements.yaml assertion id." },
        "impact": { "type": "string", "enum": ["blocker", "deferred"] },
        "cost_of_delay": { "type": "string", "minLength": 1 },
        "declared_at": { "type": "string", "format": "date" },
        "revisit": {
          "type": "string",
          "description": "An ISO date (YYYY-MM-DD), auto-evaluated at run time, OR the name of an event, never auto-evaluated."
        },
        "declared_by": { "type": "string", "minLength": 1 },
        "status": {
          "type": "string",
          "enum": ["deposited", "pending-deposit"],
          "default": "deposited"
        }
      }
    }
  }
}
```

### Deferred anti-rot, exact mechanics

Every run, for every declaration with `impact: deferred`:

1. If `revisit` fails to parse as an ISO date, treat it as a named-event
   trigger: never auto-expires, always reports under "Deferred, active."
2. If `revisit` parses and is `>= today`, not yet expired: reports under
   "Deferred, active," with age = `today - declared_at`.
3. If `revisit` parses and is `< today`, expired:
   - If every `essential`-layer assertion in the `identity` component
     currently passes: **re-escalate to Blocker.**
   - Otherwise (identity's own essential checks are currently failing):
     report as **`RECOVERABLE-degraded`**, a distinct class from Blocker.
     A node that could not update its own declarations while its identity
     is broken or it is offline is a system condition to go fix, not
     evidence of rot. Fixing the identity blockers and re-running
     re-evaluates the expired item correctly on the next pass.

This runner treats "all essential assertions under the `identity`
component currently pass" as the operational definition of "the node's own
identity/connectivity essential checks are healthy," per the governing
spec's Facets-pass-2 trigger-hardening fold. This is a deliberate, narrow
interpretation choice (identity is the one component every other component
structurally depends on), documented here for a reviewer rather than left
implicit in the code.

## 3. `ops/node.yaml` (node-local, optional)

**Never committed to this packet repo.** A convenience: rather than
exporting every path as a shell environment variable before invoking the
runner, a node can write its path configuration once here. An explicit
process-environment export always overrides the corresponding `node.yaml`
key - `node.yaml` is a default, not an override.

| `node.yaml` key | env var exposed to `check:` commands |
|---|---|
| `node_key_path` | `NODE_KEY_PATH` |
| `mem_db_path` | `MEM_DB_PATH` |
| `keeper_persona_path` | `KEEPER_PERSONA_PATH` |
| `keeper_seeds_dir` | `KEEPER_SEEDS_DIR` |
| `keeper_corpora_dir` | `KEEPER_CORPORA_DIR` |
| `decline_list_path` | `DECLINE_LIST_PATH` |
| `service_config_path` | `SERVICE_CONFIG_PATH` |
| `decks_path` | `DECKS_PATH` |
| `soul_md_path` | `SOUL_MD_PATH` |
| `corpus_remotes_path` | `CORPUS_REMOTES_PATH` |
| `corpus_notes_path` | `CORPUS_NOTES_PATH` |
| `invariants_path` | `INVARIANTS_PATH` |
| `operations_shape_path` | `OPERATIONS_SHAPE_PATH` |
| `council_shape_path` | `COUNCIL_SHAPE_PATH` |

A relative path value is resolved against `--node-root` (default: the
current working directory). `NODE_ROOT` itself is also exposed to every
`check:` command, for assertions that need to reference the node root
directly.

For the three `governance`-component keys added above, this packet's
convention for a node's own default path (what a node's own `ops/node.yaml`
would typically declare once it grows that component, absent some other
node-specific choice) is:

| `node.yaml` key | node-side default |
|---|---|
| `invariants_path` | `ops/invariants.yaml` |
| `operations_shape_path` | `ops/governance/operations.yaml` |
| `council_shape_path` | `ops/governance/council.yaml` |

These defaults resolve against `--node-root` the same as every other
relative path in this table, and point at the node's own adapted copies -
never at this packet's `seeds/governance/` shapes directly.

### JSON Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "ops/node.yaml",
  "type": "object",
  "additionalProperties": { "type": "string" },
  "description": "A flat mapping of the config keys in the table above to path strings (relative paths resolve against --node-root). Every key is optional; an unset key simply leaves the corresponding env var unset unless the process environment already provides it."
}
```

## Exit codes (restated, normative)

| code | meaning |
|---|---|
| `0` | every essential assertion passed, and every failing living assertion has a valid, unexpired declaration |
| `1` | at least one gap: an essential failure, an undeclared living deviation, an expired-and-reescalated Deferred, or a RECOVERABLE-degraded item |
| `2` | runner error - a `requirements.yaml`, `node.yaml`, or declarations file could not be read or failed to parse, or `components/` is missing. Never used for a gap or a green. |

A `check:` command itself erroring out (e.g. a missing binary, a
permission-denied read inside the check) is **not** a runner error - it is
treated as that one assertion failing, with the failure detail captured in
the gap report. Only a failure to read/parse the runner's own three input
file types (above) is a runner error.
```

### 4.4 km-seed README (VERBATIM) — packet structure + sovereignty stance

```text
# Knowledge Mesh Seed Packet

A standalone, downloadable bundle that grows or aligns **any** node -
whatever agentic OS it runs - into a mesh-compatible surface. Someone
clones exactly this repository, nothing else. Philosophy: **plug in what
you have, or grow what you don't.**

## What this is (and is not)

This is a **contract plus reference shapes, not an installer.**

- **Contract** - per-component, machine-checkable requirements
  (`components/*/requirements.yaml`) plus a thin conformance runner
  (`conform/km-conform.py`) that emits a gap report: here is what we need,
  here is what's missing.
- **Shapes** - `seeds/` holds canonical greenfield reference
  implementations: usable shapes to instantiate directly (grow mode) or to
  diff your node's dirty local reality against and converge toward (align
  mode).
- **Process** - `GROW.md`, an LLM-guided interview: inventory, reconcile
  (surface stale or conflicting artifacts, never silently route around
  them), grow/align/route per component, re-run the conformance runner
  until green.

The node's own resident LLM - local or cloud, this packet does not care
which - does the labor of getting its node in order against the contract.
That responsibility loop is the thing under test; this packet supplies the
contract, the shapes, and the process, not a script that does the work for
you.

## Sovereignty stance

**Self-hosted, local-first, never GitHub.** Every git remote this packet's
components reference, and every remote a node grows for its own shared
corpus, is Forgejo. No GitHub URLs, no GitHub workflow files, anywhere in
this repository or in anything it instructs a node to create. See
`components/shared-corpus/shared-corpus.md` and the constraint below.

## The protocol seam (the invariant)

Components are a la carte and swappable. The **protocol seam is not** -
everything a grown node does routes toward the mesh protocol described in
`protocol/mesh-protocol.md`: Expert = Keeper + Persona (+ a Harness axis
this packet deliberately does not specify - bring your own agentic OS and
model backends), a three-outcome query envelope (answered / refused /
unreachable), per-Expert attestation with cache-serve-as-citation, and
signed deposit into Zephyr attribution.

## Component map

| Component | What it is | Doc |
|---|---|---|
| `identity` | one node key + one sovereign store | `components/identity/identity.md` |
| `keeper` | the custodial half of an Expert - corpus, never generates | `components/keeper/keeper.md` |
| `persona` | the generative half of an Expert - Composition cards + soul.md | `components/persona/persona.md` |
| `expert-service` | Keeper + Persona stood up as a queryable service | `components/expert-service/expert-service.md` |
| `shared-corpus` | a corpus genuinely co-owned by more than one node | `components/shared-corpus/shared-corpus.md` |
| `lapis-pm` (optional) | an a-la-carte PM pipeline, contract-first | `components/lapis-pm/lapis-pm.md` |
| `governance` | invariant ledger + the `operations`/`council` deliberation pair | `components/governance/governance.md` |

Every component's `requirements.yaml` is walked by the conformance runner;
every component's `.md` doc explains what it is, where its seed shape came
from (with exact provenance), and what "green" means for it.

## Repository layout

```
README.md              this file
GROW.md                 the guided-setup interview
protocol/               the mesh protocol seam: envelope, signing, store
                        ownership, shared corpus
components/             per-component doc + requirements.yaml contract
seeds/                  reference shapes to grow or align against
conform/                the conformance runner + its schema doc
fixtures/dirty-node/     a synthetic dirty-node fixture proving the
                        gap-report mechanic (not real node data)
fixtures/governance-declined/  a focused positive fixture proving the
                        governance component's recommend-not-require
                        declare-to-decline lever
scripts/                repo-local tooling (link checker)
```

## Getting started

Start at `GROW.md`. It walks every component in order (identity first -
everything else depends on it), tells you what to inventory, and tells you
when to re-run `conform/km-conform.py`.

## Constraints

These hold everywhere in this repository, without exception:

- **Hyphens, not em dashes**, throughout all authored prose.
- **No `ANTHROPIC_API_KEY` or direct Anthropic API references anywhere.**
  Every LLM-call example in this packet routes through an adapter seam
  (the `call_claude_cli()` idiom is the reference pattern this packet's
  source ecosystem uses; your node's Harness may use a different one - the
  requirement is the seam, not the specific function name). A local model
  is exactly as first-class a synthesis backend as any hosted one. See
  `components/expert-service/expert-service.md`.
- **Forgejo-only.** No GitHub remotes, GitHub URLs, or GitHub workflow
  files anywhere - not in this repo, and not in anything this repo
  instructs a node to grow.
- **The conformance runner is stdlib-only, read-only, and safe to run on a
  foreign node.** No third-party dependencies, no network calls, no
  mutation of anything it inspects. It reports; it never fixes.
- **Any Python touching zephyr uses the dynamic-import seam**, never a
  static `import zephyr...` - see `components/lapis-pm/lapis-pm.md` for
  where zephyr-facing code is discussed.
- **Seeds carry provenance.** Every file under `seeds/` was copied *with*
  attribution back to its source repo, path, commit, and governing mem
  key - never silently forked from its source. See the provenance header
  or sidecar on each seed file. Source repos remain canonical for their
  own code; this packet only ever copies, never moves.

## Governing record

- `decision/lapis-pm-packaging-feeds-seed-packet-forgejo-selfhosted-2026-07-20`
- `strategy/knowledge-mesh-seed-package-vision-2026-07-20`
- `decision/knowledge-mesh-seed-packet-v0-forks-dirty-node-test-2026-07-20`
- `decision/knowledge-mesh-mvp-two-node-scoping-2026-07-20`
- `decision/vault-git-canonical-zephyr-attribution-2026-07-20`
- `decision/zephyr-agent-key-management-2026-06-08`
```

### 4.5 Components (inventory; VERBATIM at paths, embedded as manifest here)

`/data/git/knowledge-mesh-seed-working/components/` — 7 components, each `<name>.md + requirements.yaml`: `identity`, `expert-service`, `governance`, `lapis-pm`, `keeper`, `persona`, `shared-corpus`. `protocol/shared-corpus.md` and `protocol/signing.md` + `protocol/store-ownership.md` embedded in 02 §4.3. `seeds/`: `governance/VALIDATOR.md`, `keeper/{persona.md,decline.yaml}`, `persona/{VALIDATOR.md,soul.md}`. Process: `GROW.md` (29,388 B, LLM-guided interview). (unverified per audit §C: whether `conform/km-conform.py` runs green against a live node.)

---

## 5. Code + tests surface (inventory — `/data/git/zephyr-working`, git ls-files, fetched 2026-10-12)

Modules — `zephyr/`: `attribution.py claims.py deposit.py intent_queue.py keymint.py registry.py relabel_settlement_intents.py _sqlite_migrate.py __init__.py` (+ module files past ls-files head); `settler/`: `event_log.py gnap.py ledger.py op_flow.py run.py split.py wallet_map.py __init__.py`; `scripts/show_ledger.py`; `fixtures/{__init__.py setup_demo.py}`; `demo/{run_demo.py, README.md, surface/{index.html,README.md}}`.

Tests (`tests/`, git ls-files):

```text
- `tests/conftest.py`
- `tests/test_agent_anchor.py`
- `tests/test_attribution.py`
- `tests/test_attribution_seq_migration.py`
- `tests/test_attribution_signed.py`
- `tests/test_claims.py`
- `tests/test_demo_e2e.py`
- `tests/test_intent_queue_isolation.py`
- `tests/test_keymint.py`
- `tests/test_keymint_agent.py`
- `tests/test_node_anchor.py`
- `tests/test_registry_multi_anchor.py`
- `tests/test_relabel_settlement_intents.py`
- `tests/test_revocation_and_anchors.py`
- `tests/test_route_cli.py`
- `tests/test_route_exec.py`
- `tests/test_routing.py`
- `tests/test_settlement_emitter.py`
- `tests/test_settlement_intent_readout.py`
- `tests/test_settler.py`
- `tests/test_signing.py`
- `tests/test_stop_minting_settlement_intents.py`
- `tests/test_transparency.py`
- `tests/test_u0_fixture.py`
- `tests/test_u3_ledger_demo.py`
- `tests/test_use_terms.py`
```

Test surface covers: attribution (+seq-migration, +signed), claims, agent/node/registry-multi anchors, keymint (incl. agent), intent-queue isolation, relabel-settlement-intents, revocation-and-anchors, route (cli/exec/routing), settlement (emitter, intent-readout, settler), signing, stop-minting-settlement-intents, transparency, demo e2e, u0 fixture, u3 ledger demo, use-terms (working tree). This is the lock's acceptance surface: `python3 -m pytest tests/` is the spec-chain verification bar (route-manifest-v0 header, §3.1).

---

## 6. What the protocol core commits to (read-before-build summary, all ratified sources above)

1. **Doctrine**: route-not-compute; attribution-not-valuation; non-custodial; consent co-equal to attribution (02 §2.3, 02 §5). Nine flame-origin invariants: path-not-amount, execute-never-derive, fail-closed, exact conservation, credited-but-unpaid forever, non-custodial, two clocks, no model in the money path, key doctrine (02 §1, Card 11).
2. **Object model** (RATIFIED item 1): every edit = NEW immutable content-hashed object; references pin version-hashes; "latest" = creator-signed convenience pointer, never protocol truth.
3. **One new artifact**: the Route Manifest — compiled deterministically from declared terms; executed by a replay-safe client; execute-never-derive; no LLM in compile/execute.
4. **Ledger not chain**: receipts + attestations, no global consensus, ledger keeps hashes (not bytes); store = torrent model, stores interchangeable (02 §4 store-ownership).
5. **Consent v0 is shipped code, not aspiration**: tri-state permitted/denied/undeclared, undeclared is NEVER permission, revocation-by-supersession never delete (01 §3.4, 02 §5).
6. **Mesh conformance**: components swappable, the protocol seam is not; invariants are per-node declared musts with a ledger + deposit seam (§4).
