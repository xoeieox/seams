import test from 'node:test';
import assert from 'node:assert/strict';
import { Store, StoreError, diffHunks, merge3, tokenize } from '../lib.mjs';

const owners = (s) => s.head.segs.map(([t, a]) => `${a}:${t}`);
const mk = () => { const s = new Store(); s.seed('The quick brown fox', 'Ann'); return s; };

test('kept words stay with their author, new words go to the editor', () => {
  const s = mk();
  s.edit({ name: 'Bob', text: 'The slow brown fox jumps', baseV: 1 });
  assert.deepEqual(owners(s), ['Ann:The ', 'Bob:slow', 'Ann: brown fox', 'Bob: jumps']);
  const bob = s.lineage('bob');
  assert.equal(bob.edits.length, 1);
  assert.equal(bob.edits[0].hunks[0].rm[0][0], 'quick');
  assert.equal(bob.edits[0].hunks[0].rm[0][1], 'Ann');
});

test('names are case-insensitive and keep the first spelling', () => {
  const s = mk();
  s.edit({ name: 'Bob', text: 'The quick brown fox!', baseV: 1 });
  s.edit({ name: '  bob ', text: 'The quick brown fox!!', baseV: 2 });
  assert.equal(s.authors().length, 2);
  assert.equal(s.head.name, 'Bob');
});

test("lineage shows what others did to someone's words", () => {
  const s = mk();
  s.edit({ name: 'Bob', text: 'A shopping list', baseV: 1 });
  const ann = s.lineage('ann');
  assert.equal(ann.author.words, 0);
  assert.equal(ann.lost.length, 1);
  assert.equal(ann.lost[0].by, 'Bob');
});

test('retyped text is credited to the retyper (documented gap)', () => {
  const s = mk();
  s.edit({ name: 'Bob', text: 'The quick brown', baseV: 1 });
  s.edit({ name: 'Cy', text: 'The quick brown fox', baseV: 2 });
  assert.ok(owners(s).includes('Cy: fox'));
});

test('stale base merges when edits are apart, conflicts when they touch', () => {
  const s = new Store(); s.seed('one two three four five six', 'Ann');
  s.edit({ name: 'Bob', text: 'ONE two three four five six', baseV: 1 });
  s.edit({ name: 'Cy', text: 'one two three four five SIX', baseV: 1 });
  assert.equal(s.head.segs.map((x) => x[0]).join(''), 'ONE two three four five SIX');
  assert.deepEqual(s.head.segs.filter(([, a]) => a === 'Cy').map((x) => x[0]), ['SIX']);
  assert.throws(() => s.edit({ name: 'Di', text: 'ONE two three four five bad', baseV: 1 }), (e) => e instanceof StoreError && e.code === 'conflict');
  assert.throws(() => s.edit({ name: 'Di', text: 'xx two three four five SIX', baseV: 1 }), { code: 'conflict' });
});

test('validation', () => {
  const s = mk();
  assert.throws(() => s.edit({ name: ' ', text: 'x', baseV: 1 }), { code: 'name_required' });
  assert.throws(() => s.edit({ name: 'B', text: '   ', baseV: 1 }), { code: 'empty' });
  assert.throws(() => s.edit({ name: 'B', text: 'The quick brown fox', baseV: 1 }), { code: 'no_change' });
  assert.throws(() => s.edit({ name: 'B', text: 'x', baseV: 9 }), { code: 'bad_base' });
});

test('revert restores text and original authorship, history keeps everything', () => {
  const s = mk();
  const before = JSON.stringify(s.head.segs);
  s.edit({ name: 'Vandal', text: 'lol', baseV: 1 });
  s.revert(1);
  assert.equal(JSON.stringify(s.head.segs), before);
  assert.equal(s.entries.length, 3);
  assert.equal(s.head.kind, 'revert');
  assert.equal(s.entry(2).segs[0][0], 'lol');
  assert.equal(s.authors().find((a) => a.name === 'Vandal').words, 0);
});

test('log persists as append-only jsonl', async () => {
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'at-')), 'log.jsonl');
  const a = new Store(f); a.seed('hi there', 'Ann'); a.edit({ name: 'Bob', text: 'hi there you', baseV: 1 });
  const b = new Store(f);
  assert.deepEqual(b.head.segs, a.head.segs);
  assert.equal(b.authors().length, 2);
});

test('export has hash chain and unverified creators', () => {
  const s = mk(); s.edit({ name: 'Bob', text: 'The quick brown fox!', baseV: 1 });
  const x = s.export();
  assert.equal(x.entries[1].parents[0], x.entries[0].content_hash);
  assert.equal(x.entries[0].derivation, 'original');
  assert.equal(x.entries[1].creator_verified, false);
});

test('diff and merge basics', () => {
  assert.deepEqual(diffHunks(['a'], ['a']), []);
  assert.deepEqual(diffHunks(['a', ' ', 'b'], ['a', ' ', 'c', ' ', 'b']).length, 1);
  assert.equal(merge3(tokenize('a b'), tokenize('a b c'), tokenize('x a b')).join(''), 'x a b c');
});
