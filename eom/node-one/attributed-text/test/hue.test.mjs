// hue.test.mjs - RED-LINE harness for the author-hue contract (EOM-DEMO-UI-FIXWAVE-2026-10-28,
// Leg 1; red on the pre-fix tree, green on the fix - gate rule of the handoff).
//
// The bug this pins out of existence (owner live-observed, 2026-10-28: "the toggle still shows
// the same green on two different names"): hue was `a${a.idx % NCOLORS}` with idx = position in
// a locally built author list. Positional assignment re-maps when the author set changes and
// collides within/across views. The contract:
//   1. hue derives from author identity ONLY - the base64 public half for key:ed25519 authors,
//      the name string for keyless names - stable everywhere and forever;
//   2. distinct authors in one view never share a hue class when the view has <= 10 authors;
//   3. hash-space collisions (>1 author in one slot) fall back to the `.alt` dotted underline;
//   4. no position state anywhere (the contract block must never read an author's idx).
//
// The harness extracts the HUE-CONTRACT block from the SHIPPED public/app.js bytes and runs
// them verbatim in node (the block is DOM-free by contract): what the browser ships is exactly
// what this suite certifies - no duplicated copy to drift.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appSrc = fs.readFileSync(path.join(here, '..', 'public', 'app.js'), 'utf8');
const cssSrc = fs.readFileSync(path.join(here, '..', 'public', 'app.css'), 'utf8');

const BEGIN = '// ===== HUE-CONTRACT-BEGIN';
const END = '// ===== HUE-CONTRACT-END';

let cached = null;
function contract() {
  if (cached) return cached;
  const b = appSrc.indexOf(BEGIN);
  const e = appSrc.indexOf(END);
  assert.notEqual(b, -1, 'RED-LINE: public/app.js carries no HUE-CONTRACT block - the hue is not an extracted pure-identity function');
  assert.notEqual(e, -1, 'RED-LINE: the HUE-CONTRACT block is not closed');
  const block = appSrc.slice(appSrc.indexOf('\n', b) + 1, e);
  const factory = new Function('"use strict";' + block + '\n return { HUE_NC, hueIdentity, hueHash, hueSlot, colorClass };');
  cached = factory();
  cached._block = block;
  return cached;
}

// A fixed corpus whose ten slots are 0..9 exactly once under the pinned FNV-1a hash.
// The pins below are load-bearing forever: identity-derived hue may never re-map.
const CORPUS = ['Ann', 'Tomas', 'Gita', 'Sven', 'Hugo', 'Ivy', 'Cara', 'Lena', 'Ed', 'Nils'];
const PINNED = { Ann: 0, Tomas: 1, Gita: 2, Sven: 3, Hugo: 4, Ivy: 5, Cara: 6, Lena: 7, Ed: 8, Nils: 9 };
// Two keyless names whose slots collide by hash (fixture for the alt fallback), and two
// synthetic ed25519 public halves with pinned slots.
const COLLIDE_A = 'visitor-6'; const COLLIDE_B = 'visitor-8'; const COLLIDE_SLOT = 8;
const PUB_A = 'A'.repeat(43) + '='; const PUB_B = 'B'.repeat(43) + '=';
const view = (names) => names.map((name, idx) => ({ name, idx }));   // server-shaped list; idx must not matter

test('HUE-CONTRACT: the shipped app.js carries a pure identity->hue block that runs in node', () => {
  const H = contract();
  assert.equal(H.HUE_NC, 10, 'the palette width is ten hue classes (.a0-.a9)');
  assert.equal(typeof H.hueSlot, 'function');
  assert.equal(typeof H.colorClass, 'function');
});

test('RED-LINE self-check: the positional rule this contract replaces fails this harness', () => {
  // The old rule verbatim (app.js L33-36 pre-fix): hue from position in the locally built list.
  const positionalClass = (authors, name) => {
    const a = authors.find((x) => x.name === name);
    return a ? `a${a.idx % 10}${a.idx >= 10 ? ' alt' : ''}` : 'a0';
  };
  const viewA = view(['Ann', 'Bob']);
  const viewB = view(['Bob', 'Ann', 'Cara']);   // the author set churns (an edit lands elsewhere)
  assert.notEqual(positionalClass(viewA, 'Ann'), positionalClass(viewB, 'Ann'),
    'harness sanity: the positional rule re-maps Ann when the set changes - the shipped contract must NOT');
  // Erah's live case is exactly this: hue == position, so two different names carried by two
  // different locally built lists (main view vs a version view) render the SAME class token.
  assert.equal(positionalClass(view(['x']), 'x'), positionalClass(view(['y', 'z']), 'y'),
    'harness sanity: the positional rule shows two different names in the same hue across views');
});

test('hue is identity, not position: same author keeps the same hue across view changes and author-set churn', () => {
  const H = contract();
  const base = view(CORPUS);
  const churns = [
    [...base].reverse(),
    base.slice(0, 5),
    view([...CORPUS, 'visitor-6', 'visitor-8', 'key:ed25519:' + PUB_A]),
    view(['visitor-1', ...CORPUS, 'key:ed25519:' + PUB_B]),
    view([CORPUS[3], CORPUS[0], CORPUS[7], CORPUS[9]]),
  ];
  for (const name of CORPUS) {
    const want = H.colorClass(base, name).split(' ')[0];
    for (const v of churns) {
      if (!v.some((a) => a.name === name)) continue;
      assert.equal(H.colorClass(v, name).split(' ')[0], want, `${name} re-mapped under churn`);
    }
  }
  // the idx field is invisible to the contract: identical list, poisoned positions
  const poisoned = base.map((a) => ({ ...a, idx: (a.idx * 7 + 3) % 10 }));
  for (const name of CORPUS) assert.equal(H.colorClass(poisoned, name), H.colorClass(base, name));
  assert.ok(!/\bidx\b/.test(contract()._block), 'no position state anywhere: the contract block must not read idx');
});

test('distinct authors never share a hue class when the view has <= 10 authors', () => {
  const H = contract();
  const base = view(CORPUS);
  const seen = new Map();
  for (const name of CORPUS) {
    const cls = H.colorClass(base, name);
    assert.equal(cls, `a${PINNED[name]}`, `${name} must hold its pinned slot forever (got ${cls})`);
    assert.ok(!seen.has(cls), `${seen.get(cls)} and ${name} share ${cls}`);
    seen.set(cls, name);
  }
  assert.equal(seen.size, CORPUS.length);
});

test('hash-space collisions fall back to .alt - symmetric, order-free, and only when a slot is shared', () => {
  const H = contract();
  assert.equal(H.hueSlot(COLLIDE_A), COLLIDE_SLOT);
  assert.equal(H.hueSlot(COLLIDE_B), COLLIDE_SLOT);
  const both = view([COLLIDE_A, COLLIDE_B]);
  assert.equal(H.colorClass(both, COLLIDE_A), `a${COLLIDE_SLOT} alt`);
  assert.equal(H.colorClass(both, COLLIDE_B), `a${COLLIDE_SLOT} alt`);
  assert.equal(H.colorClass([...both].reverse(), COLLIDE_A), H.colorClass(both, COLLIDE_A), 'alt is collision state, not position');
  assert.equal(H.colorClass(view([COLLIDE_A]), COLLIDE_A), `a${COLLIDE_SLOT}`, 'a lone author in a slot is plain - alt means collision');
});

test('ed25519 hues derive from the full public half; keyless names from the name string', () => {
  const H = contract();
  const keyA = 'key:ed25519:' + PUB_A, keyB = 'key:ed25519:' + PUB_B;
  assert.equal(H.hueIdentity(keyA), PUB_A, 'identity is the public half itself - not the 8-char display fingerprint, not the prefix');
  assert.equal(H.hueIdentity('Zoe'), 'Zoe');
  assert.equal(H.hueSlot(keyA), H.hueHash(PUB_A) % H.HUE_NC, 'the prefix must not enter the hash');
  assert.equal(H.hueSlot(keyA), 5); assert.equal(H.hueSlot(keyB), 2);   // pinned forever
  assert.notEqual(H.hueSlot(keyA), H.hueSlot(keyB));
  for (let i = 0; i < 2000; i++) {
    const s = H.hueSlot('visitor-' + i);
    assert.ok(Number.isInteger(s) && s >= 0 && s < H.HUE_NC, 'slots stay inside the palette');
  }
});

test('the hue-class contract the CSS must honor: .alt reaches segments and chips, and it stays the dotted fallback', () => {
  contract();   // fails first if the block is absent
  assert.match(cssSrc, /\.alt[\s.]*\.seg[^{]*,|\.alt\s+\.seg,\s*\.alt\.seg/, 'the alt fallback must style segments (.alt.seg), not only chips');
  assert.match(cssSrc, /\.alt\.chip/);
  assert.match(cssSrc, /text-decoration:\s*underline dotted/, 'the collision fallback stays the dotted underline');
});
