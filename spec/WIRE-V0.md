# Seams wire v0.1-draft: what Kyma sends and gets back

*Claude (Seams project), 2026-10-12. This pins the exact shapes behind `SEAMS-KYMA-CONTRACT.md` §1–2b. The verdict rules are pinned by the test vectors in `vectors/`, and `stub/seams_stub.py` passes all of them. Where this file and the vectors disagree, the vectors win and this file gets fixed.*

**Aspects are in the protocol** (Erah, decision card 2026-10-12, "Aspects now"; this retires the 09-28 "not now" ruling). Payments (`quote_route`, `record_value_event`) are v0.2 and live in `SEAMS-KYMA-CONTRACT.md` §3.

## Files

| File | What it is |
|---|---|
| `WIRE-V0.md` | This file: transport, message shapes, the verdict rules |
| `vectors/check_use.json` | 35 cases for `check_use`, on a shared fixture |
| `vectors/emit.json` | 9 cases for `emit` and `declare`, on the same fixture |
| `vectors/character_layers.json` | 10 cases for v0.2: character layers, the `assisted` origin, declared provenance fields |
| `vectors/payments.json` | 12 cases for v0.3 paper-money payments (§6), including the compiler spec's two worked examples |
| `vectors/deep_splits.json` | 6 cases for the **draft** deeper splits (§7) |

The stand-in's rounding is checked against the real `zephyr/routing.py` with `python3 stub/property_check.py 20000 7 --zephyr <path to a zephyr checkout>`.
| `stub/property_check.py` | Randomized checks of the money rules (conservation, whole units, credited-but-unpaid, determinism), plus random deep lineages and a check that the draft equals v0 on two-hop lineage |
| `vectors/scene_tags.json` | 6 cases for the **proposed** scene-tag rule (§4) |
| `stub/seams_stub.py` | A local stand-in for Seams. In memory, no signing, no ledger. Python 3 standard library only |

Run the vectors: `python3 stub/seams_stub.py --vectors vectors/check_use.json vectors/emit.json`

## Transport *(decided: Erah, decision card 2026-10-12, "Helper now, port later")*

*Payments make the helper choice stronger, not weaker. The payment executor Seams already uses is a Node helper on the official Open Payments SDK, and the split compiler is the most rule-heavy Python in Seams. Porting both to Rust now would be the riskiest rewrite in the system. Behind one helper, Kyma gets payments with no extra moving parts on its side.*

- Seams runs as a **helper process beside Kyma**, launched by Kyma as a Tauri sidecar.
- They talk over **stdin/stdout, one JSON object per line**. Each request gets exactly one response line, in order.
- A request may carry `"id"`. The response echoes it.
- Every response carries `"wire": "seams-wire/0.1-draft"`. Kyma should send `{"op":"hello"}` at startup and refuse to run Seams features if the major version differs.
- **Kyma wraps the helper in one Rust module** (one trait: `emit`, `check_use`, `declare`). When Seams is ported to Rust later, only that module changes. No Seams logic lives in UI code.
- The stub speaks this transport today: `python3 seams_stub.py --fixture vectors/check_use.json`, then JSON lines on stdin.

## Conventions

- **Hashes are opaque strings** to Kyma, in the form `sha256:<…>`. Kyma never computes one. The stub's deposit hashes are placeholders, not the real Seams algorithm. The test fixtures use readable fake hashes such as `sha256:fixture-farmer`.
- **Keys are opaque references** (`key:…` in fixtures). Signing happens on the user's device, inside the helper. Private keys never cross the wire.
- **Fixture identities are synthetic** (creator-a, player-b, creator-x, squatter). No real person's name goes in any vector, per the Zephyr redline.
- **Errors are never verdicts.** A bad request returns `{"error": "<code>", "message": "…"}`. An unknown capability is an error, never `undeclared`. This matches the shipped `check_use`, which raises on unknown tokens.

## Vocabulary

| Field | Values |
|---|---|
| `capability` | `view`, `context`, `fork`, `remix`, `redistribution`, `training` |
| `aspect` | `whole` (default), `character`, `plot`, `item`, `scene`, `setting`, `mythology`, `metaphysics`, `magic`; v0.2 adds the character layers `character.voice`, `character.backstory`, `character.state`, `character.relationships`, `character.mechanics` |
| `origin` | `played`, `assisted` (v0.2), `authored` on requests. A grant's filter is `any`, one origin, or a list of origins |
| `verdict` | `permitted`, `denied`, `undeclared` |
| context tag | `{ "taxonomy": "<ref>", "tag": "branch/leaf", "tier"?: n }` |

The taxonomy refs in the fixtures (`lapis-rpg/0`, `adult-platform/0`) are placeholders. Real tag lists are community-authored deposits (consent draft, Axis 3).

## 1. `check_use`: may I do this with someone's work?

**Request**
```json
{"op": "check_use", "id": 7,
 "work": "sha256:fixture-farmer",
 "capability": "fork",
 "aspect": "character",
 "origin": "played",
 "contexts": [{"taxonomy": "lapis-rpg/0", "tag": "violence/combat", "tier": 2}],
 "surface_profile": "local"}
```
`surface_profile` is the enforcement level of the surface asking: `local`, `cloud` or `platform` (default `local`). `aspect` defaults to `whole`. `origin` matters only for `fork` and `remix`. `contexts` lists the context tags of the scene or session the work is entering; send `[]` for an untagged scene.

**Response**
```json
{"wire": "seams-wire/0.1-draft", "id": 7,
 "verdict": "permitted",
 "work": "sha256:fixture-farmer", "capability": "fork", "aspect": "character",
 "decided_by": {"level": "work", "declaration": "sha256:…"},
 "contexts": [{"tag": "violence/combat", "verdict": "permitted", "level": "default_policy"}],
 "terms_note": "Grow my farmer through play; no desk rewrites of their story."}
```
- `decided_by.level` says which rule settled it, so Kyma can explain a refusal. Values: `aspect`, `work`, `default_policy_aspect`, `default_policy`, `origin_filter`, `protocol_default`, `unknown_work`, or `context:<level>` when a context tag decided it (`context:floor`, `context:hard_limit`, `context:work:tier`, …).
- `terms_note` is the creator's own words on the deciding grant, for the provenance line.

**What Kyma does with it** (unchanged from the contract): `permitted` → go, and list the work in `parents` of anything made from it. `denied` → block and show the terms. `undeclared` → block. `view` of a published work comes back `permitted` on its own, so play is never blocked unless a context tag is.

### How the verdict is reached

1. **Whose grants count.** Only declarations signed by the work's creator key. Anyone can sign a declaration over any hash ("consent squatting", flagged in the shipped spec as H5), so the cross-check that the shipped rail leaves to the consumer happens here. *Vector: "training denied by default policy; squatter's grant ignored."*
2. **Levels, most specific first:** this aspect of this work → the whole work → the creator's default policy for this aspect → the creator's default policy. A default policy is an ordinary declaration with `subject: "*"`.
3. **At each level, the latest declaration wins** (highest sequence number, as in the shipped selection law). If that latest one is a revocation, the level says nothing and the check falls through to the next level.
4. **Capability:** the first level that mentions the capability decides it. A denial says `denied`. A grant says `permitted`, unless it has an origin filter the request doesn't meet, which gives `denied` (`origin_filter`). A request with no origin never meets a filter. If no level mentions it: `view` of a published work is `permitted`, and everything else is `undeclared`.
5. **Each context tag, in this order:**
   - The protocol floor (`floor/minors`, `floor/real-person-unconsented`) is always `denied`, whatever any grant says.
   - A hard limit at any level is `denied`. A later or more specific grant can't loosen it. Only superseding the declaration that holds the hard limit can.
   - Otherwise, the first level whose contexts block uses the same taxonomy decides. A matching `deny` gives `denied`, and deny beats allow within a block. A matching `allow` gives `permitted`, unless the tier is above `max_tier` or the surface is below the entry's `min_profile`. Either of those gives `denied` (`…:tier` or `…:profile`).
   - If no level matches, the tag is `undeclared`. This covers both "mature is off unless opted in" and a tag from a taxonomy the creator didn't use (no crosswalk yet).
6. **Overall verdict** is the worst of the capability and every context: `denied` beats `undeclared` beats `permitted`.
7. **Consent is inherited** *(Erah direction 10-12)*. The same check runs on every ancestor in the work's lineage, and the worst verdict wins. A fork or remix can add limits but can never loosen what any ancestor's creator set. When an ancestor decides, `decided_by` names it (`"level": "ancestor:<level>", "ancestor": "<hash>"`). An ancestor that isn't known locally counts as `undeclared`, except for `view`, so public work stays playable. *Vectors: "inherited: …"*

## 2. `emit`: hand Seams something Kyma made

**Request**
```json
{"op": "emit",
 "kind": "character",
 "content_b64": "eyJiYXNlIjoi…",
 "parents": ["sha256:fixture-farmer"],
 "derivation": "fork",
 "creator_key_ref": "key:player-b",
 "tier": "player",
 "provenance": {"origin": "played", "session_ref": "session:demo-1"},
 "contexts": [],
 "use_terms": {"allowed_uses": ["fork"], "origin": {"fork": "played"}}}
```
- `kind`: `pack`, `character`, `scene`, `setting`, `item`, `plot`, `world`, `session-log`, `image-beat`.
- `content_b64`: canonical bytes of the asset. For a play-fork, the content is `{base, delta}` (see the entity-delta request in `requests/`).
- `derivation`: `original`, `fork` or `remix`. Fork and remix need at least one parent.
- `use_terms`: optional. The creator's terms for the new work, written in the same breath.

**Response:** `{"status": "deposited", "content_hash": "sha256:…", "deposit_hash": "sha256:…", "declaration_hash": "sha256:…" | null}`

or `{"status": "refused", "reason": "gm_tier" | "parent_consent", "blocked": [{"parent", "verdict", "decided_by"}]}`.

**Rules the helper enforces at emit:**
- `tier: "gm"` is always refused.
- For a fork or remix, every parent is checked with `check_use(parent, derivation, aspect from kind, origin, contexts)`. Anything short of `permitted` refuses the whole emit, and `blocked` says which parent and why. This is "fail closed": a derivative can't be deposited past a parent's consent.
- The kind maps to an aspect: character, item, scene, setting and plot map to themselves, and everything else checks `whole`.

## 3. `declare`: set or change terms

```json
{"op": "declare", "creator_key_ref": "key:creator-a",
 "use_terms": {"subject": "sha256:… or *", "aspect": "whole", ...}}
```
- Only the work's creator key can declare on it (`not_creator` otherwise). `subject: "*"` sets that key's default policy.
- Revoke by declaring `{"subject": …, "aspect": …, "revokes": true}`. Nothing is deleted.

## 4. Scene tags and who sets them *(PROPOSED, not locked; awaiting Erah)*

A scene's context tags can come from three sources: the **author** of the content, the **GM** (a person running the table), or a **model** that reads the scene as play drifts. Each tag carries `"source": "author" | "gm" | "model"`.

**The design's rule: a model can only tighten.** It may add a tag or raise a tier. It can never remove a tag or lower a tier. Only an author or GM can loosen. A weak, misconfigured or manipulated model can therefore cause a false stop, but never a false permission. This matters under bring-your-own-model, where tagging quality varies.

```json
{"op": "update_scene_tags", "source": "model",
 "current": [{"taxonomy": "lapis-rpg/0", "tag": "violence/combat", "tier": 2, "source": "author"}],
 "add": [{"taxonomy": "lapis-rpg/0", "tag": "mature/sexual", "tier": 1}],
 "remove": []}
→ {"contexts": [...merged...], "ignored": [{"tag", "reason": "model_cannot_remove" | "model_cannot_lower_tier"}]}
```

`check_use` treats a tag the same whatever its source. The model suggests and the deterministic check decides, so no model makes the consent verdict. This extends the money-path invariant ("no model in the money path") to consent. It is the design's proposal, not a ruling.

**A model's tag is not evidence.** It can pause a scene or show a visible flag, but on its own it can't count as a violation against anyone's standing. That needs signed evidence a person has confirmed.

Kyma should also pass the active consent limits to the GM persona before it writes. That prevents most problems, and the tagger catches drift.

## 5. v0.2 additions (Kyma request 2026-10-13, accepted by Seams)

- **Character layers.** `character.voice`, `.backstory`, `.state`, `.relationships` and `.mechanics` are aspects. Resolution falls back from layer → `character` → `whole`, on the work and then on the default policy. There is deliberately no `character.consent` aspect: the character's consent graph is never a target of use terms (see the request's Answer).
- **`assisted` origin.** This covers changes made with the Kyma assistant. A filter that says `played` doesn't match it, but a filter can list several origins: `"origin": {"fork": ["played", "assisted"]}`.
- **`emit.touched_aspects`.** This is optional. It lists the layers a fork's delta changes, which Kyma can read off its JSON Patch paths. Each one is checked against every parent, and a refusal names the layer. Without it, the kind's aspect is checked as before.
- **Declared provenance fields.** These are `engine_build` (a string) and `consent_enforced` (a boolean, rejected if it's anything else), alongside `origin` and `session_ref`. They're signed with the deposit and echoed back for the provenance line. `consent_enforced: false` never blocks anything. It's a signed statement, so a build that strips enforcement either says so or signs something false.

## 6. Payments with paper money *(v0.3-draft; nothing moves)*

These calls mirror the shipped Route Manifest compiler (`declared-split+single-passthrough-v0`), so the stand-in gives the **same split real Seams would**. The vectors include the compiler spec's two normative worked examples. Execution is simulated: routable legs get a `simulated` receipt, and legs with no wallet stay `pending-credited`.

```json
{"op": "quote_route", "work": "sha256:…", "event_ref": "sale-123",
 "amount": {"value": 500, "asset_code": "USD", "asset_scale": 2}}
→ {"status": "quoted", "manifest": {"payer_retained": 175, "depth": 1, "legs": [
     {"beneficiary": "key:D", "amount": 180, "wallet_address": "https://…", "leg_status": "routable", "edge_refs": ["<work>"]},
     {"beneficiary": "key:P", "amount": 20, "wallet_address": null, "leg_status": "credited-unpaid", "edge_refs": ["<work>", "<parent>"]},
     {"beneficiary": "key:M", "amount": 125, ...}]}}

{"op": "record_value_event", ...same fields...}
→ {"status": "recorded", "manifest_hash": "sha256:…", "manifest": {...},
   "receipts": [{"beneficiary", "amount", "state": "simulated" | "pending-credited"}], "executor": "simulated"}
```

- **Splits come only from declared terms** (`declare_terms`, in basis points). Seams never estimates worth. With no terms, the payer keeps everything.
- **Only the work's creator key can declare a split on it** (`not_creator` otherwise), the same rule as `declare`. *Added 10-13:* the shipped compiler accepts any registered key's term on any work, so without this a stranger could route most of a sale to themselves.
- **Exact conservation.** Integer minor units, largest-remainder rounding with the compiler's tie order, and `payer_retained + legs == amount` always.
- **Lineage.** The work's own terms, plus at most one pass-through: the parent's standing term splits the leg paid to the parent's creator (see §7). **Anything deeper is refused (`depth_exceeded`)** until multi-hop composition (U5) lands. Long forks-through-play chains hit this, so it's flagged to Erah.
- **One event allocates once.** Recording the same `event_ref` again with the same allocation is a no-op. A different allocation is a `replay_conflict`.
- **Kyma's part:** show the quote before purchase, send the buyer to approve (the testnet phase adds the real `approval_url`), and show receipts and credits on the provenance line.

## 7. Deeper splits *(DRAFT for U5; opt-in; Erah 10-13: test deeper splits before the first real payment)*

Send `"algorithm": "recursive-passthrough-draft"` with `quote_route` or `record_value_event`. Without it, the shipped v0 behaviour stays the default, including `depth_exceeded`.

**The shipped rule** (checked against `zephyr/routing.py` at `537d90f`): a sale pays the shares declared on the work being sold. If the work's parent carries a standing term, that term takes its share **of the leg paid to the parent's creator**, and passes it to the term's beneficiary. Example: M sells a derivative of D's work, and pays D 40%. D's work says "P gets 10% of what I earn through derivatives". D gets 180 and P gets 20.

**The draft repeats that rule at every level, and across several parents:**
- **A chain of forks:** C sells, paying B 20% and C 30%. B's work passes 10% of B's leg to A, and A's work passes half of A's leg to Q. From 1,000: B 180, A 10, Q 10, C 300, seller 500.
- **A remix of two works:** each parent passes up its share of its own creator's leg. An ancestor shared by both paths is paid once per path, each leg with its own `edge_refs`.
- If the shares passing up from one leg add up to more than 100%, the sale is refused (`bad_terms`).
- **Wherever v0 accepts a lineage, the draft gives exactly v0's result.** Checked over about 19,000 random v0-valid cases, plus the compiler spec's worked example.

**Who gets paid upstream depends on declared terms, not on lineage alone.** A fork's creator is paid only if the sale's terms name them. Upstream creators are paid only through standing terms on the works in between. That is "path not amount": lineage sets who *can* be paid, and declarations set the ratio.

**Not ratified.** The packet says U5 must be re-implemented to an existing "rate composition DoD brief" (`design/attribution-rate-composition-algorithm-2026-07-07`). Seams doesn't have it, so this draft must be reconciled with it.

## The grant shape (`use_terms`)

This **extends the shipped v0 payload without renaming anything.** Every shipped field keeps its name and meaning, and every new field is optional, so a shipped v0 declaration is a valid v0.1 declaration that reads as `aspect: whole` with no context grants. *Vectors: "shipped v0 row reads as aspect whole."*

```json
{"subject": "sha256:… | *",
 "declared_by": "key:…",
 "allowed_uses": ["fork", "remix"],
 "denied_uses": ["training"],
 "scope": "standing",
 "revokes": false,
 "note": "Grow my farmer through play.",

 "aspect": "whole",
 "origin": {"fork": "played"},
 "contexts": {"taxonomy": "lapis-rpg/0",
              "allow": [{"tag": "violence/*", "max_tier": 2},
                        {"tag": "mature/*", "max_tier": 1, "min_profile": "platform"}],
              "deny": ["violence/torture"],
              "hard_limits": ["mature/*"]}}
```
- The first seven fields are the shipped v0 shape. `declared_by` is always derived from the signer and never accepted from a caller (shipped DD2).
- `aspect`, `origin` and `contexts` are new.
- `min_profile` *(Erah, 10-12)*: the lowest enforcement level a surface must declare for this allow to apply. On a local surface that's a visible norm, not a lock, because the user controls the stack.
- `branch/*` matches the branch and everything under it. Any other tag matches exactly.
- `platform_scope` and `supersedes` from the consent draft are left out of v0.1. Nothing in Kyma needs them yet, and latest-wins already covers supersession.

## What changes on the real Seams side (Seams work, not Kyma's)

- `USE_VOCAB` grows from 3 verbs to 6, additively.
- Selection becomes per (subject, aspect) instead of per subject, and default policies (`subject: "*"`) arrive. The shipped spec listed "blanket per-author default terms" as deliberately deferred; this unit is where they land.
- `check_use` grows `aspect`, `origin` and `contexts` arguments, and filters on the creator's key.
- **Aspects are in.** The shipped spec recorded an Erah ruling of 2026-09-28 that character, scene and environment consent was "not now". Erah retired that ruling on 10-12 (decision card, "Aspects now").

## Choices I made that Erah or Kyma may want changed

| Choice | Why | Vector |
|---|---|---|
| Revoking a per-work grant falls back to the creator's default policy, not to "nothing" | The creator withdrew an override, so their general stance applies. A creator who wants a firm no should declare a denial | "revoking a per-work grant falls back to the default" |
| A grant with an origin filter *denies* other origins, rather than leaving them undeclared | The creator spoke about that capability, so their limit is explicit | "desk fork fails the origin filter" |
| Exceeding `max_tier` is `denied`, not `undeclared` | Same reason: the creator set a ceiling | "context above tier ceiling" |
| Tags from an unknown taxonomy are `undeclared` | There's no crosswalk between community vocabularies yet | "taxonomy mismatch is undeclared" |

## 8. Hardening and lineage ops *(added 10-14; answers Kyma's wire v0 review and create-flow request)*

**Fail closed.** Unknown or malformed input is an error, never a deposit and never a crash. Every response line has `wire`, and `hello` returns `ops` (each op's standing: `locked`, `draft` or `proposed`), `kinds` and `origins`.
- `tier` is **required**: `player` or `gm`. Anything else, including `"GM"` or a missing tier, is `bad_tier`. `gm` is refused.
- `kind` is a closed set: `pack, character, scene, setting, item, plot, world, session-log, image-beat, campaign`. Otherwise `unknown_kind`.
- `provenance.origin` is a closed set: `authored, assisted, played`. Otherwise `bad_origin`.
- `derivation: original` with `parents` is `parents_on_original`. A fork can't skip the parent check by calling itself an original.
- The same bytes from a second key are `already_deposited`. The first deposit keeps its creator. The same key may re-emit.
- `emit` passes `surface_profile` to the parent check (default `local`).
- `declare` or `record_link` on a work that isn't known is `unknown_work`. A bad line, a missing field or an unknown op is `bad_json`, `bad_request` or `unknown_op`, and the helper keeps running.

**`get_lineage`** *(proposed)*: `{"op":"get_lineage","work":h,"direction":"up|down|both","depth":16}` returns `nodes` (start node first: `content_hash`, `kind`, `derivation`, `origin`, `creator`, `parents`, `seq`; the real helper also returns `deposit_hash`) and `edges` (`child`, `parent`). Descendants are only what this ledger holds. An ancestor not held here appears as `{"content_hash", "unknown": true}`.

**`record_link` / `get_links`** *(proposed)*: `{"op":"record_link","creator_key_ref":k,"from":h,"to":h,"relation":"uses|contains","pinned":bool}`. Only the creator of `from` can record it. Links are signed deposits. A link carries **no consent and no money**: `check_use` and the route compiler never read it, so a scene full of characters doesn't pull their terms into the scene's lineage, and a played session pins the versions it used without becoming their derivative. `get_links {work, relation?}` returns links where the work is either end.

*Vectors:* `vectors/hardening.json`, 21 cases, passing on the stand-in (100/100 in all) and on the real helper.

## 9. Suggested works: imports with no author of record *(proposed; answers Kyma's create-flow request, built 10-14)*

*Erah 10-14: imported cards are not a lesser experience; nobody is asked to prove authorship; the origin is `suggested`; a play-fork keeps it.*

**Depositing an import.** `emit` with `derivation: "original"` and `provenance: {"imported_from": {"format", "source_sha256"}, "origin_status": "suggested"}`. The signer is the **importer, credited as importer, never as creator**. Optional `provenance.attributed_to: {"name", "verified": false}` stores an unverified attribution. It is accepted only on an import, `verified: true` is refused, and Seams never uses it for consent or payment. Any other use of those fields is `bad_provenance`. A suggested work has no `origin`.

**`check_use` on a suggested work.** Nobody holds authority over it:
- `view`, `context`, `fork`, `remix` → `permitted`, `decided_by.level: "suggested_open_default"`.
- `redistribution`, `training` → `undeclared` (`level: "suggested"`), because nobody can grant them.
- Context tags: **only the protocol floor binds** (`denied`). Every other tag is `permitted`. A card's own hard limits are advice, so they don't bind. *(Seams' choice, flagged to Erah: gating mature content is then the reading surface's job, not the card's.)*
- Responses carry `origin_status: "suggested"` so Kyma can display it.
- Declarations on a suggested work, from anyone, are stored and are **advisory**: the response says `advisory: true` and `check_use` never reads them.
- **Inheritance:** a suggested ancestor gives the verdict above, so it never blocks descendants on `fork`, `remix`, `view` or `context`. A descendant also cannot grant `training` or `redistribution` over it (`ancestor:suggested`).
- **No splits:** `declare_terms` on a suggested work is `suggested_work`. A sale of one pays no one: the payer keeps it all.
- **Lineage:** `get_lineage` nodes carry `origin_status` (`suggested` or `declared`) and `suggested_root` (true when any root ancestor held here is a suggested import). An import node also carries `importer` and `imported_from`.
- **Claim path: not built.** A later signed emit of the same bytes by another key is still `already_deposited`. Erah has ruled out supersession for now; see `seams/CLAIMS-AND-ATTESTATION-DESIGN-2026-10-14.md`.

*Vectors:* `vectors/suggested.json`, 21 cases, passing on the stand-in (121/121 in all) and on the real helper.

*Claims, vouches, rulings and platform keys are drafted separately in `WIRE-CLAIMS-DRAFT.md` (proposed, not built).*
