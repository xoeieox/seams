# Wire draft: authorship claims, vouches, rulings and platform keys

*Seams, 2026-10-14. **DRAFT, proposed.** Not built, no vectors yet. Extends `WIRE-V0.md` §9 (suggested works). Design reasoning and Erah's words are in `Seams_Protocol/seams/CLAIMS-AND-ATTESTATION-DESIGN-2026-10-14.md`. Marks: **[Erah]** is a ruling on record; **[Proposed]** is Seams' choice for Erah to react to.*

## What Erah ruled, and what this draft rests on

- **[Erah 10-14, ratified]** Platforms may **adjudicate** a claimant's claim, and therefore have **some level of signing**. Platforms may not originate a claim.
- **[Erah 10-14]** Any key may vouch or dispute. A claimant with no standing may bring evidence. Seams stores no score and no money. Only a user with a key creates a card, and nothing is deposited for someone without a key.
- **[Erah 10-14]** Surface decides whose word counts ("I guess so", not a considered ruling). Seams never says a claim is true.
- **[Standing doctrine, 10-06]** A platform's voice is licensed for health and, now, adjudication, never for authoring creative work. A platform is founded by a user who vouches for it, guarantors share the hit, and key rotation doesn't reset liability. Trust weighting is a client-side aid: "weight in views, never gates."

## 1. Records

All records are signed deposits (same two-homes pattern as use terms, signer derived from the key ref, never caller-supplied). All are append-only: nothing is edited or deleted. Each returns its `record_hash` (an opaque `sha256:` string).

| Record | Op | Signed by | Subject |
|---|---|---|---|
| **claim** | `record_claim` | the claimant | a work |
| **vouch** | `record_vouch` | any key | a claim |
| **dispute** | `record_dispute` | any key | a claim |
| **ruling** | `record_ruling` | any key (by convention a platform) | a claim |
| **retraction** | `retract` | the signer of the target | any of the above |
| **platform declaration** | `declare_platform` | the platform's own key | itself |
| **platform vouch** | `vouch_platform` | a guarantor's key | a platform key |

### `record_claim`
```json
{"op": "record_claim", "creator_key_ref": "key:claimant", "work": "sha256:…",
 "evidence": [{"kind": "url", "ref": "https://…", "observed_at": "2024-03-02T00:00:00Z", "note": "…"}],
 "earliest_seen": {"ref": "https://…", "observed_at": "2023-11-20T00:00:00Z", "version_note": "v1, shorter description"},
 "note": "…"}
```
- The signer **is** the claimant. There is no field for naming someone else as the author. A platform that "found the author" can only vouch for or rule on a claim that author's key made.
- `evidence` kinds: `url`, `archive_hash`, `timestamped_post`, `account_proof`, `other`. Seams **never fetches or checks** evidence. It stores and echoes it. Limits: at most 32 items, strings at most 2048 characters, `note` at most 2000.
- **Account proof [Proposed].** The challenge string is `seams-claim:<work content hash>:<claimant pubkey id>`. The claimant puts it on an external profile (bio, description, a post), and evidence of kind `account_proof` points at it. A reviewer fetches it themselves.
- A claimant claiming their **own** authored work is refused (`already_creator`). A claim on a work **another key authored** is allowed and marked `against_genesis: true`: it is a challenge to a Seams record, shown beside it, and never honoured (section 3).
- Rival claims from different keys on the same work coexist. The same key may claim again (latest by seq is active, after any retraction).

### `record_vouch` and `record_dispute`
```json
{"op": "record_vouch", "creator_key_ref": "key:anyone", "claim": "sha256:<record_hash>",
 "basis": [{"kind": "url", "ref": "…", "observed_at": "…"}], "note": "…"}
```
`record_dispute` has the same shape, with `evidence` in place of `basis`. A vouch means "I believe this claim and put my key behind it". A dispute means "I contest it". A key may vouch **or** dispute a given claim (the latest of its own records on that claim stands). Vouching for a claim you made yourself is allowed and **doesn't count** (`self_vouch: true`, ignored when counting).

### `record_ruling` (platform adjudication)
```json
{"op": "record_ruling", "creator_key_ref": "key:platform", "claim": "sha256:<record_hash>",
 "outcome": "upheld", "basis": [{"kind": "other", "ref": "…"}], "note": "…"}
```
`outcome` is `upheld`, `rejected` or `inconclusive`. A ruling is a signed statement about a **claim**, never about a person, and no reputation is stored. A key's latest ruling on a claim is active. Upheld and rejected rulings are the strongest signals a reader can list in `honor_claims_from`.

### `retract`
`{"op": "retract", "creator_key_ref": k, "record": "sha256:…"}`. Only the signer of the target can retract it. The target stays visible, marked retracted, and stops counting. **A retraction of a vouch or ruling is a fact readers can use.** Whether it earns a grace window before any ding is reader-side, as with the founding vouches.

## 2. Platform keys

**[Erah ratified]** platforms need some level of signing. **[Proposed]** the minimum that makes that true without a new signing scheme:
- **`declare_platform {creator_key_ref: <platform key>, name}`** is signed by the platform's **own** key. Only the key's owner can make it a platform, so nobody can grief a user by declaring their key a platform.
- **`vouch_platform {creator_key_ref: <guarantor user key>, platform: <platform key ref>}`** is the founding attestation: a named user's signed claim tying their key to the platform key, per the 10-06 ruling. More guarantors may vouch. `retract` ends a guarantor's vouch, and key rotation does not reset liability: a platform key's guarantors stay in the record.
- A platform key is an ordinary Ed25519 key. What makes it a platform in the record is `declare_platform`, and what makes it trusted is up to readers.
- **What a platform key may sign:** rulings, vouches, disputes, retractions of its own records, and its own platform declaration and guarantors' vouches. **`emit` refuses a declared platform key** (`platform_cannot_deposit`): creative work is always user-signed. The same goes for `declare` and `declare_terms`.
- **Collective-safety warnings** (the platform-authored class ratified 10-06) are **not** designed here. Platform-level signing for them, bundled messages and propagation remain open (supplement register items 1 to 3).
- `get_platform {platform}` returns the declaration, the guarantors and their retractions.

## 3. Standing, and when a claim binds

**Standing ladder (protocol-level, never a truth value).** For a work: `suggested` (no active claim), `claimed` (an active claim exists), `attested` (an active claim has an active vouch or an upheld ruling). A work also shows `contested: true` when a rival claim, an active dispute or a rejected ruling exists. Seams returns the ladder and the signers. It never returns `verified`.

**`get_claims {work}`** returns the standing and every claim with its vouches, disputes, rulings and retractions, each with `signer`, `seq`, `evidence` and `platform: true|false` (whether the signer has a platform declaration), and each platform's guarantors.

**Honouring a claim, reader-side [Proposed].** `check_use` takes an optional `honor_claims_from: ["key:…", …]`, the keys the asking surface trusts. For a **suggested** work, a claim by K **qualifies** for that reader when:
1. it is active and not `against_genesis`, and
2. it has an active vouch **or** an upheld ruling from a key in the list, and
3. no key in the list has an active dispute or a rejected ruling on it.

If exactly one claimant qualifies, **K's declarations on the work are treated as the creator's** (same levels and rules as a Seams-native work), the response says `origin_status: "claimed"` and `decided_by.claim: <record_hash>`, and inheritance continues up the lineage. If **several** claimants qualify, **the worst verdict across their declarations wins** (the same rule as ancestors), with `decided_by.claimants` naming them. If none qualifies, the work is a suggested open default as before. Without `honor_claims_from`, claims change **nothing** in the verdict. `check_use` also returns the ladder as `standing` on suggested works, for display.
- This is client-side weighting, applied only when the surface chooses to list keys. **"Weight in views, never gates"** holds in the sense that nothing blocks publishing or play for readers who don't list anyone.
- `honor_claims_from` is a **seed set**, so the anchor paradox applies (supplement register item 8): whoever builds the list is the hidden centralisation. A citation ring of keys vouching for each other can fill the list's inputs, and Seams can't tell it from independent witnesses (item 9). This draft solves neither.

**Declaring on a claimed work.** `declare` on a suggested work by a key with an **active claim** on it is accepted and returned `advisory: true`. It only counts for readers who honour the claim. Without an active claim it is `not_creator`. A claimant never becomes "creator of record": the deposit's signer stays the importer, as ruled.

## 4. Never changes

- The deposit's signer and the earliest deposit as the work of record. No supersession. A claim, vouch or ruling never moves a work's creator.
- Splits: `declare_terms` on a suggested work stays `suggested_work`. **A claim does not unlock splits** in this draft. How a claimed author gets paid for forks is a payment question for Erah.
- Nothing is deleted, unlogged or rewritten. Filtering can dim and cannot unlog.

## 5. Errors

`already_creator`, `unknown_claim`, `unknown_record`, `not_signer` (retract by someone else), `bad_evidence` (kind, size or count), `bad_outcome`, `platform_cannot_deposit`, `unknown_platform`, `self_vouch` is not an error (it is stored and ignored). Malformed requests return `bad_request`, never a verdict.

## 6. Test plan (vectors to write once Erah has reacted)

Claim by non-creator on a suggested work; claim on one's own work refused; rival claims coexist; vouch counts only from other keys; dispute and ruling; retraction stops counting and stays visible; account-proof challenge string; evidence limits; ladder (`suggested` → `claimed` → `attested`, `contested`); `check_use` ignores claims without `honor_claims_from`; honoured single claim switches to the claimant's declarations; honoured rival claims take the worst verdict; a disputed qualifying claim stops qualifying; an `against_genesis` claim is never honoured; platform declaration only by its own key; `emit` by a platform key refused; guarantor vouch and retraction; tamper tests on every new record type; fuzz the new ops.

## 7. Open, for Erah

1. **Rival honoured claimants:** worst-verdict-wins (my choice, matches ancestors) or fall back to the open default?
2. **Self-declared platform:** is "a platform is any key that declares itself one, trusted by readers' own lists" enough, or must a platform declaration need at least one guarantor vouch before it counts?
3. **Platform signing beyond rulings:** I've allowed only adjudication-related records. Should a platform also sign anything else now, or wait for the platform-deposit-reasons list?
4. **Payments for claimed authors** (section 4): leave open?
