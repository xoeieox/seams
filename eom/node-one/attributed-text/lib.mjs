// Core logic: tokenizing, diffing, authorship, the append-only log. No I/O except the log file.
// EoM build leg 2026-10-26 (branch eom-node-one): adds the ingest store path, the closed kind gate,
// a persisted hash chain with an anchor + salt (T5a tamper detection, no re-hash laundering),
// load-time quarantine instead of crash-on-boot, and deposit-hash-shaped export fields.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { NODE_KEY_ED25519_RE, verifyBodySig, fingerprintOf } from './keys.mjs';

export const MAX_TEXT = 8000;
export const MAX_NAME = 40;
export const WIRE_VERSION = 'seams-wire/0.3-draft';

// Closed kind gate (Erah ruling 2026-10-26, plan v2): the accept set is exactly {node-key, session-log}.
// Text/page payloads (the kit's export self-label and the page body) map to session-log AT THE GATE;
// no new wire kind is created. Unmapped unknown shapes - including a text payload carrying transport
// metadata (kind "text/html" or a `headers` field, the documented T3 "text-with-header" case) - are
// refused fail-closed with unknown_kind, never defaulted, never deposited.
export const GATE_KINDS = ['node-key', 'session-log'];
export const KIND_MAP = { text: 'session-log', page: 'session-log' };
const HEADERISH = /^(kind_?headers|headers|content[-_]type)$/i;
export function mapKind(kind, body = {}) {
  if (kind == null && (body.text != null || body.content_b64 != null)) return 'session-log'; // page payload
  if (typeof kind !== 'string') return null;
  const k = kind.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(body, 'headers') || HEADERISH.test(k)) return null; // documented refusal
  if (KIND_MAP[k]) return KIND_MAP[k];
  return GATE_KINDS.includes(k) ? k : null;
}

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
    for (let j = n - 1 >= 0 ? 0 : 0; j < m; j++)
      ;
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
export const canonical = (v) =>
  v === null || v === undefined || typeof v !== 'object' ? JSON.stringify(v ?? null)
    : Array.isArray(v) ? '[' + v.map(canonical).join(',') + ']'
      : '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';

// Deposit-hash shape, same rule the kit's Python stub uses: the deposit hash is the sha256 of the
// canonical envelope, NOT of the bare text. Still a placeholder algorithm pending the deposits-spec
// ruling - export says so honestly (T5a lesson: a hash that everything is recomputed from at serve
// time is decorative; here hashes are computed ONCE at append time, persisted, and verified at load).
export const depositHash = (env) => sha(canonical(env));
const chainHash = (salt, prev, payloadObj) => sha(salt + '|' + prev + '|' + canonical(payloadObj));

const ORIGIN_SET = new Set(['authored', 'assisted', 'played']);
const NODE_KEY_RE = /^key:[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$/i;
// KEYS demo (EOM-KEYS-2026-10-28): a ref key (name-only claim) OR a real Ed25519 key the
// gateway can verify. Base64 of 32 bytes is always 43 chars + one '=' pad.
const nodeKeyOk = (k) => NODE_KEY_RE.test(k) || NODE_KEY_ED25519_RE.test(k);
export { nodeKeyOk };
const PAGE_KINDS = new Set(['seed', 'edit', 'revert']);

export class Store {
  constructor(file = null) {
    this.file = file; this.entries = []; this.canon = new Map();
    this.receipts = new Map();          // payload_hash -> receipt (idempotence across restarts)
    this.nodes = new Map();             // node_key -> {first_seen, seen} (registry; no IPs, ever)
    this.contentIndex = new Map();      // content_hash -> first depositing node key (squat guard)
    this.quarantined = [];
    this.integrity = { ok: true, corrupt: [], tampered: [], anchorOk: true, legacy: false };
    if (file) fs.mkdirSync(path.dirname(file), { recursive: true });
    this.salt = this._loadSalt();
    if (file && fs.existsSync(file)) this._load(file);
    this._loadReceipts();
    this._loadNodes();
    for (const e of this.entries) if (e.kind === 'ingest' && e.content_hash) this.contentIndex.set(e.content_hash, e.name);
  }

  _dir() { return path.dirname(this.file); }
  _loadSalt() {
    if (!this.file) return crypto.randomBytes(16).toString('hex');
    const f = path.join(this._dir(), 'chain-salt');
    if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
    const s = crypto.randomBytes(16).toString('hex');
    fs.writeFileSync(f, s + '\n', { mode: 0o600 });
    return s;
  }

  _load(file) {
    let prevH = 'GENESIS', n = 0;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      n++; if (!line.trim()) continue;
      let e;
      try { e = JSON.parse(line); } catch { this._quarantine(n, line, 'corrupt_json'); continue; }
      if (!e || typeof e !== 'object' || typeof e.kind !== 'string' || !Array.isArray(e.segs)) {
        this._quarantine(n, line, 'bad_shape'); continue;
      }
      if (e.chain) {
        const { chain, ...payload } = e;
        const want = chainHash(this.salt, chain.prev, payload);
        if (chain.hash !== want || chain.prev !== prevH) { this.integrity.tampered.push(e.v ?? n); this.integrity.ok = false; }
        prevH = chain.hash;
      } else { e.v = this.entries.length + 1; this.integrity.legacy = true; }
      this.entries.push(e); this._note(e);
    }
    const a = this._readAnchor();
    if (a) {
      const head = this.entries[this.entries.length - 1];
      if (!head?.chain || a.hash !== head.chain.hash || a.n !== this.entries.length) {
        this.integrity.anchorOk = false; this.integrity.ok = false;
      }
    } else if (this.entries.length) {
      this._writeAnchor(this.entries[this.entries.length - 1]); // legacy bootstrap: anchor from now on
    }
  }

  _quarantine(lineNo, line, reason) {
    const rec = { line: lineNo, reason, raw: line, seen_at: new Date().toISOString() };
    this.quarantined.push(rec); this.integrity.corrupt.push(rec);
    if (this.file) {
      const qf = path.join(this._dir(), 'quarantine.jsonl');
      fs.appendFileSync(qf, JSON.stringify(rec) + '\n');
    }
  }

  _anchorFile() { return path.join(this._dir(), 'chain-anchor.json'); }
  _readAnchor() {
    if (!this.file) return null;
    try { return JSON.parse(fs.readFileSync(this._anchorFile(), 'utf8')); } catch { return null; }
  }
  _writeAnchor(e) {
    if (!this.file || !e?.chain) return;
    const f = this._anchorFile(), tmp = f + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ n: e.v, hash: e.chain.hash, updated: new Date().toISOString() }) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, f);
  }

  _note(e) { if (e.kind === 'edit' || e.kind === 'seed') { const k = nameKey(e.name); if (!this.canon.has(k)) this.canon.set(k, e.name); } }

  _append(e) {
    e.v = this.entries.length + 1;
    const prev = this.entries[this.entries.length - 1];
    const prevH = prev?.chain?.hash || 'GENESIS';
    const { chain, ...payload } = e;
    e.chain = { n: e.v, prev: prevH, hash: chainHash(this.salt, prevH, payload) };
    this.entries.push(e); this._note(e);
    if (this.file) { fs.appendFileSync(this.file, JSON.stringify(e) + '\n'); this._writeAnchor(e); }
    return e;
  }

  get head() { for (let i = this.entries.length - 1; i >= 0; i--) if (PAGE_KINDS.has(this.entries[i].kind)) return this.entries[i]; return undefined; }
  get empty() { return this.head === undefined; }
  entry(v) { const e = this.entries[v - 1]; return e && e.v === v && PAGE_KINDS.has(e.kind) ? e : undefined; }

  seed(text, name) {
    const who = normName(name) || 'Seed';
    const segs = [[cleanText(text), who, 1]];
    const e = { ts: new Date().toISOString(), name: who, kind: 'seed', base_v: 0, segs, hunks: [], stats: { added_words: wordCount(segs), removed_words: 0 } };
    this._stamp(e, textOf(segs), `name:${who}`, { origin: 'authored' });
    return this._append(e);
  }

  // Persist the wire-shaped hashes ONCE, at append time (the anti-decorative rule).
  _stamp(e, text, creatorRef, prov) {
    e.content_hash = sha(text);
    e.deposit_hash = depositHash({
      kind: 'session-log', content_hash: e.content_hash, parents: [],
      creator: creatorRef, derivation: 'original', provenance: prov,
    });
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
    const e = { ts: new Date().toISOString(), name: who, kind: 'edit', base_v: baseV, segs: segsOf(objs), hunks };
    if (merged) e.merged = true;
    e.stats = this._stats(hunks);
    this._stamp(e, textOf(e.segs), `name:${who}`, { origin: 'authored' });
    return this._append(e);
  }

  revert(toV, note = 'admin') {
    const target = this.entry(toV), head = this.head;
    if (!target) throw new StoreError('bad_version', 'Unknown version.');
    if (textOf(target.segs) === textOf(head.segs) && JSON.stringify(target.segs) === JSON.stringify(head.segs))
      throw new StoreError('no_change', 'That is already the current version.');
    const { objs, hunks } = attribute(objsOf(head.segs), objsOf(target.segs), true);
    const e = { ts: new Date().toISOString(), name: note, kind: 'revert', base_v: head.v, restored_v: toV, segs: segsOf(objs), hunks, stats: this._stats(hunks) };
    this._stamp(e, textOf(e.segs), `name:${note}`, { origin: 'authored' });
    return this._append(e);
  }

  // Ingest path: a node's outgoing emit, arriving as a wire-shaped body. Fail-closed everywhere:
  // op must be emit; the kind must pass the closed gate; the node key must be well-formed; content
  // bounds apply before anything is stored; idempotence is keyed on the payload hash (canonicalized
  // body), so a replay is acked with the original receipt and grows nothing.
  ingest(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new StoreError('bad_json', 'A request is a JSON object.');
    if (body.op !== 'emit') throw new StoreError('unknown_op', `op must be "emit", got ${JSON.stringify(body.op ?? null)}.`);
    const payloadHash = sha(canonical(body));
    const seen = this.receipts.get(payloadHash);
    if (seen) return { ...seen, duplicate: true };
    const nodeKey = typeof body.node_key === 'string' ? body.node_key.trim() : '';
    if (!nodeKeyOk(nodeKey)) throw new StoreError('bad_node_key', 'node_key must look like key:<ref> (3-64 chars, letters digits . _ -) or key:ed25519:<base64 public key>.');
    const kind = mapKind(body.kind ?? null, body);
    if (!kind) throw new StoreError('unknown_kind', `kind gate closed: accept {${GATE_KINDS.join(', ')}} (text/page map to session-log).`);
    const derivation = body.derivation ?? 'original';
    if (derivation !== 'original') throw new StoreError('consent_gate_unbuilt', 'fork/remix emit is refused on this node until the consent layer exists - fail closed.');
    if (Array.isArray(body.parents) && body.parents.length) throw new StoreError('parents_on_original', 'an original has no parents; fork/remix is refused here (consent_gate_unbuilt).');
    const origin = body.provenance?.origin ?? 'authored';
    if (!ORIGIN_SET.has(origin)) throw new StoreError('bad_origin', 'provenance.origin must be one of authored|assisted|played.');
    // KEYS demo (REQ-SIGN, pinned in eom/endpoint-surface/requirements.yaml): a body carrying
    // `sig` is verified at the GATE, before anything is stored. The signature must verify under
    // the key EMBEDDED IN node_key itself, over the canonical body minus sig. A present-but-bad
    // sig is a gate refusal (bad_signature) - nothing deposits, nothing quarantines: quarantine
    // is for a corrupted log, not for someone else's bad signature. Absence of sig stays legal:
    // that deposit is a name-only claim and export says so (creator_verified false).
    const hasSig = body.sig !== undefined && body.sig !== null;
    let keyVerified = false;
    if (hasSig) {
      if (!NODE_KEY_ED25519_RE.test(nodeKey)) throw new StoreError('bad_signature', 'a signed emit needs a key:ed25519:<base64> node_key - there is no key to check that signature against. Nothing was deposited.');
      if (!verifyBodySig(nodeKey, body)) throw new StoreError('bad_signature', 'signature does not verify against node_key over the canonical body (REQ-SIGN-1). Nothing was deposited.');
      keyVerified = true;
    }
    let text;
    if (kind === 'node-key') {   // a node-key announce carries no content; text is not required here
      const who = normName(body.provenance?.attributed_to?.name ?? '') || normName(body.node_key) || nodeKey;
      if (!this.nodes.has(nodeKey)) this.nodes.set(nodeKey, { first_seen: new Date().toISOString(), seen: 0 });
      const rec = this.nodes.get(nodeKey); rec.seen++; rec.who = who;
      // Registration verification (REQ-SIGN-3): a self-signed node-key announce (sig over the
      // canonical body, checked against the key embedded in node_key) marks the registry entry
      // verified; verified is monotone - a later unsigned announce never un-verifies a key that
      // already proved control of its private half.
      rec.verified = !!rec.verified || keyVerified;
      const receipt = { status: 'deposited', kind, receipt: 'rcpt:' + sha(payloadHash).slice(7, 23), id: body.id ?? null, payload_hash: payloadHash, node_key: nodeKey, verified: !!rec.verified, ...(fingerprintOf(nodeKey) ? { node_key_fingerprint: fingerprintOf(nodeKey) } : {}), ts: new Date().toISOString(), duplicate: false };
      this.receipts.set(payloadHash, receipt);
      this._persistReceipt(receipt);
      if (this.file) fs.appendFileSync(path.join(this._dir(), 'nodes.jsonl'), JSON.stringify({ node_key: nodeKey, who, first_seen: rec.first_seen, seen: rec.seen, verified: !!rec.verified, ts: receipt.ts }) + '\n');
      return receipt;
    }

    if (body.content_b64 != null) {
      if (typeof body.content_b64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.content_b64))
        throw new StoreError('bad_content', 'content_b64 is not valid base64.');
      text = cleanText(Buffer.from(body.content_b64, 'base64').toString('utf8'));
    } else if (body.text != null) text = cleanText(body.text);
    else throw new StoreError('bad_request', 'need text or content_b64.');
    if (!text.trim()) throw new StoreError('empty', 'The text cannot be empty.');
    if (text.length > MAX_TEXT) throw new StoreError('too_long', `Keep it under ${MAX_TEXT} characters.`);
    const preHash = sha(text);
    const prior = this.contentIndex.get(preHash);
    if (prior && prior !== nodeKey) throw new StoreError('already_deposited', 'these bytes are already deposited by another key; identity squatting does not take the work.');
    const v0 = this.entries.length + 1;
    const segs = [[text, nodeKey, v0]];
    const e = {
      ts: new Date().toISOString(), name: nodeKey, kind: 'ingest', ingested_from: nodeKey,
      base_v: this.head?.v ?? 0, segs, hunks: [], payload_hash: payloadHash,
      // REQ-SIGN-4 (verified-only-on-truth): creator_verified is true iff the gateway verified
      // this body's signature at ingest AND the key was registered in the registry (announce
      // first, then emit - the rule pinned in requirements.yaml). Everything else, signed-but-
      // unregistered included, stays a claim: key_verified false.
      key_verified: keyVerified && this.nodes.has(nodeKey),
      ...(hasSig ? { sig: String(body.sig) } : {}),
      provenance: { origin: 'ingested', declared_origin: origin, via: 'ingest' },
    };
    this._stamp(e, text, nodeKey, { origin: 'ingested', declared_origin: origin });
    this._append(e);
    const receipt = { status: 'deposited', kind, receipt: 'rcpt:' + sha(payloadHash).slice(7, 23), id: body.id ?? null, payload_hash: payloadHash, content_hash: e.content_hash, deposit_hash: e.deposit_hash, v: e.v, creator_verified: e.key_verified, ...(fingerprintOf(nodeKey) ? { node_key_fingerprint: fingerprintOf(nodeKey) } : {}), ts: e.ts, duplicate: false };
    this.receipts.set(payloadHash, receipt);
    this._persistReceipt(receipt);
    this.contentIndex.set(preHash, nodeKey);
    return receipt;
  }

  _loadReceipts() {
    for (const e of this.entries) if (e.kind === 'ingest' && e.payload_hash && !this.receipts.has(e.payload_hash)) this.receipts.set(e.payload_hash, { status: 'deposited', kind: 'session-log', receipt: 'rcpt:' + sha(e.payload_hash).slice(7, 23), payload_hash: e.payload_hash, content_hash: e.content_hash, v: e.v, ts: e.ts, duplicate: false });
    if (!this.file) return;
    const f = path.join(this._dir(), 'receipts.jsonl');   // authoritative receipts: replays ack the ORIGINAL receipt, byte-identical, across restarts
    if (!fs.existsSync(f)) return;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { const r = JSON.parse(line); if (r.payload_hash) this.receipts.set(r.payload_hash, { ...r, duplicate: false }); } catch { /* skip bad receipt lines */ }
    }
  }
  _persistReceipt(r) { if (this.file) fs.appendFileSync(path.join(this._dir(), 'receipts.jsonl'), JSON.stringify(r) + '\n'); }
  _loadNodes() {
    if (!this.file) return;
    const f = path.join(this._dir(), 'nodes.jsonl');
    if (!fs.existsSync(f)) return;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { const r = JSON.parse(line); this.nodes.set(r.node_key, { first_seen: r.first_seen, seen: r.seen, who: r.who, verified: !!r.verified }); } catch { /* skip bad registry lines */ }
    }
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
      if (!PAGE_KINDS.has(e.kind)) continue;
      const a = touch(e.name); if (e.kind === 'edit') a.edits++;
      a.first ??= e.ts; a.last = e.ts;
    }
    if (!this.empty) for (const [t, who] of this.head.segs) { if (who && !String(who).startsWith('key:')) touch(who).words += tokenize(t).filter(isWord).length; }
    return order;
  }

  state() {
    const h = this.head;
    const s = { v: h.v, ts: h.ts, name: h.name, kind: h.kind, segs: h.segs, authors: this.authors() };
    if (!this.integrity.ok) s.integrity = { ok: false, suspect: true, tampered: this.integrity.tampered, corrupt_lines: this.integrity.corrupt.length };
    return s;
  }

  versions() { return this.entries.filter((e) => PAGE_KINDS.has(e.kind)).map((e) => ({ v: e.v, ts: e.ts, name: e.name, kind: e.kind, restored_v: e.restored_v, stats: e.stats })).reverse(); }

  lineage(key) {
    const authors = this.authors(), who = authors.find((a) => a.key === key);
    if (!who) return null;
    const edits = [], lost = [];
    for (const e of this.entries) {
      if (!PAGE_KINDS.has(e.kind)) continue;
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

  // A log shaped after the fields of seams-wire/0.3-draft `emit`, with the build-leg fixes:
  // kind vocabulary enforced (session-log; "text" is not a wire kind), NO self-fork parents
  // (a version chain is not a derivation - parents are [] and the chain lives in `chain`),
  // content_hash/deposit_hash computed once at append and persisted (verified at load - a
  // tampered log fails closed, it is never silently re-hashed), and ingest provenance on
  // entries that arrived through the ingest gate.
  export() {
    if (!this.integrity.ok)
      throw new StoreError('log_integrity', 'This log failed its integrity check; export refuses to serve until an operator reviews the quarantine.',
        { tampered: this.integrity.tampered, corrupt_lines: this.integrity.corrupt.length, anchor_ok: this.integrity.anchorOk });
    let prev = null;
    const entries = this.entries.map((e) => {
      const text = textOf(e.segs);
      const isKey = String(e.name).startsWith('key:');
      const ingested = e.kind === 'ingest';
      const fp = fingerprintOf(e.name);
      const out = {
        op: 'emit', kind: 'session-log', v: e.v, ts: e.ts, content_hash: e.content_hash,
        deposit_hash: e.deposit_hash, parents: [], derivation: 'original',
        creator_ref: isKey ? e.name : `name:${e.name}`,
        // KEYS demo (0-eom.2): true ONLY for an ingest entry the gateway signature-checked at
        // ingest (REQ-SIGN-4). A typed name - and any ingest without a verified signature - is
        // a claim and says so: creator_verified false, no badge.
        creator_verified: e.key_verified === true,
        node_key_fingerprint: fp,
        provenance: { origin: ingested ? 'ingested' : 'authored', entry_kind: e.kind, base_version: e.base_v,
          ...(e.provenance?.declared_origin && { declared_origin: e.provenance.declared_origin }),
          ...(e.merged && { merged: true }), ...(e.restored_v && { restored_version: e.restored_v }),
          ...(ingested && { via: 'ingest', payload_hash: e.payload_hash }) },
        contributions: (e.hunks || []).map((h) => ({ removed: h.rm.map(([t, a, v]) => ({ text: t, author: a, version: v })), added: h.add.map(([t, a, v]) => ({ text: t, author: a, version: v })) })),
        attribution: e.segs.map(([t, a, v]) => ({ text: t, author: a, version: v })),
        text,
        chain: e.chain ? { n: e.chain.n, hash: e.chain.hash, prev: e.chain.prev } : null,
      };
      prev = e.chain?.hash ?? null; return out;
    });
    return {
      format: 'seams-attribution-log/0-eom.2',
      wire: WIRE_VERSION,
      note: 'Shaped after the fields of seams-wire/0.3-draft emit (kind, parents, derivation, creator_ref, provenance, use_terms), with the build-leg wire-semantics fixes: kind vocabulary enforced (entries are session-log; text/page payloads were mapped at the closed gate, no new wire kind), a version chain is NOT a derivation (parents stay [] and the log chain is carried separately in `chain`), content_hash/deposit_hash are computed once at append time and verified at load - a tampered log makes export refuse, it never silently re-hashes. Hashes remain opaque placeholders until the deposits-spec ruling lands. KEYS pass (0-eom.2, EOM-KEYS-2026-10-28): signing is live - creator_verified true means the gateway verified an Ed25519 signature over the canonical body (REQ-SIGN rules, pinned in eom/endpoint-surface/requirements.yaml) against the key embedded in node_key, at ingest time, for a registered key; a typed or unsigned node_key is a claim and stays creator_verified false. node_key_fingerprint is the first 8 chars of the base64 public half. A bad signature is refused at the gate (bad_signature), never deposited, never quarantined. This adds fields; it removes none - the 0-eom.1 readers keep working.',
      integrity: { ok: true, tampered: [], corrupt_lines: this.integrity.corrupt.length, anchor_ok: this.integrity.anchorOk, legacy_bootstrap: this.integrity.legacy },
      nodes: [...this.nodes.entries()].map(([node_key, r]) => ({ node_key, who: r.who ?? null, first_seen: r.first_seen, seen: r.seen, verified: !!r.verified, node_key_fingerprint: fingerprintOf(node_key) })),
      use_terms: { allowed_uses: ['view', 'fork', 'remix'], compensation: 'none', note: 'Anyone may change this; your name stays on your words.' },
      entries,
    };
  }
}
