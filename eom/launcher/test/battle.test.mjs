// EOM-E2E-BATTLE-2026-10-29 - W2 (reply watcher), W3 (consent envelope), W4 (R1 hardening against a mock
// https gateway). Fully offline: every "remote" here is a loopback server this process started.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { LAUNCHER, NODE_ONE, tmp, serve, killed, exited, jfetch, POSTJ } from './helpers.mjs';
import { startMockGateway, haveOpenssl } from './mock-gateway.mjs';
import { WIRE_PIN, watchReplies, buildConsent, CONSENT_GRANTS, parseReplies } from '../launcher-core.mjs';

const sha = (u8) => crypto.createHash('sha256').update(u8).digest('hex');
const keysMod = await import('file://' + path.join(path.dirname(NODE_ONE), 'keys.mjs'));

// ---------------- W2: reply watcher, pure core ----------------
test('W2 watchReplies: cursor advances over complete lines only; a half-written ack waits for its newline', () => {
  const a = 'ack T-001 — first\nack T-002 — second\n';
  const r1 = watchReplies(a, null, sha);
  assert.deepEqual(r1.entries.map((e) => e.tid), ['T-001', 'T-002']);
  assert.ok(r1.entries.every((e) => e.honesty === 'asserted'), 'a reply line never verifies anything');
  assert.equal(r1.cursor.offset, Buffer.byteLength(a)); assert.equal(r1.reset, false);
  const b = a + 'ack T-003 — thi';                       // writer mid-line
  const r2 = watchReplies(b, r1.cursor, sha);
  assert.deepEqual(r2.entries, []); assert.equal(r2.cursor.offset, r1.cursor.offset); assert.equal(r2.pending_partial, Buffer.byteLength('ack T-003 — thi'));
  const c = a + 'ack T-003 — third\n';
  const r3 = watchReplies(c, r2.cursor, sha);
  assert.deepEqual(r3.entries.map((e) => [e.tid, e.text]), [['T-003', 'third']], 'delivered exactly once, whole');
  assert.deepEqual(watchReplies(c, r3.cursor, sha).entries, [], 'nothing twice');
});
test('W2 watchReplies: multibyte text keeps the BYTE offset honest; a rewritten prefix resets loudly', () => {
  const a = 'ack T-001 — café ☕ done\n';
  const r1 = watchReplies(a, null, sha);
  assert.equal(r1.cursor.offset, Buffer.byteLength(a), 'bytes, not characters');
  const grown = a + 'ack T-002 — ok\n';
  assert.deepEqual(watchReplies(grown, r1.cursor, sha).entries.map((e) => e.tid), ['T-002']);
  const rewritten = 'ack T-009 — different history\nack T-010 — x\n';
  const r = watchReplies(rewritten, r1.cursor, sha);
  assert.equal(r.reset, true, 'prefix hash mismatch is reported, not trusted');
  assert.deepEqual(r.entries.map((e) => e.tid), ['T-009', 'T-010'], 're-read from the start');
  const trunc = watchReplies('', r1.cursor, sha); assert.equal(trunc.reset, true); assert.equal(trunc.cursor.offset, 0);
});
test('W2 parseReplies stays the single parser (the watcher adds no second grammar)', () => {
  assert.deepEqual(parseReplies('- ack T-004: yes\n').map((e) => e.tid), ['T-004']);
});

// ---------------- W2: through the server, across a restart with a gap ----------------
test('W2 watcher persists its cursor: restart-during-gap delivers exactly the missed replies, once, and records emissions', async () => {
  const ops = tmp('seams-ops-watch-'); const data = tmp('seams-n1-watch-');
  const one = serve(NODE_ONE, { PORT: '0', DATA_DIR: data }); const oneBase = await one.url;
  const mk = () => serve(LAUNCHER, { PORT: '0', OPS_DIR: ops, NODE_ONE_URL: oneBase });
  const replies = path.join(ops, 'agent-replies.md');
  let s = mk(); let base = await s.url;
  try {
    assert.equal((await jfetch(base + '/agent/watch', POSTJ({}))).body.entries.length, 0, 'no file yet: empty, not an error');
    fs.writeFileSync(replies, 'ack T-001 — one\nack T-002 — two\n');
    const peek = await jfetch(base + '/agent/watch');
    assert.equal(peek.body.entries.length, 2); assert.equal(peek.body.consumed, false);
    assert.equal((await jfetch(base + '/agent/watch')).body.entries.length, 2, 'GET never moves the cursor');
    const took = await jfetch(base + '/agent/watch', POSTJ({}));
    assert.deepEqual(took.body.entries.map((e) => e.tid), ['T-001', 'T-002']); assert.equal(took.body.consumed, true);
    assert.equal((await jfetch(base + '/agent/watch', POSTJ({}))).body.entries.length, 0);
    // our own emission lands in the record (receipt as the node returned it)
    const mint = await jfetch(base + '/agent/keys/mint', POSTJ({})); assert.equal(mint.status, 200);
    await jfetch(base + '/agent/emit', POSTJ({ body: { op: 'emit', kind: 'node-key', provenance: { attributed_to: { name: 'Watcher Test' } } } }));
    const e1 = await jfetch(base + '/agent/emit', POSTJ({ body: { op: 'emit', kind: 'text', text: 'watched hello', provenance: { origin: 'authored' } } }));
    assert.equal(e1.status, 200);
    const w1 = await jfetch(base + '/agent/watch');
    assert.equal(w1.body.emissions.total, 2);
    const last = w1.body.emissions.recent.at(-1);
    assert.equal(last.target, 'local'); assert.equal(last.receipt, e1.body.receipt); assert.equal(last.creator_verified, e1.body.creator_verified);
    assert.equal(last.http, 200); assert.ok(!('priv_b64' in last) && !JSON.stringify(last).includes('priv'), 'no key material in the record');

    // ---- the gap: launcher down, agent keeps writing, last line half-written ----
    await killed(s.proc);
    fs.appendFileSync(replies, 'ack T-003 — written while down\nack T-004 — also while down\nack T-005 — half');
    s = mk(); base = await s.url;
    const back = await jfetch(base + '/agent/watch', POSTJ({}));
    assert.deepEqual(back.body.entries.map((e) => e.tid), ['T-003', 'T-004'], 'exactly the missed replies - T-001/T-002 are not replayed, the partial T-005 waits');
    assert.equal(back.body.reset, false); assert.equal(back.body.pending_partial_bytes, Buffer.byteLength('ack T-005 — half'));
    assert.equal((await jfetch(base + '/agent/watch')).body.emissions.total, 2, 'emission record survived the restart');
    fs.appendFileSync(replies, ' done\n');
    assert.deepEqual((await jfetch(base + '/agent/watch', POSTJ({}))).body.entries.map((e) => [e.tid, e.text]), [['T-005', 'half done']]);
    assert.equal((await jfetch(base + '/agent/watch', POSTJ({}))).body.entries.length, 0);
    // ---- the file is replaced under us ----
    fs.writeFileSync(replies, 'ack T-100 — new history\n');
    const rs = await jfetch(base + '/agent/watch', POSTJ({}));
    assert.equal(rs.body.reset, true); assert.deepEqual(rs.body.entries.map((e) => e.tid), ['T-100']);
    // cursor file is the whole persisted state: small, no content
    const cur = JSON.parse(fs.readFileSync(path.join(ops, 'watcher.json'), 'utf8'));
    assert.equal(cur.v, 1); assert.deepEqual(Object.keys(cur.replies).sort(), ['offset', 'prefix_sha']);
  } finally { await killed(s.proc); await killed(one.proc); }
});

// ---------------- W3: consent envelope (shape contract only) ----------------
const W = 'sha256:' + 'a'.repeat(64);
test('W3 buildConsent: closed shape, closed grant vocabulary, opaque work hash, nothing invented', () => {
  assert.deepEqual(CONSENT_GRANTS, ['view', 'fork', 'remix']);
  const ok = buildConsent({ op: 'consent', work: W, grants: ['remix', 'view'], note: ' fine\n by me ' });
  assert.deepEqual(ok.body, { op: 'consent', work: W, grants: ['remix', 'view'].sort(), note: 'fine  by me' });
  for (const [input, err] of [
    [null, 'bad_body'], [[], 'bad_body'], [{ op: 'emit', work: W, grants: ['view'] }, 'unknown_op'],
    [{ op: 'consent', work: 'abc', grants: ['view'] }, 'bad_work'], [{ op: 'consent', work: 'sha256:' + 'A'.repeat(64), grants: ['view'] }, 'bad_work'],
    [{ op: 'consent', work: W, grants: [] }, 'bad_grants'], [{ op: 'consent', work: W, grants: ['view', 'view'] }, 'bad_grants'],
    [{ op: 'consent', work: W, grants: ['sell'] }, 'bad_grants'], [{ op: 'consent', work: W, grants: 'view' }, 'bad_grants'],
    [{ op: 'consent', work: W, grants: ['view'], note: 'x'.repeat(201) }, 'bad_note'],
    [{ op: 'consent', work: W, grants: ['view'], priv_b64: 'x' }, 'bad_request'], [{ op: 'consent', work: W, grants: ['view'], wallet_address: 'x' }, 'bad_request'],
  ]) assert.equal(buildConsent(input).error, err, JSON.stringify(input));
});
test('W3 /agent/consent signs launcher-side and shows the node\'s answer verbatim (today: consent_gate_unbuilt 501); refusals never leave', async () => {
  const one = serve(NODE_ONE, { PORT: '0', DATA_DIR: tmp('seams-n1-consent-') }); const oneBase = await one.url;
  const s = serve(LAUNCHER, { PORT: '0', OPS_DIR: tmp('seams-ops-consent-'), NODE_ONE_URL: oneBase }); const base = await s.url;
  try {
    const nokey = await jfetch(base + '/agent/consent', POSTJ({ body: { op: 'consent', work: W, grants: ['view'] } }));
    assert.equal(nokey.body.error, 'no_key');
    const nk = (await jfetch(base + '/agent/keys/mint', POSTJ({}))).body.node_key;
    const bad = await jfetch(base + '/agent/consent', POSTJ({ body: { op: 'consent', work: 'nope', grants: ['view'] } }));
    assert.equal(bad.status, 400); assert.equal(bad.body.error, 'bad_work');
    const foreign = await jfetch(base + '/agent/consent', POSTJ({ body: { op: 'consent', node_key: 'key:someone-else', work: W, grants: ['view'] } }));
    assert.equal(foreign.body.error, 'foreign_key');
    const r = await jfetch(base + '/agent/consent', POSTJ({ body: { op: 'consent', work: W, grants: ['view', 'fork'] } }));
    assert.equal(r.status, 501); assert.equal(r.body.error, 'consent_gate_unbuilt'); assert.equal(r.body.wire, WIRE_PIN);
    assert.equal((await jfetch(oneBase + '/api/export')).body.entries.length, 1, 'nothing was stored on the node (only the seed)');
    assert.equal((await jfetch(base + '/agent/watch')).body.emissions.recent.at(-1).error, 'consent_gate_unbuilt', 'recorded as refused');
    assert.ok(nk.startsWith('key:ed25519:'));
  } finally { await killed(s.proc); await killed(one.proc); }
});

// ---------------- W4: R1 hardening against a mock https gateway ----------------
const HAVE_SSL = haveOpenssl();
const skipSsl = HAVE_SSL ? false : '(unverified) openssl not found: mock https gateway legs did not run';
async function withGateway(opts, fn) {
  const gw = await startMockGateway(opts);
  const ops = tmp('seams-ops-r1-');
  const s = serve(LAUNCHER, { PORT: '0', OPS_DIR: ops, NODE_ONE_URL: 'http://127.0.0.1:1', SEAMS_GATEWAY_URL: gw.url, NODE_EXTRA_CA_CERTS: gw.caPath });
  const base = await s.url;
  try { await jfetch(base + '/agent/keys/mint', POSTJ({})); await fn({ gw, base, ops }); }
  finally { await killed(s.proc); await gw.close(); }
}
const EMIT = { body: { op: 'emit', kind: 'text', text: 'hello, mock gateway', provenance: { origin: 'authored' } } };

test('W4 hello wire-pin mismatch is refused launcher-side: emit AND consent, nothing reaches the ingest/consent doors', { skip: skipSsl }, async () => {
  await withGateway({ wire: 'seams-wire/9.9' }, async ({ gw, base }) => {
    for (const [p, body] of [['/gateway/emit', EMIT], ['/gateway/consent', { body: { op: 'consent', work: W, grants: ['view'] } }]]) {
      const r = await jfetch(base + p, POSTJ(body));
      assert.equal(r.status, 409); assert.equal(r.body.error, 'held by launcher'); assert.match(r.body.message, /seams-wire\/9\.9/);
    }
    assert.equal(gw.calls.filter((c) => c.path !== '/api/hello').length, 0, 'only hello was ever asked');
    assert.equal((await jfetch(base + '/gateway/hello')).body.wire, 'seams-wire/9.9', 'the read route still shows the gateway as it is, verbatim');
  });
});
test('W4 gateway whose gate is not the closed set, quarantined, or whose hello is a 404 holds the send; unconfigured -> 404 no_gateway on every route', { skip: skipSsl }, async () => {
  for (const o of [{ kinds: ['node-key', 'session-log', 'page'] }, { integrity: 'QUARANTINED: chain mismatch' }, { helloStatus: 404 }]) {
    await withGateway(o, async ({ gw, base }) => {
      const r = await jfetch(base + '/gateway/emit', POSTJ(EMIT));
      assert.equal(r.status, 409, JSON.stringify(o)); assert.equal(r.body.error, 'held by launcher');
      assert.equal(gw.ingestCalls().length, 0);
    });
  }
  const s = serve(LAUNCHER, { PORT: '0', OPS_DIR: tmp('seams-ops-nogw-'), NODE_ONE_URL: 'http://127.0.0.1:1' }); const base = await s.url;
  try {
    for (const [m, p] of [['GET', '/gateway/hello'], ['GET', '/gateway/export'], ['GET', '/gateway/deposits?node_key=key:x'], ['POST', '/gateway/emit'], ['POST', '/gateway/consent']]) {
      const r = await jfetch(base + p, m === 'POST' ? POSTJ({}) : undefined);
      assert.equal(r.status, 404, p); assert.equal(r.body.error, 'no_gateway', p);
    }
  } finally { await killed(s.proc); }
});
test('W4 bare-origin validation: only a bare https origin (or a loopback http one) boots; everything else refuses with the reason', async () => {
  const refuse = ['http://example.com', 'https://user:pw@example.com', 'https://example.com/api', 'https://example.com/?x=1', 'https://example.com/#f', 'https://example.com:notaport', 'ftp://example.com', 'file:///etc/passwd', 'javascript:alert(1)', 'example.com', 'https://'];
  for (const bad of refuse) {
    const b = serve(LAUNCHER, { PORT: '0', OPS_DIR: tmp('seams-ops-'), NODE_ONE_URL: 'http://127.0.0.1:1', SEAMS_GATEWAY_URL: bad });
    assert.equal(await exited(b.proc), 1, bad + ' refused'); assert.match(b.out(), /SEAMS_GATEWAY_URL/, bad);
  }
  for (const [given, shown] of [['https://example.com', 'https://example.com'], ['https://example.com/', 'https://example.com'], ['https://example.com:8443', 'https://example.com:8443'], ['http://127.0.0.1:9', 'http://127.0.0.1:9']]) {
    const s = serve(LAUNCHER, { PORT: '0', OPS_DIR: tmp('seams-ops-'), NODE_ONE_URL: 'http://127.0.0.1:1', SEAMS_GATEWAY_URL: given });
    try { assert.equal((await jfetch((await s.url) + '/health')).body.gateway, shown, given); } finally { await killed(s.proc); }
  }
});
test('W4 emit retry: a dropped connection is retried with the SAME signed bytes and dedupes; an HTTP answer (even 500) is final; give-up is honest', { skip: skipSsl }, async () => {
  await withGateway({ dropIngests: 1 }, async ({ gw, base }) => {
    const r = await jfetch(base + '/gateway/emit', POSTJ(EMIT));
    assert.equal(r.status, 200); assert.equal(r.headers.get('x-seams-attempts'), '2');
    const sent = gw.ingestCalls(); assert.equal(sent.length, 2);
    assert.equal(sent[0].raw, sent[1].raw, 'byte-identical body on retry (deterministic Ed25519 signature)');
    assert.ok(JSON.parse(sent[0].raw).sig, 'signed launcher-side');
    const again = await jfetch(base + '/gateway/emit', POSTJ(EMIT));
    assert.equal(again.body.duplicate, true, 'replay of the same emit acks the original receipt'); assert.equal(again.body.receipt, r.body.receipt);
    assert.equal(again.headers.get('x-seams-attempts'), '1');
  });
  await withGateway({ ingestStatus: 500 }, async ({ gw, base }) => {
    const r = await jfetch(base + '/gateway/emit', POSTJ(EMIT));
    assert.equal(r.status, 500); assert.equal(r.body.error, 'server_error', 'upstream bytes pass through verbatim'); assert.equal(r.headers.get('x-seams-attempts'), '1');
    assert.equal(gw.ingestCalls().length, 1, 'no retry after any HTTP answer: a 5xx may have deposited');
  });
  await withGateway({ dropIngests: 99 }, async ({ gw, base }) => {
    const r = await jfetch(base + '/gateway/emit', POSTJ(EMIT));
    assert.equal(r.status, 502); assert.equal(r.body.error, 'node_unreachable'); assert.match(r.body.message, /Tried 3 times/);
    assert.equal(gw.ingestCalls().length, 3, 'bounded: three attempts, then stop');
  });
});
test('W4 consent through the pinned gateway path: signed, shaped, verifiable; the gateway\'s 501 comes back verbatim and is recorded', { skip: skipSsl }, async () => {
  await withGateway({ consent: 501 }, async ({ gw, base }) => {
    const nk = (await jfetch(base + '/agent/keys')).body.node_key;
    const r = await jfetch(base + '/gateway/consent', POSTJ({ body: { op: 'consent', work: W, grants: ['view', 'remix'], note: 'ok' } }));
    assert.equal(r.status, 501); assert.equal(r.body.error, 'consent_gate_unbuilt');
    const sent = JSON.parse(gw.calls.find((c) => c.path === '/api/consent').raw);
    assert.deepEqual(Object.keys(sent).sort(), ['grants', 'node_key', 'note', 'op', 'sig', 'work']);
    assert.equal(sent.node_key, nk); assert.equal(keysMod.verifyBodySig(nk, sent), true, 'the signature checks under the key embedded in node_key');
    assert.equal(keysMod.verifyBodySig(nk, { ...sent, grants: ['view'] }), false, 'and covers the grants');
    assert.equal((await jfetch(base + '/agent/watch')).body.emissions.recent.at(-1).target, 'gateway');
  });
  await withGateway({ consent: 200 }, async ({ base }) => {
    const r = await jfetch(base + '/gateway/consent', POSTJ({ body: { op: 'consent', work: W, grants: ['view'] } }));
    assert.equal(r.status, 200); assert.equal(r.body.status, 'recorded-shape-only', 'whatever the gateway says is passed through; the launcher claims nothing');
    const bad = await jfetch(base + '/gateway/consent', POSTJ({ body: { op: 'consent', work: W, grants: ['sell'] } }));
    assert.equal(bad.status, 400); assert.equal(bad.body.error, 'bad_grants');
  });
});
