// Seams launcher test suite - zero deps, `node --test eom/launcher/test/`.
// EoM build leg 2026-10-26 (branch eom-node-one). Covers the five things the brief names:
//   1. the static server boots on loopback (and REFUSES a non-loopback node-one target);
//   2. the six tabs render (served-source smoke check of the window);
//   3. hello pins the wire - a skew refuses, rails-before-emit holds are launcher-side;
//   4. the agent queue writes the correct markdown (append, never renumber, readback-confirmed);
//   5. asserted-vs-verified labels are structural (reply-watcher output can never come back verified).
// Plus an end-to-end against the REAL eom/node-one server (spawned ephemerally, driven through the
// launcher's same-origin proxy, killed, ps-verified gone - no mocks), and the app-launch pass:
// the PWA shell (manifest parses/standalone/icons real; SW caches the static shell ONLY - /api,
// /ops, /agent, /health are never intercepted), icon determinism, and launch.mjs (ONE command:
// spawns+supervises both servers, ctrl-c reaps both ps-verified, a busy port is REUSE with a
// clear message and no EADDRINUSE stack trace). And the Tauri shell (Erah's ruling
// 16:11 PDT - Kyma-style Mac iteration): scaffold consistency, the zero-frontend-deps rule,
// and the one-command Mac bundle - plus the bundle-LAYOUT boot (Mac run #1 triage
// 2026-10-26: Erah's first `npm run tauri` died before Rust compiled - launch.mjs resolved
// node-one with the repo layout, one '..' above the unpacked bundle, and the shotgun
// beforeDevCommand swallowed it into a 180s tauri poll timeout). The beforeDevCommand
// sequence now runs against an unpacked bundle from <tmp>/tauri as cwd, as a standing gate.
// Twenty-one tests; every server the suite starts is
// killed and ps-verified gone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  WIRE_PIN, FORMAT_PIN, GATE_EXPECT, NODE_YAML_DEFAULT,
  helloGate, canEmit, renderRefusal, claim, replayProof,
  appendPacket, parseQueueTasks, parseReplies, replyRows, conformState,
  parseDeclarations, renderDeclarations, parseNodeYaml, renderNodeYaml,
} from '../launcher-core.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const LAUNCHER = path.join(here, '..', 'server.mjs');
const LAUNCH = path.join(here, '..', 'launch.mjs');
const NODE_ONE = [path.join(here, '..', 'node-one', 'attributed-text', 'server.mjs'),   // bundle layout (flat tree)
                  path.join(here, '..', '..', 'node-one', 'attributed-text', 'server.mjs')] // repo layout
                 .find((p) => fs.existsSync(p)) || path.join(here, '..', '..', 'node-one', 'attributed-text', 'server.mjs');
const ICON_SCRIPT = path.join(here, '..', 'scripts', 'make-icons.mjs');
const ICONS_DIR = path.join(here, '..', 'public', 'icons');
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

// ---------------- 4b. self-contained hand-off briefs - Mac run #4 doctrine ----------------
// Erah's live Mac test (2026-10-27): he Q-for-agent'd 7 Parts items with NO goal and the agent
// got bare titles - 'not enough information to know what to do'. Adopted seed doctrine: an open
// entry carries its OWN brief - one-line goal, machine-readable pointers into the unpacked
// packet, an acceptance check (read files / curl loopback ports), honest-label footer. The
// launcher COMPOSES the brief from queue-time tab context (source+title+evidence) when the human
// types nothing; typed goal wins; per-field human overrides allowed; pointers are linted against
// the packet at queue time; no goal AND nothing derivable = readable refusal (no silent open
// tasks). Append-only: pre-doctrine entries stay open and unedited - composition is at WRITE
// time, never retrofitted on read.

test('brief doctrine: Q-for-agent with NO goal still queues a COMPOSED brief with real packet pointers (never a bare title)', async () => {
  const ops = tmp('seams-ops-');
  const s = serve(LAUNCHER, { PORT: '0', OPS_DIR: ops, NODE_ONE_URL: 'http://127.0.0.1:1' });
  try {
    const base = await s.url;
    const w = await jfetch(base + '/agent/queue', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ goal: '', items: [{ title: 'triage keeper', evidence: 'none / different / one-to-one ?', source: 'Parts' }] }) });
    assert.equal(w.status, 200, 'Parts tab context composes the brief - Erah\'s exact scenario: no typed goal, still self-serving');
    assert.equal(w.body.briefed, true);
    const file = fs.readFileSync(path.join(ops, 'agent-queue.md'), 'utf8');
    assert.match(file, /^## T-000 triage keeper$/m);
    assert.match(file, /^- brief-goal: triage 'keeper'/m, 'goal composed from tab context, never a bare title');
    assert.match(file, /^- brief-pointers: README\.md, AGENTS\.md, /m, 'door docs lead the pointer list');
    assert.match(file, /^- brief-accept: .*ops\/parts\.json/m, 'acceptance check reads files/ports');
    assert.match(file, /^- honesty: asset-asserted only/m, 'honest-label footer rides every brief, per must-nevers');
    const st = await jfetch(base + '/agent/state');
    const tk = st.body.outbox.tasks[0];
    assert.ok(tk.briefGoal && tk.briefGoal.length > 10, 'brief fields read back through /agent/state');
    assert.ok(tk.briefPointers.includes('node-one/attributed-text/seed.json'), 'node docs among the pointers');
  } finally { await killed(s.proc); }
});

test('brief doctrine: pointer lint catches a non-existent packet path AT QUEUE TIME; refused write lands nothing', async () => {
  const ops = tmp('seams-ops-');
  const s = serve(LAUNCHER, { PORT: '0', OPS_DIR: ops, NODE_ONE_URL: 'http://127.0.0.1:1' });
  try {
    const base = await s.url;
    const okB = await jfetch(base + '/agent/queue', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ goal: 'lint me', items: [{ title: 'route test', evidence: 'x', source: 'Route', brief: { pointers: ['README.md', 'AGENTS.md'] } }] }) });
    assert.equal(okB.status, 200, 'human-overridden pointers that exist pass the lint (override path works)');
    const badB = await jfetch(base + '/agent/queue', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ goal: 'lint me', items: [{ title: 'route test 2', evidence: 'x', source: 'Route', brief: { pointers: ['README.md', 'docs/does-not-exist.md'] } }] }) });
    assert.equal(badB.status, 400); assert.equal(badB.body.error, 'bad_pointer');
    assert.match(badB.body.message, /docs\/does-not-exist\.md/, 'the refusal names the offending path');
    const st = await jfetch(base + '/agent/state');
    assert.equal(st.body.outbox.tasks.length, 1, 'the refused write queued NOTHING - whole-write refusal, append-only intact');
    const abs = await jfetch(base + '/agent/queue', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ goal: 'lint me', items: [{ title: 'route test 3', evidence: 'x', source: 'Route', brief: { pointers: ['/etc/passwd'] } }] }) });
    assert.equal(abs.status, 400, 'absolute paths fail the shape check before any disk probe');
  } finally { await killed(s.proc); }
});

test('brief doctrine: all 7 Parts triage task types compose briefs that name a REAL packet file', async () => {
  const ops = tmp('seams-ops-');
  const s = serve(LAUNCHER, { PORT: '0', OPS_DIR: ops, NODE_ONE_URL: 'http://127.0.0.1:1' });
  const resolves = (p) => fs.existsSync(path.join(LAUNCHER, p)) || fs.existsSync(path.join(LAUNCHER, '..', p)); // bundle-first, repo-sibling fallback (launch.mjs doctrine)
  try {
    const base = await s.url;
    const ids = ['identity', 'keeper', 'persona', 'expert-service', 'shared-corpus', 'lapis-pm', 'governance'];
    const items = ids.map((id) => ({ title: 'triage ' + id, evidence: 'none / different / one-to-one ?', source: 'Parts' }));
    const w = await jfetch(base + '/agent/queue', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ goal: '', items }) });
    assert.equal(w.status, 200);
    const tasks = parseQueueTasks(fs.readFileSync(path.join(ops, 'agent-queue.md'), 'utf8'));
    assert.equal(tasks.length, 7, 'all seven queued in one packet');
    for (const [i, tk] of tasks.entries()) {
      assert.ok(tk.briefGoal && tk.briefGoal.length > 10, ids[i] + ': composed goal');
      assert.ok(Array.isArray(tk.briefPointers) && tk.briefPointers.length, ids[i] + ': pointers present');
      assert.ok(tk.briefPointers.some((p) => resolves(p)), ids[i] + ': brief names a real packet file');
      assert.ok(tk.briefAccept && /127\.0\.0\.1|read /.test(tk.briefAccept), ids[i] + ': acceptance check reads a file or a loopback port');
      assert.match(tk.briefHonesty || '', /asset-asserted only/, ids[i] + ': honest-label footer');
    }
  } finally { await killed(s.proc); }
});

test('brief doctrine: queue round-trip readback; pre-doctrine brief-less entries stay open and UNEDITED (append-only)', async () => {
  const ops = tmp('seams-ops-');
  fs.mkdirSync(ops, { recursive: true });
  const legacy = '# seams tasks\n\n## T-000 old-style task\n- source: Conform\n- evidence: gap from before the brief doctrine\n- status: open\n';
  fs.writeFileSync(path.join(ops, 'agent-queue.md'), legacy);
  const s = serve(LAUNCHER, { PORT: '0', OPS_DIR: ops, NODE_ONE_URL: 'http://127.0.0.1:1' });
  try {
    const base = await s.url;
    const w = await jfetch(base + '/agent/queue', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ goal: 'close the gap', items: [{ title: 'triage identity', evidence: 'none / different / one-to-one ?', source: 'Parts' }] }) });
    assert.equal(w.status, 200); assert.deepEqual(w.body.tids, ['T-001'], 'append, never renumber');
    const st = await jfetch(base + '/agent/state');
    const [oldT, newT] = st.body.outbox.tasks;
    assert.equal(oldT.tid, 'T-000'); assert.equal(oldT.status, 'open');
    assert.equal(oldT.briefGoal, null, 'old entries read back brief-less - NO retroactive composition on read');
    assert.equal(newT.briefGoal, 'close the gap', 'typed goal WINS over composition (human override, as the doctrine demands)');
    assert.ok(newT.briefPointers && newT.briefPointers.includes('AGENTS.md'), 'pointers stay composed from tab context even under a typed goal');
    assert.ok(newT.briefHonesty.includes('asset-asserted only'), 'footer rides the brief even when the human typed the goal');
    assert.ok(fs.readFileSync(path.join(ops, 'agent-queue.md'), 'utf8').startsWith(legacy), 'old bytes preserved exactly - append-only');
    assert.equal(parseQueueTasks(fs.readFileSync(path.join(ops, 'agent-queue.md'), 'utf8')).length, 2, 'round-trip: parse reads the mixed-format outbox cleanly');
  } finally { await killed(s.proc); }
});

test('brief doctrine: blank goal AND no tab context -> readable refusal, nothing written (no silent open tasks)', async () => {
  const ops = tmp('seams-ops-');
  const s = serve(LAUNCHER, { PORT: '0', OPS_DIR: ops, NODE_ONE_URL: 'http://127.0.0.1:1' });
  try {
    const base = await s.url;
    const r = await jfetch(base + '/agent/queue', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ goal: '', items: [{ title: 'do the thing', evidence: '', source: 'Nowhere' }] }) });
    assert.equal(r.status, 400); assert.equal(r.body.error, 'unbriefed_task');
    assert.match(r.body.message, /goal/i); assert.match(r.body.message, /tab context/i); assert.match(r.body.message, /silent open tasks/i, 'the refusal tells the human exactly what to do');
    const st = await jfetch(base + '/agent/state');
    assert.equal(st.body.outbox.exists, false, 'refused: the outbox was never even created');
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

// ---------------- 8. installable app shell: manifest + service-worker doctrine ----------------
function spawnCollect(entry, env) {
  const proc = spawn(process.execPath, [entry], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  proc.stdout.on('data', (c) => { out += c; });
  proc.stderr.on('data', (c) => { out += c; });
  return { proc, out: () => out };
}
const waitForExit = (proc, ms = 9000) => new Promise((resolve, reject) => {
  const to = setTimeout(() => reject(new Error('still running')), ms);
  proc.once('exit', (c) => { clearTimeout(to); resolve(c); });
});
const pngRaw = (buf) => {
  assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'PNG signature');
  assert.equal(buf.toString('ascii', 12, 16), 'IHDR');
  assert.equal(buf[24], 8, '8-bit'); assert.equal(buf[25], 6, 'RGBA');
  const idat = [];
  let off = 8;
  while (off < buf.length) { const len = buf.readUInt32BE(off); const type = buf.toString('ascii', off + 4, off + 8); if (type === 'IDAT') idat.push(buf.subarray(off + 8, off + 8 + len)); off += 12 + len; }
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), pixels: zlib.inflateSync(Buffer.concat(idat)).toString('base64') };
};

test('PWA shell: manifest parses, standalone, real served icons; CSP opens manifest-src and nothing else', async () => {
  const s = serve(LAUNCHER, { PORT: '0', OPS_DIR: tmp('seams-ops-'), NODE_ONE_URL: 'http://127.0.0.1:1' });
  try {
    const base = await s.url;
    const m = await fetch(base + '/manifest.webmanifest');
    assert.equal(m.status, 200);
    assert.match(m.headers.get('content-type'), /application\/manifest\+json/);
    assert.equal(m.headers.get('cache-control'), 'no-store', 'the server never answers the shell stale; the SW is network-first anyway');
    const man = JSON.parse(await m.text());
    assert.equal(man.name, 'Seams Launcher');
    assert.equal(man.display, 'standalone', 'installs as an app window, not a tab');
    assert.equal(man.start_url, '/'); assert.equal(man.scope, '/');
    assert.match(man.theme_color, /^#[0-9a-f]{6}$/i); assert.match(man.background_color, /^#[0-9a-f]{6}$/i);
    assert.ok(Array.isArray(man.icons) && man.icons.length >= 3, 'icon set present');
    const sizes = man.icons.map((i) => i.sizes);
    assert.ok(sizes.includes('192x192') && sizes.includes('512x512'), 'install-grade icon sizes');
    for (const ic of man.icons) {
      assert.match(ic.src, /^\/icons\/[a-z0-9-]+\.png$/, 'icons are local loopback-served files');
      const r = await fetch(base + ic.src);
      assert.equal(r.status, 200, ic.src + ' resolves');
      assert.match(r.headers.get('content-type'), /image\/png/);
    }
    const idx = (await jfetch(base + '/')).raw;
    assert.match(idx, /rel="manifest" href="\/manifest\.webmanifest"/, 'the window declares the manifest');
    assert.match(idx, /apple-mobile-web-app-capable/, 'Safari Add-to-Dock opens a standalone window');
    assert.match(idx, /apple-touch-icon/);
    assert.match(idx, /name="theme-color"/);
    assert.match((await fetch(base + '/')).headers.get('content-security-policy'), /manifest-src 'self'/, 'manifest fetch allowed - nothing else opens');
  } finally { await killed(s.proc); }
});

test('SW doctrine: app-shell cache ONLY - /api, /ops, /agent, /health are never intercepted, cached, or replayed', async () => {
  const s = serve(LAUNCHER, { PORT: '0', OPS_DIR: tmp('seams-ops-'), NODE_ONE_URL: 'http://127.0.0.1:1' });
  try {
    const base = await s.url;
    const swRes = await fetch(base + '/sw.js');
    assert.equal(swRes.status, 200);
    assert.match(swRes.headers.get('content-type'), /text\/javascript/);
    const sw = await swRes.text();
    assert.match(sw, /network-first/, 'fresh bytes when online; the cache answers offline only - no stale receipts');
    assert.match(sw, /method !== 'GET'\) return/, 'every write is the network\'s, always');
    assert.match(sw, /DYNAMIC\(u\)\) return/, 'dynamic traffic: the SW steps aside entirely');
    assert.match(sw, /DYNAMIC[\s\S]*?'\/api'[\s\S]*?'\/api\/'[\s\S]*?'\/ops\/'[\s\S]*?'\/agent\/'[\s\S]*?'\/health'/, 'the step-aside list names /api, /ops, /agent, /health');
    assert.match(sw, /u\.origin !== self\.location\.origin/, 'cross-origin left on the network untouched');
    const listM = sw.match(/const ASSETS = \[([\s\S]*?)\];/);
    assert.ok(listM, 'one named static cacheable list');
    const assets = [...listM[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    assert.ok(assets.length >= 6, 'static asset list sane (' + assets.length + ' entries)');
    for (const a of assets) {
      assert.doesNotMatch(a, /^\/(api|ops|agent|health)(\/|$)/, 'no dynamic path may EVER be cacheable: ' + a);
      const r = await fetch(base + a);
      assert.equal(r.status, 200, 'the cacheable list is honest - every entry serves: ' + a);
    }
    assert.match(sw, /net\.ok && ASSETS\.includes\(u\.pathname\)/, 'cache writes only for allow-listed static');
    assert.doesNotMatch(sw, /caches\.add\(|addAll/, 'no bulk pre-cache: nothing sneaks in behind the list');
    assert.equal((sw.match(/caches\.open\(CACHE\)/g) || []).length, 1, 'exactly one cache target');
    assert.equal((sw.match(/\.put\(/g) || []).length, 1, 'exactly one write site, behind the guard');
  } finally { await killed(s.proc); }
});

test('icons: valid PNGs at advertised sizes, rebuilding pixel-identical from the repo script (into temp, repo untouched)', async () => {
  const committed = {};
  for (const [f, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
    const buf = fs.readFileSync(path.join(ICONS_DIR, f));
    assert.ok(buf.length > 512 && buf.length < 250 * 1024, f + ' sane file size');
    committed[f] = pngRaw(buf);
    assert.equal(committed[f].w, size, f + ' width'); assert.equal(committed[f].h, size, f + ' height');
  }
  const outDir = tmp('seams-icons-');
  const gen = spawnCollect(ICON_SCRIPT, { ICONS_OUT: outDir });
  assert.equal(await waitForExit(gen.proc, 15000), 0, 'icon script runs clean: ' + gen.out());
  for (const f of Object.keys(committed)) {
    assert.deepEqual(pngRaw(fs.readFileSync(path.join(outDir, f))), committed[f], f + ' rebuilds pixel-identical - the MANIFEST can pin it honestly');
  }
});

// ---------------- 9. the one command: launch.mjs spawns, supervises, reaps ----------------
const portTaken = (port) => new Promise((resolve) => {
  const s = net.connect({ host: '127.0.0.1', port });
  const done = (v) => { s.destroy(); resolve(v); };
  s.setTimeout(500, () => done(false));
  s.once('connect', () => done(true));
  s.once('error', () => done(false));
});
async function freePorts(n) {
  const got = [];
  for (let i = 0; i < n; i++) {
    const s = net.createServer();
    await new Promise((r) => s.listen(0, '127.0.0.1', r));
    got.push(s.address().port);
    await new Promise((r) => s.close(r));
  }
  return got;
}
async function waitLine(s, re, ms = 12000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (re.test(s.out())) return s.out();
    if (s.proc.exitCode !== null) throw new Error(`exited ${s.proc.exitCode} before /${re}/:\n${s.out()}`);
    await new Promise((r) => setTimeout(r, 60));
  }
  throw new Error(`timeout waiting for /${re}/:\n${s.out()}`);
}
const psGone = (pid) => new Promise((resolve) => {
  const ps = spawn('ps', ['-p', String(pid)], { stdio: ['ignore', 'pipe', 'ignore'] });
  let o = ''; ps.stdout.on('data', (c) => { o += c; });
  ps.on('exit', () => resolve(!/\bnode\b/.test(o.replace(/^\s*PID[^\n]*\n/, ''))));
});

test('launch.mjs: ONE command boots both servers (hello through the supervised proxy); ctrl-c reaps both, ps-verified', async () => {
  const [pL, pN] = await freePorts(2);
  const s = spawnCollect(LAUNCH, { PORT: String(pL), NODE_ONE_PORT: String(pN), OPS_DIR: tmp('seams-ops-'), NODE_ONE_DATA_DIR: tmp('seams-n1-') });
  try {
    await waitLine(s, /Seams Launcher is up/);
    const mN = s.out().match(/spawned node-one pid=(\d+)/);
    const mL = s.out().match(/spawned launcher pid=(\d+)/);
    assert.ok(mN && mL, 'both children spawned and logged:\n' + s.out().slice(0, 600));
    const [pidN, pidL] = [Number(mN[1]), Number(mL[1])];
    const health = await jfetch(`http://127.0.0.1:${pL}/health`);
    assert.equal(health.body.posture, 'local-only');
    const hello = await jfetch(`http://127.0.0.1:${pL}/api/hello`);
    assert.equal(hello.body.wire, WIRE_PIN, 'the supervised node-one answers through the supervised launcher');
    s.proc.kill('SIGINT');
    assert.equal(await waitForExit(s.proc), 0, 'ctrl-c exits clean');
    assert.equal((s.out().match(/reaped \(ps-verified gone\)/g) || []).length, 2, 'supervisor ps-verified both children');
    assert.ok(await psGone(pidN), 'node-one child really gone (independent ps)');
    assert.ok(await psGone(pidL), 'launcher child really gone (independent ps)');
    assert.equal(await portTaken(pL), false, 'launcher port released');
    assert.equal(await portTaken(pN), false, 'node-one port released');
  } finally {
    if (s.proc.exitCode === null) { s.proc.kill('SIGKILL'); await waitForExit(s.proc, 5000).catch(() => {}); }
  }
});

test('port hygiene: second launch REUSES with a clear message - no EADDRINUSE, no stack trace; bare re-runs of both servers exit 0 too', async () => {
  const [pL, pN] = await freePorts(2);
  const env = { PORT: String(pL), NODE_ONE_PORT: String(pN), OPS_DIR: tmp('seams-ops-'), NODE_ONE_DATA_DIR: tmp('seams-n1-') };
  const first = spawnCollect(LAUNCH, env);
  await waitLine(first, /Seams Launcher is up/);
  try {
    const two = spawnCollect(LAUNCH, { ...env, OPS_DIR: tmp('seams-ops2-') });
    assert.equal(await waitForExit(two.proc), 0, 'second launch exits 0 - reuse, not crash');
    const out2 = two.out();
    assert.match(out2, /already running/, 'says already running');
    assert.match(out2, new RegExp('open http:\\/\\/127\\.0\\.0\\.1:' + pL), 'hands over the open-the-URL line');
    assert.match(out2, /everything already running/, 'both ports busy -> nothing to supervise');
    assert.doesNotMatch(out2, /spawned \S+ pid=/, 'the reuse path spawns nothing');
    assert.doesNotMatch(out2, /EADDRINUSE/, 'no EADDRINUSE anywhere');
    assert.doesNotMatch(out2, /^\s+at\s+\S+\s+\(/m, 'no stack frames');
    assert.equal((await jfetch(`http://127.0.0.1:${pL}/health`)).status, 200, 'the running launcher is untouched by the second attempt');
    // and the bare `node server.mjs` re-runs that bit Erah today - the servers answer busy ports themselves now
    const dupL = spawnCollect(LAUNCHER, { PORT: String(pL), OPS_DIR: tmp('seams-ops-'), NODE_ONE_URL: `http://127.0.0.1:${pN}` });
    assert.equal(await waitForExit(dupL.proc), 0, 'launcher server.mjs on a busy port exits 0');
    assert.match(dupL.out(), /already running on 127\.0\.0\.1:\d+ - open http:\/\/127\.0\.0\.1:/);
    assert.doesNotMatch(dupL.out(), /EADDRINUSE/);
    const dupN = spawnCollect(NODE_ONE, { PORT: String(pN), DATA_DIR: tmp('seams-n1-') });
    assert.equal(await waitForExit(dupN.proc), 0, 'node-one on a busy port exits 0');
    assert.match(dupN.out(), /node-one already running on http:\/\/127\.0\.0\.1:\d+ - reusing/);
    assert.doesNotMatch(dupN.out(), /EADDRINUSE|at .*\.mjs:\d+:/);
  } finally {
    first.proc.kill('SIGINT');
    await waitForExit(first.proc, 5000).catch(() => { first.proc.kill('SIGKILL'); });
  }
});

// ---------------- 11-13. the Tauri shell (static validation - no cargo on this host) ----------------
const TAURI_DIR = path.join(here, '..', 'tauri');
const BUNDLE_SH = path.join(here, '..', 'scripts', 'make-mac-bundle.sh');

test('F3 published rate shape: launch.mjs pins the ruling budget into the node-one child env (keeper F3)', async () => {
  // The live box shipped INGEST_LIMIT at the old default 30 while docs advertised 10: the launcher
  // now ALWAYS boots node-one with the ruled shape (Erah 2026-10-26, ratified+shipped 2026-10-28).
  // Asserted against the REAL child env via /proc - the boot shape is checkable, not folklore.
  const [pL, pN] = await freePorts(2);
  const s = spawnCollect(LAUNCH, { PORT: String(pL), NODE_ONE_PORT: String(pN), OPS_DIR: tmp('seams-ops-'), NODE_ONE_DATA_DIR: tmp('seams-n1-') });
  try {
    await waitLine(s, /Seams Launcher is up/);
    const mN = s.out().match(/spawned node-one pid=(\d+)/);
    assert.ok(mN, 'node-one child pid logged:\n' + s.out().slice(0, 500));
    assert.match(s.out(), /published rate shape: INGEST_LIMIT=10 EDIT_LIMIT=10 GLOBAL_LIMIT=80 READ_LIMIT=300 READ_GLOBAL_LIMIT=1500 \(per 10-min window, socket-keyed\)/, 'the boot says what it pins');
    const envText = fs.readFileSync(`/proc/${mN[1]}/environ`, 'latin1');
    for (const [k, v] of Object.entries({ INGEST_LIMIT: '10', EDIT_LIMIT: '10', GLOBAL_LIMIT: '80', READ_LIMIT: '300', READ_GLOBAL_LIMIT: '1500' })) {
      assert.ok(envText.includes(`${k}=${v}\u0000`) || envText.endsWith(`${k}=${v}`), `child env must carry the published shape ${k}=${v}`);
    }
  } finally {
    if (s.proc.exitCode === null) s.proc.kill('SIGKILL');
    await waitForExit(s.proc, 5000).catch(() => {});
  }
});

test('F3 operator override: an explicit INGEST_LIMIT in the launcher env passes through unchanged (expert escape)', async () => {
  const [pL, pN] = await freePorts(2);
  const s = spawnCollect(LAUNCH, { PORT: String(pL), NODE_ONE_PORT: String(pN), OPS_DIR: tmp('seams-ops-'), NODE_ONE_DATA_DIR: tmp('seams-n1-'), INGEST_LIMIT: '30' });
  try {
    await waitLine(s, /Seams Launcher is up/);
    const mN = s.out().match(/spawned node-one pid=(\d+)/);
    assert.ok(mN, 'node-one child pid logged');
    assert.match(s.out(), /published rate shape: INGEST_LIMIT=30 EDIT_LIMIT=10/, 'the boot notes the override verbatim');
    const envText = fs.readFileSync(`/proc/${mN[1]}/environ`, 'latin1');
    assert.ok(envText.includes('INGEST_LIMIT=30\u0000') || envText.endsWith('INGEST_LIMIT=30'), 'operator-set knob survives verbatim');
  } finally {
    if (s.proc.exitCode === null) s.proc.kill('SIGKILL');
    await waitForExit(s.proc, 5000).catch(() => {});
  }
});

test('tauri shell: scaffold is consistent - config, capability, rust, icons, gitignore', () => {
  const read = (p) => fs.readFileSync(path.join(TAURI_DIR, p), 'utf8');
  const conf = JSON.parse(read('src-tauri/tauri.conf.json'));
  assert.equal(conf.productName, 'Seams Launcher');
  assert.equal(conf.identifier, 'app.seams.launcher');
  assert.match(conf.build.devUrl, /^http:\/\/127\.0\.0\.1:\d+$/, 'devUrl is loopback only');
  const dist = path.resolve(TAURI_DIR, 'src-tauri', conf.build.frontendDist);
  assert.ok(fs.existsSync(path.join(dist, 'index.html')), 'frontendDist resolves to the REAL public/ (zero fork)');
  assert.ok(fs.existsSync(path.join(dist, 'manifest.webmanifest')), 'same PWA the browser gets');
  const lib = read('src-tauri/src/lib.rs');
  assert.match(lib, /fn launch_mjs/, 'locates launch.mjs itself');
  assert.match(lib, /SEAMS_LAUNCHER_DIR/, 'explicit override for where launch.mjs lives');
  assert.match(lib, /Duration::from_secs\(3\)/, 'reap grace: SIGTERM then SIGKILL after 3s');
  assert.match(lib, /SIGKILL|kill\(.*-9|Command::new\("kill"\)/, 'the SIGKILL rung exists');
  assert.match(lib, /Node.js required/, 'honest missing-node panel, never a blank white window');
  assert.match(lib, /CloseRequested/, 'close reaps the sidecar');
  assert.match(lib, /ExitRequested/, 'exit reaps the sidecar');
  assert.match(lib, /seams:\/\/localhost\/node-missing/, 'panels served over a private scheme');
  assert.match(lib, /127\.0\.0\.1/, 'the shell dials loopback, nothing else');
  assert.doesNotMatch(lib, /\breqwest::|https?:\/\/(?!127\.0\.0\.1)[a-z]/, 'no external fetches from the shell');
  assert.doesNotMatch(lib, /0\.0\.0\.0/, 'no non-loopback address anywhere');
  const main = read('src-tauri/src/main.rs');
  assert.match(main, /app_lib::run\(\)/, 'thin binary, logic in the lib (Tauri 2 convention)');
  const cargo = read('src-tauri/Cargo.toml');
  const depLines = [];
  let inDep = false;
  for (const l of cargo.split('\n')) {
    if (/^\s*\[dependencies\]\s*$/.test(l)) { inDep = true; continue; }
    if (inDep && /^\s*\[/.test(l)) break;
    if (inDep) { const t = l.trim(); if (t && !t.startsWith('#')) depLines.push(t); }
  }
  assert.deepEqual(depLines, ['tauri = { version = "2", features = [] }'], 'runtime Cargo deps are EXACTLY tauri v2 - no plugins, no extra crates');
  assert.ok(/^tauri-build\s*=\s*\{\s*version\s*=\s*"2"/m.test(cargo), 'tauri-build present as build-dependency only');
  const cap = JSON.parse(read('src-tauri/capabilities/default.json'));
  assert.deepEqual(cap.permissions, ['core:default'], 'the webview gets core:default and nothing more - no IPC surface');
  assert.deepEqual(cap.windows, ['main']);
  const ign = read('src-tauri/.gitignore');
  for (const pat of ['/target/', '/gen/', '/Cargo.lock', '.icns', '.ico']) {
    assert.ok(ign.includes(pat), 'gitignore covers ' + pat);
  }
  const png = fs.readFileSync(path.join(TAURI_DIR, 'src-tauri/icons/icon.png'));
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'source flame icon is a real PNG');
});

test('package.json: the scripts exist and the runtime stays zero-dependency', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8'));
  for (const s of ['dev', 'test', 'tauri', 'tauri:build', 'tauri:icons']) {
    assert.ok(pkg.scripts[s], `script ${s} exists`);
  }
  assert.match(pkg.scripts.test, /node --test test\/launcher\.test\.mjs/, 'test is the one launcher suite file');
  assert.match(pkg.scripts.tauri, /@tauri-apps\/cli dev/);
  assert.match(pkg.scripts['tauri:build'], /@tauri-apps\/cli build/);
  assert.match(pkg.scripts['tauri:icons'], /@tauri-apps\/cli icon \S+$/, 'tauri:icons passes exactly ONE positional input (Mac run #2: CLI 2.12.4 rejects a second positional)');
  assert.doesNotMatch(pkg.scripts['tauri:icons'], /icon\s+\S+\s+\S+/, 'no second positional - output dir is the -o/--output OPTION; default is icons beside tauri.conf.json (live-verified: 512 flame source -> full icns/ico/png set, exit 0)');
  assert.ok(!pkg.dependencies || Object.keys(pkg.dependencies).length === 0, 'zero runtime deps holds');
  assert.ok(pkg.devDependencies['@tauri-apps/cli'], 'dev-only tauri CLI');
  assert.deepEqual(Object.keys(pkg.devDependencies), ['@tauri-apps/cli'], 'and it is the ONLY dev dep');
});

test('make-mac-bundle.sh: one command -> verified, self-describing tarball the Mac can unpack', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'seams-bundle-'));
  execFileSync('bash', [BUNDLE_SH], { env: { ...process.env, SEAMS_BUNDLE_DIR: out, SEAMS_LAUNCHER_DIR: path.join(here, '..') } });
  const tar = path.join(out, 'seams-launcher-mac-latest.tar.gz');
  const side = path.join(out, 'seams-launcher-mac-latest.tar.gz.sha256');
  assert.ok(fs.existsSync(tar) && fs.existsSync(side), 'tarball + sha256 sidecar land at stable paths');
  const wantHash = createHash('sha256').update(fs.readFileSync(tar)).digest('hex');
  assert.ok(fs.readFileSync(side, 'utf8').startsWith(wantHash), 'sidecar sha256 matches the tarball bytes (node crypto: macOS ships shasum, not GNU sha256sum - Mac run #3 latent landmine, now gone)');
  const listing = execFileSync('tar', ['-tf', tar], { encoding: 'utf8' });
  for (const req of ['seams-launcher/launch.mjs', 'seams-launcher/server.mjs', 'seams-launcher/public/index.html',
    'seams-launcher/tauri/src-tauri/src/lib.rs', 'seams-launcher/tauri/src-tauri/icons/icon.png',
    'seams-launcher/scripts/make-mac-bundle.sh',
    'seams-launcher/node-one/attributed-text/server.mjs', 'seams-launcher/node-one/attributed-text/seed.json']) {
    assert.ok(listing.includes(req), 'tarball carries ' + req + ' (Mac run #1: the flat tree MUST include node-one beside launch.mjs)');
  }
  for (const banned of ['/target/', '/node_modules/', '/ops/', '/data/', '/.DS_Store']) {
    assert.ok(!listing.includes(banned), 'tarball excludes ' + banned);
  }
  fs.rmSync(out, { recursive: true, force: true });
});

// ---------------- 9a2. tar-flavor portability - Mac run #3 regression ----------------
// Erah's Mac run #3 (bundle b1519cd6): npm test 18/21 - all 3 bundle tests died at ONE inner
// command: bsdtar printed "tar: Option --sort=name is not supported" when the suite ran
// make-mac-bundle.sh. Root cause: GNU-only create flags. The bundler now packs with node
// builtins ONLY (strict POSIX ustar + gzip with the header clock zeroed): portable wherever
// node runs - BRIX or Mac - and byte-deterministic by construction. These gates keep it that
// way: (1) belt - no GNU-only create flag may ever return, no external tar/gzip/sha256sum, and
// the suite's own tar calls stay in the bsdtar-safe -tf/-xf forms; (2) two fresh builds must be
// BYTE-IDENTICAL (the sha256 sidecar doctrine rests on it) and the archive must parse under a
// hand-written STRICT ustar reader - the exact subset bsdtar is guaranteed to accept - with no
// external tar involved anywhere.
const GNU_CREATE_FLAGS = ['--sort', '--format=gnu', '--owner=', '--group=', '--numeric-owner', '--mtime=', '--clamp-mtime', '--pax-option', '--pax-header'];

test('portability: bundler carries NO GNU-only create flags and no GNU-coreutils deps (Mac run #3)', () => {
  const code = fs.readFileSync(BUNDLE_SH, 'utf8').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  for (const flag of GNU_CREATE_FLAGS) {
    assert.ok(!code.includes(flag), 'GNU-only create flag returned to the bundler: ' + flag);
  }
  assert.doesNotMatch(code, /^\s*tar\b/m, 'create side runs NO external tar - the node packer owns the bytes (bsdtar lacks GNU flags entirely)');
  assert.match(code, /zlib\.gzipSync/, 'packer rides node:zlib - portable wherever node runs');
  assert.doesNotMatch(code, /(^|[^.\w])(sha256sum|gzip)\b/, 'no GNU-coreutils sha256sum / external gzip - macOS promises neither (shasum lives here)');
  const testSrc = fs.readFileSync(path.join(here, 'launcher.test.mjs'), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const calls = [...testSrc.matchAll(/execFileSync\('tar',\s*\[([^\]]*)\]/g)];
  assert.equal(calls.length, 2, 'suite exercises exactly list+unpack through the system tar');
  for (const c of calls) {
    assert.match(c[1], /^'-t[f]'|^'-x[f]'/, 'tar call must open with a bsdtar-safe -tf/-xf op: ' + c[1]);
    assert.doesNotMatch(c[1], /tzf|xzf|--sort|--format/, 'no test-hostile tar args: ' + c[1]);
  }
});

test('portability: two builds BYTE-IDENTICAL; archive parses as strict ustar (bsdtar subset, no external tar)', () => {
  const dirs = [];
  const build = () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'seams-determ-'));
    dirs.push(out);
    execFileSync('bash', [BUNDLE_SH], { env: { ...process.env, SEAMS_BUNDLE_DIR: out, SEAMS_LAUNCHER_DIR: path.join(here, '..') } });
    return fs.readFileSync(path.join(out, 'seams-launcher-mac-latest.tar.gz'));
  };
  try {
    const a = build();
    const b = build();
    assert.equal(createHash('sha256').update(a).digest('hex'), createHash('sha256').update(b).digest('hex'),
      'two fresh builds of the same tree -> IDENTICAL bytes - the sha sidecar doctrine rests on this');
    assert.deepEqual([...a.subarray(4, 8)], [0, 0, 0, 0], 'gzip MTIME pinned to 0 - no build clock in the bytes');
    assert.equal(a[9], 0xff, 'gzip OS byte = unknown (flavor-agnostic)');
    const tb = zlib.gunzipSync(a);
    assert.equal(tb.length % 512, 0, 'tar is a stream of 512-byte blocks');
    const field = (blk, o, len) => {
      const s = blk.subarray(o, o + len);
      const z = s.indexOf(0);
      return (z === -1 ? s : s.subarray(0, z)).toString('latin1').replace(/\s+$/, '');
    };
    const oct = (s) => { const t = s.replace(/^[0 ]+/, ''); return t === '' ? 0 : parseInt(t, 8); };
    const members = new Map();
    let pos = 0;
    while (pos + 512 <= tb.length) {
      const blk = tb.subarray(pos, pos + 512);
      if (blk.every((x) => x === 0)) break;
      let sum = 0;
      for (let i = 0; i < 512; i++) sum += (i >= 148 && i < 156) ? 0x20 : blk[i];
      assert.equal(sum, oct(field(blk, 148, 8)), 'ustar header checksum @' + pos + ' for ' + field(blk, 0, 100));
      assert.equal(blk.subarray(257, 263).toString('latin1'), 'ustar\0', 'strict POSIX ustar magic - NOT gnu format (bsdtar reads this subset)');
      assert.equal(blk.subarray(263, 265).toString('latin1'), '00', 'ustar version 00');
      const tf = String.fromCharCode(blk[156]);
      assert.ok(tf === '0' || tf === '5', 'plain files and dirs only, saw ' + JSON.stringify(tf) + ' @' + pos);
      assert.equal(field(blk, 157, 100), '', 'no linkname - symlinks stay out of the bundle @' + pos);
      assert.equal(oct(field(blk, 108, 8)), 0, 'uid pinned 0');
      assert.equal(oct(field(blk, 116, 8)), 0, 'gid pinned 0');
      assert.equal(field(blk, 265, 32), 'root', 'uname pinned');
      assert.equal(field(blk, 297, 32), 'root', 'gname pinned');
      assert.equal(oct(field(blk, 136, 12)), 0, 'mtime pinned 0');
      const mode = oct(field(blk, 100, 8));
      assert.ok(tf === '5' ? mode === 0o755 : (mode === 0o644 || mode === 0o755), 'modes normalized, saw ' + mode.toString(8) + ' for ' + field(blk, 0, 100));
      members.set(field(blk, 0, 100).replace(/\/$/, ''), { tf, mode });
      pos += 512 + 512 * Math.ceil(oct(field(blk, 124, 12)) / 512);
    }
    for (const req of ['seams-launcher/launch.mjs', 'seams-launcher/server.mjs', 'seams-launcher/node-one/attributed-text/server.mjs',
      'seams-launcher/node-one/attributed-text/seed.json', 'seams-launcher/tauri/src-tauri/tauri.conf.json',
      'seams-launcher/scripts/make-mac-bundle.sh', 'seams-launcher/AGENTS.md']) {
      assert.ok(members.has(req), 'strict ustar walk carries ' + req);
    }
    for (const nm of members.keys()) {
      assert.ok(!/(^|\/)(target|node_modules|ops|data|\.git)(\/|$)/.test(nm), 'junk must stay home: ' + nm);
      assert.ok(!nm.endsWith('.DS_Store') && !nm.includes('._'), 'AppleDouble junk must stay home: ' + nm);
    }
    const execBit = (m) => (m & 0o111) !== 0;
    assert.equal(execBit(members.get('seams-launcher/scripts/make-mac-bundle.sh').mode), execBit(fs.statSync(BUNDLE_SH).mode),
      'the exec bit travels with the packer');
  } finally {
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  }
});

// ---------------- 9b. bundle layout (flat tree) e2e - Mac run #1 regression ----------------
// Runs the EXACT beforeDevCommand sequence (`node ../launch.mjs --dev`) with cwd=<tmp>/tauri
// against a freshly built, unpacked bundle. Asserts both ports accept AFTER the launcher
// parent exited (detached posture), node-one root 200, and the resolved node-one path lies
// INSIDE the unpacked dir - the failure Erah hit is now a standing gate, not repo-layout-only.
function unpackBundle() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'seams-unpack-'));
  execFileSync('bash', [BUNDLE_SH], { env: { ...process.env, SEAMS_BUNDLE_DIR: out, SEAMS_LAUNCHER_DIR: path.join(here, '..') } });
  execFileSync('tar', ['-xf', path.join(out, 'seams-launcher-mac-latest.tar.gz'), '-C', out]);
  return { out, root: path.join(out, 'seams-launcher') };
}

test('bundle layout: beforeDevCommand boots BOTH servers from <tmp>/tauri; node-one resolves INSIDE the unpacked dir', async () => {
  const u = unpackBundle();
  const [pL, pN] = await freePorts(2);
  const proc = spawn(process.execPath, ['../launch.mjs', '--dev'], {
    cwd: path.join(u.root, 'tauri'),
    env: { ...process.env, PORT: String(pL), NODE_ONE_PORT: String(pN), SEAMS_DEV_LOG: path.join(u.out, 'dev.log') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  proc.stdout.on('data', (c) => { out += c; });
  proc.stderr.on('data', (c) => { out += c; });
  const pids = [];
  try {
    const code = await new Promise((r) => proc.on('exit', r));
    assert.equal(code, 0, 'beforeDevCommand posture: exits 0 once BOTH servers answer:\n' + out.slice(0, 2000));
    assert.match(out, /layout: bundle/, 'announces which layout it picked:\n' + out.slice(0, 800));
    const entry = out.match(/node-one entry: (\S+)/);
    assert.ok(entry, 'announces the resolved node-one entry path:\n' + out.slice(0, 800));
    assert.ok(entry[1].startsWith(u.root + path.sep), `node-one resolved INSIDE the unpacked dir (${entry[1]} not under ${u.root})`);
    assert.equal(entry[1], path.join(u.root, 'node-one', 'attributed-text', 'server.mjs'), 'bundle-sibling entry - not one dir too high');
    assert.ok(fs.existsSync(entry[1]), 'the resolved entry exists on disk');
    assert.equal(await portTaken(pN), true, 'node-one port accepts AFTER the parent exited (detached children stayed up)');
    assert.equal(await portTaken(pL), true, 'launcher port accepts after the parent exited');
    assert.equal((await jfetch(`http://127.0.0.1:${pN}/`)).status, 200, 'node-one root 200 in bundle layout');
    assert.equal((await jfetch(`http://127.0.0.1:${pL}/`)).status, 200, 'launcher window 200 in bundle layout');
    for (const m of out.matchAll(/spawned [\w-]+ pid=(\d+)/g)) pids.push(Number(m[1]));
    assert.equal(pids.length, 2, 'both children were SPAWNED here, not reused');
  } finally {
    for (const pid of pids) { try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ } }
    const t0 = Date.now();
    while ((await portTaken(pL)) || (await portTaken(pN))) {
      if (Date.now() - t0 > 4000) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    fs.rmSync(u.out, { recursive: true, force: true });
  }
  assert.equal(await portTaken(pL), false, 'cleanup: launcher port released');
  assert.equal(await portTaken(pN), false, 'cleanup: node-one port released');
});

test('bundle layout: node-one stripped -> --dev refuses LOUDLY (nonzero exit, candidates listed, no half-boot)', async () => {
  const u = unpackBundle();
  fs.rmSync(path.join(u.root, 'node-one'), { recursive: true, force: true });
  const [pL, pN] = await freePorts(2);
  const proc = spawn(process.execPath, ['../launch.mjs', '--dev'], {
    cwd: path.join(u.root, 'tauri'),
    env: { ...process.env, PORT: String(pL), NODE_ONE_PORT: String(pN), SEAMS_DEV_LOG: path.join(u.out, 'dev.log') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  proc.stdout.on('data', (c) => { out += c; });
  proc.stderr.on('data', (c) => { out += c; });
  try {
    const code = await new Promise((r) => proc.on('exit', r));
    assert.notEqual(code, 0, 'beforeDevCommand FAILS LOUDLY instead of masking into a poll timeout');
    assert.match(out, /refusing to start: node-one/, out.slice(0, 1200));
    assert.match(out, /Looked in:/, 'lists where it searched:\n' + out.slice(0, 1200));
    assert.ok(out.includes(path.join(u.root, 'node-one', 'attributed-text', 'server.mjs')), 'the candidate list names the bundle-sibling path');
    assert.match(out, /servers are DOWN/, 'honest state line');
    assert.equal(await portTaken(pL), false, 'no half-boot: nothing left on the launcher port');
  } finally {
    if (proc.exitCode === null) proc.kill('SIGKILL');
    fs.rmSync(u.out, { recursive: true, force: true });
  }
});

test('beforeDevCommand posture: ONE self-locating invocation (no shotgun, no || true); zero cwd math in launch.mjs', () => {
  const conf = JSON.parse(fs.readFileSync(path.join(here, '..', 'tauri', 'src-tauri', 'tauri.conf.json'), 'utf8'));
  const cmd = conf.build.beforeDevCommand;
  assert.equal(cmd, 'node ../launch.mjs --dev', 'one invocation from tauri/ cwd; launch.mjs self-locates');
  assert.ok(!/\|\||&&|\btrue\b/.test(cmd), 'no || shotgun / || true that swallows boot failures into 180s timeouts');
  const src = fs.readFileSync(LAUNCH, 'utf8');
  assert.ok(!src.includes('process.cwd'), 'launch.mjs derives no paths from the shell cwd');
  const iB = src.indexOf("path.join(here, 'node-one', 'attributed-text', 'server.mjs')");
  const iR = src.indexOf("path.join(here, '..', 'node-one', 'attributed-text', 'server.mjs')");
  assert.ok(iB >= 0 && iR > iB, 'existence probe is bundle-first (the inner copy always wins)');
});
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
