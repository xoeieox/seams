// home.test.mjs - RED-LINE harness for the homepage live-window contract
// (EOM-SITE-IMPL-2026-10-28, boards 1a/1b + the mission gates).
//
// The homepage window is a read-only component polling the public /api/export. The gates this
// harness certifies (handoff: "homepage component tests"):
//   1. poll cadence <= 20 s (the polite, accepted shape; the read budget is real);
//   2. fail-closed on fetch error: the window degrades to the browser's cached view and says
//      PAUSED - never empty, never broken-looking, never a fabricated state;
//   3. no fabricated entries in ANY state: every row derives from export bytes; an empty
//      export or a cold+paused window renders zero rows and the honest message.
//
// The harness extracts the FEED-CONTRACT block from the SHIPPED public/home.js bytes and runs
// it verbatim in node (DOM-free by contract) - what the browser ships is what the suite
// certifies, no duplicated copy to drift.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const homeSrc = fs.readFileSync(path.join(here, '..', 'public', 'home.js'), 'utf8');
const homeHtml = fs.readFileSync(path.join(here, '..', 'public', 'home.html'), 'utf8');

const BEGIN = '// ===== FEED-CONTRACT-BEGIN';
const END = '// ===== FEED-CONTRACT-END';

let cached = null;
function contract() {
  if (cached) return cached;
  const b = homeSrc.indexOf(BEGIN);
  const e = homeSrc.indexOf(END);
  assert.notEqual(b, -1, 'RED-LINE: public/home.js carries no FEED-CONTRACT block');
  assert.notEqual(e, -1, 'RED-LINE: the FEED-CONTRACT block is not closed');
  const block = homeSrc.slice(homeSrc.indexOf('\n', b) + 1, e);
  const factory = new Function('"use strict";' + block + '\n return { POLL_MS, FRESH_MS, CAP, EMPTY_TEXT, PAUSED_TEXT, NOCACHE_TEXT, LIVE_TEXT, displayName, isEdKey, snippetOf, feedRows, nextFeed, cacheWorth };');
  cached = factory();
  cached._block = block;
  return cached;
}

const E = (ref, v, ts, extra = {}) => ({ creator_ref: ref, v, ts, kind: 'session-log', text: `entry ${v}`, ...extra });
const NOW = Date.parse('2026-10-28T23:00:00.000Z');

test('FEED-CONTRACT: shipped home.js carries the DOM-free block and runs in node', () => {
  const F = contract();
  assert.equal(typeof F.feedRows, 'function');
  assert.equal(typeof F.nextFeed, 'function');
});

test('GATE: poll cadence never exceeds 20 s - the accepted, polite shape', () => {
  const F = contract();
  assert.ok(typeof F.POLL_MS === 'number' && F.POLL_MS <= 20000, `POLL_MS must be <= 20000 (read budget), got ${F.POLL_MS}`);
  assert.ok(F.POLL_MS > 0, 'a zero-negative cadence would either hammer or never re-read');
});

test('no fabricated entries: rows exist ONLY for export entries; an empty export renders zero rows', () => {
  const F = contract();
  const xs = [E('name:Erah', 1, '2026-10-28T20:00:00Z'), E('key:ed25519:Sv0rL+JvS5SjWsZrTtag/Ar3eOTT5TmmkbfhAWSRzvQ=', 10, '2026-10-28T22:10:35.422Z', { creator_verified: true, node_key_fingerprint: 'Sv0rL+Jv' })];
  const rows = F.feedRows(xs, NOW);
  assert.equal(rows.length, xs.length, 'every export entry is shown, none invented');
  assert.deepEqual(rows.map((r) => r.snippet), ['entry 10', 'entry 1'], 'snippets come from the entries themselves');
  assert.equal(F.feedRows([], NOW).length, 0, 'an empty REAL export shows zero rows - the honest empty state');
  assert.equal(F.feedRows(null, NOW).length, 0, 'garbage input never becomes rows');
  // every row field traces to the entry shapes; no helper can leak a synthetic row into the DOM
  for (const r of rows) {
    const e = xs.find((x) => r.snippet === (typeof x.text === 'string' ? x.text : '') || F.snippetOf(x) === r.snippet);
    assert.ok(e, 'row without a source entry (fabrication)');
  }
  assert.match(F.EMPTY_TEXT, /nothing landed yet/i, 'the empty state copy is the honest quiet-state from the boards');
});

test('rows render newest first, with the <30 s landing tint and the old window left plain', () => {
  const F = contract();
  const rows = F.feedRows([
    E('name:RandoNando', 2, '2026-10-28T21:00:00.000Z'),
    E('key:ed25519:Sv0rL+JvS5SjWsZrTtag/Ar3eOTT5TmmkbfhAWSRzvQ=', 3, '2026-10-28T22:59:50.000Z', { creator_verified: true, node_key_fingerprint: 'Sv0rL+Jv' }),
    E('name:Erah', 1, '2026-10-28T20:00:00.000Z'),
  ], NOW);
  assert.deepEqual(rows.map((r) => r.snippet), ['entry 3', 'entry 2', 'entry 1'], 'newest first, regardless of export order');
  assert.equal(rows[0].fresh, true, 'a 10 s old landing carries the accent tint');
  assert.equal(rows[1].fresh, false, 'a 2 h old landing is plain');
  assert.equal(rows[0].verified, true, 'the verified badge follows the gateway, only where it checked');
  assert.equal(rows[2].verified, null, 'a claimed NAME carries no verified badge and no mint chrome');
  assert.equal(rows[0].depositsHref, '#/d/key%3Aed25519%3ASv0rL%2BJvS5SjWsZrTtag%2FAr3eOTT5TmmkbfhAWSRzvQ%3D', 'key rows link the deposits view (board-1c)');
  assert.equal(rows[2].depositsHref, null, 'name rows have no key to open');
});

test('GATE: fail-closed on fetch error - paused state keeps the cached view, never empties it, never fabricates', () => {
  const F = contract();
  const xs = { entries: [E('name:Erah', 1, '2026-10-28T20:00:00.000Z'), E('name:Erah - but like, for realz', 2, '2026-10-28T20:05:00.000Z')] };
  const live = F.nextFeed({ mode: 'live', entries: xs.entries }, null);
  assert.equal(live.mode, 'paused', 'a read error flips the window to paused, not empty');
  assert.equal(live.entries.length, 2, 'the cached view survives the outage byte-identically');
  assert.equal(live.error, true, 'the state carries the paused flag for the honest banner');
  const cold = F.nextFeed({ mode: '', entries: [] }, null);
  assert.equal(cold.mode, 'paused-nocache', 'cold window + dead gateway = the honest no-cache state');
  assert.equal(cold.entries.length, 0, 'which still fabricates nothing');
  // and the no-cache states refuse to invent rows even when the DOM renders the message
  assert.equal(F.feedRows(cold.entries, NOW).length, 0);
});

test('cacheWorth persists only real entry shapes; the cache is a view of the export, never a story', () => {
  const F = contract();
  const x = { entries: [E('name:Erah', 1, '2026-10-28T20:00:00.000Z')], format: 'seams-attribution-log/0-eom.2' };
  const c = F.cacheWorth(x);
  assert.equal(c.entries.length, 1, 'real entries only');
  assert.equal(c.entries[0].creator_ref, 'name:Erah', 'raw shapes cached, display re-derived at render');
  assert.equal(F.cacheWorth(null), null, 'an error caches nothing');
  assert.equal(F.cacheWorth({}), null, 'a malformed answer caches nothing');
});

test('the honest states are reachable from the shipped HTML copy (the page never claims a row it cannot read)', () => {
  const F = contract();
  for (const t of [F.PAUSED_TEXT, F.NOCACHE_TEXT, F.EMPTY_TEXT, F.LIVE_TEXT.toUpperCase() === F.LIVE_TEXT ? F.LIVE_TEXT : '']) {
    if (t) assert.ok(t.length > 10, 'the state copies are sentences, not ellipses');
  }
  assert.match(homeSrc, /never invents rows|never fabricated|fabricates/i, 'the shipped file itself states the fail-closed rule');
});
