# DEMO-REHEARSAL - sending a signed, attributed message to the public demo gateway

Audience: the owner, on a machine with network access. This file contains no secrets and no host paths. Everything marked (unverified) has not been run against the public gateway by whoever wrote this; the local halves are covered by the suites listed at the end.

What the demo claims, and no more: a deposit whose signature the gateway checked at ingest shows `creator_verified: true` and a key fingerprint. That proves control of a key at deposit time. It is not identity, a vouch, or consent. A typed name is a claim and says so.

## 0. Before you start

- Node 18 or newer (`node --version`). Nothing else to install.
- The launcher checkout, verified against the sha256 you were given for the bundle.
- The demo gateway origin, a bare https origin: `https://seams.fyi` (the lab reported it live, HTTP 200 with `/api/export` serving, on 2026-10-29; (unverified) from this side). Do not use `meta.seams.fyi`; it was reported down.
- Keys are minted only by the launcher, on this machine. The gateway site never mints.

## 1. Start the launcher pointed at the gateway

```
SEAMS_GATEWAY_URL=https://seams.fyi node eom/launcher/launch.mjs
```

- It starts a local node-one and the launcher on loopback only, and prints `http://127.0.0.1:4173/`. Ports busy? It says so and reuses what is running; run with `PORT=` / `NODE_ONE_PORT=` to move them.
- `SEAMS_GATEWAY_URL` is read once at boot. There is no UI and no runtime setter for it, by design. It must be a bare https origin: no path, no query, no credentials. A bad value refuses to boot and says why.
- Confirm: `curl -s http://127.0.0.1:4173/health` shows `"gateway":"https://seams.fyi"` and `"posture":"local-only"`.

## 2. Mint a key (once)

Open the launcher window, Keys tab, Mint. Or: `curl -s -X POST http://127.0.0.1:4173/agent/keys/mint -H 'content-type: application/json' -d '{}'`.
- You get `key:ed25519:<base64>` and an 8-character fingerprint. The private half stays in the launcher's ops folder at mode 0600 and never leaves it. Use Export on the Keys tab to back it up.

## 3. Check the gateway's rails

```
curl -s http://127.0.0.1:4173/gateway/hello
```
Expect `wire: "seams-wire/0.3-draft"`, `format: "seams-attribution-log/0-eom.2"`, the closed gate `{node-key, session-log}`, `integrity: ok`.
If the wire differs, every send below is refused by the launcher with `held by launcher` and nothing leaves. That is correct behaviour; report the value you saw.

## 4. Register the key on the gateway, then send

Register (a self-signed announce; the launcher signs it):
```
curl -s -X POST http://127.0.0.1:4173/gateway/emit -H 'content-type: application/json' \
  -d '{"body":{"op":"emit","kind":"node-key","provenance":{"attributed_to":{"name":"Your Name Here"}}}}'
```
Send attributed text:
```
curl -s -X POST http://127.0.0.1:4173/gateway/emit -H 'content-type: application/json' \
  -d '{"body":{"op":"emit","kind":"text","text":"Hello from my own node.","provenance":{"origin":"authored"}}}'
```
Expect `status: "deposited"`, `creator_verified: true`, your fingerprint, a `receipt`. Send the identical command again: `duplicate: true` with the same receipt (a replay grows nothing).
Network flap: the launcher retries a connection that dropped (up to 3 tries, same signed bytes) and tells you in the `x-seams-attempts` response header (`curl -i` to see it). An HTTP answer, even a 500, is never retried.

## 5. See it land

```
curl -s "http://127.0.0.1:4173/gateway/deposits?node_key=<your key, URL-encoded>"
```
Then open `https://seams.fyi/demo#/timeline`. Your key is a lane, the deposit a node with a solid ring; a typed-name visitor beside you is dashed. (unverified) against the public site.

## 6. What a refusal looks like (all of these are expected, none is a bug)

| You see | Meaning |
|---|---|
| `held by launcher` (409) | the launcher pinned the gateway's hello and did not like it; nothing was sent |
| `no_gateway` (404) on `/gateway/*` | you started without `SEAMS_GATEWAY_URL` |
| `bad_signature` (400) | signature did not check; nothing deposited |
| `already_deposited` (409) | those exact bytes belong to another key |
| `rate_limited` (429) | wait the stated minutes |
| `consent_gate_unbuilt` (501) | consent, forks and remixes are not built; this is built-later |
| `node_unreachable` (502) | could not reach the gateway after the stated tries; nothing is known to have deposited |

## 7. Rollback

Stop with Ctrl-C (both servers are reaped). Remove the ops folder to forget the key (back it up first if you want it). Nothing on the gateway can be edited or deleted by you; the log is append-only.

## What the suites cover, and what only you can check

Covered locally by commands in the wave report: mint/register/send/replay/forged-signature loop, the launcher's gateway path against a mock https gateway (pin mismatch, retries, origin validation, consent shape), the reply watcher across a restart, the river model over fixtures.
Only you can check: the real public gateway accepting and showing these deposits, TLS to the real origin, and the public timeline page.
