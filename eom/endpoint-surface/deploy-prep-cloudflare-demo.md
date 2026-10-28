# EoM node-one - Cloudflare demo-exposure deploy prep (PREP ONLY - cutover hard-stopped)

Status 2026-10-28: **rate posture RATIFIED and SHIPPED; tunnel PREP ONLY.** The go-public
mission of 2026-10-28 landed the origin-side code (budgeted reads, published rate shape in
`launch.mjs`, landing page, bind rail - see node-one README). The tunnel itself is **not
cut today**: the adversary-gate verdict is RED (`finding/eom-adversary-t1t5-2026-10-28`),
so `cloudflared tunnel login/create/route/run` are a HARD STOP until Erah calls cutover.
No tunnel exists, no domain change, no cloud-side object. Ruled posture
(Erah 2026-10-26 ~13:42 PDT, folded in `requirements.yaml` under `host_exposure_ruling`):
the Cloudflare Tunnel is **month-end DEMO PLUMBING ONLY** - labeled as such everywhere -
and the Switter lesson (2018 Cloudflare walk; the 2022 OSA episode that killed it) makes
**moving off Cloudflare / multi-posture a later requirement, not an option**.

## Shape of the wiring (verified, so nobody guesses on Tuesday)

Cloudflare Tunnel is an **outbound** connector: a `cloudflared` daemon on the node host
dials out to the Cloudflare edge and proxies public requests to an origin URL **on the
same host** (e.g. `http://127.0.0.1:PORT`). Verified against the official cloudflared
README (fetched 2026-10-26): the daemon "sits between Cloudflare network and your
origin... without requiring you to poke holes on your firewall - your origin can remain
as closed as possible."

Consequences, stated as requirements:

- **`BIND_HOST` STAYS `127.0.0.1`.** The question "what does the bind become under
  cloudflared" has the answer "nothing" - cloudflared is a loopback client of the
  server, exactly like the browser on the box today. No `0.0.0.0`, no public bind.
  (Verified 2026-10-26; the "likely stays loopback" guess is confirmed.)
- **The public origin is a DEDICATED PORT (F1, Erah mission 2026-10-28).** cloudflared
  ingress points at `http://127.0.0.1:18080` and **nowhere else**. Port 8080 is NOT the
  tunnel origin: on this box `100.100.52.102:8080` is already held by dock-proxy/
  qBittorrent's interface-address binding, and day-to-day node-one stays on
  `127.0.0.1:8080` untouched. The demo-window public instance is a separate boot:
  `NODE_ONE_PORT=18080 node ../launcher/launch.mjs`. Every ingress line in
  `cloudflared/config.template.yaml` names the full loopback URL, catch-all 404 last.
  Proven by `cloudflared/verify-tunnel-fingerprint.sh`.
- **No reverse proxy** (this is the ruling, restated so the tunnel never quietly
  becomes one): `TRUSTED_PROXY` stays absent and unbuilt; `cf-connecting-ip` /
  `x-forwarded-for` stay unread even though the connector sends them - the connector
  is not an authenticating proxy, so its headers are attacker-controllable-adjacent
  and treated like any client header: never read (T1 posture unchanged).
- **Socket-keying consequence (honest):** because headers stay unread, every tunneled
  visitor arrives on the connector's single loopback socket key. Per-socket tiers then
  govern direct/local clients; the **global buckets are the effective public
  ceiling** for the demo. This is why the proposed global numbers below are the ones
  that actually matter.
- **TLS**: terminates at the Cloudflare edge; the edge->origin hop is plain HTTP over
  loopback only. Acceptable for a public log + capped writes. One flagged consequence:
  an **admin-token submission through the public URL transits the edge**. Pre-deploy
  recommendation: perform admin reverts via a loopback path (admin page through a
  local port-forward), not through the public hostname, unless Erah explicitly accepts
  edge-seeable admin tokens for the demo.

## What the external step needs (inputs from Erah, in order)

1. **seams.fyi ownership status - UNKNOWN AT THE CODE SEAT; FLAGGED FOR ERAH.**
   Does the owner control the domain, where is it registered, and can its DNS be
   delegated to Cloudflare (nameservers or an added zone)? The demo hostname (suggest
   `node-one.seams.fyi`) cannot be planned until this answers. Fallback if unresolved
   by Tuesday: an ephemeral `trycloudflare.com` quick-tunnel URL - random vendor URL,
   zero DNS work, obviously labeled demo plumbing; **Erah's call** which posture ships
   for the demo.
2. **Cloudflare account.** The official prerequisite (cloudflared README, "Before you
   get started"): the website must be added to a Cloudflare account and the domain's
   nameservers changed to Cloudflare. Which account, whose payment method, who holds
   the login - Erah decides; nothing is created until then.
3. **cloudflared daemon on the host - PLAN ONLY, NOT INSTALLED.** Planned shape:
   official Linux binary or distro package from the cloudflared releases page, pinned
   to the then-current release (official support window: versions within one year of
   the latest release), run under a dedicated **non-root** user with a systemd unit,
   outbound-only (no firewall hole, no inbound port). Credentials
   (`cert.pem` from `cloudflared tunnel login`) live under that user's home at 0600.

## Rate config for the demo (RATIFIED and SHIPPED 2026-10-28 - Erah go-public GO)

Two tiers per the ruling (generous read / priced write), peek/charge split kept, admin
attempts keep charging up front. **Shipped code behavior:** writes and admin attempts
charge as before; reads now carry real buckets at origin - `READ_LIMIT=300` per
socket-IP + `READ_GLOBAL_LIMIT=1500` all-sockets per window, 429 answered **before**
serving, charge only under 400 (404/429/503 floods burn nothing). `launch.mjs` pins the
published shape into every node-one boot (`INGEST_LIMIT=10 EDIT_LIMIT=10 GLOBAL_LIMIT=80
READ_LIMIT=300 READ_GLOBAL_LIMIT=1500`) unless the operator overrides a knob explicitly.
The `0/0` read-tier escape exists for loopback dev only - never the public posture.

| knob | shipped default (loopback + public shape) | public posture | per | notes |
|---|---|---|---|---|
| `READ_LIMIT` (hello/export/static) | **300** | **300** | per socket key / 10 min | generous; honest visitors never feel it; `0` = loopback-dev escape only |
| `READ_GLOBAL_LIMIT` | **1500** | **1500** | all socket keys / 10 min | the effective public read ceiling behind the tunnel |
| `INGEST_LIMIT` | **10** (was 30; F3 aligned it) | **10** | per socket key / 10 min | writes stay tight; an honest node emits far slower |
| `EDIT_LIMIT` | 10 | 10 (unchanged) | per socket key / 10 min | page saves |
| `GLOBAL_LIMIT` (write-global) | 80 | 80 (unchanged) | all socket keys / 10 min | the effective public write ceiling |
| admin attempts | 10, charged up front | 10, charged up front (unchanged) | per socket key / 10 min | failed-token retries are the attack priced here |
| `WINDOW_MS` | 600000 | 600000 (unchanged) | - | 10-min sliding windows |

Shape rationale: generous-read / write-capped matches the 1F916 pattern; the
Cloudflare-bill anecdote behind it is **memory-only and unverified** - it motivated the
shape, it is not evidence, and no file on disk currently records it (a capture pass is
owed if it is ever load-bearing).

## Pre-deploy checklist (ledger, 2026-10-28 go-public pass; all green before the public URL is announced)

0. **F1-F4 origin work** - **DONE (committed this pass)**: dedicated public origin
   `127.0.0.1:18080` (F1), read tier at origin + red/green tests (F2), launcher-pinned
   published rate shape + operator-override tests (F3), bind rail + conformance test
   (F4), landing page + `/text`, fingerprint verify script, de-credded ingress template.
1. Erah GO on this document + ratification of the rate numbers above. **DONE 2026-10-28**
   (go-public GO; numbers RATIFIED as shipped above).
2. seams.fyi ownership/DNS control confirmed (or quick-tunnel fallback chosen, labeled).
   **PARTIAL**: RDAP verified 2026-10-26 (nameservers lily/mustafa.ns.cloudflare.com,
   owner control asserted by Erah). Zone record for `seams.fyi` -> tunnel: **PENDING
   cutover**; quick-tunnel fallback stays labeled-demo if Erah prefers it.
3. Cloudflare account + zone added; `cloudflared tunnel login` cert provisioned to the
   non-root tunnel user (0600). **PREP**: `login` not run - hard stop; the auth URL is
   captured verbatim in the 2026-10-28 go-public report for Erah to complete in-browser.
4. cloudflared installed and started per the shape above; pinned version recorded in
   the leg notes. **PREP**: binary pinned + checksum-verified via
   `cloudflared/verify-tunnel-fingerprint.sh`; systemd unit is a cutover step.
5. Bind check on the host: `ss -ltn` shows the server bound to `127.0.0.1:<PORT>` only.
   **DONE at prep time** (8080 held by dock-proxy on the interface address - the reason
   for F1; the 18080 demo instance binds `127.0.0.1` only).
6. Full `npm test` green on the host (T1/T2 suites: socket keying, spoofed forwarded
   headers ignored, no burn on refusals, successes charge, admin attempts charge, token
   never printed, token file 0600, tamper quarantine + export refusal) + go-public
   additions (read tier, bind rail, published shape, landing honesty). **DONE this pass.**
7. Re-run the T1 probes **behind the tunnel**: spoofed `cf-connecting-ip` /
   `x-forwarded-for` against the public URL change nothing (headers never read; socket
   keying survives the tunnel), error flood burns no budget, successes charge the
   global buckets. **CUTOVER WINDOW** (needs the tunnel up).
8. **hello-world against the public URL**:
   `node scripts/send-hello.mjs --url https://<public-host> --key key:node-two --text "..." --replay`
   -> A3 echo pins `seams-wire/0.3-draft`, emit deposits, replay acks `duplicate:true`
   byte-identical, log does not grow. Offline equivalent **DONE**: `--selftest` (9
   checks) green against loopback boots; public-URL run is **CUTOVER WINDOW**.
9. Public export check: `GET /api/export` returns the log (public by ruling); then
   tamper a copy of `data/log.jsonl`, restart, and confirm public export refuses 503
   `log_integrity` while the quarantine state holds. **DONE on loopback** (covered by
   the suite); re-run publicly in the **CUTOVER WINDOW**.
10. Token hygiene re-check after wiring: token still absent from stdout/journal/exports,
    file still 0600; admin revert demonstrated over the loopback path (see TLS note).
    **DONE pre-wiring** (suite asserts never-printed + 0600); re-check in **CUTOVER
    WINDOW**. Admin routes are absent from the ingress template - the tunnel cannot
    reach `/api/admin/*` even by mistake.
11. Kill-switch drill (Switter lesson, demo-day version): `systemctl stop cloudflared`
    -> public URL dead within one window, loopback posture fully intact; restart brings
    it back. Also record the teardown: at demo close the tunnel comes DOWN; loopback is
    the resting posture. **CUTOVER WINDOW** (drill scripted in the cutover list).

## Exact cutover sequence (execute only when Erah calls it; each step is reversible)

```
# 0. preflight (no state change)
bash eom/endpoint-surface/cloudflared/verify-tunnel-fingerprint.sh   # binary pinned, ingress = 18080 only
ss -ltn | grep 18080                                                  # demo instance bound loopback only
# 1. login (browser step; URL printed by the command)
cloudflared tunnel login
# 2. create + DNS route (the ONLY cloud-side writes)
cloudflared tunnel create seams-node-one                              # writes ~/.cloudflared/<TUNNEL-UUID>.json (0600)
cp eom/endpoint-surface/cloudflared/config.template.yaml ~/.cloudflared/seams-config.yaml
# fill <TUNNEL-UUID> + hostname seams.fyi; creds file referenced, never inlined
cloudflared tunnel route dns seams-node-one seams.fyi
# 3. serve (run under the dedicated non-root tunnel user / systemd unit)
cloudflared tunnel --config ~/.cloudflared/seams-config.yaml run
# 4. prove: checklist items 7-11 above against https://seams.fyi
# teardown / kill-switch: systemctl stop cloudflared  (loopback posture intact throughout)
```

## Explicitly NOT in this plan (deferred, ruled posture)

- Any reverse proxy, proxy-protocol, or `TRUSTED_PROXY` allowlist - absent by ruling.
- Reading any forwarded header - never, even from the connector.
- Binding anything but `127.0.0.1`.
- Admin token in payloads/exports/stdout - never.
- Multi-posture (second path off Cloudflare so no single vendor holds a kill-switch):
  the later requirement per the Switter lesson; the demo tunnel is plumbing we must be
  able to walk away from, and the teardown drill above is the muscle for that.
