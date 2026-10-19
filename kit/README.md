# Seams battle-test kit

Seams, 2026-10-17. Lets your local models attack the Seams wire while deterministic
oracles referee. The model is the attacker, never the judge. Standard library only.

## What it needs

- **Python >= 3.10 (3.11 for the helper target), pinned by absolute path.** `bootstrap.sh` searches `SEAMS_PYTHON`, then
  `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`, builds its own `.venv`, and fails with a
  message (never hangs) if nothing qualifies. It never calls bare `python3`; headless shells
  that fall back to the system 3.9 are refused. Run everything as `.venv/bin/python battle.py ...`.
- **Stub target:** nothing to install.
- **Helper target (the real zephyr):** `cryptography`, `httpx` and `pydantic`, installed by
  `./bootstrap.sh helper` with a bounded pip timeout. The zephyr source is in `zephyr-src/`
  (branch `seams/wire-helper`, commit stated in `PROVENANCE.txt`).
- **No Node, no network** except your own model endpoint.

## Run it

```sh
./bootstrap.sh helper                    # builds .venv, installs, runs both self-tests
cp config.example.env config.env         # edit base URL + model; no secrets in this file
set -a; . ./config.env; set +a
.venv/bin/python battle.py selftest      # vectors + oracles on both targets (no LLM)
.venv/bin/python battle.py fuzz          # ~9,000 mutated requests, deterministic, no LLM
.venv/bin/python battle.py probe         # endpoint reachable? tool-calling supported?
.venv/bin/python battle.py run --steps 40            # every focus, serial
.venv/bin/python battle.py run --focus money-conservation
.venv/bin/python battle.py report        # findings.md for the newest run
```

`fake_llm.py PORT` is a scripted stand-in endpoint that proves the plumbing (back-off, serial
behaviour, think-tag stripping) without your GPU box. Results land in `out/<kind>-<time>/`
(`findings.jsonl`, `findings.md`, `transcript.jsonl`, `llm_claims.jsonl`).

## How the LLM side behaves

- **Strictly serial.** One request in flight, ever. 429, 408, 5xx and connection errors back off
  (honouring `Retry-After`, doubling to 60 s, 8 attempts) and then stop cleanly with the run saved.
  It never fans out; the vectors and fuzz run in-process and do not touch the endpoint at all.
- **Baseline is plain JSON lines:** the model replies with one JSON object per turn. `<think>`
  blocks and code fences are stripped. Tool-calling is **off** until `probe` has shown that the
  endpoint returns a valid tool call; then set `SEAMS_USE_TOOLS=1`.
- **Context budget is explicit.** Window `SEAMS_LLM_CTX` (default 262144) minus output and a
  safety margin, times `SEAMS_CTX_FRACTION` (0.8), token cost estimated pessimistically at 3
  characters per token. When a session outgrows it the harness drops the OLDEST exchanges and
  tells the model so; it never errors mid-run. The full transcript is kept on disk regardless.
- **Config only:** base URL and model name come from the environment; nothing is hardcoded.
- **Keys:** a key value is never accepted in config, argv or env, and never logged.
  `SEAMS_LLM_KEY_FILE` (optional) is a PATH read at request time. The kit has no wallet or node
  key handling at all; `ZEPHYR_AGENT_KEY_PATH` and the Open Payments key paths belong to the
  phase-2 executor adapter, which runs on your Mac. All identities in this kit are synthetic.

## What the referee enforces

`oracles.py` runs after every exchange, whoever sent it.

**N1 to N9** are the first nine of the twelve ratified invariants in the Rail design doc of
2026-07-20 section 1 (packet V2 supplement section A, verbatim there): path not amount; execute,
never derive; every payment traces to a signed edge; exact conservation; credited-but-unpaid is
first-class; non-custodial; two clocks; no model in the money path; key doctrine. Invariants 10
to 12 are wire-shape gaps already filed and are not in this kit yet.

**A1 to A6 are NAMED ADDITIONS by Seams**, with no verbatim precedent in your corpus; they ride
for ratification on receipt: A1 errors are never verdicts; A2 fail closed and never crash; A3
every response is an object carrying the wire version; A4 only the creator's key counts; A5 only
`player` tier is ever deposited; A6 side-effect-free reads are repeatable. "Deny beats allow"
is *not* an oracle, because it is a verdict rule that the `check_use` vectors pin directly.

Some invariants are about code, not the wire (N6 custody, N8 "no model"). Those oracles check the
observable consequence (no custodian legs, repeatable answers, shares unchanged when only the
amount is scaled x1000). **A pass means "no counter-example found", never a proof.** `severity:
review` means a human should confirm; `fail` means a deterministic oracle saw it.

## Vectors

`vectors/*.json` are the 127 shared test vectors (121 plus six added by this kit's first fuzz
finding), shipped here as a reviewable file set; `MANIFEST.sha256` pins them. They did not exist
on your side, so there is nothing to reconcile against: ratify on receipt. Five recursive
deeper-split vectors are stand-in only (U5, not ratified) and skip on the helper.

## Findings flow

A finding is a request sequence a fresh target reproduces. `report` writes it as
`findings.md` with the sequence, the expected rule and the response. Copy `findings/TEMPLATE.md`
for a human-found one. Send them back through Lapis; each real one becomes a vector that must
pass on BOTH the stand-in and the real helper (a disagreement is a bug in one of them).

## Known limits (said plainly)

- Payments are paper money. No executor exists (U2c). When you pass the proven Node
  `@interledger/open-payments` file in at kit review, the adapter will be seeded from it and built
  against the merged U2b foundation (`route_exec` per-leg state machine, the claims receipt API,
  the `route.py` JSON CLI seam and its 0/10/11/12 exit codes). Not in this kit.
- The claims ops (`WIRE-CLAIMS-DRAFT.md`) are drafted, not built, so they are not attacked yet.
- An LLM can only find what its prompts steer it toward; the fuzz and oracles carry the
  deterministic load, the model adds odd sequences and spec-versus-behaviour mismatches.
- State: each focus gets a fresh target. The helper target builds a throwaway ledger in a temp
  directory with synthetic keys and deletes it afterwards.
