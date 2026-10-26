// seams-launcher core: pure logic, zero deps, importable by the browser (module) and by tests (node).
// EoM build leg 2026-10-26 (branch eom-node-one). The launcher is the minimal human client of the
// Seams protocol: a tall corner window (design direction 2a), Manage + Agent modes, no chat surface.
// Honesty rule, enforced HERE: every claim row carries a tag - 'verified' only when a machine check
// passed this session, 'asserted' for everything the server or an agent merely says. The UI never
// gets a claim string without one.
//
// The rails the launcher pins (verified 2026-10-26 against eom/node-one, branch eom-node-one):
export const WIRE_PIN = 'seams-wire/0.3-draft';
export const FORMAT_PIN = 'seams-attribution-log/0-eom.1';
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
export function appendPacket(existing, goal, items) {
  const body = existing && existing.trim() ? existing.replace(/\s*$/, '\n\n') : '# seams tasks\n';
  const base = nextTaskSeq(existing);
  const block = (goal ? '\ngoal: ' + goal + '\n\n' : '\n')
    + items.map((q, i) =>
      `## T-${String(base + i).padStart(3, '0')} ${q.title}\n- source: ${q.source}\n- evidence: ${q.evidence}\n- status: open`
    ).join('\n\n') + '\n';
  return { text: body + block, tids: items.map((_, i) => 'T-' + String(base + i).padStart(3, '0')) };
}

// Read the outbox back (the server confirms a write by reading the file and pairing tids).
export function parseQueueTasks(text) {
  const rows = [];
  const src = String(text ?? '');
  for (const m of src.matchAll(/^## (T-\d{3,}) (.+)$/gm)) {
    const tail = src.slice(m.index + m[0].length, m.index + m[0].length + 300);
    rows.push({
      tid: m[1], title: m[2].trim(),
      source: (tail.match(/^- source:\s*(.+)$/m) || [])[1]?.trim() || '',
      status: (tail.match(/^- status:\s*(.+)$/m) || [])[1]?.trim() || 'open',
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
