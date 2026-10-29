// W5 (EOM-E2E-BATTLE-2026-10-29): the timeline river over fixture data. The pure model block in
// public/app.js (RIVER-MODEL-BEGIN/END) is loaded alone into a vm context - no DOM, no api, no
// browser - and the rendered nodes are asserted from its STATE. Fixtures are labelled fixture data;
// none of this is a recording of a live gateway.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', 'public', 'app.js'), 'utf8');
const block = src.slice(src.indexOf('// ===== RIVER-MODEL-BEGIN'), src.indexOf('// ===== RIVER-MODEL-END'));
assert.ok(block.length > 200, 'the model block is present');
const riverModel = vm.runInNewContext('(function(){' + block + '; return riverModel; })()');
const fx = (n) => JSON.parse(fs.readFileSync(path.join(here, 'fixtures', n), 'utf8'));
const plain = (o) => JSON.parse(JSON.stringify(o)); // cross-realm objects -> plain for deepEqual

test('v1 payload (no kind, no stats): tolerated - rows draw as edits at fixed size, time axis, lanes in first-appearance order', () => {
  const f = fx('river-v1.json'); const m = plain(riverModel(f.versions, f.entries, null));
  assert.equal(m.axis, 'time');
  assert.deepEqual(m.lanes, ['Erah', 'Sam']);
  assert.equal(m.nodes.length, 3);
  assert.deepEqual(m.nodes.map((n) => n.kind), ['edit', 'edit', 'edit']);
  assert.ok(m.nodes.every((n) => n.size === 16), 'no stats: nothing is invented about edit size');
  assert.ok(m.nodes.every((n) => n.verified === false), 'typed names are claims');
  assert.equal(m.nodes[0].x, 3); assert.equal(m.nodes[2].x, 97);
  assert.ok(m.nodes[1].x > 3 && m.nodes[1].x < 97 && m.nodes[1].x < 20, 'real time: 10 minutes into an 2-hour span sits near the left');
  assert.deepEqual(m.refused, []); assert.deepEqual(m.skipped, []);
});

test('v2 payload: seed/edit/revert kinds, sizes scale with words changed, deposits join the lanes, verified only where the export says so', () => {
  const f = fx('river-v2.json'); const m = plain(riverModel(f.versions, f.entries, new Map()));
  assert.equal(m.nodes.length, 6, '3 page versions + 3 ingest deposits; the seed export entry is NOT double-drawn');
  const byId = Object.fromEntries(m.nodes.map((n) => [n.id, n]));
  assert.equal(byId.v1.kind, 'seed'); assert.equal(byId.v4.kind, 'revert'); assert.equal(byId.v4.restored_v, 1);
  assert.ok(byId.v1.size > byId.v2.size && byId.v2.size > byId.v4.size, 'bigger edit, bigger dot');
  assert.equal(byId.d3.kind, 'deposit'); assert.equal(byId.d3.size, 16);
  assert.equal(byId.d3.verified, true, 'creator_verified true from the export');
  assert.equal(byId.d5.verified, false, 'an ed25519 key whose signature was not checked is a claim');
  assert.equal(byId.d6.verified, false, 'a typed name is a claim');
  assert.match(byId.d3.href, /^#\/d\/key%3Aed25519%3A/);
  assert.equal(byId.v2.href, '#/v/2');
  assert.ok(m.nodes.every((n, i, a) => i === 0 || a[i - 1].x <= n.x), 'x never goes backwards: time order');
  assert.equal(m.lanes.length, new Set(m.nodes.map((n) => n.lane)).size, 'one lane per author');
});

test('a version row by a verified key (map says so) renders solid; a map that says claim does not', () => {
  const k = 'key:ed25519:CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC=';
  const rows = [{ v: 1, ts: '2026-10-28T10:00:00.000Z', name: k, kind: 'edit', stats: { added_words: 1, removed_words: 0 } }];
  assert.equal(riverModel(rows, [], new Map([[k, { verified: true }]])).nodes[0].verified, true);
  assert.equal(riverModel(rows, [], new Map([[k, { verified: false }]])).nodes[0].verified, false);
  assert.equal(riverModel(rows, [], null).nodes[0].verified, false);
});

test('branch claims are REFUSED (counted, not drawn); malformed rows are skipped; the rest still draws', () => {
  const f = fx('river-branchy.json'); const m = plain(riverModel(f.versions, f.entries, null));
  assert.deepEqual(m.refused.map((r) => r.v).sort(), [2, 3], 'parents on a version row and derivation:fork on a deposit are refused');
  assert.ok(m.refused.every((r) => r.why === 'branch'));
  assert.equal(m.skipped.length, 3, 'row without a version number, null row, deposit without creator_ref');
  assert.deepEqual(m.nodes.map((n) => n.id), ['v1', 'd4']);
});

test('unusable timestamps: honest sequence order, never a guessed clock', () => {
  const m = plain(riverModel([{ v: 1, ts: 'not a time', name: 'A' }, { v: 2, ts: '2026-10-28T10:00:00.000Z', name: 'B' }], [], null));
  assert.equal(m.axis, 'order');
  assert.deepEqual(m.nodes.map((n) => n.x), [3, 97]);
});

test('empty and non-array inputs: an empty river, no throw', () => {
  for (const [v, e] of [[[], []], [null, null], [undefined, 'x'], [{}, {}]]) {
    const m = plain(riverModel(v, e, null));
    assert.deepEqual(m.nodes, []); assert.deepEqual(m.lanes, []);
  }
  const one = plain(riverModel([{ v: 1, ts: '2026-10-28T10:00:00.000Z', name: 'Solo' }], null, null));
  assert.equal(one.nodes[0].x, 50, 'a single dot sits mid-river');
});

test('the view only reads: no writes, no key material, no unfenced new colours', () => {
  const view = src.slice(src.indexOf('async function viewTimeline'), src.indexOf('async function viewVersion'));
  assert.doesNotMatch(view + block, /post\(|method:\s*'POST'|localStorage|generateKey|hsl\(/);
});
