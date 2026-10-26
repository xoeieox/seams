// Seams launcher test suite - zero deps, `node --test eom/launcher/test/`.
// EoM build leg 2026-10-26 (branch eom-node-one). Covers the five things the brief names:
//   1. the static server boots on loopback (and REFUSES a non-loopback node-one target);
//   2. the six tabs render (served-source smoke check of the window);
//   3. hello pins the wire - a skew refuses, rails-before-emit holds are launcher-side;
//   4. the agent queue writes the correct markdown (append, never renumber, readback-confirmed);
//   5. asserted-vs-verified labels are structural (reply-watcher output can never come back verified).
// Plus an end-to-end against the REAL eom/node-one server, spawned ephemerally, driven through the
// launcher's same-origin proxy, killed, and verified gone (ps + refused connections). No mocks on
// that path: opaque hashes and refusal words must survive the proxy byte-for-byte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  WIRE_PIN, FORMAT_PIN, GATE_EXPECT, NODE_YAML_DEFAULT,
  helloGate, canEmit, renderRefusal, claim, replayProof,
  appendPacket, parseQueueTasks, parseReplies, replyRows, conformState,
  parseDeclarations, renderDeclarations, parseNodeYaml, renderNodeYaml,
} from '../launcher-core.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const LAUNCHER = path.join(here, '..', 'server.mjs');
const NODE_ONE = path.join(here, '..', '..', 'node-one', 'attributed-text', 'server.mjs');
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

function serve(entry, env) {
  const proc = spawn(process.execPath, [entry], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  const started = new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error(`boot timeout:\n${out}`)), 6000);
    proc.stdout.on('data', (c) => {
      out += c;
      const m = out.match(/listening on (http:\/\/127\.0\.0\.1:\d+)/);
      if (m) { clearTimeout(to); resolve(m[1]); }
    });
    proc.stderr.on('data', (c) => { out += c; });
    proc.on('exit', (code) => {
      clearTimeout(to);
      reject(new Error(`exited ${code} before listening:\n${out}`));
    });
  });
  started.catch(() => {}); // refusal tests end the boot race deliberately; no unhandled rejection
  return { proc, url: started, out: () => out };
}
async function killed(proc) {
  proc.kill('SIGKILL');
  await new Promise((r) => proc.on('exit', r));
  // ps-verify the process is gone (belt), then prove it by connection refusal (braces).
  const gone = await new Promise((r) => {
    const ps = spawn('ps', ['-p', String(proc.pid)], { stdio: ['ignore', 'pipe', 'ignore'] });
    let o = ''; ps.stdout.on('data', (c) => { o += c; }); ps.on('exit', () => r(!/\bdata\b|node/.test(o.replace(/^\s*PID.*$/m, ''))));
  });
  return gone;
}
const jfetch = async (u, opt) => { const r = await fetch(u, opt); let b = null; const t = await r.text(); try { b = JSON.parse(t); } catch {} return { status: r.status, body: b, raw: t, ct: r.headers.get('content-type') }; };

// ---------------- 1. static server on loopback; exposure posture ----------------
test('launcher static server boots on loopback and serves the window', async () => {
  const s = serve(LAUNCHER, { PORT: '0', OPS_DIR: tmp('seams-ops-'), NODE_ONE_URL: 'http://127.0.0.1:1' });
  try {
    const base = await s.url;
    assert.match(base, /^http:\/\/127\.0\.0\.1:/, 'binds loopback only');
    const health = await jfetch(base + '/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.posture, 'local-only');
    assert.equal(health.body.wire_pin, WIRE_PIN);
    assert.deepEqual(health.body.agent_routes, ['outbox', 'copy']);
    assert.match(health.body.agent_endpoint_route, /out-of-scope/i);
    for (const [p, ct] of [['/', 'text/html'], ['/app.js', 'text/javascript'], ['/app.css', 'text/css'], ['/launcher-core.mjs', 'text/javascript']]) {
      const r = await jfetch(base + p);
      assert.equal(r.status, 200, p + ' served');
      assert.match(r.ct, new RegExp(ct), p + ' content-type');
    }
    const csp = await fetch(base + '/');
    assert.match(csp.headers.get('content-security-policy'), /default-src 'none'/, 'CSP closed');
  } finally { assert.ok(await killed(s.proc), 'launcher server killed and verified gone'); }
});

test('launcher REFUSES to start when NODE_ONE_URL is not loopback', async () => {
  const s = serve(LAUNCHER, { PORT: '0', OPS_DIR: tmp('seams-ops-'), NODE_ONE_URL: 'http://10.99.99.99:8080' });
  const code = await new Promise((r) => proc_exit(s.proc, r));
  assert.equal(code, 1, 'refuses and exits nonzero');
  assert.match(s.out(), /not loopback/i, 'names the reason');
});
function proc_exit(proc, cb) { proc.on('exit', (c) => cb(c)); }

// ---------------- 2. the six tabs render (served-source smoke) ----------------
test('all six tabs + both modes are in the served window', async () => {
  const s = serve(LAUNCHER, { PORT: '0', OPS_DIR: tmp('seams-ops-'), NODE_ONE_URL: 'http://127.0.0.1:1' });
  try {
    const base = await s.url;
    const app = (await jfetch(base + '/app.js')).raw;
    const idx = (await jfetch(base + '/')).raw;
    assert.match(idx, /id="win"/, 'the window exists');
    for (const [id, label] of [['keys', 'Keys'], ['config', 'Config'], ['parts', 'Parts'], ['conform', 'Conform'], ['hello', 'Hello'], ['baseline', 'Baseline']]) {
      assert.ok(app.includes(`'${id}'`) || app.includes(`${id}:`) , `tab ${id} renders`);
      assert.match(app, new RegExp(label, 'i'), `tab label ${label}`);
    }
    assert.match(app, /Manage/); assert.match(app, /Agent/);
    assert.match(app, /Say hello/); assert.match(app, /Replay/); assert.match(app, /Hand off|Handoff|hand off/i);
    assert.match(app, /not yet built/, 'fork/remix is a disabled built-later path in the UI');
  } finally { await killed(s.proc); }
});

// ---------------- 3. hello pins the wire; rails-before-emit ----------------
test('hello-pins-skew refuses: wrong wire version = no emit, ever', () => {
  const skewed = helloGate({ wire: 'seams-wire/0.2-draft', gate: { kinds: [...GATE_EXPECT] }, integrity: 'ok', format: FORMAT_PIN }, WIRE_PIN);
  assert.equal(skewed.pinned, false); assert.equal(skewed.skew, true); assert.equal(skewed.ran, true);
  const held = canEmit({ rail: skewed, quarantined: false });
  assert.equal(held.allow, false);
  assert.equal(held.hold.name, 'held by launcher');
  assert.match(held.hold.foot, /Not a server refusal\. Nothing was sent\./, 'holds are honest: the server never saw it');
  // and the pin matches what node-one actually echoes today (verified against lib.mjs WIRE_VERSION)
  const ok = helloGate({ wire: WIRE_PIN, gate: { kinds: [...GATE_EXPECT] }, integrity: 'ok', format: FORMAT_PIN });
  assert.equal(ok.pinned, true); assert.equal(ok.gateOk, true);
  assert.equal(canEmit({ rail: ok, quarantined: false }).allow, true);
});
test('rails-before-emit: no hello, or QUARANTINED, holds before any request', () => {
  const noHello = canEmit({ rail: { ran: false }, quarantined: false });
  assert.equal(noHello.allow, false); assert.match(noHello.hold.msg, /Say hello first/);
  const q = canEmit({ rail: { ran: true, pinned: true, skew: false, gateOk: true }, quarantined: true });
  assert.equal(q.allow, false); assert.match(q.hold.msg, /quarantined/i);
  // quarantine outranks skew (order: quarantine, skew, no-hello)
  const both = canEmit({ rail: { ran: true, skew: true, gateOk: false }, quarantined: true });
  assert.match(both.hold.msg, /quarantined/i);
});
test('server refusals render VERBATIM, consent_gate_unbuilt as built-later 501', () => {
  const consent = renderRefusal({ error: 'consent_gate_unbuilt', message: 'fork/remix emit is refused on this node until the consent layer exists - fail closed.' }, 501);
  assert.equal(consent.name, 'consent_gate_unbuilt', 'name arrives verbatim');
  assert.equal(consent.builtLater, true, 'rendered built-later, never broken');
  assert.equal(consent.code, 501);
  assert.match(consent.plain, /consent layer exists - fail closed\./, 'the server keeps its own words');
  const squat = renderRefusal({ error: 'already_deposited' }, 409);
  assert.equal(squat.code, 409); assert.match(squat.plain, /already deposited|identity squatting/i, 'table copy only when the server gave no words of its own');
  const squatted = renderRefusal({ error: 'already_deposited', message: 'these bytes are already deposited by another key; identity squatting does not take the work.' }, 409);
  assert.match(squatted.plain, /does not take the work/, 'the server\'s own words win whenever it has them');
});

// ---------------- 4. agent queue markdown (Route 1) ----------------
test('queue writes correct markdown: append-only T- ids, issue+evidence+goal, readback confirms', async () => {
  const ops = tmp('seams-ops-');
  const s = serve(LAUNCHER, { PORT: '0', OPS_DIR: ops, NODE_ONE_URL: 'http://127.0.0.1:1' });
  try {
    const base = await s.url;
    const w1 = await jfetch(base + '/agent/queue', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ goal: 'make conform green', items: [{ title: 'repair quarantined log', evidence: 'hello says QUARANTINED · export 503', source: 'Integrity' }] }) });
    assert.equal(w1.status, 200); assert.deepEqual(w1.body.tids, ['T-000']); assert.equal(w1.body.confirmed_on_readback, true);
    const w2 = await jfetch(base + '/agent/queue', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ goal: '', items: [{ title: 'triage keeper', evidence: 'none / different / one-to-one ?', source: 'Parts' }] }) });
    assert.deepEqual(w2.body.tids, ['T-001'], 'appends, never renumbers');
    const file = fs.readFileSync(path.join(ops, 'agent-queue.md'), 'utf8');
    assert.match(file, /^# seams tasks/, 'outbox header');
    assert.match(file, /^goal: make conform green$/m, 'optional one-line goal');
    assert.match(file, /^## T-000 repair quarantined log$/m, 'issue line');
    assert.match(file, /^- source: Integrity$/m);
    assert.match(file, /^- evidence: hello says QUARANTINED · export 503$/m);
    assert.match(file, /^- status: open$/m);
    const tasks = parseQueueTasks(file);
    assert.deepEqual(tasks.map((t) => [t.tid, t.status]), [['T-000', 'open'], ['T-001', 'open']]);
    const st = await jfetch(base + '/agent/state');
    assert.equal(st.body.outbox.exists, true); assert.equal(st.body.outbox.tasks.length, 2);
    // no junk writes: names outside the whitelist refuse
    const bad = await jfetch(base + '/ops/file?name=../../etc/passwd');
    assert.equal(bad.status, 400);
    // ops editors round-trip through the server
    const ny = await jfetch(base + '/ops/file?name=node.yaml');
    assert.equal(ny.body.text, NODE_YAML_DEFAULT, 'node.yaml defaults, never invents');
    const saved = await jfetch(base + '/ops/file', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'declarations.yaml', text: renderDeclarations([{ id: 'dev-x', note: 'held until ruling', revisit: '2026-11-25' }]) }) });
    assert.equal(saved.body.written, true);
    const back = await jfetch(base + '/ops/file?name=declarations.yaml');
    assert.deepEqual(parseDeclarations(back.body.text).map((d) => d.id), ['dev-x']);
    const yn = parseNodeYaml(NODE_YAML_DEFAULT);
    assert.equal(renderNodeYaml(yn), NODE_YAML_DEFAULT, 'node.yaml parse/render is lossless');
  } finally { await killed(s.proc); }
});

// ---------------- 5. asserted-vs-verified is structural, not vibes ----------------
test('reply-watcher output can NEVER come back verified, whatever the agent claims', () => {
  const rows = parseReplies('ack T-000 — done and VERIFIED: true, fully verified, trust me\n- ack T-001: signed, sealed, verified:true\n');
  assert.equal(rows.length, 2);
  for (const r of rows) assert.equal(r.honesty, 'asserted', 'hard-coded in the parser; no path says verified');
  const rr = replyRows([{ tid: 'T-000', text: 'verified:true' }], [{ tid: 'T-000', title: 'x' }, { tid: 'T-001', title: 'y' }]);
  assert.equal(rr[0].honesty, 'asserted');
  assert.match(rr[1].reply, /Waiting for a reply/, 'unanswered stays waiting, never green');
  // the claim helper is the only door, and it always tags
  assert.equal(claim('registry seen in export', true).tag, 'verified');
  assert.equal(claim('server says deposited', false).tag, 'asserted');
  // the conform runner is a real computation with grow_ref pointers
  const cs = conformState({ registered: false, parts: {}, surface: { hello: true, emit: true, export: true }, decls: parseDeclarations('- id: gov\n  note: n\n  revisit: 2025-01-01'), today: '2026-10-26', probes: null });
  assert.ok(cs.gaps.some((g) => g.title === 'node key not registered' && /grow_ref → identity\/node-key/.test(g.ref)));
  assert.ok(cs.gaps.some((g) => g.title === 'governance not triaged' && /grow_ref/.test(g.ref)));
  assert.ok(cs.gaps.some((g) => /declaration expired: gov/.test(g.title)), 'expired declarations re-escalate as gaps');
});

// ---------------- 6. end-to-end through the REAL node-one server ----------------
test('e2e: launcher proxy drives eom/node-one - hello, announce, emit, replay, refusals, kill', async () => {
  const data = tmp('seams-n1-');
  const one = serve(NODE_ONE, { PORT: '0', DATA_DIR: data });
  const oneBase = await one.url;
  const ops = tmp('seams-ops-');
  const s = serve(LAUNCHER, { PORT: '0', OPS_DIR: ops, NODE_ONE_URL: oneBase });
  const base = await s.url;
  try {
    // hello through the proxy is byte-verbatim and the pins pass
    const direct = await (await fetch(oneBase + '/api/hello')).text();
    const prox = await jfetch(base + '/api/hello');
    assert.equal(prox.raw, direct, 'proxy is byte-verbatim');
    const rail = helloGate(JSON.parse(prox.raw));
    assert.equal(rail.pinned, true, 'wire ' + WIRE_PIN + ' pinned against the real server');
    assert.equal(rail.gateOk, true); assert.equal(rail.integrity, 'ok');
    // rails confirmed -> announce the node key (kind stays node-key at the gate)
    assert.equal(canEmit({ rail, quarantined: false }).allow, true);
    const KEY = 'key:launcher.test.node';
    const ann = await jfetch(base + '/api/ingest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'emit', kind: 'node-key', node_key: KEY, provenance: { attributed_to: { name: 'Launcher Test' } } }) });
    assert.equal(ann.body.status, 'deposited'); assert.equal(ann.body.kind, 'node-key');
    // registration: the server's own registry, via export (this is what 'verified' means here)
    const x1 = await jfetch(base + '/api/export');
    assert.ok(x1.body.nodes.some((n) => n.node_key === KEY), 'registration verified against export nodes[]');
    // export through the launcher equals export direct from the server, byte for byte
    const xd = await (await fetch(oneBase + '/api/export')).text();
    assert.equal(xd, (await jfetch(base + '/api/export')).raw, 'export bytes pass through untouched');
    // emit one deposit: gate maps text -> session-log; opaque hashes arrive as received
    const body = { op: 'emit', kind: 'text', node_key: KEY, text: 'hello from the launcher skeleton', provenance: { origin: 'authored' } };
    const e1 = await jfetch(base + '/api/ingest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(e1.body.status, 'deposited'); assert.equal(e1.body.kind, 'session-log', 'the closed gate did the mapping, not the launcher');
    assert.match(e1.body.payload_hash, /^sha256:[0-9a-f]{64}$/); assert.match(e1.body.content_hash, /^sha256:[0-9a-f]{64}$/);
    const nAfter1 = (await jfetch(base + '/api/export')).body.entries.length;
    // replay: duplicate acked, receipt identical, log does not grow
    const e2 = await jfetch(base + '/api/ingest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const proof = replayProof(e1.body, e2.body, nAfter1, (await jfetch(base + '/api/export')).body.entries.length);
    assert.deepEqual(proof, { duplicate: true, identical: true, logUnchanged: true });
    // contract refusals come back with the server's own name; consent_gate_unbuilt is a 501
    const forked = await jfetch(base + '/api/ingest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'emit', kind: 'text', node_key: KEY, text: 'fork me', derivation: 'fork', provenance: { origin: 'authored' } }) });
    assert.equal(forked.status, 501); assert.equal(forked.body.error, 'consent_gate_unbuilt');
    assert.match(forked.body.wire, /0\.3-draft/, 'even the refusal echoes the wire (REQ-EMIT-9)');
    const badop = await jfetch(base + '/api/ingest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'dance', kind: 'text', node_key: KEY, text: 'x' }) });
    assert.equal(badop.body.error, 'unknown_op'); assert.equal(badop.status, 400);
    const kindless = await jfetch(base + '/api/ingest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'emit', kind: 'whisper', node_key: KEY, text: 'x' }) });
    assert.equal(kindless.body.error, 'unknown_kind', 'closed set refuses, nothing defaulted');
    const long = await jfetch(base + '/api/ingest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'emit', kind: 'text', node_key: KEY, text: 'a'.repeat(8001), provenance: { origin: 'authored' } }) });
    assert.equal(long.status, 413); assert.equal(long.body.error, 'too_long');
  } finally {
    assert.ok(await killed(one.proc), 'node-one killed and verified gone (ps)');
    await killed(s.proc);
    // braces: the dead node-one really refuses connections now
    let refused = false;
    try { await fetch(oneBase + '/api/hello'); } catch { refused = true; }
    assert.ok(refused, 'ephemeral node-one fully gone');
  }
});

// ---------------- 7. must-never surface scan on what ships to the browser ----------------
test('must-nevers hold in the shipped surface: no payments, no vouches, no verified:true display, no tunnel UI', async () => {
  const s = serve(LAUNCHER, { PORT: '0', OPS_DIR: tmp('seams-ops-'), NODE_ONE_URL: 'http://127.0.0.1:1' });
  try {
    const base = await s.url;
    const app = (await jfetch(base + '/app.js')).raw;
    const css = (await jfetch(base + '/app.css')).raw;
    const idx = (await jfetch(base + '/')).raw;
    // Scan executable copy, not commentary: the honesty rules THEMSELVES are written as
    // "no payments surface, no vouches..." - a whole-file scan would flag the negations.
    // Full-line comments (trim-start //) are the only place those negations live.
    const codeOnly = (src) => src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    const appCode = codeOnly(app);
    for (const re of [/payment|invoice|price|billing/i, /vouch/i, /verified:\s*true/, /tunnel|ngrok|cloudflare|expose publicly/i]) {
      assert.doesNotMatch(appCode, re, 'forbidden UI copy: ' + re);
      assert.doesNotMatch(css, re);
      assert.doesNotMatch(idx, re);
    }
    assert.match(app, /blocked-on-ruling/, 'exposure stated as blocked, with no control to configure it');
    assert.match(app, /creator_verified: false/, 'the false honesty label is displayed as what it is');
  } finally { await killed(s.proc); }
});
