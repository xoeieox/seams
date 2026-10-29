# KEYS provenance - EOM-KEYS-2026-10-28 (code seat, owner GO xErah 2026-10-28 12:03 PDT)

Mission: make the live seams.fyi end-of-October demo a KEYS demo - an outside person mints a real
Ed25519 node key, sends signed messages, and sees VERIFIED attribution at the gateway
(`creator_verified: true` only when the gateway itself verified the signature at ingest).
Keyless visitors keep working: their claims are labelled claims (`creator_verified: false`).

## Artifacts shipped (branch `eom-node-one`, this commit series)

sha256 of each landed artifact (recompute: `sha256sum <file>`; the root `MANIFEST.sha256` covers the whole tree):

```
09243ccd6c024eb2fe712e025370df7aae3f27cef018e9e5efbf0e81028ba289  eom/node-one/attributed-text/keys.mjs
b8b10df73581c2621f4ebf545f18e9a866ba94a116d5b4a576a84f766dc0c6e2  eom/node-one/attributed-text/lib.mjs
f868f1b637dbc915b8a297a5b2997f295cb13f3ad8baf9da39551048dded858d  eom/node-one/attributed-text/server.mjs
d496aacd0ce2d9bbb4b72ccfd219012167cedde6ab2658e9d2363b4753287cfc  eom/node-one/attributed-text/test/eom.test.mjs
38fe7a33678680e72f2186cb18bdff8e2751852bd7919f2f9e31cc7fce55696d  eom/node-one/attributed-text/public/landing.html
13858e893b44f1b1f41938528088fa9dbd3e9e3ff096057b1e85c7aa3da3db40  eom/node-one/attributed-text/public/app.js
a893ddd620738e89904f347ea7963e0de765bdf859f90899b23d586f6c3bacc1  eom/launcher/server.mjs
9bfb193d1fc42037d5475583aac8d10e172fc580cbd6ab2c5a4c63c9b9f7ab37  eom/launcher/launcher-core.mjs
9c95d5e35c5fc9e52473a471b32a5fcb73e5f989f21468791d1ee7c6101fc4b6  eom/launcher/public/app.js
30a1ccb120072512586846faab55696b0f35a9594f9bc126bab3db8ebb855674  eom/launcher/test/launcher.test.mjs
81c63520798984ed21338e9c41463e57d4dec2ebff9c4386ae5ea969d2b0646b  eom/endpoint-surface/requirements.yaml
ac2d138fc5fdb39b3972fcbb9bb1c5d840d4e445ea55b7ce8eec9e33fcca21de  eom/endpoint-surface/cloudflared/verify-tunnel-fingerprint.sh
456e5d9868cf29b999672e5a41fa9669768844bbc95b4f4c8b171004f191083c  tests/test_endpoint_conformance.py
774f877bdab640a9b3a69a7b85000f3ae1d429b202584cce17f18786c8973461  tests/test_seed_gates.py
531dafd575602261bf7c4eab7c51834bbae32875b6b32ef81bcf79c890bff2d7  eom/node-one/attributed-text/scripts/send-hello.mjs
ad0b5482fd60aaac04baf840e7d33cc8e3fffc5418a1f0f68aa60445579fa106  eom/launcher/launch.mjs
```

## Contract (pinned in `eom/endpoint-surface/requirements.yaml`)

- Key format `key:ed25519:<base64>` - the RAW 32-byte public half embedded in the node key itself;
  ref keys (`key:<ref>`) stay legal and stay claims (REQ-SIGN-1a).
- Signed bytes: canonical JSON of the whole body minus `sig`, keys sorted recursively, no
  whitespace, UTF-8; `sig` is never signed-over (REQ-SIGN-1, pinned to keys.mjs by a unit test).
- Verification at the GATE before anything stores; bad sig = `bad_signature` (400), deposits
  nothing, quarantines nothing, never explains why (REQ-SIGN-2, REQ-SIGN-3).
- `creator_verified: true` iff the gateway verified the sig at ingest AND the key was registered
  (announce first); verified is monotone; absence of sig stays a legal claim (REQ-SIGN-4).
- `node_key_fingerprint` = first 8 chars of the base64 public half, display only (REQ-SIGN-5).
- No KMS, no revocation, no ceremony: verified proves key control at ingest time and nothing
  else (REQ-SIGN-6). Deposits view: `GET /api/deposits?node_key=...` (REQ-DEP-1..3).
- Log format bumped `seams-attribution-log/0-eom.1` -> `0-eom.2` (adds fields, removes none);
  the launcher's FORMAT_PIN and the tunnel verify-script pin moved in the same series.

## Gate results (exact counts, run 2026-10-28 on BRIX against the landed tree)

- node-one suite: 31 pass / 31 tests (incl. 5 KEYS tests + canonicalization pin)
- send-hello selftest: 11/11 PASS
- launcher suite: 31 pass / 31 tests (incl. custody KEYS e2e: mint, 0600 file, re-mint 409,
  gate-verified announce, deterministic replay duplicate, foreign-key refusal, export verbatim,
  import roundtrip, no-key refusal)
- seed gates: 10 pass / 10 tests (manifest verifies, covers tree, spec pins match, 131 vectors,
  scrub hard + soft zero outside archive)
- endpoint conformance: 34 pass / 34 tests; matrix: every REQ id incl. REQ-SIGN-1..6 and
  REQ-DEP-1..3 carries an assertion
- red-on-old: the three KEYS conformance tests FAIL against the pre-KEYS `lib.mjs`/`server.mjs`
  (verified 2026-10-28: no sig gate, no deposits route on the old code)

## Honest split: verified-live vs asserted-only

- VERIFIED LIVE (checked against the running public origin before this file landed): see
  mem.db key `project/eom-keys-verified-2026-10-28` - a signed hello deposits and export answers
  `creator_verified: true` through https://seams.fyi; unsigned deposits answer false; the log
  stays append-only across the cutover.
- ASSERTED (gates only, not separately live-probed): registry monotonicity, replay idempotence,
  quarantine honesty, custody 0600 bytes, foreign-key refusal - these are enforced by the
  suites above, exercised against fresh loopback servers, not against the public origin.
- Pre-existing, disclosed: the gate originally flagged `deploy-prep-cloudflare-demo.md` and
  `config.template.yaml` (operator paths, pre-mission committed content, byte-identical in
  HEAD); these were placeholder-scrubbed here. The as-found files are preserved verbatim under
  `kyma-builds/eom-keys-2026-10-28/preserved/`. The go-public prep session's uncommitted
  routing edit to `config.template.yaml` (`/api/emit` -> `/api/ingest`) was verified against the
  origin's actual routes and adopted into the template, with the as-found preserved.
- The launcher is custody + signer only; the private half lives outside the repo tree at 0600
  under `OPS_DIR/node-key.json`; verified labels shown in the window are the gateway's receipt
  bytes verbatim, never launcher state.
