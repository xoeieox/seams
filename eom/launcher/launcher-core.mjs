// seams-launcher core: pure logic, zero deps, importable by the browser (module) and by tests (node).
// EoM build leg 2026-10-26 (branch eom-node-one). The launcher is the minimal human client of the
// Seams protocol: a tall corner window (design direction 2a), Manage + Agent modes, no chat surface.
// Honesty rule, enforced HERE: every claim row carries a tag - 'verified' only when a machine check
// passed this session, 'asserted' for everything the server or an agent merely says. The UI never
// gets a claim string without one.
//
// The rails the launcher pins (verified 2026-10-26 against eom/node-one, branch eom-node-one):
export const WIRE_PIN = 'seams-wire/0.3-draft';
export const FORMAT_PIN = 'seams-attribution-log/0-eom.2'; // bumped with the KEYS pass (EOM-KEYS-2026-10-28): the same-commit rule - the pin moves only when the code that emits that format ships
export const GATE_EXPECT = ['node-key', 'session-log']; // closed set; text/page map AT the gate
export const MAX_TEXT = 8000;

// The contract refusal table (docs/seams-launcher-spec.md). The launcher shows the NAME the server
// returns VERBATIM; this table only supplies the code and the plain-language line. consent_gate_unbuilt
// is rendered built-later (501), never as broken - per the ruling.
export const REFUSALS = {
  unknown_op: { code: 400, plain: 'Only op "emit" rides the join gate.' },
  bad_node_key: { code: 400, plain: 'node_key must look like key:<ref>, letters, digits, dot, dash, underscore.' },
  unknown_kind: { code: 400, plain: 'The kind gate is closed to {node-key, session-log}; text and page map to session-log at the gate; everything else refuses, nothing is defaulted.' },
  consent_gate_unbuilt: { code: 501, plain: 'Fork and remix are not wired until the consent layer exists. This is built-later, not broken.', builtLater: true },
  parents_on_original: { code: 400, plain: 'An original has no parents; a version chain is not a derivation.' },
  bad_origin: { code: 400, plain: 'provenance.origin must be authored, assisted or played.' },
  already_deposited: { code: 409, plain: 'These bytes are already deposited under another key. Identity squatting is never re-attributed.' },
  empty: { code: 400, plain: 'The deposit is empty after cleaning.' },
  too_long: { code: 413, plain: 'Over 8000 characters.' },
  too_big: { code: 413, plain: 'Body over 64 KB.' },
  bad_content: { code: 400, plain: 'content_b64 is not valid base64.' },
};

export const PARTS = [
  { id: 'identity' }, { id: 'keeper' }, { id: 'persona' }, { id: 'expert-service' },
  { id: 'shared-corpus' }, { id: 'lapis-pm', optional: true }, { id: 'governance' },
];
export const CH = { none: 'none', different: 'different', one: 'one-to-one', skip: 'skipped' };
export const NEXT = { none: 'Grow from seed', different: 'Align', one: 'Route' };
export const STEPS = [
  { t: 'Rails', d: 'see what the server accepts before you send', opens: 'hello' },
  { t: 'Keys', d: 'mint the node key that identifies this node', opens: 'keys' },
  { t: 'Agent', d: 'where your agent picks up work', opens: 'agent-route' },
  { t: 'Config', d: 'paths and accepted deviations', opens: 'config' },
  { t: 'Parts', d: 'what you have, what to grow', opens: 'parts' },
  { t: 'Conform', d: 'check, see gaps', opens: 'conform' },
  { t: 'Hello world', d: 'first deposit + baseline', opens: 'hello' },
];

// ---------------- hello handshake: pins and rails ----------------
// The launcher PINS the wire version and refuses to speak past a skew (REQ-HELLO-1). The gate and
// integrity state come from the SAME hello so a joining node sees the rails before it emits
// (REQ-HELLO-2/4). A missing/failed hello leaves everything 'unconfirmed' - the launcher claims
// nothing it has not seen this session.
export function helloGate(hello, pin = WIRE_PIN) {
  if (!hello || typeof hello !== 'object') return { ran: false };
  const echo = typeof hello.wire === 'string' ? hello.wire : null;
  const pinned = echo === pin;
  const kinds = Array.isArray(hello.gate?.kinds) ? [...hello.gate.kinds].sort() : null;
  const gateOk = !!kinds && JSON.stringify(kinds) === JSON.stringify([...GATE_EXPECT].sort());
  const integrityRaw = typeof hello.integrity === 'string' ? hello.integrity : null;
  return {
    ran: true, echo, pinned, skew: !pinned,
    gateKinds: kinds, gateOk,
    integrity: integrityRaw && /QUARANTINED/i.test(integrityRaw) ? 'QUARANTINED' : 'ok',
    integrityRaw,
    format: hello.format ?? null, formatOk: hello.format === FORMAT_PIN,
  };
}

// ---------------- emit holds (launcher-side, BEFORE any request leaves) ----------------
// Mirrors the design: the launcher refuses to send into a corrupted log or before the rails are
// confirmed. These are named 'held by launcher' and marked NOT a server refusal - the server never
// saw the request. Order: quarantine, skew, no-hello.
export function canEmit({ rail, quarantined }) {
  if (quarantined) return { allow: false, hold: { name: 'held by launcher', msg: "The log is quarantined. The launcher won't send into a corrupted log.", foot: 'Not a server refusal. Nothing was sent.' } };
  if (!rail || !rail.ran) return { allow: false, hold: { name: 'held by launcher', msg: 'Say hello first, so the wire and gate are confirmed before sending.', foot: 'Not a server refusal. Nothing was sent.' } };
  if (rail.skew) return { allow: false, hold: { name: 'held by launcher', msg: `The server speaks ${JSON.stringify(rail.echo)}; this launcher pins ${JSON.stringify(WIRE_PIN)}. Refusing to speak past the version skew.`, foot: 'Not a server refusal. Nothing was sent.' } };
  if (!rail.gateOk) return { allow: false, hold: { name: 'held by launcher', msg: `The advertised gate is not the closed {${GATE_EXPECT.join(', ')}} set. Nothing is emitted against rails the launcher cannot vouch for.`, foot: 'Not a server refusal. Nothing was sent.' } };
  return { allow: true };
}

// A server refusal (it answered and said no) is rendered VERBATIM: the error name as the server
// returned it, the code from the contract table, the server's own message as the plain explanation
// (falling back to the table text only when the server gave none). consent_gate_unbuilt shows
// built-later, never broken.
export function renderRefusal(body, status) {
  const name = typeof body?.error === 'string' ? body.error : 'server_error';
  const t = REFUSALS[name];
  return {
    name,
    code: t?.code ?? status ?? null,
    plain: (typeof body?.message === 'string' && body.message) || t?.plain || 'The server refused the request.',
    builtLater: !!t?.builtLater,
    verbatim: true,
    foot: 'Refusals don’t count against your rate budget.',
  };
}

// ---------------- honesty rule ----------------
// A claim row is either machinery-verified (this session's check passed) or asserted (server or
// agent says so). There is NO third state and no claim renders without its tag.
export function claim(text, verified, note) {
  return { text, tag: verified ? 'verified' : 'asserted', ...(note ? { note } : {}) };
}

// ---------------- the hello-world replay proof ----------------
// All three rows are machine checks over real responses (scripts/send-hello.mjs made human):
// duplicate acked true, receipt byte-identical to the original (deep-equal, `duplicate` aside),
// and the export log length unchanged across the replay.
export function replayProof(first, second, nBefore, nAfter) {
  const strip = (r) => { const { duplicate, ...rest } = r || {}; return rest; };
  return {
    duplicate: second?.duplicate === true,
    identical: JSON.stringify(strip(first)) === JSON.stringify(strip(second)) && !!second,
    logUnchanged: Number.isFinite(nBefore) && nBefore === nAfter,
  };
}

// ---------------- declarations (ops/declarations.yaml) ----------------
// A declaration is an accepted deviation with a revisit date. Expired means revisit < today -
// they re-escalate by themselves; the computation is a date compare, so an expired card may carry
// a verified tag for the expiry itself.
export function parseDeclarations(text) {
  const out = [];
  let cur = null;
  for (const line of String(text ?? '').split('\n')) {
    const m = line.match(/^\s*-\s*id:\s*(.+)$/);
    if (m) { cur = { id: m[1].trim(), note: '', revisit: '' }; out.push(cur); continue; }
    if (!cur) continue;
    const k = line.match(/^\s+(note|revisit):\s*(.*)$/);
    if (k) cur[k[1]] = k[2].trim();
  }
  return out;
}
export function renderDeclarations(list) {
  return '# ops/declarations.yaml - accepted deviations, revisit YYYY-MM-DD (expired items re-escalate)\n'
    + (list.length ? list.map((d) => `- id: ${d.id}\n  note: ${d.note || ''}\n  revisit: ${d.revisit || ''}`).join('\n') : '# (none)')
    + '\n';
}
export const isExpired = (d, today) => !!d.revisit && d.revisit < today;
export const expiredDecls = (list, today) => list.filter((d) => isExpired(d, today));

// ---------------- ops/node.yaml (paths and env map) ----------------
export function parseNodeYaml(text) {
  const out = []; let cur = null;
  for (const line of String(text ?? '').split('\n')) {
    const m = line.match(/^\s*-\s*path:\s*(.+)$/);
    if (m) { cur = { k: m[1].trim(), v: '' }; out.push(cur); continue; }
    if (!cur) continue;
    const e = line.match(/^\s+env:\s*(.*)$/);
    if (e) cur.v = e[1].trim();
  }
  return out;
}
export function renderNodeYaml(pairs) {
  return '# ops/node.yaml - what this node points at and where it stores truth\n'
    + '# values come from the server this launcher is wired to; edit to repoint (local/loopback only)\n'
    + (pairs.length ? pairs.map((p) => `- path: ${p.k}\n  env: ${p.v || ''}`).join('\n') : '# (none)')
    + '\n';
}
export const NODE_YAML_DEFAULT =
  '# ops/node.yaml - what this node points at and where it stores truth\n'
  + '# values come from the server this launcher is wired to; edit to repoint (local/loopback only)\n'
  + '- path: server_url\n  env: SEAMS_URL\n'
  + '- path: log_path\n  env: SEAMS_LOG\n'
  + '- path: registry_path\n  env: SEAMS_REGISTRY\n'
  + '- path: quarantine_path\n  env: SEAMS_QUARANTINE\n';

// ---------------- the agent outbox packet (Route 1, the decided shape) ----------------
// NOT a chat surface. The launcher builds markdown tasks and leaves them where the agent's
// heartbeat looks. Reply-watcher output is ALWAYS asserted - only a fresh conform run turns an
// item verified, and the launcher never says otherwise.
export function packetMd(goal, items, base = 0) {
  return '# seams tasks\n\n'
    + 'goal: ' + (goal || '—') + '\n\n'
    + items.map((q, i) =>
      `## T-${String(base + i + 1).padStart(3, '0')} ${q.title}\n- source: ${q.source}\n- evidence: ${q.evidence}\n- status: open`
    ).join('\n\n') + '\n';
}
// Next free T- id in an existing outbox (append, never renumber - the agent may already be reading it).
export function nextTaskSeq(text) {
  let max = -1;
  for (const m of String(text ?? '').matchAll(/## T-(\d{3,})\b/g)) max = Math.max(max, Number(m[1]));
  return max + 1;
}
// ---------------- self-contained hand-off briefs (Mac run #4 doctrine, 2026-10-27) ----------------
// Erah Q-for-agent'd 7 Parts items with NO goal and the agent got bare titles - 'not enough
// information to know what to do'. Seed doctrine: the agent's brain lives in the packet docs, so
// every open entry carries its own brief: a one-line goal, machine-readable pointers into the
// unpacked packet, an acceptance check (read a file / curl a loopback port), and the honest-label
// footer. The launcher COMPOSES the brief from queue-time tab context (source + title + evidence)
// when the human types nothing; a typed goal wins; a human may override each field per item. No
// goal AND nothing derivable = readable refusal (400 unbriefed_task) - no silent open tasks.
// Append-only: entries written before this doctrine stay open, unedited, brief-less; readers
// work them from README.md + AGENTS.md as before.
export const BRIEF_HONESTY = 'asset-asserted only - the launcher composed this brief from queue-time tab context and verified NOTHING; agent replies are asserted, and only a fresh conform run turns anything verified';
const DOOR = ['README.md', 'AGENTS.md'];
const NODE_DOCS = ['node-one/attributed-text/README.md'];
const NODE_SRC = ['node-one/attributed-text/server.mjs', 'node-one/attributed-text/seed.json'];
const HANDOFF_DOC = ['design-handoff-2026-10-26/docs/agent-handoff-open-questions.md'];
const SPEC_DOC = ['design-handoff-2026-10-26/docs/seams-launcher-spec.md'];

// Pure: composes { goal, pointers[], accept } or returns null = unbriefable (no goal, no context).
// Human brief overrides (per field) win over composition. pointers stay packet-relative.
export function composeBrief(item, packetGoal = '') {
  const t = String(item?.title ?? '').trim();
  const ev = String(item?.evidence ?? '').trim();
  const src = String(item?.source ?? '').trim();
  const human = item?.brief && typeof item.brief === 'object' ? item.brief : null;
  const humanGoal = String(packetGoal || '').trim() || String(human?.goal ?? '').trim();
  let a = null;
  const pm = t.match(/^triage\s+([a-z][a-z0-9-]{1,30})\b/i);
  if (pm && (!src || /parts/i.test(src))) {
    const id = pm[1].toLowerCase();
    a = {
      goal: `triage '${id}' in the Parts tab: pick none / different / one-to-one / skipped; if growing it, seed from node-one and save ops/parts.json`,
      pointers: [...DOOR, ...NODE_DOCS, 'node-one/attributed-text/seed.json'],
      accept: `ops/parts.json lists '${id}' triaged (not missing, not none) and a fresh conform run on the launcher (http://127.0.0.1:4173) shows no gap for '${id}'`,
    };
  } else if (/^parts$/i.test(src)) {
    a = { goal: `${t}${ev ? ' - ' + ev : ''} (Parts tab: pick the decision and save ops/parts.json)`, pointers: [...DOOR, ...NODE_DOCS], accept: `read ops/parts.json, then a fresh conform run on the launcher (http://127.0.0.1:4173): the Parts gap is gone` };
  } else if (/^(integrity|quarantine)$/i.test(src)) {
    a = { goal: `clear node-one's QUARANTINED log integrity so hello reports clean and export answers 200: ${ev || 'log integrity broken'}`, pointers: [...DOOR, ...NODE_DOCS, ...NODE_SRC], accept: `curl http://127.0.0.1:8080/api/hello no longer reports QUARANTINED and curl http://127.0.0.1:8080/api/export returns 200` };
  } else if (/^conform$/i.test(src)) {
    a = { goal: `close the conform gap '${t}': ${ev || 'see the gap grow_ref in the Conform tab'}`, pointers: [...DOOR, ...SPEC_DOC], accept: `fresh conform run on the launcher (http://127.0.0.1:4173): the gap '${t}' is gone` };
  } else if (/^route$/i.test(src)) {
    a = { goal: 'prove the hand-off route end-to-end: read this entry out of ops/agent-queue.md and leave an ack line in ops/agent-replies.md', pointers: [...DOOR, ...HANDOFF_DOC], accept: `grep '^ack ' ops/agent-replies.md lists an ack line for this entry's T- id (the ack is asserted, never auto-verified)` };
  } else if (ev) {
    a = { goal: `${t}: ${ev}`.slice(0, 200), pointers: [...DOOR], accept: 'read the files named in this entry (they exist in the packet): the described work is visible there; an ack line lands in ops/agent-replies.md' };
  }
  if (!a && !humanGoal) return null; // blank goal + no queue-time tab context -> the server refuses readably
  const base = a || { pointers: [...DOOR], accept: 'read ops/agent-replies.md for an ack line for this entry; the launcher marks every ack asserted, never verified' };
  const pointers = (Array.isArray(human?.pointers) && human.pointers.length ? human.pointers : base.pointers)
    .slice(0, 8).map((x) => String(x).trim()).filter(Boolean);
  const goal = humanGoal || base.goal || t;
  const accept = String(human?.accept ?? '').trim() || base.accept || goal;
  return { goal, pointers, accept };
}

// Pointer lint: paths must stay packet-relative (no absolute, no '..' hops) and must exist on
// disk under the packet, probed bundle-first then repo-sibling - the launch.mjs layout doctrine
// (a bundle has node-one/ inside; the repo keeps it a sibling). Returns the offenders ([] = clean).
export function lintPointers(pointers, existsAny) {
  const bad = [];
  for (const raw of Array.isArray(pointers) ? pointers : []) {
    const p = String(raw).replace(/\\/g, '/').replace(/^\.\/*/g, '').trim();
    if (!p || p.startsWith('/') || p.split('/').includes('..')) { bad.push(String(raw) + ' (shape)'); continue; }
    if (!existsAny([p, '../' + p])) bad.push(p);
  }
  return bad;
}

export function appendPacket(existing, goal, items) {
  const body = existing && existing.trim() ? existing.replace(/\s*$/, '\n\n') : '# seams tasks\n';
  const base = nextTaskSeq(existing);
  const block = (goal ? '\ngoal: ' + goal + '\n\n' : '\n')
    + items.map((q, i) =>
      `## T-${String(base + i).padStart(3, '0')} ${q.title}\n- source: ${q.source}\n- evidence: ${q.evidence}\n- status: open`
      + (q.brief
        ? `\n- brief-goal: ${q.brief.goal}\n- brief-pointers: ${q.brief.pointers.join(', ')}\n- brief-accept: ${q.brief.accept}\n- honesty: ${BRIEF_HONESTY}`
        : '')
    ).join('\n\n') + '\n';
  return { text: body + block, tids: items.map((_, i) => 'T-' + String(base + i).padStart(3, '0')) };
}

// Read the outbox back (the server confirms a write by reading the file and pairing tids).
// Brief fields read back too; pre-doctrine (brief-less) entries parse with null brief fields -
// append-only, they stay open and untouched.
export function parseQueueTasks(text) {
  const rows = [];
  const src = String(text ?? '');
  const heads = [...src.matchAll(/^## (T-\d{3,}) (.+)$/gm)];
  for (let i = 0; i < heads.length; i++) {
    const m = heads[i];
    const start = m.index + m[0].length;
    // clamp each entry's field window to the NEXT header (or 700 chars at the tail) - a short
    // legacy entry must never borrow the next entry's brief lines (caught by local unit smoke)
    const end = i + 1 < heads.length ? heads[i + 1].index : Math.min(src.length, start + 700);
    const tail = src.slice(start, end);
    const line = (re) => (tail.match(re) || [])[1]?.trim();
    rows.push({
      tid: m[1], title: m[2].trim(),
      source: line(/^- source:\s*(.+)$/m) || '',
      status: line(/^- status:\s*(.+)$/m) || 'open',
      briefGoal: line(/^- brief-goal:\s*(.+)$/m) || null,
      briefPointers: (line(/^- brief-pointers:\s*(.+)$/m) || '').split(',').map((s) => s.trim()).filter(Boolean).length
        ? line(/^- brief-pointers:\s*(.+)$/m).split(',').map((s) => s.trim()).filter(Boolean) : null,
      briefAccept: line(/^- brief-accept:\s*(.+)$/m) || null,
      briefHonesty: line(/^- honesty:\s*(.+)$/m) || null,
    });
  }
  return rows;
}

// ---------------- the reply watcher (stub) ----------------
// Reads ops/agent-replies.md lines of the form `ack T-000 — result` (also `- ack T-000: result`).
// EVERY entry comes back honesty:'asserted', including its tid pairing - the launcher cannot
// confirm an agent did anything. This function hard-codes the rule so no path can mark a reply
// verified; the UI renders replyRows() with the tag structurally attached.
export function parseReplies(text) {
  const rows = [];
  for (const line of String(text ?? '').split('\n')) {
    const m = line.match(/^\s*(?:[-*]\s*)?ack\s+(T-\d{3,})\b[:—\s-]*(.*)$/i);
    if (m) rows.push({ tid: m[1], text: (m[2] || '').trim() || '(no detail)', honesty: 'asserted', source: 'ops/agent-replies.md' });
  }
  return rows;
}
// W2 (EOM-E2E-BATTLE-2026-10-29): the reply watcher is real. It reads agent-replies.md from a
// PERSISTED cursor {offset, prefix_sha} (byte offset + hash of every byte before it), so a restart
// resumes exactly where it stopped: replies appended during the gap come back once, nothing already
// delivered comes back again. Only COMPLETE lines (newline-terminated) are consumed, so a half-written
// ack is left for the next poll instead of being parsed short. If the bytes before the cursor changed
// (file truncated, rotated or rewritten) the prefix hash no longer matches: the watcher reports
// reset:true and re-reads from 0 - never silently skips and never trusts a stale offset.
// `hash` is injected (node:crypto lives server-side; this module is also served to the browser).
// Every entry stays honesty:'asserted' (parseReplies pins it): a line in a file never verifies work.
export function watchReplies(text, cursor, hash) {
  const buf = new TextEncoder().encode(String(text ?? ''));
  let off = 0; let reset = false;
  const want = cursor && Number.isInteger(cursor.offset) && cursor.offset > 0 ? cursor : null;
  if (want) {
    if (want.offset <= buf.length && hash(buf.subarray(0, want.offset)) === want.prefix_sha) off = want.offset; else reset = true;
  }
  const tail = buf.subarray(off);
  const nl = tail.lastIndexOf(10);
  const used = nl < 0 ? 0 : nl + 1;
  const end = off + used;
  const entries = parseReplies(new TextDecoder().decode(tail.subarray(0, used)));
  return { entries, cursor: { offset: end, prefix_sha: hash(buf.subarray(0, end)) }, reset, pending_partial: tail.length - used };
}

// W3 (EOM-E2E-BATTLE-2026-10-29): the consent envelope. SHAPE CONTRACT ONLY. The deposits-spec ruling
// (what a work hash IS, what a consent record binds) is still open, so `work` is an opaque
// sha256:<64 hex> placeholder exactly like every other hash in this surface, and nothing here claims
// the gateway will accept it: the launcher builds, validates and signs the envelope and sends it
// through the same wire-pinned posture as emit; the node answers (today: consent_gate_unbuilt 501) and
// that answer is shown verbatim. The grant vocabulary is the one node-one already advertises in
// use_terms.allowed_uses - no new term is invented.
export const CONSENT_GRANTS = ['view', 'fork', 'remix'];
export function buildConsent(input) {
  const b = input && typeof input === 'object' && !Array.isArray(input) ? input : null;
  if (!b) return { error: 'bad_body', message: 'body must be a consent object.' };
  const allowed = new Set(['op', 'node_key', 'work', 'grants', 'note', 'sig']);
  const extra = Object.keys(b).filter((k) => !allowed.has(k));
  if (extra.length) return { error: 'bad_request', message: 'unknown fields refused: ' + extra.sort().join(', ') };
  if (b.op !== 'consent') return { error: 'unknown_op', message: 'op must be "consent".' };
  if (typeof b.work !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(b.work)) return { error: 'bad_work', message: 'work must be an opaque sha256:<64 hex> hash.' };
  if (!Array.isArray(b.grants) || !b.grants.length) return { error: 'bad_grants', message: 'grants must be a non-empty list drawn from: ' + CONSENT_GRANTS.join(', ') + '.' };
  if (new Set(b.grants).size !== b.grants.length || b.grants.some((g) => !CONSENT_GRANTS.includes(g))) return { error: 'bad_grants', message: 'grants must be unique and drawn from: ' + CONSENT_GRANTS.join(', ') + '.' };
  if (b.note !== undefined && (typeof b.note !== 'string' || b.note.length > 200)) return { error: 'bad_note', message: 'note must be a string of at most 200 characters.' };
  const out = { op: 'consent', work: b.work, grants: [...b.grants].sort() };
  if (b.node_key !== undefined) out.node_key = b.node_key;
  if (b.note !== undefined) out.note = b.note.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return { body: out };
}

export function replyRows(replies, sent) {
  return sent.map((s) => {
    const r = (replies || []).find((x) => x.tid === s.tid);
    return { tid: s.tid, title: s.title, reply: r ? r.text : 'Waiting for a reply in agent-replies.md…', honesty: 'asserted' };
  });
}

// ---------------- the local conformance runner ----------------
// Same gap sources the design names: an unregistered key, untriaged parts, parts marked "none",
// endpoints off/unreachable, expired declarations. Each gap carries its grow_ref pointer. This is
// a LOCAL computation plus (optionally) live endpoint probes; the result is a fresh machinery run,
// so the Conform tab may call it verified - and only right after a run.
export function conformState({ registered, parts, surface, decls, today, probes }) {
  const gaps = []; let green = 0; const decl = [];
  if (!registered) gaps.push({ title: 'node key not registered', ref: 'grow_ref → identity/node-key' }); else green++;
  PARTS.forEach((p) => {
    const c = parts[p.id];
    if (!c) { if (!p.optional) gaps.push({ title: p.id + ' not triaged', ref: 'grow_ref → triage/' + p.id }); }
    else if (c === 'none') gaps.push({ title: p.id + ' missing', ref: 'grow_ref → seeds/' + p.id });
    else green++;
  });
  for (const k of ['hello', 'emit', 'export']) {
    const live = probes && k in probes ? probes[k] : !!surface[k];
    if (live === true) green++;
    else if (live === false) gaps.push({ title: k + ' endpoint absent', ref: 'grow_ref → surface/' + k });
    else gaps.push({ title: k + ' endpoint unreachable', ref: 'grow_ref → surface/' + k }); // 'down'
  }
  for (const d of decls) { if (isExpired(d, today)) gaps.push({ title: 'declaration expired: ' + d.id, ref: 're-escalated · ops/declarations.yaml' }); else decl.push(d); }
  return { green, gaps, decl };
}

// ---------------- design tokens (direction B, "quiet utility") ----------------
// IBM Plex Sans / Plex Mono preferred, system fallback - the CSP (style/script 'self') stays closed.
export const FONTS = {
  sans: "'IBM Plex Sans', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  mono: "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
};
export const LIGHT = { '--desk': '#e4e3df', '--bg': '#f6f6f4', '--bar': '#efefec', '--panel': '#ffffff', '--seg': '#e9e9e6', '--sel': '#ffffff', '--line': '#e1e0dc', '--line2': '#d6d5d0', '--ink': '#1c1c1a', '--ink2': '#55544f', '--ink3': '#8a8982', '--btn': '#ffffff', '--hi': '#ffffff', '--accent': 'oklch(0.5 0.13 255)', '--accentBg': 'oklch(0.5 0.13 255)', '--accentLine': 'oklch(0.8 0.06 255)', '--ok': 'oklch(0.52 0.12 150)', '--okBg': 'oklch(0.96 0.03 150)', '--warn': 'oklch(0.58 0.13 75)', '--warnLine': 'oklch(0.84 0.08 75)', '--bad': 'oklch(0.55 0.17 27)', '--badBg': 'oklch(0.96 0.02 27)' };
export const DARK = { '--desk': '#0f1011', '--bg': '#1d1e20', '--bar': '#18191b', '--panel': '#25262a', '--seg': '#2a2b2e', '--sel': '#3b3c41', '--line': '#2e2f33', '--line2': '#3a3b3f', '--ink': '#e8e8e5', '--ink2': '#b4b4ae', '--ink3': '#7d7d77', '--btn': '#2f3034', '--hi': 'rgba(255,255,255,.07)', '--accent': 'oklch(0.76 0.11 255)', '--accentBg': 'oklch(0.56 0.13 255)', '--accentLine': 'oklch(0.45 0.1 255)', '--ok': 'oklch(0.74 0.12 150)', '--okBg': 'oklch(0.3 0.04 150)', '--warn': 'oklch(0.78 0.12 80)', '--warnLine': 'oklch(0.45 0.07 80)', '--bad': 'oklch(0.72 0.14 25)', '--badBg': 'oklch(0.28 0.04 27)' };
