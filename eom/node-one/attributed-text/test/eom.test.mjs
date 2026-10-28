// EoM build-leg tests (2026-10-26): closed kind gate, idempotent ingest, hash-chain tamper
// quarantine, export refusal + wire echo, and the T1 rate-limiting properties (socket keying,
// spoofed headers ignored, no burn on errors). Node 18+, zero deps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, StoreError, WIRE_VERSION } from '../lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const owners = (s) => s.head.segs.map(([t, a]) => `${a}:${t}`);
const mk = () => { const s = new Store(); s.seed('The quick brown fox', 'Ann'); return s; };
const emit = (over = {}) => ({ op: 'emit', kind: 'session-log', node_key: 'key:probe-a', text: 'a unique sentence', ...over });
const codes = (fn) => { try { fn(); return null; } catch (e) { return e instanceof StoreError ? e.code : ('NON_STORE_ERROR:' + e.message); } };

// ---------- closed kind gate ----------
test('gate: closed set {node-key, session-log}; text/page map to session-log at the gate', () => {
  const s = mk();
  assert.equal(s.ingest(emit({ kind: 'text', text: 'mapped one' })).kind, 'session-log');
  assert.equal(s.ingest(emit({ kind: 'page', text: 'mapped two' })).kind, 'session-log');
  assert.equal(s.ingest(emit({ kind: 'session-log', text: 'direct one' })).kind, 'session-log');
  // a payload with no kind but page-shaped content is the page case -> session-log
  const { kind: _k, ...pageish } = emit({}); delete pageish.kind;
  assert.equal(s.ingest(pageish).kind, 'session-log');
  assert.ok(s.entries.every((e) => ['seed', 'edit', 'ingest'].includes(e.kind)));
  assert.deepEqual(s.export().entries.filter((e) => e.v > 1).map((e) => e.kind), ['session-log', 'session-log', 'session-log', 'session-log']);
});

test('gate: unknown kinds refuse fail-closed, including the text-with-header case; nothing is defaulted', () => {
  const s = mk(); const n0 = s.entries.length;
  assert.equal(codes(() => s.ingest(emit({ kind: 'character', text: 'x' }))), 'unknown_kind');
  assert.equal(codes(() => s.ingest(emit({ kind: 'text/html', text: 'x' }))), 'unknown_kind');
  assert.equal(codes(() => s.ingest(emit({ kind: 'text', text: 'x', headers: { 'content-type': 'text/html' } }))), 'unknown_kind');
  assert.equal(codes(() => s.ingest(emit({ kind: 'content-type', text: 'x' }))), 'unknown_kind');
  assert.equal(codes(() => s.ingest({ ...emit({ text: 'x' }), op: 'record' })), 'unknown_op');
  assert.equal(codes(() => s.ingest(emit({ node_key: 'key:!!', text: 'x' }))), 'bad_node_key');
  assert.equal(codes(() => s.ingest(emit({ provenance: { origin: 'borrowed' }, text: 'x' }))), 'bad_origin');
  assert.equal(s.entries.length, n0, 'refusals deposit nothing');
});

// ---------- idempotence ----------
test('ingest idempotence: replay acks the original receipt byte-identically and grows nothing', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'eom-idem-')); const f = path.join(d, 'log.jsonl');
  const s = new Store(f); s.seed('base text', 'Ann');
  const b = emit({ text: 'the replayed sentence', id: 'x-1' });
  const r1 = s.ingest(b);
  assert.equal(r1.status, 'deposited'); assert.equal(r1.duplicate, false);
  const n = s.entries.length;
  const r2 = s.ingest(structuredClone(b));
  assert.equal(r2.duplicate, true); assert.equal(s.entries.length, n, 'log did not grow');
  const { duplicate: _a, ...o1 } = r1; const { duplicate: _c, ...o2 } = r2;
  assert.deepEqual(o2, o1, 'replay receipt identical');
  // across a restart: receipts persist (sidecar), not just in-memory
  const s2 = new Store(f);
  const r3 = s2.ingest(structuredClone(b));
  const { duplicate: _d, ...o3 } = r3;
  assert.equal(r3.duplicate, true); assert.deepEqual(o3, o1, 'identical across restart');
  // a different body is NOT the same payload: it deposits fresh
  assert.equal(s2.ingest(emit({ text: 'the replayed sentence!' })).duplicate, false);
});

test('ingest squat guard: identical bytes under a second key refuse already_deposited', () => {
  const s = mk();
  s.ingest(emit({ text: 'contested bytes' }));
  assert.equal(codes(() => s.ingest(emit({ node_key: 'key:probe-b', text: 'contested bytes' }))), 'already_deposited');
});

// ---------- fork parents / consent ----------
test('export never claims parentage: parents are [] and the chain carries the order', () => {
  const s = mk();
  s.edit({ name: 'Bob', text: 'The quick brown fox jumps', baseV: 1 });
  s.ingest(emit({ kind: 'text', text: 'deposited line' }));
  const x = s.export();
  assert.ok(x.entries.every((e) => Array.isArray(e.parents) && e.parents.length === 0));
  for (let i = 1; i < x.entries.length; i++) assert.equal(x.entries[i].chain.prev, x.entries[i - 1].chain.hash);
  assert.equal(x.wire, WIRE_VERSION, 'A3-style version echo');
});

test('gate: fork/remix refuse consent_gate_unbuilt; parents on an original refuse parents_on_original', () => {
  const s = mk(); const n0 = s.entries.length;
  assert.equal(codes(() => s.ingest(emit({ derivation: 'fork', text: 'f' }))), 'consent_gate_unbuilt');
  assert.equal(codes(() => s.ingest(emit({ derivation: 'remix', text: 'r' }))), 'consent_gate_unbuilt');
  assert.equal(codes(() => s.ingest(emit({ parents: ['sha256:' + 'a'.repeat(64)], text: 'p' }))), 'parents_on_original');
  assert.equal(s.entries.length, n0);
});

// ---------- T5a: tamper quarantine, no hash laundering ----------
test('tampered log quarantines at load and export REFUSES; hashes are never recomputed clean', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'eom-tamper-')); const f = path.join(d, 'log.jsonl');
  const s = new Store(f); s.seed('original words here', 'Ann');
  s.edit({ name: 'Bob', text: 'original words here plus bob', baseV: 1 });
  s.ingest(emit({ text: 'witness line', id: 'w1' }));
  const good = s.export();
  // attacker edits the persisted bytes: change one attributed word in version 2's line
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  const e2 = JSON.parse(lines[1]); e2.segs[1][0] = ' STEALEN ';
  lines[1] = JSON.stringify(e2); fs.writeFileSync(f, lines.join('\n'));
  const t = new Store(f);
  assert.equal(t.integrity.ok, false);
  assert.ok(t.integrity.tampered.includes(2), 'version 2 flagged tampered');
  assert.equal(codes(() => t.export()), 'log_integrity', 'export refuses, does not serve and does not re-hash');
  // the un-tampered view is unchanged: hashes persisted at append, not recomputed on read
  assert.equal(t.state().integrity.suspect, true, 'state flags suspect');
});

test('corrupt lines quarantine to quarantine.jsonl; boot survives; anchor mismatch flags', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'eom-corr-')); const f = path.join(d, 'log.jsonl');
  const s = new Store(f); s.seed('keep calm', 'Ann'); s.edit({ name: 'Bob', text: 'keep calm and carry on', baseV: 1 });
  fs.appendFileSync(f, 'not json at all {{{\n');
  const t = new Store(f);
  assert.equal(t.entries.length, 2, 'corrupt line kept OUT of the log');
  assert.equal(t.integrity.ok, true, 'corruption alone does not falsify the chain');
  const q = fs.readFileSync(path.join(d, 'quarantine.jsonl'), 'utf8').trim().split('\n');
  assert.equal(q.length, 1); assert.equal(JSON.parse(q[0]).reason, 'corrupt_json');
  // anchor rollback: stale anchor hash must be caught
  const anchor = path.join(d, 'chain-anchor.json');
  fs.writeFileSync(anchor, JSON.stringify({ n: 1, hash: 'sha256:' + 'b'.repeat(64), updated: 'x' }));
  const t2 = new Store(f);
  assert.equal(t2.integrity.anchorOk, false); assert.equal(t2.integrity.ok, false);
  assert.equal(codes(() => t2.export()), 'log_integrity');
});

// ---------- server-level (spawned, loopback) ----------
function startServer(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eom-srv-'));
  const child = spawn(process.execPath, [path.join(root, 'server.mjs')], {
    cwd: root, env: { ...process.env, PORT: '0', BIND_HOST: '127.0.0.1', DATA_DIR: dir, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  const ready = new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('server did not bind within 8s: ' + out)), 8000);
    child.stdout.on('data', (c) => {
      out += c.toString();
      const m = out.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
      if (m) { clearTimeout(to); resolve({ base: `http://127.0.0.1:${m[1]}`, out: () => out, dir }); }
    });
    child.on('error', reject);
  });
  return { ready, stop: () => { try { child.kill('SIGKILL'); } catch { /* gone */ } } };
}
const post = (base, p, body, hdr = {}) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...hdr }, body: JSON.stringify(body) });

test('server: hello + emit echo the wire version; token value never reaches stdout', async () => {
  const srv = startServer(); const { base, out, dir } = await srv.ready;
  try {
    const h = await (await fetch(base + '/api/hello')).json();
    assert.equal(h.wire, WIRE_VERSION);
    assert.deepEqual(h.gate.kinds, ['node-key', 'session-log']);
    const e = await (await post(base, '/api/ingest', emit({ kind: 'text', text: 'server hello world' }))).json();
    assert.equal(e.wire, WIRE_VERSION, 'A3-style echo on the ingest response too');
    assert.equal(e.kind, 'session-log', 'gate mapped text->session-log over the wire');
    const tok = fs.readFileSync(path.join(dir, 'admin-token.txt'), 'utf8').trim();
    assert.ok(tok.length >= 24);
    assert.ok(!out().includes(tok), 'T1: the admin token is never echoed to stdout');
    assert.equal(fs.statSync(path.join(dir, 'admin-token.txt')).mode & 0o777, 0o600, 'T2: token file mode 0600');
  } finally { srv.stop(); }
});

test('server: rate key is the socket - spoofed forwarded headers cannot bypass or burn (T1)', async () => {
  const srv = startServer({ INGEST_LIMIT: '2', EDIT_LIMIT: '2', GLOBAL_LIMIT: '500' });
  const { base } = await srv.ready;
  try {
    const h1 = { 'content-type': 'application/json', 'cf-connecting-ip': '9.9.1.1', 'x-forwarded-for': '8.8.8.1' };
    assert.equal(await post(base, '/api/ingest', emit({ text: 'burst one' }), h1).then((r) => r.status), 200);
    const h2 = { 'cf-connecting-ip': '9.9.1.2', 'x-forwarded-for': '8.8.8.2' };
    assert.equal(await post(base, '/api/ingest', emit({ text: 'burst two' }), h2).then((r) => r.status), 200);
    const r3 = await post(base, '/api/ingest', emit({ text: 'burst three' }));
    assert.equal(r3.status, 429, 'third from the SAME socket is limited even though headers claim different IPs');
    assert.ok(r3.headers.get('retry-after'));
    // errors do not burn: fresh store's edit budget untouched by N gate refusals
    const srv2 = startServer({ EDIT_LIMIT: '2', INGEST_LIMIT: '500', GLOBAL_LIMIT: '500' });
    const s2 = await srv2.ready;
    try {
      for (let i = 0; i < 6; i++) {
        const bad = await post(s2.base, '/api/edit', { name: '', text: 'x', base_v: 1 });
        assert.equal(bad.status, 400, 'failing edit attempt');
      }
      const ok = await post(s2.base, '/api/edit', { name: 'Ann', text: 'Erah\'s poem edited for real', base_v: 1 });
      assert.equal(ok.status, 200, 'failing attempts did not consume the window');
      // but successes DO charge
      const ok2 = await post(s2.base, '/api/edit', { name: 'Bob', text: 'Erah\'s poem edited twice', base_v: Number((await (await ok).json()).saved_v) });
      assert.equal(ok2.status, 200);
      const over = await post(s2.base, '/api/edit', { name: 'Cid', text: 'one too many', base_v: Number((await (await ok2).json()).saved_v) });
      assert.equal(over.status, 429, 'successful saves charge the window');
    } finally { srv2.stop(); }
  } finally { srv.stop(); }
});

// ---------- F2/F3/F4 go-public rails (keeper 2026-10-28) ----------
const uniq = (t) => `${t} ` + Math.random().toString(16).slice(2, 10);
const rawSpawn = (env = {}) => {
  // raw spawn helper: the startServer() harness pins BIND_HOST to loopback on purpose;
  // the F4 rail tests need to control BIND_HOST, so they spawn directly like the tamper test does.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eom-rail-'));
  const child = spawn(process.execPath, [path.join(root, 'server.mjs')], {
    cwd: root, env: { ...process.env, PORT: '0', DATA_DIR: dir, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { child, dir };
};

test('server F2: published read tier ENFORCED at origin by default - 300 served then 429+retry-after (RED ON OLD: pre-F2 binary answers 200 to all 360)', async () => {
  const srv = startServer(); const { base } = await srv.ready;
  try {
    for (let i = 0; i < 300; i++) assert.equal((await fetch(base + '/api/hello')).status, 200, `read ${i}`);
    const r = await fetch(base + '/api/hello');
    assert.equal(r.status, 429, 'at the published 300/10-min read budget the ORIGIN itself refuses');
    assert.equal((await r.json()).error, 'rate_limited');
    const ra = r.headers.get('retry-after');
    assert.ok(ra && Number(ra) > 0 && Number(ra) <= 600, '429 carries retry-after inside the window');
    // separate buckets: a spent read tier does not mute writes on the same socket
    const ing = await post(base, '/api/ingest', emit({ text: uniq('read-spent-but-writing') }));
    assert.equal(ing.status, 200, 'read budget exhaustion cannot silence the write path');
  } finally { srv.stop(); }
});

test('server F2b: read tier - successes only charge (peek/charge split); 0 on both knobs = loopback-dev escape', async () => {
  const srv = startServer({ READ_LIMIT: '3', READ_GLOBAL_LIMIT: '0' }); const { base } = await srv.ready;
  try {
    for (let i = 0; i < 40; i++) assert.equal((await fetch(base + '/no-such-route-' + i)).status, 404, `error shape ${i}`);
    for (let i = 0; i < 3; i++) assert.equal((await fetch(base + '/api/hello')).status, 200);
    assert.equal((await fetch(base + '/api/hello')).status, 429, '404 flood burned nothing: budget went 0/3 -> 3/3 on three successes');
  } finally { srv.stop(); }
  const off = startServer({ READ_LIMIT: '0', READ_GLOBAL_LIMIT: '0' }); const o = await off.ready;
  try {
    for (let i = 0; i < 360; i++) assert.equal((await fetch(o.base + '/api/hello')).status, 200, 'keeper T2: 360 reads flow when the tier is off');
  } finally { off.stop(); }
});

test('server T4b: cross-key replay refuses 409 by default (the squat guard holds at the server edge)', async () => {
  const srv = startServer({}); const { base } = await srv.ready;
  const bytes = { kind: 'session-log', text: 'identical bytes replayed by two keys ' + Math.random().toString(16).slice(2), provenance: { origin: 'authored' } };
  try {
    assert.equal((await post(base, '/api/ingest', emit(bytes))).status, 200);
    const dup = await post(base, '/api/ingest', emit({ ...bytes, node_key: 'key:second-squatter' }));
    assert.equal(dup.status, 409, 'default: cross-key byte replay is the squat case');
    assert.equal((await dup.json()).error, 'already_deposited');
  } finally { srv.stop(); }
});

test('server F4: non-loopback BIND_HOST REFUSES TO BOOT naming the escape hatch; with the hatch the banner says PUBLIC BIND, never loopback', async () => {
  const a = rawSpawn({ BIND_HOST: '127.0.10.1' });   // non-loopback, no hatch: the case the keeper caught (F4)
  const aOut = await new Promise((resolve) => {
    let o = ''; a.child.stdout.on('data', (c) => { o += c; }); a.child.stderr.on('data', (c) => { o += c; });
    a.child.on('exit', (code) => resolve({ code, o }));
    setTimeout(() => resolve({ code: -1, o }), 8000);
  });
  assert.equal(aOut.code, 1, 'F4: a non-loopback bind without the named acknowledgement exits nonzero');
  assert.match(aOut.o, /REFUSING TO BOOT/, 'loud refusal at boot');
  assert.match(aOut.o, /SEAMS_ALLOW_PUBLIC_BIND=I-know-what-this-means/, 'the refusal names the escape hatch verbatim');
  const b = rawSpawn({ BIND_HOST: '127.0.10.1', SEAMS_ALLOW_PUBLIC_BIND: 'I-know-what-this-means' });
  const boot = await new Promise((resolve) => {
    let o = ''; b.child.stdout.on('data', (c) => { o += c; const m = o.match(/listening on http:\/\/127\.0\.10\.1:(\d+)/); if (m) resolve({ o, port: m[1] }); });
    b.child.stderr.on('data', (c) => { o += c; });
    b.child.on('exit', (code) => resolve({ o, code }));
    setTimeout(() => resolve({ o, code: -1 }), 8000);
  });
  try {
    assert.ok(boot.port, 'with the named value it boots: ' + boot.o.slice(0, 300));
    assert.match(boot.o, /PUBLIC BIND/, 'banner announces the operator-acknowledged public bind');
    assert.ok(!/loopback bind/.test(boot.o), 'F4 honesty: the banner NEVER claims loopback when bound publicly');
  } finally { try { b.child.kill('SIGKILL'); } catch { /* gone */ } }
  const c = startServer({}); const { out } = await c.ready;   // default posture sanity: loopback banner still says loopback
  try { assert.match(out(), /loopback bind/); } finally { c.stop(); }
});

test('server: / is the honest landing page; the editor lives at /text; landing.js served; landing makes no verified/payments/vouch claims', async () => {
  const srv = startServer(); const { base } = await srv.ready;
  try {
    const home = await fetch(base + '/');
    assert.equal(home.status, 200);
    assert.match(home.headers.get('content-type'), /text\/html/);
    const h = await home.text();
    assert.match(h, /What this node is not/, 'the honest IS/IS-NOT list is the landing page spine');
    for (const re of [/payments?\s*(accepted|enabled|processed|due)/i, /we\s+(charge|bill)|pricing\s+plan|paid\s+(plan|tier)|invoice\s+you|get\s+paid/i, /verified:\s*true|verified\s+by\s+(cloudflare|seams)/i]) {
      assert.doesNotMatch(h, re, 'landing page must never make an affirmative commercial/verification claim: ' + re);
    }
    assert.match(h, /Not verified by anyone|No one has verified/i, 'and it states non-verification in words');
    assert.match(h, /No payments|no pricing/i, 'and it states no-payments in words');
    assert.match(h, /No vouches/i, 'and it states no-vouches in words');
    const ed = await fetch(base + '/text');
    assert.equal(ed.status, 200, 'the editor moved to /text (protocol keeps /)');
    assert.match((await ed.text()), /One page|with attribution/i, 'the editor page still serves its content');
    assert.ok(!h.includes('One page of text, with attribution</title>') , 'the editor HTML itself is no longer at /');
    const js = await fetch(base + '/landing.js');
    assert.equal(js.status, 200); assert.match(js.headers.get('content-type'), /javascript/);
  } finally { srv.stop(); }
});

test('server: export REFUSES (503) on a tampered log and never re-hashes it clean', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eom-tamp2-'));
  const s = new Store(path.join(dir, 'log.jsonl')); s.seed('witness text', 'Ann'); s.edit({ name: 'Bob', text: 'witness text appended', baseV: 1 });
  const f = path.join(dir, 'log.jsonl');
  const lines = fs.readFileSync(f, 'utf8').split('\n'); const e2 = JSON.parse(lines[1]); e2.segs[1][0] = ' HIJACKED '; lines[1] = JSON.stringify(e2);
  fs.writeFileSync(f, lines.join('\n') + (lines[lines.length - 1] === '' ? '' : '\n'));
  const child = spawn(process.execPath, [path.join(root, 'server.mjs')], {
    cwd: root, env: { ...process.env, PORT: '0', BIND_HOST: '127.0.0.1', DATA_DIR: dir }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    const ready = await new Promise((resolve, reject) => {
      let out = ''; const to = setTimeout(() => reject(new Error('no bind: ' + out)), 8000);
      child.stdout.on('data', (c) => { out += c; const m = out.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/); if (m) { clearTimeout(to); resolve(`http://127.0.0.1:${m[1]}`); } });
    });
    const r = await fetch(ready + '/api/export');
    assert.equal(r.status, 503, 'export refuses while quarantined');
    const b = await r.json();
    assert.equal(b.error, 'log_integrity');
    assert.ok(b.tampered.includes(2));
    const h = await (await fetch(ready + '/api/hello')).json();
    assert.match(h.integrity, /QUARANTINED/, 'hello reports the quarantine so peers see it before emitting');
  } finally { try { child.kill('SIGKILL'); } catch { /* gone */ } }
});
