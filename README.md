# SEAMS protocol - spec, vectors, referee

Protocol-version seed for the SEAMS wire - the attribution and value-routing
protocol for creative work shared across AI-augmented collaborators. This
repo is the contract and its referee; the runtime (launcher UI + demo
node-one) ships in the sibling runtime repo (working name `seams-runtime`).

**Edition: `seams-wire/0.3-draft`.** Working repo name `seams-protocol` -
final naming is the owner's call before any push.

**What Seams is.** Two problems, one wire. First, the attribution hole:
AI-assisted creative work currently erases attribution - the model's output
leaves no record of which human work it came from, and there is no path for
value to flow back to that human. Second, the structural hole: whatever
fixes the first must not recreate what it rejects - a fix owned by a
gatekeeper, swayed by a hierarchy, or opinionated in the protocol itself
can't empower all people, and the only way to build it properly is with
everybody helping. SEAMS is the protocol for both at once - a signed,
consent-first, fail-closed wire on which a work carries who made it, what
use is permitted, and where value routes. The protocol layer is opinionless
by design: it moves signed messages about consent, attribution, and
compensation ratios, and the morals and decisions stay with the entities on
the ends of the wire. It is also the referee: a deterministic battle-test
kit that checks any implementation against the protocol's counted vectors.

## Verify - the selftest is the verification step

Prereq: Python 3 (3.10+). No installs, no network.

```sh
sha256sum -c MANIFEST.sha256
cd kit && python3 battle.py selftest
```

Expected on success: **`stub: 131/131 vectors pass`** (a readable refusal on
failure names the failing vector). The selftest referees the reference stub
against the counted vector suite - deterministic, in-process; the model is
the attacker, never the judge. A pass means "no counter-example found",
never a proof. The count is 131 by counted truth, pinned by
`kit/vectors/MANIFEST.sha256`. For the full kit (fake endpoint, fuzz, LLM
targets) see `kit/README.md`.

## What is in here

| Path | What it is |
|---|---|
| `spec/WIRE-V0.md` | The SEAMS wire spec, edition 0.3-draft - **start reading here (section 1)** |
| `spec/INVARIANTS.md` | The nine canonical invariants (N1-N9) plus ratified additions A1-A4, A6 |
| `spec/FIELD-NAMING.md` | The field-naming ruling for rail-specific names |
| `spec/WIRE-CLAIMS-DRAFT.md` | Draft claims/receipt API surface (drafted, not built) |
| `kit/` | The battle-test kit (Python standard library only): oracles, vectors runner, fake endpoint, bootstrap |
| `kit/vectors/` | 8 JSON vector suites - **131 counted cases** - pinned by `kit/vectors/MANIFEST.sha256` |
| `kit/stub/seams_stub.py` | The reference stub target - a complete in-process wire implementation |
| `docs/` | `PROTOCOL-DECISIONS.md` (the ratified decisions this seed carries) and the archived original packet README at `docs/archive/00-README.md` - kept verbatim, links unresolved; the packet's narrative sections do not ship here (see `PROVENANCE.txt`) |
| `tests/` | The seed acceptance gates: manifest, 131/131 selftest, scrub (`python3 -m pytest tests/`) |
| `HELPER.md` | Pointer to the real zephyr helper branch - intentionally not vendored; parity unverified |
| `MANIFEST.sha256` | sha256 of every shipped file; `sha256sum -c MANIFEST.sha256` must pass in a fresh checkout |
| `PROVENANCE.txt` | Where every seeded artifact came from |
| `LICENSE` | The seed license, shipped verbatim |

## Reading order

1. **The contract:** `spec/WIRE-V0.md`, top to bottom, starting at section 1.
2. **The referee's canon:** `spec/INVARIANTS.md` - the invariants the oracles
   check against.
3. **The executable proof:** `kit/` - run the selftest above.
4. **The record:** `docs/PROTOCOL-DECISIONS.md`, then the archived original
   packet README at `docs/archive/00-README.md`.
5. **The helper pointer:** `HELPER.md` - a pointer, not evidence.

## The other half of the split

The launcher and node-one ship in the sibling runtime repo (working name
`seams-runtime`): clone it, run `node eom/launcher/launch.mjs`, and the UI
comes up on `http://127.0.0.1:4173` with node-one on `http://127.0.0.1:8080`.
That repo holds no spec and no vectors - the spec and this 131-case selftest
live here. Repo names are placeholders; final naming is the owner's call.
