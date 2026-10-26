// Core logic: tokenizing, diffing, authorship, the append-only log. No I/O except the log file.
import fs from 'node:fs';
import crypto from 'node:crypto';

export const MAX_TEXT = 8000;
export const MAX_NAME = 40;

const TOKEN_RE = /\s+|[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*|[^\s\p{L}\p{N}]/gu;
export const tokenize = (s) => s.match(TOKEN_RE) || [];
const isWord = (t) => /[\p{L}\p{N}]/u.test(t);
const wordCount = (segs) => segs.reduce((n, [t]) => n + tokenize(t).filter(isWord).length, 0);

const BAD_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g;
export const normName = (s) =>
  String(s ?? '').normalize('NFKC').replace(BAD_CHARS, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
export const nameKey = (s) => normName(s).toLowerCase();
export const cleanText = (s) =>
  String(s ?? '').normalize('NFC').replace(/\r\n?/g, '\n').replace(BAD_CHARS, '');

export class StoreError extends Error {
  constructor(code, message, extra = {}) { super(message || code); this.code = code; this.extra = extra; }
}

// Myers-free word diff: trim common prefix/suffix, LCS on the middle. Returns hunks of
// differing regions: a[i1:i2] was replaced by b[j1:j2] (either side may be empty).
export function diffHunks(a, b) {
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length, eb = b.length;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  const n = ea - s, m = eb - s;
  if (!n && !m) return [];
  if (!n || !m || n * m > 4e6) return [{ i1: s, i2: ea, j1: s, j2: eb }];
  const w = m + 1, L = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      L[i * w + j] = a[s + i] === b[s + j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
  const hunks = []; let cur = null, i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[s + i] === b[s + j]) { if (cur) { hunks.push(cur); cur = null; } i++; j++; continue; }
    if (!cur) cur = { i1: s + i, i2: s + i, j1: s + j, j2: s + j };
    if (j < m && (i === n || L[i * w + j + 1] >= L[(i + 1) * w + j])) { j++; cur.j2 = s + j; }
    else { i++; cur.i2 = s + i; }
  }
  if (cur) hunks.push(cur);
  // Changes separated only by whitespace read as one change (keeps a replaced phrase from leaving stray spaces).
  const merged = [];
  for (const h of hunks) {
    const p = merged[merged.length - 1];
    if (p && a.slice(p.i2, h.i1).every((t) => /^\s+$/.test(t))) { p.i2 = h.i2; p.j2 = h.j2; } else merged.push({ ...h });
  }
  return merged;
}

// Three-way merge of token arrays. Returns merged tokens, or null if the two sides touch the same spot.
export function merge3(base, mine, head) {
  const hm = diffHunks(base, mine).map((h) => ({ ...h, rep: mine.slice(h.j1, h.j2) }));
  const hh = diffHunks(base, head).map((h) => ({ ...h, rep: head.slice(h.j1, h.j2) }));
  for (const x of hm) for (const y of hh)
    if (Math.max(x.i1, y.i1) <= Math.min(x.i2, y.i2)) return null;
  const all = [...hm, ...hh].sort((p, q) => p.i1 - q.i1);
  const out = []; let i = 0;
  for (const h of all) { out.push(...base.slice(i, h.i1), ...h.rep); i = h.i2; }
  out.push(...base.slice(i));
  return out;
}

// Group per-token records {t,a,v} into compact segments [text, author, version].
export function segsOf(objs) {
  const segs = [];
  for (const o of objs) {
    const last = segs[segs.length - 1];
    if (last && last[1] === o.a && last[2] === o.v) last[0] += o.t; else segs.push([o.t, o.a, o.v]);
  }
  return segs;
}
export const objsOf = (segs) => segs.flatMap(([t, a, v]) => tokenize(t).map((tt) => ({ t: tt, a, v })));
export const textOf = (segs) => segs.map((s) => s[0]).join('');

// Compare old per-token records with a new token list; kept tokens keep their author, the rest are new.
export function attribute(oldObjs, newObjs, exact = false) {
  const hunks = diffHunks(oldObjs.map((o) => o.t), newObjs.map((o) => o.t));
  const out = [], hs = []; let i = 0;
  for (const h of hunks) {
    for (; i < h.i1; i++) out.push(oldObjs[i]);
    const added = newObjs.slice(h.j1, h.j2);
    out.push(...added);
    hs.push({ rm: segsOf(oldObjs.slice(h.i1, h.i2)), add: segsOf(added) });
    i = h.i2;
  }
  for (; i < oldObjs.length; i++) out.push(oldObjs[i]);
  return { objs: exact ? newObjs : out, hunks: hs };
}

const sha = (s) => 'sha256:' + crypto.createHash('sha256').update(s, 'utf8').digest('hex');

export class Store {
  constructor(file = null) {
    this.file = file; this.entries = []; this.canon = new Map();
    if (file && fs.existsSync(file)) {
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        const e = JSON.parse(line); this.entries.push(e); this._note(e);
      }
    }
  }
  _note(e) { if (e.kind !== 'revert') { const k = nameKey(e.name); if (!this.canon.has(k)) this.canon.set(k, e.name); } }
  _append(e) {
    this.entries.push(e); this._note(e);
    if (this.file) fs.appendFileSync(this.file, JSON.stringify(e) + '\n');
    return e;
  }
  get head() { return this.entries[this.entries.length - 1]; }
  get empty() { return this.entries.length === 0; }
  entry(v) { return this.entries[v - 1]; }

  seed(text, name) {
    const who = normName(name) || 'Seed';
    const segs = [[cleanText(text), who, 1]];
    return this._append({ v: 1, ts: new Date().toISOString(), name: who, kind: 'seed', base_v: 0, segs, hunks: [], stats: { added_words: wordCount(segs), removed_words: 0 } });
  }

  edit({ name, text, baseV }) {
    const who0 = normName(name);
    if (!who0) throw new StoreError('name_required', 'Please enter a name.');
    text = cleanText(text);
    if (!text.trim()) throw new StoreError('empty', 'The text cannot be empty.');
    if (text.length > MAX_TEXT) throw new StoreError('too_long', `Keep it under ${MAX_TEXT} characters.`);
    const head = this.head, base = this.entry(baseV);
    if (!base) throw new StoreError('bad_base', 'Unknown base version.');
    let newToks = tokenize(text), merged = false;
    if (baseV !== head.v) {
      const m = merge3(tokenize(textOf(base.segs)), newToks, tokenize(textOf(head.segs)));
      if (!m) throw new StoreError('conflict', 'Someone saved a change in the same place while you were editing.', { head_v: head.v });
      newToks = m; merged = true;
    }
    if (newToks.join('') === textOf(head.segs)) throw new StoreError('no_change', 'Nothing changed.');
    const who = this.canon.get(nameKey(who0)) ?? who0, v = head.v + 1;
    const { objs, hunks } = attribute(objsOf(head.segs), newToks.map((t) => ({ t, a: who, v })));
    const entry = { v, ts: new Date().toISOString(), name: who, kind: 'edit', base_v: baseV, segs: segsOf(objs), hunks };
    if (merged) entry.merged = true;
    entry.stats = this._stats(hunks);
    return this._append(entry);
  }

  revert(toV, note = 'admin') {
    const target = this.entry(toV), head = this.head;
    if (!target) throw new StoreError('bad_version', 'Unknown version.');
    if (textOf(target.segs) === textOf(head.segs) && JSON.stringify(target.segs) === JSON.stringify(head.segs))
      throw new StoreError('no_change', 'That is already the current version.');
    const { objs, hunks } = attribute(objsOf(head.segs), objsOf(target.segs), true);
    return this._append({ v: head.v + 1, ts: new Date().toISOString(), name: note, kind: 'revert', base_v: head.v, restored_v: toV, segs: segsOf(objs), hunks, stats: this._stats(hunks) });
  }

  _stats(hunks) {
    return { added_words: hunks.reduce((n, h) => n + wordCount(h.add), 0), removed_words: hunks.reduce((n, h) => n + wordCount(h.rm), 0) };
  }

  authors() {
    const order = [], seen = new Map();
    const touch = (name) => {
      const k = nameKey(name);
      if (!seen.has(k)) { const a = { name: this.canon.get(k) ?? name, key: k, idx: order.length, edits: 0, words: 0, first: null, last: null }; seen.set(k, a); order.push(a); }
      return seen.get(k);
    };
    for (const e of this.entries) {
      if (e.kind === 'revert') continue;
      const a = touch(e.name); if (e.kind === 'edit') a.edits++;
      a.first ??= e.ts; a.last = e.ts;
    }
    if (!this.empty) for (const [t, who] of this.head.segs) { if (who) touch(who).words += tokenize(t).filter(isWord).length; }
    return order;
  }

  state() {
    const h = this.head;
    return { v: h.v, ts: h.ts, name: h.name, kind: h.kind, segs: h.segs, authors: this.authors() };
  }

  versions() { return this.entries.map((e) => ({ v: e.v, ts: e.ts, name: e.name, kind: e.kind, restored_v: e.restored_v, stats: e.stats })).reverse(); }

  lineage(key) {
    const authors = this.authors(), who = authors.find((a) => a.key === key);
    if (!who) return null;
    const edits = [], lost = [];
    for (const e of this.entries) {
      if (e.kind === 'edit' && nameKey(e.name) === key) edits.push({ v: e.v, ts: e.ts, hunks: e.hunks });
      if (e.kind !== 'seed' && !(e.kind === 'edit' && nameKey(e.name) === key)) {
        for (const h of e.hunks) {
          const mine = h.rm.filter(([, a]) => nameKey(a) === key);
          if (mine.length) lost.push({ v: e.v, ts: e.ts, by: e.name, kind: e.kind, rm: mine, add: h.add });
        }
      }
    }
    return { author: who, segs: this.head.segs, edits, lost };
  }

  // A log shaped after the fields of seams-wire/0.1-draft `emit`. Not valid wire v0 (see note).
  export() {
    let prev = null;
    const entries = this.entries.map((e) => {
      const text = textOf(e.segs), hash = sha(text), out = {
        op: 'emit', kind: 'text', v: e.v, ts: e.ts, content_hash: hash, parents: prev ? [prev] : [],
        derivation: prev ? 'fork' : 'original',
        creator_ref: `name:${e.name}`, creator_verified: false,
        provenance: { origin: 'authored', entry_kind: e.kind, base_version: e.base_v, ...(e.merged && { merged: true }), ...(e.restored_v && { restored_version: e.restored_v }) },
        contributions: e.hunks.map((h) => ({ removed: h.rm.map(([t, a, v]) => ({ text: t, author: a, version: v })), added: h.add.map(([t, a, v]) => ({ text: t, author: a, version: v })) })),
        attribution: e.segs.map(([t, a, v]) => ({ text: t, author: a, version: v })),
        text,
      };
      prev = hash; return out;
    });
    return {
      format: 'seams-attribution-log/0-demo',
      note: 'Shaped after the fields of seams-wire/0.1-draft emit (kind, parents, derivation, creator_ref, provenance, use_terms). NOT valid wire v0: no keys or signatures, creator names are typed and unverified, hashes are sha256 of the UTF-8 text rather than the Seams deposit hash, and "text" is not in the wire kind vocabulary. Authorship is inferred by word diff against the previous version.',
      use_terms: { allowed_uses: ['view', 'fork', 'remix'], compensation: 'none', note: 'Anyone may change this; your name stays on your words.' },
      entries,
    };
  }
}
