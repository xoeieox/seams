# SEAMS

Protocol-version seed for the SEAMS wire - the attribution and value-routing
protocol for creative work shared across AI-augmented collaborators.

This repo is the publishable form of the SEAMS wire spec (edition
**0.3-draft**): the counted vector suite that pins its behavior, the
battle-test kit that referees a model against it, and a reference stub
target so everything here runs with zero infrastructure.

**Edition: `seams-wire/0.3-draft` · seed tag: `v0.3-draft-seed.1`**

## What is in here

| Path | What it is |
|---|---|
| `spec/WIRE-V0.md` | The SEAMS wire spec, edition 0.3-draft |
| `spec/WIRE-CLAIMS-DRAFT.md` | Draft claims/receipt API surface (drafted, not built) |
| `spec/INVARIANTS.md` | The nine canonical invariants (N1-N9) plus ratified additions A1-A4, A6 |
| `spec/FIELD-NAMING.md` | The field-naming ruling for rail-specific names |
| `kit/vectors/` | 8 JSON vector suites - **131 counted cases** - pinned by `kit/vectors/MANIFEST.sha256` |
| `kit/` | The battle-test kit (Python standard library only): oracles, vectors runner, fake endpoint, bootstrap |
| `kit/stub/seams_stub.py` | The reference stub target - a complete in-process wire implementation |
| `docs/` | The protocol narrative (sections 01-04) and the archived original README |
| `MANIFEST.sha256` | sha256 manifest of every tracked file; `sha256sum -c MANIFEST.sha256` must pass in a fresh checkout |
| `PROVENANCE.txt` | Where every seeded artifact came from |
| `HELPER.md` | Pointer to the real zephyr helper branch (not vendored here) |

## Vector suites (131 cases)

| Suite | Cases | Covers |
|---|---|---|
| `character_layers.json` | 10 | identity layering |
| `check_use.json` | 35 | use-term checks, the core verdict surface |
| `deep_splits.json` | 6 | recursive/derived split shapes (draft) |
| `emit.json` | 9 | manifest emission |
| `hardening.json` | 25 | malformed and adversarial inputs |
| `payments.json` | 19 | payment/leg shapes |
| `scene_tags.json` | 6 | scene tagging |
| `suggested.json` | 21 | advisory suggested-work declarations |

Every case carries its expected verdict; the oracles referee responses
against the invariants, and a pass means "no counter-example found", never
a proof.

## Run the kit

```sh
cd kit
python3 battle.py selftest          # vectors + oracles against the stub, no network
```

That is the whole zero-dependency loop: the stub target is in-process, the
oracles are deterministic, and the model is the attacker, never the judge.
For the full kit (fake endpoint, fuzz, LLM targets) see `kit/README.md`.

## Layout note

The kit discovers its vectors and stub relative to its own directory, so
they live under `kit/vectors/` and `kit/stub/` rather than at the repo
root. Everything in `kit/` is self-contained.

## Provenance and decisions

`PROVENANCE.txt` records where each seeded artifact came from, and
`docs/PROTOCOL-DECISIONS.md` records the protocol decisions this seed
carries. The kit ships with its own `kit/README.md` (its known vector-count
prose drift - it says 127, the counted truth is 131 - is tracked for the
next migration pass).

## Status

Seed cut under tag `v0.3-draft-seed.1`, carrying wire edition 0.3-draft.
The 0.3-draft to 0.4 promotion is queued separately (stub behavior pins,
claims API build-out, helper parity evidence) and will bump the wire
edition in `spec/WIRE-V0.md` when it lands.
