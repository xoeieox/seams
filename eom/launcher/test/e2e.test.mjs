// W1 (EOM-E2E-BATTLE-2026-10-29): the end-to-end loop, one command, fully local.
//   npm run e2e        (= node --test test/e2e.test.mjs)
// It boots the REAL one-command path (launch.mjs: node-one + launcher, loopback only, ephemeral ports,
// throwaway data dirs) and drives the whole loop through the launcher's own HTTP surface:
//   mint key -> register -> hello (rails) -> sign + emit attributed text -> receipt -> replay dedupe ->
//   keyless claim beside it -> a bad signature refused -> the node's export carries re-checkable bytes ->
//   the timeline river, fed the node's own /api/versions + /api/export, shows the deposits as nodes.
// What is asserted is STATE (HTTP bodies, files on disk, the pure river model loaded from the node's
// served app.js). It does NOT drive a browser: there is no DOM assertion here, and no screenshot. The
// launcher window's DOM is not exercised by this suite (unverified by it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { tmp, jfetch, POSTJ } from './helpers.mjs';
import { WIRE_PIN, helloGate, canEmit } from '../launcher-core.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const LAUNCH = path.join(here, '..', 'launch.mjs');
const keysPath = [path.join(here, '..', 'node-one', 'attributed-text', 'keys.mjs'), path.join(here, '..', '..', 'node-one', 'attributed-text', 'keys.mjs')].find((p) => fs.existsSync(p));
const K = await import('file://' + keysPath);

async function freePorts(n) {
  const got = [];
  for (let i = 0; i < n; i++) { const s = net.createServer(); await new Promise((r) => s.listen(0, '127.0.0.1', r)); got.push(s.address().port); await new Promise((r) => s.close(r)); }
  return got;
}
const portTaken = (port) => new Promise((r) => { const c = net.connect(port, '127.0.0.1'); c.once('connect', () => { c.destroy(); r(true); }); c.once('error', () => r(false)); });
async function waitUp(get, ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { return await get(); } catch { await new Promise((r) => setTimeout(r, 150)); } } throw new Error('never came up'); }

test('E2E loop: launch -> mint -> register -> hello -> signed emit -> receipt -> river shows the deposit; claims stay claims; bad sig deposits nothing; ctrl-c reaps', async () => {
  const [pL, pN] = await freePorts(2);
  const ops = tmp('seams-e2e-ops-');
  let out = '';
  const proc = spawn(process.execPath, [LAUNCH], { env: { ...process.env, PORT: String(pL), NODE_ONE_PORT: String(pN), OPS_DIR: ops, NODE_ONE_DATA_DIR: tmp('seams-e2e-n1-'), SEAMS_GATEWAY_URL: 'http://127.0.0.1:1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.on('data', (c) => { out += c; }); proc.stderr.on('data', (c) => { out += c; });
  const L = `http://127.0.0.1:${pL}`, N = `http://127.0.0.1:${pN}`;
  try {
    await waitUp(async () => { const r = await fetch(L + '/health'); if (!r.ok) throw new Error('no'); });
    const hz = (await jfetch(L + '/health')).body;
    assert.equal(hz.posture, 'local-only');
    assert.equal(hz.gateway, 'http://127.0.0.1:1', 'SEAMS_GATEWAY_URL passes through launch.mjs to the launcher');
    assert.equal((await jfetch(L + '/gateway/hello')).status, 502, 'a dead gateway is a clean 502, the local loop is unaffected');

    // 1. no key yet; mint; the custody file is 0600 and holds the private half only there
    assert.equal((await jfetch(L + '/agent/keys')).body.present, false);
    const mint = await jfetch(L + '/agent/keys/mint', POSTJ({}));
    assert.equal(mint.status, 200); const nk = mint.body.node_key;
    assert.match(nk, /^key:ed25519:[A-Za-z0-9+/]{43}=$/);
    const keyFile = path.join(ops, 'node-key.json');
    assert.equal(fs.statSync(keyFile).mode & 0o777, 0o600, 'private half at 0600');
    const keyInfo = await jfetch(L + '/agent/keys');
    assert.equal(keyInfo.body.registered, false); assert.ok(!JSON.stringify(keyInfo.body).includes(JSON.parse(fs.readFileSync(keyFile, 'utf8')).priv_b64), 'the key view never carries the private half');

    // 2. hello: the rails (wire pin + closed gate) hold before any send
    const hello = await jfetch(L + '/api/hello');
    const rail = helloGate(hello.body);
    assert.equal(rail.pinned, true); assert.equal(rail.gateOk, true); assert.equal(hello.body.wire, WIRE_PIN);
    assert.equal(canEmit({ rail, quarantined: rail.integrity === 'QUARANTINED' }).allow, true);

    // 3. register: a self-signed announce marks the key verified at the gate, not by the launcher
    const ann = await jfetch(L + '/agent/emit', POSTJ({ body: { op: 'emit', kind: 'node-key', provenance: { attributed_to: { name: 'E2E Author' } } } }));
    assert.equal(ann.status, 200); assert.equal(ann.body.verified, true);
    assert.equal((await jfetch(L + '/agent/keys')).body.registered, true, 'registration is read back from the node');

    // 4. sign + emit attributed text; the receipt comes back verbatim
    const text = 'the first signed words from the e2e author';
    const em = await jfetch(L + '/agent/emit', POSTJ({ body: { op: 'emit', kind: 'text', text, provenance: { origin: 'authored' } } }));
    assert.equal(em.status, 200); assert.equal(em.body.status, 'deposited'); assert.equal(em.body.creator_verified, true);
    assert.equal(em.body.node_key_fingerprint, nk.slice(12, 20)); assert.match(em.body.receipt, /^rcpt:/); assert.equal(em.body.duplicate, false);
    const again = await jfetch(L + '/agent/emit', POSTJ({ body: { op: 'emit', kind: 'text', text, provenance: { origin: 'authored' } } }));
    assert.equal(again.body.duplicate, true, 'replay: same bytes, same signature, same receipt'); assert.equal(again.body.receipt, em.body.receipt);

    // 5. a keyless visitor beside it: accepted as a claim, labelled false
    const claim = await jfetch(N + '/api/ingest', POSTJ({ op: 'emit', node_key: 'key:visitor', kind: 'text', text: 'an unsigned name, as typed', provenance: { origin: 'authored' } }));
    assert.equal(claim.status, 200); assert.equal(claim.body.creator_verified, false);

    // 6. a forged signature is refused at the gate and deposits nothing
    const before = (await jfetch(N + '/api/export')).body.entries.length;
    const forged = K.signBody(JSON.parse(fs.readFileSync(keyFile, 'utf8')).priv_b64, { x: 'something else entirely' });
    const bad = await jfetch(N + '/api/ingest', POSTJ({ op: 'emit', node_key: nk, kind: 'text', text: 'forged', sig: forged }));
    assert.equal(bad.status, 400); assert.equal(bad.body.error, 'bad_signature');
    assert.equal((await jfetch(N + '/api/export')).body.entries.length, before, 'nothing deposited');

    // 7. a page edit by a typed name, so the river has both kinds of node
    const st = (await jfetch(N + '/api/state')).body;
    const ed = await jfetch(N + '/api/edit', POSTJ({ name: 'Visitor', text: st.segs.map((s) => s[0]).join('') + ' A visitor added this line.', base_v: st.v }));
    assert.equal(ed.status, 200);

    // 8. the export carries bytes anyone can re-check without trusting the node (REQ-SIGN-7)
    const exp = (await jfetch(N + '/api/export')).body;
    const mine = exp.entries.find((e) => e.creator_ref === nk && e.provenance.entry_kind === 'ingest' && e.creator_sig_b64);
    assert.ok(mine, 'the signed deposit is in the export'); assert.equal(mine.creator_verified, true);
    const pub = crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(mine.creator_pub_b64, 'base64')]), format: 'der', type: 'spki' });
    assert.equal(crypto.verify(null, Buffer.from(mine.creator_signed_b64, 'base64'), pub, Buffer.from(mine.creator_sig_b64, 'base64')), true, 'local re-check with node:crypto alone');
    assert.equal((await jfetch(N + `/api/deposits?node_key=${encodeURIComponent(nk)}`)).body.count, 1, 'one log entry: the text (an announce registers the key, it is not a log deposit)');

    // 9. the launcher recorded its own emissions; the watcher shows them
    const w = (await jfetch(L + '/agent/watch')).body;
    assert.equal(w.emissions.total, 3, 'announce, text, replay');
    assert.deepEqual(w.emissions.recent.map((r) => [r.target, r.http, r.duplicate]), [['local', 200, false], ['local', 200, false], ['local', 200, true]]);

    // 10. the timeline river: the node's own served app.js model, the node's own payloads
    const appJs = (await fetch(N + '/demo/app.js').then((r) => (r.ok ? r.text() : null))) ?? (await fetch(N + '/app.js').then((r) => r.text()));
    const block = appJs.slice(appJs.indexOf('// ===== RIVER-MODEL-BEGIN'), appJs.indexOf('// ===== RIVER-MODEL-END'));
    assert.ok(block.length > 200, 'the node serves the river model');
    const riverModel = vm.runInNewContext('(function(){' + block + '; return riverModel; })()');
    const versions = (await jfetch(N + '/api/versions')).body;
    const verif = new Map([[nk, { verified: true }]]);
    const m = JSON.parse(JSON.stringify(riverModel(versions, exp.entries, verif)));
    const dep = m.nodes.filter((n) => n.kind === 'deposit');
    assert.equal(dep.length, 2, 'the signed text and the keyless claim are deposits on the river (an announce is registry, not a log entry)');
    const signed = dep.find((n) => n.lane === nk && !n.href.includes('undefined') && n.verified);
    assert.ok(signed, 'the launcher-signed deposit is a SOLID node'); assert.equal(signed.href, '#/d/' + encodeURIComponent(nk));
    assert.equal(dep.find((n) => n.lane === 'key:visitor').verified, false, 'the keyless visitor stays a claim (dashed)');
    assert.deepEqual(m.nodes.filter((n) => n.kind !== 'deposit').map((n) => [n.kind, n.lane]), [['seed', 'Erah'], ['edit', 'Visitor']], 'page versions are there too');
    assert.deepEqual(m.refused, []); assert.ok(m.nodes.every((n, i, a) => i === 0 || a[i - 1].x <= n.x));
    assert.ok(m.lanes.includes(nk) && m.lanes.includes('Visitor') && m.lanes.includes('key:visitor'));

    // 11. ctrl-c reaps both servers
    proc.kill('SIGINT');
    const code = await new Promise((r) => { const to = setTimeout(() => r('timeout'), 9000); proc.once('exit', (c) => { clearTimeout(to); r(c); }); });
    assert.equal(code, 0);
    assert.equal(await portTaken(pL), false); assert.equal(await portTaken(pN), false);
  } finally {
    if (proc.exitCode === null) { proc.kill('SIGKILL'); await new Promise((r) => proc.once('exit', r)); }
  }
});
