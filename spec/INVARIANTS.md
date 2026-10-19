# SEAMS wire invariants - 0.3-draft canon

The invariants the SEAMS wire is refereed against at this cut: the nine
canonicals N1-N9, plus the ratified additions A1, A2, A3, A4 and A6. One
addition is held and is excluded from this canon (see the exclusion line
below).

Sources, pinned by `MANIFEST.sha256` at the seed cut:

- `kit/README.md`, section "What the referee enforces" (the one-line form
  of N1-N9, verbatim below)
- `A1-A6-ADDITIONS.md` (the additions extract shipped with the battle kit
  intake; quotes `kit/oracles.py`'s canon and additions registries
  verbatim)
- ratified-set overlay: decision ledger key
  `decision/seams-rulings-2026-10-17` (2026-10-17)

The referee (`kit/oracles.py`) enforces every invariant below as a
deterministic oracle today. A pass means "no counter-example found", never
a proof; `severity: review` marks a finding a human should confirm.

## N1-N9 - the one-line form

Verbatim from `kit/README.md`: "N1 to N9 are the first nine of the twelve
ratified invariants in the Rail design doc of 2026-07-20 section 1 (packet
V2 supplement section A, verbatim there): path not amount; execute, never
derive; every payment traces to a signed edge; exact conservation;
credited-but-unpaid is first-class; non-custodial; two clocks; no model in
the money path; key doctrine. Invariants 10 to 12 are wire-shape gaps
already filed and are not in this kit yet."

## Canonical invariants

Verbatim from the canon registry (`kit/oracles.py`, quoted in
`A1-A6-ADDITIONS.md`):

- **N1.** Path not amount: attribution sets the path, the amount enters
  exogenously, no valuation is computed in the rail.
- **N2.** Execute, never derive: a leg executes a declared term, never a
  share derived from a property of the contribution.
- **N3.** Every payment traces to a signed attribution edge: a leg that
  cannot cite its edges does not execute.
- **N4.** Exact conservation: integer minor units, payer_retained + legs
  == amount in, always.
- **N5.** Credited-but-unpaid is first-class: a leg with no wallet stays a
  pending intent, keeps its amount, is never redistributed.
- **N6.** Non-custodial: value moves payer to recipient directly, one leg
  per recipient; no held balance, no intermediary.
- **N7.** Two clocks: attribution settles at capture with no money; payout
  only at a value event with an exogenous amount.
- **N8.** No model in the money path: compile and execute are
  deterministic.
- **N9.** Key doctrine: caller never supplies identity or key material; no
  secret appears in any response.

## Ratified additions

Verbatim from the additions registry (`kit/oracles.py`, quoted in
`A1-A6-ADDITIONS.md`); ratified as named additions alongside N1-N9 per
`decision/seams-rulings-2026-10-17` (2026-10-17):

- **A1.** Errors are never verdicts: a response with an error carries no
  verdict, no manifest and no success status.
- **A2.** Fail closed and never crash: any request, however malformed,
  gets a JSON object back (not an exception or a hang).
- **A3.** Every response is a JSON object carrying the wire version.
- **A4.** Only the work's creator key can declare terms, splits or links
  on it (advisory suggested-work declarations excepted).
- **A6.** Side-effect-free reads are repeatable: the same check_use /
  quote_route / get_lineage request twice gives the same answer.

## Held addition

- **A5 - EXCLUDED from this canon**: held as referee-enforced only, not ratified, until a deposits-spec sentence authors the tier policy; the GM-versus-player taxonomy is unresolved and Kyma-shaped, not protocol-shaped; exclusion ruling `decision/seams-rulings-2026-10-17` (2026-10-17); the vector suite and the stub carry none of its behavior at this cut, and ratification lands with the 0.4 promotion queue, not here.
