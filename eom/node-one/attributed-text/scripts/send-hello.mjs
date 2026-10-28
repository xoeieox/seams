#!/usr/bin/env node
// EoM build-leg (2026-10-26): hello-world one-shot send script for node-one's ingest gate.
// Zero dependencies, Node 18+. Local/loopback only - exposure is a separate ruling.
//
// Usage:
//   node scripts/send-hello.mjs [--url http://127.0.0.1:8080] [--key key:hello-world] [--text "..."] [--replay] [--no-announce]
//
// Flow: GET /api/hello (pin the A3-style wire echo), announce the node key (op emit kind node-key,
// unless --no-announce), then one hello-world emit. The gate maps kind "text" to session-log; that
// mapping is asserted, not assumed. With --replay the identical payload is sent twice: the second
// must ack duplicate:true with a byte-identical receipt (idempotence keyed on payload hash).
import { WIRE_VERSION } from '../lib.mjs';

const arg = (name, dflt) => {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return dflt;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : '';
};
const flag = (name) => process.argv.includes('--' + name);

const base = (arg('url', 'http://127.0.0.1:8080') || 'http://127.0.0.1:8080').replace(/\/+$/, '');
const nodeKey = arg('key', 'key:hello-world') || 'key:hello-world';
const text = arg('text', 'hello world from node-one - EoM build leg, 2026-10-26') || 'hello world from node-one - EoM build leg, 2026-10-26';

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

// 2. node-key announce (registry only; carries no content).
if (!flag('no-announce')) {
  const ann = await jget('/api/ingest', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op: 'emit', kind: 'node-key', node_key: nodeKey, provenance: { attributed_to: { name: nodeKey.replace(/^key:/, '') } } }) });
  if (ann.status !== 200 || ann.body.status !== 'deposited') die('node-key announce refused', ann.body);
  console.log(`announce: ${nodeKey} -> ${ann.body.kind} ${ann.body.receipt}${ann.body.duplicate ? ' (duplicate ack)' : ''}`);
}

// 3. the hello-world emit. kind "text" exercises the gate's ruling-mapping to session-log.
const emit = { op: 'emit', kind: 'text', node_key: nodeKey, text, provenance: { origin: 'authored' } };
const post = async () => jget('/api/ingest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(emit) });

const first = await post();
if (first.status !== 200 || first.body.status !== 'deposited') die('emit refused', first.body);
if (first.body.kind !== 'session-log') die(`gate mapping broken: kind "text" must map to session-log, gate returned ${first.body.kind}`, first.body);
console.log(`emit: deposited as ${first.body.kind} (mapped at the closed gate), v${first.body.v}, ${first.body.content_hash}, receipt ${first.body.receipt}`);

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
    return { child, base, out: () => out };
  };
  const stop = (t) => { try { t.child.kill('SIGKILL'); } catch { /* gone */ } };
  const F = async (b, p, opts) => fetch(b + p, opts);
  const P = (b, p, o) => F(b, p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) });
  const stamp = Math.random().toString(16).slice(2, 10);
  const check = async (name, fn) => { try { await fn(); console.log(`selftest: PASS ${name}`); } catch (e) { die(`${name}: ${e && e.message ? e.message : e}`); } };
  const eq = (a, b, why) => { if (a !== b) throw new Error(`${why} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); };

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
    if (!/Not verified by anyone/.test(text) || !/No payments/.test(text) || !/No vouches/.test(text)) throw new Error('honest disclaimers incomplete');
    const ed = await F(main.base, '/text'); eq(ed.status, 200, 'editor at /text');
    const edHtml = await ed.text();
    if (edHtml === text) throw new Error('/ and /text must not serve the same page');
    const js = await F(main.base, '/landing.js');
    eq(js.status, 200, 'landing.js served');
    if (!/javascript/.test(js.headers.get('content-type'))) throw new Error('landing.js wrong content-type');
  });
  for (const c of seen) { try { c.kill('SIGKILL'); } catch { /* gone */ } }
  console.log('selfTest: PASS (9 checks) - every claim in this script is checked, none asserted.');
}
