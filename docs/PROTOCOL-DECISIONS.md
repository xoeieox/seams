# SEAMS protocol decisions - re-export from the decision ledger

Curated re-export of the protocol-relevant decision rows for the SEAMS
wire (edition 0.3-draft), regenerated from the decision ledger at seed
time (2026-10-19). Each row cites its ledger key and date. Internal
operating metadata (lane assignments, campaign logs, host paths) is
deliberately not part of this export - protocol decisions only.

## SEAMS rulings (decision/seams-rulings-2026-10-17, 2026-10-17)

- A-ratifications: the named additions A1 (errors are never verdicts), A2
  (fail closed and never crash), A3 (every response carries the wire
  version), A4 (only the creator's key declares terms) and A6
  (side-effect-free reads are repeatable) are ratified alongside the nine
  canonicals N1-N9.
- The fifth addition (player-tier-only-deposits, A5 in the kit's addition
  registry) is HELD: referee-enforced, not canon, until a deposits-spec
  sentence authors the tier policy. See spec/INVARIANTS.md.
- Zero-amount disposition: rejected at the record boundary - a
  record_value_event carrying amount.value == 0 must return bad_amount.
  Zero lives on the quote/attribution path only. Asks queued to the wire:
  stub behavior update plus a new hardening vector pin (zero at record to
  bad_amount); the malformed-amount pin stands.
- The zephyr-suite reconciliation ask (740-versus-537) is approved and
  queued as its own verification act.

## Field naming (decision/seams-wire-rail-field-naming-2026-10-14, 2026-10-14)

Rail-specific field names are acceptable when they name the actual rail;
the rails roadmap is Open Payments first, Nostr/Lightning-family later,
each with its own names. Rail-blindness holds at human-facing surfaces -
settlement is deliberately invisible, a tip is a tip. Naming fights are
taste unless test-settleable. Full text: spec/FIELD-NAMING.md.

## Platform name (decision/seams-is-the-knowledge-mesh-platform-name-2026-08-03, taken 2026-08-03, backfilled 2026-08-08)

The knowledge mesh is a platform in its own right and its name is SEAMS.
This makes four peer platforms: Inertia (the code beachhead), the creative
platform, the code platform, and Seams. Seams hosts the ability to find
nodes and the ability to find things.

## Release ruling (decision/seams-release-ruling-ship-now-local-ai-rd-first-slice-2026-10-16, 2026-10-16)

Release Seams at current polish. The local-AI R&D platform is the first
slice of Seams for people to join and do. Audiences are sorted by
demonstrated behavior: local-LLM doers build and benchmark, governance
participants re-slot via projects and choose-your-governance, and the
first external collaborator is offered the repo for use and PRs.
Open-source maintenance grammar: fork, PR, canonical version; governance
deferred beyond one maintainer in a repo. Donation avenues in fiat and
crypto tie to the SEAMS account.

## Consent invariant (decision/seams-voluntary-consent-no-scrape-seeding-2026-08-28, 2026-08-28)

No scraping social media to seed SEAMS; no voice-carve-out claim model.
Any import of external content is voluntary and user-initiated. The
platform starts with the founder's own corpus as the seed content, and
others may port their own threads later. Taking voices without consent is
the move the platform exists to prevent.

## Not in this export

Lane rosters, campaign logs, harness triage rows and host-side operating
records are internal operating metadata and are deliberately excluded.
The superseded pre-platform design row (Seams as the join between
platforms rather than a platform) is superseded by the platform-name
ruling above and is not restated here.
