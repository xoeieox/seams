# Field naming on the SEAMS wire

The field-naming ruling this seed carries, from decision ledger key
`decision/seams-wire-rail-field-naming-2026-10-14` (ruling taken
2026-10-14, keeper-recorded).

## The ruling

Rail-specific field names are acceptable when they name the actual rail:
"having it named Open Payments is okay if it is to the Open Payments rail.
When we get on to other different payment rails, we will have names for
those as well."

Rails roadmap: Open Payments first; Nostr/Lightning-family rails later,
each with its own names. A rail-specific field name is correct when the
payload actually rides that rail; a generic name is correct when the
payload is rail-agnostic.

## Rail-blindness at human-facing surfaces

Rail-blindness is preserved at human-facing surfaces: settlement is
deliberately invisible there - a tip is a tip, and the human surface does
not expose which rail carried it. The wire's field names are for machines
building against the spec; they are not the human-facing presentation.
Keys stay hidden at relay-level surfaces too, per the Nostr underlying-
rails ruling (`decision/nostr-underlying-rails-not-community-2026-10-10`).

The `op_wallet_address` field follows the lud16-style precedent already in
the Nostr protocol research (vault research doc, 2026-08-25, cited by
title).

## Naming fights are taste unless test-settleable

A naming disagreement is a taste fight unless it can be settled by a test.
When two names are test-settleable, the vector suite settles it; when they
are not, the name is a maintainer call and this doc does not adjudicate
it.

## Open follow-ups (not ruled)

- Cross-rail resolution order when a contributor holds multiple rail
  bindings.
- The canonical payment-intent view for ledger surfaces.
