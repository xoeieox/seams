#!/usr/bin/env node
// EoM build-leg (2026-10-26): hello-world one-shot send script for node-one's ingest gate.
// Zero dependencies, Node 18+. Local/loopback only - exposure is a separate ruling.
//
// Usage:
//   node scripts/send-hello.mjs [--url http://127.0.0.1:8080] [--key key:hello-world] [--text "..."] [--replay] [--no-announce]
//   node scripts/send-hello.mjs --url <base> --key <key-file> [--text "..."]        SIGNED mode (KEYS pass 2026-10-28)
//   node scripts/send-hello.mjs --genkey <path>                                     mint a fresh ed25519 key file (0600), print the public half, exit
//
// Flow: GET /api/hello (pin the A3-style wire echo), announce the node key (op emit kind node-key,
// unless --no-announce), then one hello-world emit. The gate maps kind "text" to session-log; that
// mapping is asserted, not assumed. With --replay the identical payload is sent twice: the second
// must ack duplicate:true with a byte-identical receipt (idempotence keyed on payload hash).
//
// SIGNED mode (EOM-KEYS-2026-10-28): when --key names a key FILE (a path, a *.key, or an existing
// file), the script reads that 0600 keypair file (the launcher or --genkey wrote it), takes the
// node_key from the embedded PUBLIC half (key:ed25519:<base64>) and signs every outgoing body -
// announce and emit alike - with the private half over the canonical body minus sig (REQ-SIGN-1,
// pinned in eom/endpoint-surface/requirements.yaml). A plain key name keeps the old name-only
// claim behavior, unchanged. The private key is never printed.
import fs from 'node:fs';
import path from 'node:path';
import { WIRE_VERSION } from '../lib.mjs';
import { generateKeyPair, writeKeyPairFile, readKeyPairFile, signBody } from '../keys.mjs';

const arg = (name, dflt) => {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return dflt;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : '';
};
const flag = (name) => process.argv.includes('--' + name);

const base = (arg('url', 'http://127.0.0.1:8080') || 'http://127.0.0.1:8080').replace(/\/+$/, '');

// --genkey <path>: mint, write 0600, report the PUBLIC half only, exit. No server contact.
if (flag('genkey')) {
  const target = arg('genkey', '');
  if (!target) die('--genkey needs a file path');
  const p = path.resolve(target);
  if (fs.existsSync(p)) die(`--genkey refuses to overwrite an existing key file: ${p}`);
  const pair = generateKeyPair();
  fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
  fs.writeFileSync(p, JSON.stringify({ v: 1, node_key: pair.nodeKey, priv_b64: pair.privB64 }) + '\n', { mode: 0o600 });
  try { fs.chmodSync(p, 0o600); } catch { /* odd filesystems */ }
  console.log(`key minted: ${pair.nodeKey}`);
  console.log(`key file:   ${p} (0600 - the private half never leaves it and is never printed)`);
  process.exit(0);
}

const keyArg = arg('key', 'key:hello-world') || 'key:hello-world';
// Signed mode iff --key resolves like a key file: a path, a .key name, or an existing file.
const keyPair = (keyArg.includes('/') || keyArg.endsWith('.key') || fs.existsSync(keyArg))
  ? readKeyPairFile(keyArg) || die(`--key ${JSON.stringify(keyArg)} looks like a key file but is not a readable one (mint: node scripts/send-hello.mjs --genkey <path>)`)
  : null;
const nodeKey = keyPair ? keyPair.nodeKey : keyArg;
// Sign the canonical bytes (body minus sig), then attach sig - the body sent IS the body signed.
const sign = (body) => { if (!keyPair) return body; const b = { ...body }; b.sig = signBody(keyPair.privB64, b); return b; };
const text = arg('text', keyPair ? 'keyed hello from node-one - EoM KEYS demo, 2026-10-28' : 'hello world from node-one - EoM build leg, 2026-10-26') || 'hello world from node-one';

const die = (msg, detail) => { console.error(`FAIL: ${msg}`); if (detail) console.error(JSON.stringify(detail, null, 2)); process.exit(1); };

const jget = async (path, opts) => {
  let r;
  try { r = await fetch(base + path, opts); } catch (e) { die(`cannot reach ${base}${path}: ${e.cause?.code || e.message}`, null); }
  let body;
  try { body = await r.json(); } catch { die(`non-JSON response from ${path} (HTTP ${r.status})`); }
  return { status: r.status, body };
};

if (!flag('selftest')) {
// 1. hello handshake: the server must echo the wire version it actually speaks (A3 lesson).
const hello = await jget('/api/hello');
if (hello.status !== 200) die(`hello returned HTTP ${hello.status}`, hello.body);
if (hello.body.wire !== WIRE_VERSION) die(`wire mismatch: server says ${JSON.stringify(hello.body.wire)}, client pins ${WIRE_VERSION} - do not speak past a version skew`, hello.body);
console.log(`hello: ${base} speaks ${hello.body.wire}; gate accepts ${JSON.stringify(hello.body.gate?.kinds)}, maps ${JSON.stringify(hello.body.gate?.maps)}`);

// 2. node-key announce (registry only; carries no content). In signed mode the announce is
// SELF-SIGNED - registration verification (REQ-SIGN-3) is exactly this signature checked against
// the key embedded in the key itself.
if (!flag('no-announce')) {
  const ann = await jget('/api/ingest', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sign({ op: 'emit', kind: 'node-key', node_key: nodeKey, provenance: { attributed_to: { name: nodeKey.replace(/^key:/, '') } } })) });
  if (ann.status !== 200 || ann.body.status !== 'deposited') die('node-key announce refused', ann.body);
  console.log(`announce: ${nodeKey}${keyPair ? ' (self-signed)' : ''} -> ${ann.body.kind} ${ann.body.receipt}${ann.body.verified === true ? ' · registry VERIFIED (gateway checked the signature)' : ''}${ann.body.duplicate ? ' (duplicate ack)' : ''}`);
}

// 3. the hello-world emit. kind "text" exercises the gate's ruling-mapping to session-log.
// Signed mode: sign FIRST, send the signed bytes verbatim - replay resends the same signed bytes.
const emit = sign({ op: 'emit', kind: 'text', node_key: nodeKey, text, provenance: { origin: 'authored' } });
const post = async () => jget('/api/ingest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(emit) });

const first = await post();
if (first.status !== 200 || first.body.status !== 'deposited') die('emit refused', first.body);
if (first.body.kind !== 'session-log') die(`gate mapping broken: kind "text" must map to session-log, gate returned ${first.body.kind}`, first.body);
if (keyPair && first.body.creator_verified !== true) die('signed emit did NOT verify at the gateway', first.body);
console.log(`emit: deposited as ${first.body.kind} (mapped at the closed gate), v${first.body.v}, ${first.body.content_hash}, receipt ${first.body.receipt}${keyPair ? ' · creator_verified ' + first.body.creator_verified + ' · fingerprint ' + first.body.node_key_fingerprint : ''}`);

if (flag('replay')) {
  const second = await post();
  if (second.status !== 200 || second.body.duplicate !== true) die('idempotence broken: replay was not acked as duplicate', second.body);
  const { duplicate: _d, ...a } = first.body; const { duplicate: _e, ...b } = second.body;
  if (JSON.stringify(a) !== JSON.stringify(b)) die('idempotence broken: replay receipt differs from the original', { a, b });
  console.log('replay: duplicate ack, receipt byte-identical - the log did not grow');
}
console.log('OK: hello-world sent through the closed gate.');
} // end normal send flow (skipped under --selftest, which boots its own throwaway nodes)

// ---------------- --selftest (go-public 2026-10-28): every claim above, checked ----------------
// Boots throwaway node-one instances itself: no operator data, no fixed ports, loopback only.
// Exit 0 only when every check passes; any failure prints FAIL and exits 1.
if (flag('selftest')) {
  const { spawn } = await import('node:child_process');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = (await import('node:path')).default;
  const { fileURLToPath } = await import('node:url');
  const K = await import('../keys.mjs');
  const SERVER = fileURLToPath(new URL('../server.mjs', import.meta.url));
  const seen = [];
  const boot = async (env = {}) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sendhello-st-'));
    const child = spawn(process.execPath, [SERVER], { env: { ...process.env, PORT: '0', BIND_HOST: '127.0.0.1', DATA_DIR: dir, ADMIN_TOKEN: '', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    seen.push(child);
    let out = '';
    const base = await new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('no bind: ' + out)), 8000);
      const onData = (c) => { out += c; const m = out.match(/listening on http:\/\/([\d.]+):(\d+)/); if (m) { clearTimeout(to); resolve(`http://${m[1]}:${m[2]}`); } };
      child.stdout.on('data', onData); child.stderr.on('data', onData);
      child.on('exit', (code) => reject(new Error(`exited ${code}: ${out}`)));
    });
    return { child, base, dir, out: () => out };
  };
  const stop = (t) => { try { t.child.kill('SIGKILL'); } catch { /* gone */ } };
  const F = async (b, p, opts) => fetch(b + p, opts);
  const P = (b, p, o) => F(b, p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) });
  const stamp = Math.random().toString(16).slice(2, 10);
  let nChecks = 0;
  const check = async (name, fn) => { try { await fn(); nChecks++; console.log(`selftest: PASS ${name}`); } catch (e) { die(`${name}: ${e && e.message ? e.message : e}`); } };
  const eq = (a, b, why) => { if (a !== b) throw new Error(`${why} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); };
  const signK = (pair, body) => { const b = { ...body }; b.sig = K.signBody(pair.privB64, b); return b; };

  const main = await boot();
  await check('hello wire pin + closed gate list', async () => {
    const h = await (await F(main.base, '/api/hello')).json();
    eq(h.wire, WIRE_VERSION, 'wire echo must pin');
    eq(JSON.stringify(h.gate.kinds), JSON.stringify(['node-key', 'session-log']), 'closed gate kinds');
    eq(h.integrity, 'ok', 'chain integrity ok on a clean boot');
  });
  await check('announce + emit (gate maps text->session-log)', async () => {
    const ann = await (await P(main.base, '/api/ingest', { op: 'emit', kind: 'node-key', node_key: `key:selftest.${stamp}`, provenance: { attributed_to: { name: 'selftest' } } })).json();
    eq(ann.status, 'deposited', 'announce deposited');
    const em = await (await P(main.base, '/api/ingest', { op: 'emit', kind: 'text', node_key: `key:selftest.${stamp}`, text: `hello world selftest ${stamp}`, provenance: { origin: 'authored' } })).json();
    eq(em.status, 'deposited', 'emit deposited'); eq(em.kind, 'session-log', 'gate mapping');
  });
  await check('replay idempotence: duplicate ack, byte-identical receipt, log does not grow', async () => {
    const body = { op: 'emit', kind: 'session-log', node_key: `key:selftest.${stamp}`, text: `replayed bytes ${stamp}`, provenance: { origin: 'authored' } };
    const n0 = (await (await F(main.base, '/api/export')).json()).entries.length;
    const r1 = await (await P(main.base, '/api/ingest', body)).json();
    const n1 = (await (await F(main.base, '/api/export')).json()).entries.length;
    const r2 = await (await P(main.base, '/api/ingest', body)).json();
    const n2 = (await (await F(main.base, '/api/export')).json()).entries.length;
    eq(r2.duplicate, true, 'replay acks duplicate'); eq(r2.receipt, r1.receipt, 'receipt identical'); eq(n2, n1, 'log did not grow');
  });
  await check('cross-key replay of identical bytes -> 409 already_deposited', async () => {
    const bytes = { op: 'emit', kind: 'session-log', text: `squat bytes ${stamp}`, provenance: { origin: 'authored' } };
    const r1 = await P(main.base, '/api/ingest', { ...bytes, node_key: `key:selftest.${stamp}` });
    eq(r1.status, 200, 'first key deposits');
    const r2 = await P(main.base, '/api/ingest', { ...bytes, node_key: 'key:second-squatter' });
    eq(r2.status, 409, 'cross-key squat refused');
  });
  const rt = await boot({ READ_LIMIT: '3' });
  await check('read tier (published shape enforced): 3 served then 429 + retry-after; 404 flood burns nothing; writes unaffected', async () => {
    for (let i = 0; i < 25; i++) eq((await F(rt.base, '/nope' + i)).status, 404, 'error shape burns nothing');
    for (let i = 0; i < 3; i++) eq((await F(rt.base, '/api/hello')).status, 200, `served read ${i}`);
    const r = await F(rt.base, '/api/hello');
    eq(r.status, 429, 'at budget the origin refuses'); eq((await r.json()).error, 'rate_limited', 'error shape');
    const ra = r.headers.get('retry-after'); if (!ra || Number(ra) < 1) throw new Error('retry-after missing/bogus');
    const ing = await P(rt.base, '/api/ingest', { op: 'emit', kind: 'session-log', node_key: `key:rt.${stamp}`, text: `writes stay live ${stamp}`, provenance: { origin: 'authored' } });
    eq(ing.status, 200, 'spent reads do not mute writes');
    stop(rt);
  });
  const off = await boot({ READ_LIMIT: '0', READ_GLOBAL_LIMIT: '0' });
  await check('loopback-dev escape: READ_LIMIT=0 (both) runs the keeper T2 count (360) unbudgeted', async () => {
    for (let i = 0; i < 360; i++) eq((await F(off.base, '/api/hello')).status, 200, `escape read ${i}`);
    stop(off);
  });
  const ic = await boot({ INGEST_LIMIT: '2', EDIT_LIMIT: '2', GLOBAL_LIMIT: '500' });
  await check('ingest cap: 2 deposits then 429 on the same socket', async () => {
    for (let i = 0; i < 2; i++) {
      const r = await P(ic.base, '/api/ingest', { op: 'emit', kind: 'session-log', node_key: `key:cap.${stamp}`, text: `capped write ${i} ${stamp}`, provenance: { origin: 'authored' } });
      eq(r.status, 200, `within cap ${i}`);
    }
    const over = await P(ic.base, '/api/ingest', { op: 'emit', kind: 'session-log', node_key: `key:cap.${stamp}`, text: `one too many ${stamp}`, provenance: { origin: 'authored' } });
    eq(over.status, 429, 'over cap refused');
    stop(ic);
  });
  await check('F4 bind rail: non-loopback refuses boot naming the hatch; hatch boots banner PUBLIC BIND', async () => {
    const a = spawn(process.execPath, [SERVER], { env: { ...process.env, PORT: '0', BIND_HOST: '127.0.10.1', DATA_DIR: mkdtempSync(path.join(tmpdir(), 'sendhello-f4-')) }, stdio: ['ignore', 'pipe', 'pipe'] });
    let ao = ''; const code = await new Promise((res) => { a.stdout.on('data', (c) => { ao += c; }); a.stderr.on('data', (c) => { ao += c; }); a.on('exit', res); setTimeout(() => res(-1), 8000); });
    eq(code, 1, 'refuses with nonzero exit');
    if (!/REFUSING TO BOOT/.test(ao) || !/SEAMS_ALLOW_PUBLIC_BIND=I-know-what-this-means/.test(ao)) throw new Error('refusal text missing or hatch not named verbatim: ' + ao.slice(0, 200));
    const b = await boot({ BIND_HOST: '127.0.10.1', SEAMS_ALLOW_PUBLIC_BIND: 'I-know-what-this-means' });
    if (!/PUBLIC BIND/.test(b.out()) || /loopback bind/.test(b.out())) throw new Error('banner must say PUBLIC BIND, never loopback: ' + b.out().slice(0, 300));
    stop(b);
  });
  await check('protocol surface: / landing honest IS/IS-NOT; editor at /text; landing.js served', async () => {
    const h = await F(main.base, '/');
    eq(h.status, 200, 'landing served');
    const text = await h.text();
    if (!/What this node is not/.test(text)) throw new Error('honest IS-NOT list missing');
    for (const re of [/payments?\s*(accepted|enabled|processed|due)/i, /we\s+(charge|bill)|pricing\s+plan|paid\s+(plan|tier)|invoice\s+you|get\s+paid/i, /verified:\s*true|verified\s+by\s+(cloudflare|seams)/i]) if (re.test(text)) throw new Error('forbidden affirmative claim on landing: ' + re);
    if (!/Not verified by any third party/.test(text) || !/No payments/.test(text) || !/No vouches/.test(text)) throw new Error('honest disclaimers incomplete');
    if (!/Keys that check/.test(text)) throw new Error('landing must tell the keys story honestly ("Keys that check")');
    if (!/href="\/demo"/.test(text)) throw new Error('Try-it must feature /demo');
    const ed = await F(main.base, '/text'); eq(ed.status, 200, 'editor at /text');
    const edHtml = await ed.text();
    if (edHtml === text) throw new Error('/ and /text must not serve the same page');
    for (const alias of ['/demo', '/attributed-text']) {
      const al = await F(main.base, alias); eq(al.status, 200, `editor alias ${alias}`);
      if ((await al.text()) !== edHtml) throw new Error(`${alias} must serve the exact editor bytes`);
    }
    const js = await F(main.base, '/landing.js');
    eq(js.status, 200, 'landing.js served');
    if (!/javascript/.test(js.headers.get('content-type'))) throw new Error('landing.js wrong content-type');
  });
  await check('KEYS: signed announce + signed emit verify at the gateway (creator_verified, fingerprint, registry, deposits view)', async () => {
    const pair = K.generateKeyPair();
    const ann = await (await P(main.base, '/api/ingest', signK(pair, { op: 'emit', kind: 'node-key', node_key: pair.nodeKey, provenance: { attributed_to: { name: 'keyed-lab' } } }))).json();
    eq(ann.status, 'deposited', 'signed announce deposited');
    eq(ann.verified, true, 'registry verified ONLY from the checked self-signature');
    const em = await (await P(main.base, '/api/ingest', signK(pair, { op: 'emit', kind: 'session-log', node_key: pair.nodeKey, text: `keyed hello ${stamp}`, provenance: { origin: 'authored' } }))).json();
    eq(em.status, 'deposited', 'signed emit deposited');
    eq(em.creator_verified, true, 'creator_verified true comes only from the gateway check');
    eq(em.node_key_fingerprint, pair.pubB64.slice(0, 8), 'fingerprint is the first 8 chars of the base64 public half');
    const dep = await (await F(main.base, '/api/deposits?node_key=' + encodeURIComponent(pair.nodeKey))).json();
    eq(dep.count, 1, 'deposits view shows exactly this key\u2019s deposits');
    eq(dep.registered, true, 'registry record present');
    eq(dep.entries[0].creator_verified, true, 'deposits carries the same verified truth as export');
    // and the honest negative: a VALID sig from an UNREGISTERED key is a claim, not verified
    const lone = K.generateKeyPair();
    const lm = await (await P(main.base, '/api/ingest', signK(lone, { op: 'emit', kind: 'session-log', node_key: lone.nodeKey, text: `unregistered but signed ${stamp}`, provenance: { origin: 'authored' } }))).json();
    eq(lm.status, 'deposited', 'signed-but-unregistered still deposits (signing is truth, never a gate)');
    eq(lm.creator_verified, false, 'unregistered key never shows verified');
  });
  await check('KEYS: bad signature refused at the GATE - nothing deposits, nothing quarantines, refusals echo wire', async () => {
    const pair = K.generateKeyPair();
    const good = signK(pair, { op: 'emit', kind: 'session-log', node_key: pair.nodeKey, text: `tamper me not ${stamp}`, provenance: { origin: 'authored' } });
    const n0 = (await (await F(main.base, '/api/export')).json()).entries.length;
    const qFile = path.join(main.dir, 'quarantine.jsonl');
    const qLines = () => fs.existsSync(qFile) ? fs.readFileSync(qFile, 'utf8').split('\n').filter(Boolean).length : 0;
    const q0 = qLines();
    const r1 = await P(main.base, '/api/ingest', { ...good, text: good.text + ' TAMPERED' });
    eq(r1.status, 400, 'body changed after signing refuses');
    const b1 = await r1.json(); eq(b1.error, 'bad_signature', 'refusal code bad_signature'); eq(b1.wire, WIRE_VERSION, 'refusal echoes wire');
    const r2 = await P(main.base, '/api/ingest', { ...good, node_key: `key:ref.${stamp}` });
    eq(r2.status, 400, 'a sig on a ref (non-ed25519) key refuses');
    eq((await r2.json()).error, 'bad_signature', 'same code');
    const r3 = await P(main.base, '/api/ingest', { ...good, sig: 'not base64!!' });
    eq(r3.status, 400, 'a malformed sig refuses');
    eq((await r3.json()).error, 'bad_signature', 'same code even for garbage');
    eq(n0, (await (await F(main.base, '/api/export')).json()).entries.length, 'the log grew NOTHING');
    eq(q0, qLines(), 'quarantine grew NOTHING - a bad signature is a gate refusal, not a corrupted log');
  });
  for (const c of seen) { try { c.kill('SIGKILL'); } catch { /* gone */ } }
  console.log(`selfTest: PASS (${nChecks} checks) - every claim in this script is checked, none asserted.`);
}
