// Seams Launcher - the window. Zero deps, vanilla ESM. The launcher is the minimal HUMAN client:
// a tall corner window (2a), Manage + Agent modes, NO chat surface. Agents are workers, never the
// destination. EoM build leg 2026-10-26 (eom-node-one), built from the Claude Design handoff
// (canonical copy: ../design-handoff-2026-10-26/), direction B "quiet utility", motion: none.
//
// Honesty rule, structural: every displayed claim goes through claimRow()/tag() and carries either
// 'verified' (a machinery check ran THIS session: fresh hello/export/conform/file-readback result)
// or 'asserted' (the server or an agent merely says so). MUST-NEVERS: no payments surface, no
// claims/vouches surface, no verified:true attribution display, fork/remix stays built-later (501),
// no exposure/tunnel UI (exposure is blocked-on-ruling; there is nothing to configure).
import {
  WIRE_PIN, FORMAT_PIN, GATE_EXPECT, MAX_TEXT, PARTS, CH, NEXT, STEPS, REFUSALS,
  helloGate, canEmit, renderRefusal, replayProof,
  parseDeclarations, renderDeclarations, isExpired, expiredDecls,
  parseNodeYaml, renderNodeYaml, packetMd, parseQueueTasks, conformState, replyRows, claim,
} from '/launcher-core.mjs';

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = String(text); return n; };
const h = (tag, cls, kids) => { const n = el(tag, cls); (Array.isArray(kids) ? kids : kids != null ? [kids] : []).forEach((k) => n.append(k instanceof Node ? k : el('span', null, k))); return n; };
const btn = (label, cls, onclick, title) => { const b = el('button', 'btn' + (cls ? ' ' + cls : ''), label); if (onclick) b.onclick = onclick; if (title) b.title = title; return b; };
const hhmm = () => new Date().toTimeString().slice(0, 5);
const TODAY = () => new Date().toISOString().slice(0, 10);

// honesty tag - solid for verified, dashed for asserted. No claim renders without one.
function tag(verified, note) {
  const t = el('span', 'tag ' + (verified ? 'oktag' : 'asserted'), verified ? '✓ verified' : 'asserted');
  t.title = verified
    ? 'verified: a machinery check ran this session' + (note ? ' — ' + note : '')
    : 'asserted: reported by the server or an agent — the launcher has not confirmed it' + (note ? ' (' + note + ')' : '');
  return t;
}
const claimRow = (text, verified, note, cls) => h('div', cls || 'proofrow', [el('span', null, text), tag(verified, note)]);

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

const S = Object.assign({
  view: 'setup', mode: 'manage', tab: 'keys', agentSub: 'queue', setupFrom: null, issueOpen: false, theme: 'light',
  helloBody: null, rail: null, shookAt: null,
  nodeKey: null, registered: false, registrationVerified: false, regReceipt: null, oldKeys: [],
  cfgSub: 'node', nodePairs: null, decls: [], declSaved: null, nodeSaved: null,
  parts: {}, open: null, surface: { hello: true, emit: true, export: true },
  conform: null,
  text: 'hello, network', origin: 'authored', receipt: null, refusal: null, replayed: false, replayErr: null, replayProofRes: null, logN: null, exportBody: null, exportError: null, exportAt: null,
  quarantineInfo: null,
  queue: [], sent: [], goal: '', route: null, outPath: 'ops/agent-queue.md', replyPath: 'ops/agent-replies.md', replies: [], test: null,
}, store.get('seams-launcher/v1') || {});
const save = () => store.set('seams-launcher/v1', {
  theme: S.theme, nodeKey: S.nodeKey, registered: S.registered, regReceipt: S.regReceipt, oldKeys: S.oldKeys,
  parts: S.parts, surface: S.surface, text: S.text, origin: S.origin,
  queue: S.queue, sent: S.sent, goal: S.goal, route: S.route, outPath: S.outPath, replyPath: S.replyPath,
});

const api = async (path, opts) => {
  const r = await fetch(path, opts);
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = null; }
  return { status: r.status, ok: r.ok, body, text };
};
const post = (p, data) => api(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });

const today = () => TODAY();
const expired = () => expiredDecls(S.decls, today());
const triagedCount = () => PARTS.filter((p) => S.parts[p.id]).length;
const quarantined = () => S.rail?.ran && S.rail.integrity === 'QUARANTINED';
const inQ = (title) => S.queue.some((q) => q.title === title) || S.sent.some((q) => q.title === title);
const qLabel = (title) => inQ(title) ? '✓ Queued' : '+ Queue for agent';
function addQ(title, evidence, source) {
  if (inQ(title)) return;
  S.queue.push({ id: title, title, evidence, source, checked: true });
  save(); render();
}

// ---------- real wiring: the three endpoints, via the launcher's same-origin loopback proxy ----------
async function sayHello() {
  const r = await api('/api/hello');
  if (!r.ok || !r.body) {
    S.helloBody = null;
    S.rail = { ran: true, echo: null, pinned: false, skew: true, gateKinds: null, gateOk: false, integrity: 'unconfirmed', integrityRaw: null, formatOk: false, unreachable: true };
    S.refusal = { name: 'node_unreachable', code: r.status, plain: (r.body && r.body.message) || 'The node-one server did not answer.', builtLater: false, verbatim: true, foot: 'The launcher shows what the server reported — nothing more.' };
    render(); return;
  }
  S.helloBody = r.body; S.refusal = null;
  S.rail = helloGate(r.body); S.shookAt = hhmm();
  saveLater(); render();
}
const saveLater = save;

async function announce({ from } = {}) {
  if (!S.nodeKey) return;
  const r = await post('/api/ingest', { op: 'emit', kind: 'node-key', node_key: S.nodeKey.pub, provenance: { attributed_to: { name: S.nodeKey.pub.replace(/^key:/, '') } } });
  if (r.ok && r.body?.status === 'deposited') {
    S.registered = true; S.regReceipt = r.body; S.registrationVerified = false;
    // a fresh export read is what turns registration verified (nodes[] is the registry the server itself returns)
    const x = await api('/api/export');
    if (x.ok && x.body?.entries && Array.isArray(x.body.nodes)) {
      S.registrationVerified = x.body.nodes.some((n) => n.node_key === S.nodeKey.pub);
      S.exportBody = x.body; S.exportError = null; S.logN = x.body.entries.length; S.exportAt = hhmm();
    }
    if (from === 'hello') S.helloStepAnnounced = true;
    save(); render();
  } else {
    S.refusal = renderRefusal(r.body, r.status);
    if (from === 'hello') S.helloAnnounceRefused = S.refusal;
    render();
  }
}

async function emit() {
  if (!S.nodeKey) { S.refusal = { name: 'held by launcher', code: null, plain: 'Mint a node key first, in Keys.', builtLater: false, verbatim: false, foot: 'Not a server refusal. Nothing was sent.' }; return render(); }
  const hold = canEmit({ rail: S.rail, quarantined: quarantined() });
  if (!hold.allow) { S.refusal = hold.hold; S.receipt = null; return render(); }
  const body = { op: 'emit', kind: 'text', node_key: S.nodeKey.pub, text: S.text, provenance: { origin: S.origin } };
  const nBefore = await logCount();
  const r = await post('/api/ingest', body);
  if (r.ok && r.body?.status === 'deposited') {
    S.receipt = r.body; S.refusal = null; S.replayed = false; S.replayProofRes = null;
    // opaque hashes arrive verbatim; n comes from the chain block the server reports
    S.logN = r.body.v ?? S.logN; S._nBefore = nBefore;
  } else {
    S.receipt = null; S.refusal = renderRefusal(r.body, r.status);
  }
  render();
}
async function logCount() {
  const x = await api('/api/export');
  if (x.ok && x.body?.entries) { S.exportBody = x.body; S.exportError = null; S.exportAt = hhmm(); return x.body.entries.length; }
  S.exportBody = null; S.exportError = x.body || { error: 'export_failed', message: 'export refused' };
  return null;
}
async function replay() {
  if (!S.receipt) return;
  const nBefore = S._nBefore ?? S.logN;
  const first = S.receipt;
  const body = { op: 'emit', kind: 'text', node_key: S.nodeKey.pub, text: S.text, provenance: { origin: S.origin } };
  const r = await post('/api/ingest', body);
  const nAfter = await logCount();
  S.replayErr = null;
  if (r.ok && r.body) {
    S.replayProofRes = replayProof({ ...first, duplicate: false }, r.body, nBefore, nAfter);
    S.replayed = S.replayProofRes.duplicate && S.replayProofRes.identical && S.replayProofRes.logUnchanged;
  } else {
    S.replayErr = renderRefusal(r.body, r.status);
    S.replayed = false;
  }
  render();
}
async function runConform() {
  // live probes only from what the launcher actually saw this session:
  const probes = {};
  probes.hello = !!(S.rail?.ran && S.rail.pinned && S.rail.gateOk);
  const x = await api('/api/export');
  if (x.ok && x.body?.entries) { S.exportBody = x.body; S.exportError = null; S.logN = x.body.entries.length; S.exportAt = hhmm(); probes.export = true; }
  else { S.exportError = x.body; probes.export = x.status === 503 ? 'quarantined' : 'down'; }
  probes.emit = !!(S.rail?.ran && S.rail.pinned && S.rail.gateOk); // the join gate answered for hello+emit rails; a deposit is only proven by the receipt
  S.conform = { at: hhmm(), ...conformState({ registered: S.registered, parts: S.parts, surface: S.surface, decls: S.decls, today: today(), probes }) };
  render();
}
async function handOff() {
  const checked = S.queue.filter((q) => q.checks !== false && q.checked);
  if (!checked.length) return;
  const r = await post('/agent/queue', { goal: S.goal, items: checked.map((q) => ({ title: q.title, evidence: q.evidence, source: q.source })) });
  if (r.ok && r.body?.written) {
    r.body.tids.forEach((tid, i) => S.sent.push({ tid, title: checked[i].title, source: checked[i].source, evidence: checked[i].evidence, writtenAt: hhmm(), fileConfirmed: !!r.body.confirmed_on_readback }));
    S.queue = S.queue.filter((q) => !checked.includes(q));
    S.agentSub = 'sent'; save();
  }
  render();
}
async function refreshReplies() {
  const r = await api('/agent/replies');
  S.replies = r.ok && r.body?.entries ? r.body.entries : [];
  render();
}
async function saveOps(name, text, cb) {
  const r = await post('/ops/file', { name, text });
  if (r.ok && r.body?.written) { cb && cb(hhmm()); }
  render();
}

// ---------- the window ----------
const win = document.getElementById('win');
function tag2(v, note) { return tag(v, note); }

function renderTitlebar() {
  const bar = h('div', 'titlebar', [el('span', 'title', 'Seams Launcher')]);
  if (S.view === 'tabs') {
    const seg = h('div', 'seg', [
      (() => { const b = el('button', S.mode === 'manage' ? 'on' : '', 'Manage'); b.onclick = () => setS({ mode: 'manage', issueOpen: false }); return b; })(),
      (() => { const b = el('button', S.mode === 'agent' ? 'on' : ''); b.append('Agent ', h('span', 'qn', S.queue.length)); b.onclick = () => setS({ mode: 'agent', issueOpen: false }); return b; })(),
    ]);
    bar.append(seg);
  } else {
    bar.append(el('span', 'setupcount', 'setup ' + doneArr().filter(Boolean).length + '/7'));
  }
  const help = el('button', 'iconbtn', '?'); help.title = 'Setup guide'; help.onclick = () => setS({ view: 'setup', setupFrom: null, issueOpen: false });
  const th = el('button', 'iconbtn', '◐'); th.title = 'Light / dark'; th.onclick = () => { S.theme = S.theme === 'dark' ? 'light' : 'dark'; save(); render(); };
  bar.append(help, th);
  return bar;
}
const setS = (patch) => { Object.assign(S, patch); render(); };

function renderRails() {
  const r = S.rail;
  const rail = h('div', 'rails');
  if (!r || !r.ran) {
    rail.append(
      h('span', 'dim3', 'wire ? — say hello'),
      h('span', 'dim3', 'gate ?'),
    );
    const ig = el('button', 'integrity unconfirmed', 'integrity ?'); ig.onclick = sayHello; ig.title = 'GET /api/hello — run the handshake to see the rails before you emit';
    rail.append(ig); return rail;
  }
  if (r.unreachable) {
    rail.append(h('span', 'skew', 'node-one unreachable'), h('span', 'dim3', 'start it: node eom/node-one/attributed-text/server.mjs'), h('span', 'integrity unconfirmed', 'integrity ?'));
    return rail;
  }
  const wire = h('span', null, ['wire ', h('span', 'mono', r.echo ?? '?'), ' ']);
  wire.append(r.pinned ? h('span', 'pinned', '✓ pinned') : h('span', 'skew', '✗ skew — refusing'));
  wire.title = r.pinned
    ? 'server echo matches the pinned wire ' + WIRE_PIN + ' (checked this session)'
    : 'server echoes ' + JSON.stringify(r.echo) + ' but this launcher pins ' + WIRE_PIN + ' — it refuses to speak past the skew';
  const gate = h('span', r.gateOk ? null : 'skew', 'gate ' + (r.gateKinds ? r.gateKinds.length + ' kinds' : '?'));
  gate.title = 'advertised accepted kinds: {' + (r.gateKinds ? r.gateKinds.join(', ') : '?') + '} — closed set ' + (r.gateOk ? 'matches' : 'DOES NOT MATCH') + ' ' + '{' + GATE_EXPECT.join(', ') + '}';
  const ig = el('button', 'integrity' + (r.integrity === 'QUARANTINED' ? ' q' : ''), r.integrity === 'QUARANTINED' ? 'QUARANTINED ›' : r.integrity === 'ok' ? 'integrity ok' : 'integrity ?');
  ig.title = 'integrity reported by GET /api/hello at ' + (S.shookAt || '?') + ' — ' + (r.integrityRaw || 'not reported') + ' (asserted by the server; the launcher refuses emit while QUARANTINED)';
  if (r.integrity === 'QUARANTINED') ig.onclick = () => setS({ view: 'tabs', issueOpen: true });
  rail.append(wire, gate, ig);
  return rail;
}

function renderBanner() {
  if (!(S.view === 'tabs' && quarantined() && !S.issueOpen)) return null;
  const b = el('button', 'qbanner');
  b.append(h('b', null, 'Log quarantined'), h('span', 'mid', 'Sending is paused.'), h('span', 'more', 'Details ›'));
  b.onclick = () => setS({ issueOpen: true });
  return b;
}

function doneArr() {
  return [true, !!(S.nodeKey && S.registered), !!S.route, expired().length === 0, triagedCount() === PARTS.length, !!S.conform, !!S.replayed];
}
function badge(txt, cls) { return h('span', 'badge ' + cls, txt); }
function renderTabbar() {
  const bar = h('div', 'tabbar');
  const badges = {
    keys: S.registered ? badge('✓', 'ok') : S.nodeKey ? badge('unreg', 'warn') : badge('none', 'warn'),
    config: expired().length ? badge('! ' + expired().length, 'bad') : badge('✓', 'ok'),
    parts: badge(triagedCount() + '/' + PARTS.length, triagedCount() === PARTS.length ? 'ok' : 'dim'),
    conform: S.conform ? (S.conform.gaps.length ? badge(S.conform.gaps.length + ' gap', 'warn') : badge('green', 'ok')) : badge('—', 'dim'),
    hello: quarantined() ? badge('paused', 'bad') : (S.receipt && S.replayed ? badge('✓', 'ok') : S.receipt ? badge('✓', 'ok') : badge('—', 'dim')),
    baseline: quarantined() ? badge('503', 'bad') : badge(S.logN ?? '—', 'dim'),
  };
  for (const [id, label] of [['keys', 'Keys'], ['config', 'Config'], ['parts', 'Parts'], ['conform', 'Conform'], ['hello', 'Hello'], ['baseline', 'Baseline']]) {
    const b = el('button', S.tab === id ? 'on' : null);
    b.append(label, badges[id]);
    b.onclick = () => setS({ tab: id, setupFrom: S.setupFrom !== null && STEPS[S.setupFrom] && STEPS[S.setupFrom].opens === id ? S.setupFrom : null });
    bar.append(b);
  }
  return bar;
}
function renderAgentbar() {
  const bar = h('div', 'agent-sub');
  for (const [id, label, n] of [['queue', 'To hand off', S.queue.length], ['sent', 'Handed off', S.sent.length], ['route', 'Route', '']]) {
    const b = el('button', S.agentSub === id ? 'on' : null);
    b.append(label, n === '' ? '' : h('span', 'qn', n));
    b.onclick = () => setS({ agentSub: id });
    bar.append(b);
  }
  return bar;
}

function footer() {
  const f = h('div', 'footer');
  if (S.view === 'setup') {
    f.append(btn('Skip to tabs', 'sm', () => setS({ view: 'tabs', setupFrom: null })), h('span', 'spacer'), el('span', 'exposure', 'local only'));
    return f;
  }
  if (S.view === 'tabs' && S.setupFrom !== null && !S.issueOpen) {
    const all = el('button', 'ghost', '‹ All steps'); all.onclick = () => setS({ view: 'setup', setupFrom: null });
    f.append(all, el('span', 'dim3', 'setup step ' + (S.setupFrom + 1) + ' of 7'), h('span', 'spacer'),
      btn(S.setupFrom === 6 ? 'Finish' : 'Next step ›', 'sm', () => { if (S.setupFrom >= 6) setS({ view: 'setup', setupFrom: null }); else goStep(S.setupFrom + 1); }));
    return f;
  }
  f.append(el('span', 'dim3', 'local only · log n ' + (S.logN ?? '—')), h('span', 'spacer'), el('span', 'exposure', 'exposure: blocked-on-ruling'));
  return f;
}
function goStep(i) {
  const opens = STEPS[i].opens;
  if (opens === 'agent-route') setS({ view: 'tabs', mode: 'agent', agentSub: 'route', setupFrom: i, issueOpen: false });
  else setS({ view: 'tabs', mode: 'manage', tab: opens, setupFrom: i, issueOpen: false });
}

function renderSetup() {
  const box = h('div');
  box.append(h('div', 'pad-setup', [el('div', 'h', 'Join the network as a node.'), el('div', 'sub', 'You set it up here. Agents do the work later. Every step can be done by hand or handed to your agent.')]));
  const done = doneArr(); const cur = done.indexOf(false);
  const steps = h('div', 'steps');
  STEPS.forEach((st, i) => {
    const d = done[i], c = i === cur;
    const row = h('button', 'step' + (d ? ' done' : '') + (c ? ' current' : ''));
    row.onclick = () => goStep(i);
    row.append(h('span', 'circ', d ? '✓' : String(i + 1)),
      h('span', 'stext', [h('span', 'stitle', st.t) , el('span', null, ' · ' + st.d)], ),
      el('span', 'hint', d ? 'done' : c ? '' : 'open ›'));
    if (c) row.querySelector('.stext').append(btn('Start', 'primary', () => goStep(i)));
    steps.append(row);
  });
  box.append(steps);
  return box;
}

// ---------- KEYS ----------
function renderKeys() {
  const box = h('div', 'pad');
  const nodeBox = h('div', 'card nodekey-box', [el('span', 'keytag', 'NODE KEY')]);
  if (!S.nodeKey) {
    nodeBox.append(el('span', 'dim', 'No node key yet. Minting makes one here. Only its public half is registered with the node.'),
      btn('Mint node key', 'primary', mintKey));
  } else {
    nodeBox.append(el('p', 'keypub', S.nodeKey.pub));
    const kv = h('dl', 'kv', [el('dt', null, 'role'), el('dd', null, 'node'), el('dt', null, 'status'), el('dd', null, S.registered ? 'active' : 'active · not registered yet'), el('dt', null, 'valid_from'), el('dd', null, S.nodeKey.from)]);
    nodeBox.append(kv);
    const acts = h('div', 'rowlist');
    if (!S.registered) acts.append(btn('Register public half', 'primary', () => announce({})));
    acts.append(btn('Rotate', null, mintKey));
    if (S.registered) {
      acts.append(h('div', 'proofrow', [el('span', 'dim', 'Registered · server accepted node-key'), tag(S.registrationVerified, S.registrationVerified ? 'seen in export nodes[] from a fresh export fetch' : 'server accepted the announce; not yet cross-checked against export nodes[]')]));
      if (S.regReceipt?.payload_hash) acts.append(el('div', 'receipt-hash mono dim3', 'registry payload hash: ' + S.regReceipt.payload_hash));
    }
    nodeBox.append(acts);
    if (S.oldKeys.length) nodeBox.append(el('div', 'dim3 mono', 'retired: ' + S.oldKeys.map((k) => k.pub).join(' · ')));
  }
  box.append(nodeBox);
  const human = h('div', 'card humankey-box', [el('span', 'keytag', 'HUMAN KEYS'),
    el('div', 'dim', 'Never listed with node keys and never managed from here.')]);
  box.append(human);
  return box;
}
async function mintKey() {
  const a = crypto.getRandomValues(new Uint8Array(8));
  const ref = 'node-' + [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (S.nodeKey) S.oldKeys = [{ pub: S.nodeKey.pub }, ...S.oldKeys];
  S.nodeKey = { pub: 'key:' + ref, from: new Date().toISOString().replace(/\.\d+Z$/, 'Z') };
  S.registered = false; S.registrationVerified = false; S.regReceipt = null;
  save(); render();
}

// ---------- CONFIG ----------
async function loadCfg() {
  const [n, d] = await Promise.all([api('/ops/file?name=node.yaml'), api('/ops/file?name=declarations.yaml')]);
  if (n.ok) S.nodePairs = parseNodeYaml(n.body?.text);
  if (d.ok) S.decls = parseDeclarations(d.body?.text);
  render();
}
function renderConfig() {
  const box = h('div', 'pad');
  const subs = h('div', 'subtabs');
  const b1 = el('button', S.cfgSub === 'node' ? 'on' : '', 'node.yaml'); b1.onclick = () => setS({ cfgSub: 'node' });
  const b2 = el('button', S.cfgSub === 'decl' ? 'on' : '');
  b2.append('declarations.yaml'); if (expired().length) b2.append(h('span', 'exp', ' !'));
  b2.onclick = () => setS({ cfgSub: 'decl' });
  subs.append(b1, b2); box.append(subs);

  if (S.cfgSub === 'node') {
    if (!S.nodePairs) { loadCfg(); box.append(el('span', 'dim3', 'loading ops/node.yaml…')); return box; }
    for (const p of S.nodePairs) {
      const inp = el('input'); inp.value = p.v; inp.onchange = () => { p.v = inp.value; saveNode(); };
      box.append(h('div', 'envrow', [el('span', 'pathk', p.k), inp]));
    }
    box.append(el('div', 'cfgfoot', 'ops/node.yaml · saved ' + (S.nodeSaved || '—')));
  } else {
    if (!S.decls.length) box.append(el('span', 'dim3', 'No declarations yet.'));
    for (const d of S.decls) {
      const ex = isExpired(d, today());
      const card = h('div', 'decl-card' + (ex ? ' expired' : ''));
      card.append(h('div', 'decl-head', [h('b', null, d.id), el('span', 'decl-state', ex ? 'expired ' + d.revisit + ' · re-escalated' : 'revisit ' + d.revisit)]),
        el('span', 'dim', d.note));
      const acts = h('div', 'rowlist');
      if (ex) {
        acts.append(h('div', 'rowlist', [
          btn('Renew +30 days', 'sm', () => { d.revisit = addDays(today(), 30); saveDecl(); }),
          btn('Resolved', 'sm', () => { S.decls = S.decls.filter((x) => x !== d); saveDecl(); }),
          btn(qLabel('resolve declaration ' + d.id), 'queue sm', () => addQ('resolve declaration ' + d.id, 'expired ' + d.revisit + ' · ' + d.note, 'Config')),
        ]));
      }
      card.append(acts); box.append(card);
    }
    box.append(btn('+ Add declaration', 'sm', () => { S.decls.push({ id: 'deviation-' + (S.decls.length + 1), note: 'Describe the accepted deviation', revisit: addDays(today(), 30) }); saveDecl(); }));
    box.append(el('div', 'cfgfoot', 'Expired items re-escalate by themselves. They show up in Conform as gaps. · ops/declarations.yaml · saved ' + (S.declSaved || '—')));
  }
  return box;
}
const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const saveDecl = () => saveOps('declarations.yaml', renderDeclarations(S.decls), (t) => { S.declSaved = t; });
const saveNode = () => saveOps('node.yaml', renderNodeYaml(S.nodePairs), (t) => { S.nodeSaved = t; });

// ---------- PARTS ----------
async function saveParts() { await post('/ops/file', { name: 'parts.json', text: JSON.stringify({ parts: S.parts, surface: S.surface }, null, 2) }); }
function renderParts() {
  const box = h('div', 'pad');
  box.append(el('span', 'h', 'Component · do you have it?'));
  for (const p of PARTS) {
    const c = S.parts[p.id], open = S.open === p.id;
    const dec = p.id === 'governance' ? S.decls.find((d) => d.id === 'governance-deferred' && !isExpired(d, today())) : null;
    const row = el('button', 'part-row' + (open ? ' open' : '') + (c === 'skip' ? ' skip' : ''));
    row.onclick = () => setS({ open: open ? null : p.id });
    row.append(h('span', 'part-icon ' + (c && c !== 'skip' ? 'ok' : 'dim'), c ? (c === 'skip' ? '–' : '✓') : '○'),
      h('span', 'part-name', [p.id, c ? h('span', 'dim3', ' · ' + CH[c]) : p.optional ? h('span', 'dim3', ' · optional') : '']),
      NEXT[c] ? el('span', 'chip', NEXT[c]) : el('span', 'part-status ' + (c === 'skip' || dec ? 'dim' : 'warn'), c === 'skip' ? 'skipped' : dec ? 'declared · revisit ' + dec.revisit.slice(5) : 'not triaged'));
    box.append(row);
    if (open) {
      const card = h('div', 'part-card', [el('span', null, 'Do you already have ' + p.id + '?')]);
      const picks = h('div', 'pickrow');
      for (const [k, label] of [['none', 'No → grow'], ['different', 'Sort of → align'], ['one', 'Yes → route']]) {
        const b = el('button', 'pick' + (c === k ? ' on' : ''), label);
        b.onclick = (e) => { e.stopPropagation(); S.parts[p.id] = k; S.open = null; saveParts(); render(); };
        picks.append(b);
      }
      if (p.optional) { const b = el('button', 'pick' + (c === 'skip' ? ' on' : ''), 'Skip'); b.onclick = (e) => { e.stopPropagation(); S.parts[p.id] = 'skip'; S.open = null; saveParts(); render(); }; picks.append(b); }
      card.append(picks, btn(qLabel('triage ' + p.id), 'queue sm', () => addQ('triage ' + p.id, c ? 'current: ' + CH[c] + ' · confirm or change' : 'none / different / one-to-one ?', 'Parts')));
      box.append(card);
    }
  }
  box.append(el('span', 'h', 'endpoint-surface · what this node serves'));
  const surf = h('div', 'surface');
  for (const k of ['hello', 'emit', 'export']) {
    const label = h('label'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!S.surface[k];
    cb.onchange = () => { S.surface[k] = cb.checked; saveParts(); };
    label.append(cb, ' ' + k); surf.append(label);
  }
  box.append(surf);
  return box;
}

// ---------- CONFORM ----------
function renderConform() {
  const box = h('div', 'pad');
  if (!S.conform) {
    box.append(el('span', 'sub', 'The conformance runner checks keys, config, parts, and endpoints locally, then lists each gap with where to grow it from.'),
      btn('Run conformance', 'primary', runConform));
    return box;
  }
  box.append(h('div', 'proofrow', [el('span', 'dim3', 'gap report'), h('span', null, [el('span', 'dim3', 'result '), tag(true, 'fresh runner session at ' + S.conform.at)])]));
  box.append(h('div', 'stats', [
    h('div', 'stat green', [el('div', 'n', S.conform.green), el('div', 'l', 'green')]),
    h('div', 'stat gap', [el('div', 'n', S.conform.gaps.length), el('div', 'l', 'gap')]),
    h('div', 'stat', [el('div', 'n', S.conform.decl.length), el('div', 'l', 'dated-declared')]),
  ]));
  if (!S.conform.gaps.length) box.append(el('div', 'notice', 'No gaps. Everything is green or dated-declared.'));
  for (const g of S.conform.gaps) {
    box.append(h('div', 'gap-card', [h('div', 'proofrow', [el('span', null, g.title), btn(inQ(g.title) ? '✓ Queued' : '+ Queue', 'queue sm', () => addQ(g.title, g.ref, 'Conform'))]), el('div', 'growref', g.ref)]));
  }
  for (const d of S.conform.decl) box.append(h('div', 'decl-gap-card', [el('span', null, d.id), el('span', 'growref dim3', 'declared · revisit ' + d.revisit)]));
  box.append(h('div', 'conform-foot', [btn('Run again', 'sm', runConform), el('span', null, 'last run ' + S.conform.at + ' · local')]));
  return box;
}

// ---------- HELLO ----------
function renderHello() {
  const box = h('div', 'pad');
  const steps = h('div', 'steps4');
  const hs = [!!S.rail?.ran, !!S.registered, !!S.receipt, !!S.replayed];
  const hcur = hs.indexOf(false);
  const circ = (i) => h('span', 'step4 ' + (hs[i] ? 'done' : ''), h('span', 'circ' + (hs[i] ? ' done' : i === hcur ? ' current' : ''), hs[i] ? '✓' : String(i + 1)));
  const step = (i, title, sub, body) => h('div', 'step4', [circ(i), h('div', 'body4', [h('div', 'head4', [h('span', null, [el('b', null, title), el('span', 'dim', ' · ' + sub)])]), body])]);

  // 1 handshake
  const b1 = h('div', 'body4');
  if (S.rail?.ran && !S.rail.unreachable) {
    b1.append(el('span', 'dim', 'Echo ' + JSON.stringify(S.rail.echo) + ' ' + (S.rail.pinned ? 'matches the pin' : 'DOES NOT MATCH the pin ' + WIRE_PIN) + '. Gate is ' + (S.rail.gateOk ? 'exactly' : 'NOT the closed set') + ' {' + (S.rail.gateKinds || '?') + '}. Integrity: '),
      el('b', quarantined() ? 'skew' : 'pinned', S.rail.integrity), tag(S.rail.pinned && S.rail.gateOk, 'launcher compared echo vs pin and the advertised gate vs the closed set'));
    b1.append(btn('Say hello again', 'sm', sayHello));
  } else {
    b1.append(btn('Say hello', 'primary', sayHello));
    if (S.refusal && S.refusal.name === 'node_unreachable') b1.append(el('div', 'refusal', [el('span', 'name', 'node_unreachable ' + (S.refusal.code || '')), el('span', null, S.refusal.plain)]));
  }
  steps.append(step(0, 'Hello handshake', 'GET /api/hello', b1));

  // 2 announce
  const b2 = h('div', 'body4');
  if (!S.nodeKey) b2.append(el('span', 'dim', 'Mint a node key first, in Keys.'));
  else if (!S.registered) b2.append(btn('Announce', 'primary', () => announce({ from: 'hello' })));
  else b2.append(h('span', 'dim', ['Accepted by the gate. ', tag(S.registrationVerified, S.registrationVerified ? 'seen in export nodes[] (fresh fetch)' : 'server says so')]),
    S.regReceipt?.receipt ? el('div', 'mono dim3', 'receipt ' + S.regReceipt.receipt + ' · payload ' + (S.regReceipt.payload_hash || '')) : null);
  steps.append(step(1, 'Announce node key', 'kind node-key', b2));

  // 3 emit
  const b3 = h('div', 'body4');
  const ta = el('textarea', 'emitter'); ta.value = S.text; ta.oninput = () => { S.text = ta.value; cnt.textContent = (S.text.length) + ' / ' + (S.helloBody?.limits?.max_text || MAX_TEXT); cnt.className = 'counter' + (S.text.length > (S.helloBody?.limits?.max_text || MAX_TEXT) ? ' over' : ''); };
  b3.append(ta);
  const cnt = el('div', 'counter', S.text.length + ' / ' + (S.helloBody?.limits?.max_text || MAX_TEXT));
  b3.append(cnt);
  const origins = h('div', 'origins');
  for (const k of ['authored', 'assisted', 'played']) {
    const lab = h('label'); const rb = el('input'); rb.type = 'radio'; rb.name = 'origin'; rb.checked = S.origin === k;
    rb.onchange = () => { S.origin = k; save(); }; lab.append(rb, ' ' + k); origins.append(lab);
  }
  b3.append(origins);
  const bar3 = h('div', 'rowlist');
  bar3.append(h('div', 'rowlist', [btn('Emit', 'primary', emit), btn(qLabel('send: "' + shortText() + '"'), 'queue sm', () => addQ('send: "' + shortText() + '"', 'message · origin ' + S.origin + ' · ' + S.text.length + ' chars', 'Hello'))]));
  bar3.append(el('button', 'btn dashed', 'Fork / remix · not yet built'));
  bar3.lastChild.disabled = true; bar3.lastChild.title = 'consent_gate_unbuilt 501 — the consent layer is not built; this is a built-later path, not a breakage';
  b3.append(bar3);
  if (S.refusal) {
    const r = S.refusal;
    b3.append(h('div', r.name === 'held by launcher' ? 'hold' : 'refusal' + (r.builtLater ? ' built-later' : ''),
      [el('span', 'name', r.name + (r.code != null ? ' ' + r.code : '')), el('span', null, r.plain), el('span', 'foot', r.foot)]));
  }
  if (S.receipt) {
    const rc = S.receipt;
    const mapped = h('div', 'receipt', [
      h('div', 'h', [el('span', null, 'Gate mapped text → ' + (rc.kind || 'session-log')), tag(rc.kind === 'session-log', 'receipt kind checked against the mapped value this session')]),
      h('div', 'hashes', [
        'payload_hash ' + (rc.payload_hash || '—'),
        'content_hash ' + (rc.content_hash || '—'),
        'deposit_hash ' + (rc.deposit_hash || '—'),
        'n ' + (rc.v ?? '—'),
      ]),
      el('div', 'opaque-note', 'Hashes are opaque, shown exactly as received.'),
    ]);
    b3.append(mapped);
  }
  steps.append(step(2, 'Emit one deposit', 'POST /api/ingest', b3));

  // 4 replay
  const b4 = h('div', 'body4');
  if (!S.receipt) b4.append(el('span', 'dim', 'After the emit: expect duplicate:true, the same receipt, and no growth.'));
  else if (!S.replayed && !S.replayErr) b4.append(btn('Replay', 'primary', replay));
  if (S.replayErr) b4.append(h('div', 'refusal', [el('span', 'name', S.replayErr.name + ' ' + (S.replayErr.code ?? '')), el('span', null, S.replayErr.plain)]));
  if (S.replayProofRes) {
    const p = S.replayProofRes;
    b4.append(
      proofRow('duplicate: true', p.duplicate, 'server acked duplicate:true on the replay'),
      proofRow('Receipt byte-identical to original', p.identical, 'launcher deep-compared the two receipts (duplicate flag aside)'),
      proofRow('Log unchanged · n ' + S._nBefore + ' → ' + (S.logN ?? '?'), p.logUnchanged, 'export entry count fetched before and after the replay'),
    );
  }
  steps.append(step(3, 'Replay proof', 'same bytes again', b4));
  box.append(steps);
  return box;
}
const proofRow = (text, ok, note) => h('div', 'proofrow', [el('span', null, text), tag(!!ok, ok ? note : 'check did not pass')]);
const shortText = () => S.text.length > 28 ? S.text.slice(0, 28) + '…' : S.text;

// ---------- BASELINE ----------
async function loadBaseline() { await logCount(); render(); }
function renderBaseline() {
  const box = h('div', 'pad');
  if (quarantined() || S.exportError?.error === 'log_integrity') {
    box.append(h('div', 'blocked503', [
      h('b', 'skew', 'Export refuses while the log is quarantined.'),
      el('span', null, 'No baseline is shown, because it wouldn’t be truthful.'),
      btn('See what’s quarantined', 'sm', () => setS({ issueOpen: true })),
    ]));
    return box;
  }
  if (!S.exportBody) {
    box.append(el('span', 'sub', 'The first truthful baseline is the /api/export payload itself — honesty labels preserved, hashes opaque, chain alongside the wire fields.'),
      btn('Fetch export', 'primary', loadBaseline));
    if (S.exportError) box.append(el('div', 'refusal', [el('span', 'name', S.exportError.error || 'export_failed'), el('span', null, S.exportError.message || '')]));
    return box;
  }
  const x = S.exportBody;
  box.append(h('div', 'baseline-head', [el('span', null, 'GET /api/export · ' + (x.entries?.length ?? '?') + ' entries'), el('span', 'fmt', x.format || FORMAT_PIN)]));
  box.append(h('div', 'honesty', [
    h('div', 'proofrow', [el('span', null, 'creator_verified: false'), el('span', 'dim3', 'on every entry, for now')]),
    h('div', 'proofrow', [el('span', null, 'Hashes opaque, public sha256'), el('span', 'dim3', 'not wire-v0')]),
    h('div', 'proofrow', [el('span', null, 'parents: []'), el('span', 'dim3', 'order is in the chain block')]),
  ]));
  const pre = el('pre', 'json');
  // chain shown ALONGSIDE the wire fields, not injected inside them - and the hashes rendered exactly as received
  const shown = { format: x.format, wire: x.wire, n: x.entries?.length ?? null, last_entry: x.entries?.[x.entries.length - 1] || null, integrity: x.integrity, nodes: x.nodes };
  pre.textContent = JSON.stringify(shown, null, 2);
  box.append(pre);
  box.append(h('div', 'conform-foot', [
    btn('Save baseline.json', 'sm', () => {
      const b = new Blob([JSON.stringify(x, null, 2)], { type: 'application/json' });
      const a = el('a'); a.href = URL.createObjectURL(b); a.download = 'baseline.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }),
    el('span', null, 'fetched ' + (S.exportAt || '—') + ' · local'), tag(true, 'fresh export result from this session'),
  ]));
  return box;
}

// ---------- INTEGRITY ISSUE VIEW ----------
function renderIssue() {
  const box = h('div', 'issue');
  const crumb = h('div', 'crumb', []);
  const back = el('button', 'ghost', '‹ Back'); back.onclick = () => setS({ issueOpen: false });
  crumb.append(back, el('span', 'dim3', '/'), el('b', null, 'Integrity'));
  const wrap = h('div', null, [crumb, box]);
  box.append(h('div', 'red-card', [
    h('div', 'red-title', [el('span', null, 'Log quarantined'), tag(false, 'reported by hello — the server says so')]),
    el('span', 'dim', 'Sending is paused. The launcher won’t emit into a corrupted log.'),
  ]));
  const what = h('div');
  what.append(el('h4', null, 'What'));
  const lines = [
    'hello integrity: ' + (S.rail?.integrityRaw || 'not reported this session'),
    ...(S.exportError?.error === 'log_integrity' ? ['export refuses: 503 log_integrity', 'tampered: ' + JSON.stringify(S.exportError.tampered || []), 'corrupt lines: ' + (S.exportError.corrupt_lines ?? '?'), 'anchor_ok: ' + (S.exportError.anchor_ok ?? '?')] : []),
  ];
  what.append(h('div', 'mono-box', lines.join('\n')), el('div', 'dim3', 'quarantine.jsonl line contents live with the node’s data dir; the launcher shows only what the node itself reports (no log-dir reads).'));
  box.append(what);
  box.append(h('div', null, [el('h4', null, 'Why it matters'), el('span', 'dim', 'Export refuses with 503 log_integrity. A baseline can’t be truthful until the chain is repaired.')]));
  box.append(h('div', 'cols2', [
    h('div', null, [el('h4', null, 'Still works'), el('span', 'dim', '✓ Keys · Config · Parts'), el('span', 'dim', '✓ Conform (local)'), el('span', 'dim', '✓ Hello (read-only)')]),
    h('div', null, [el('h4', null, 'Blocked'), el('span', 'dim3', '✕ Emit (paused)'), el('span', 'dim3', '✕ Export (503)')]),
  ]));
  box.append(h('div', 'hand-card', [
    h('div', 'proofrow', [el('span', null, 'Hand to agent'), el('span', 'dim3', 'adds to Agent queue')]),
    el('span', 'dim', 'Attaches the hello integrity report, the export refusal detail, and what the node reported about the chain.'),
    btn(qLabel('repair quarantined log'), 'primary', () => addQ('repair quarantined log', 'hello: ' + (S.rail?.integrityRaw || '?') + ' · export: 503 log_integrity · tampered ' + JSON.stringify(S.exportError?.tampered || []), 'Integrity')),
  ]));
  return wrap;
}

// ---------- AGENT ----------
function renderAgent() {
  const box = h('div', 'pad');
  if (S.agentSub === 'queue') {
    box.append(el('div', 'route-line', '→ ' + (S.route === 'copy' ? 'clipboard (copy only)' : S.outPath)));
    if (!S.queue.length) box.append(el('span', 'dim', 'Nothing queued. Use + Queue on any gap, problem, or message to hand it to your agent.'));
    for (const q of S.queue) {
      const card = el('button', 'q-item' + (q.checked ? '' : ' off') + ' src-' + q.source);
      card.onclick = () => { q.checked = !q.checked; render(); };
      card.append(h('span', null, q.checked ? '☑' : '☐'), h('div', null, [el('div', 'qt', q.title), el('div', 'qe', q.evidence), el('div', 'qs', q.source)]));
      box.append(card);
    }
    const g = el('input', 'goal'); g.placeholder = 'Goal (one line, optional)'; g.value = S.goal; g.onchange = () => { S.goal = g.value; save(); };
    box.append(g);
    const checked = S.queue.filter((q) => q.checked);
    const acts = h('div', 'rowlist');
    const ho = btn('Hand off ' + checked.length + ' task' + (checked.length === 1 ? '' : 's'), 'primary', handOff);
    if (!S.route || !checked.length) ho.disabled = true, ho.title = !S.route ? 'Set a route first (Route tab).' : 'Nothing checked.';
    acts.append(ho, btn('Copy', null, () => { navigator.clipboard?.writeText(packetMd(S.goal, checked)).catch(() => {}); }));
    box.append(acts);
    const det = el('details', 'packet'); const sum = el('summary', null, 'Packet preview'); det.append(sum, el('pre', null, packetMd(S.goal, checked)));
    box.append(det);
    return box;
  }
  if (S.agentSub === 'sent') {
    if (!S.sent.length) { box.append(el('span', 'dim', 'Nothing handed off yet.')); }
    const rows = replyRows(S.replies, S.sent);
    rows.forEach((r) => {
      const s = S.sent.find((x) => x.tid === r.tid) || {};
      box.append(h('div', 'sent-card', [
        h('div', 'proofrow', [el('span', null, r.tid + ' · ' + r.title), tag(!!s.fileConfirmed, 'the launcher wrote ' + S.outPath + ' and read it back with this task id')]),
        el('div', 'tid', s.source ? 'source: ' + s.source : ''),
        h('div', 'proofrow', [el('span', 'dim', r.reply), tag(false, 'agent replies are never verified — only a fresh conform run turns an item verified')]),
      ]));
    });
    box.append(el('div', 'notice', 'Agent replies stay asserted. An item turns verified only after Conform or hello confirms the fix.'),
      btn('Refresh replies', 'sm', refreshReplies));
    return box;
  }
  // route
  box.append(el('span', 'h', 'Where does your agent pick up work?'));
  box.append(el('span', 'sub', 'The launcher doesn’t run your agent or talk to it. It leaves tasks where your agent looks.'));
  const mk = (id, title, tagText, tagCls, desc, extra, disabled) => {
    const card = el('button', 'route-card' + (S.routeDraft === id ? ' on' : '') + (disabled ? ' disabled' : ''));
    card.onclick = () => { if (!disabled) S.routeDraft = id; render(); };
    card.append(h('div', 'rt', [el('b', null, title), el('span', 'rtag ' + tagCls, tagText)]), el('span', 'rdesc', desc));
    if (extra) card.append(extra);
    return card;
  };
  const outExtras = h('div', 'rowlist', [
    h('label', null, [el('span', 'dim3', 'outbox'), el('input', 'path', S.outPath)]),
  ]);
  const outIn = el('input', 'path'); outIn.value = S.outPath; outIn.onclick = (e) => e.stopPropagation(); outIn.onchange = () => { S.outPath = outIn.value.trim() || S.outPath; save(); };
  const repIn = el('input', 'path'); repIn.value = S.replyPath; repIn.onclick = (e) => e.stopPropagation(); repIn.onchange = () => { S.replyPath = repIn.value.trim() || S.replyPath; save(); };
  outExtras.replaceChildren(
    h('label', null, [el('span', 'dim3', 'outbox '), outIn]),
    h('label', null, [el('span', 'dim3', 'replies '), repIn]),
    el('div', 'dim3', 'Heartbeat line for your agent:'),
    el('div', 'mono dim', 'Every 30 min: read ' + S.outPath + '. Work any task with status: open. Append "ack T-xxx" or a short result to ' + S.replyPath + '. Don’t edit the outbox.'),
  );
  box.append(mk('outbox', 'Outbox file', 'works with any agent', '', 'The launcher writes a markdown file. Point your agent’s heartbeat at it.', outExtras, false));
  box.append(mk('endpoint', 'Endpoint', 'not built · open question', 'part-status warn', 'POST the packet to a URL you supply. OUT OF SCOPE this month: the credentials question is unresolved (see README). No placeholder code exists for this route.', null, true));
  box.append(mk('copy', 'Copy only', '', 'dim3', 'You paste the packet into your agent yourself.', null, false));
  const sb = btn(S.routeDraft === 'outbox' ? 'Save + write test task' : S.routeDraft === 'copy' ? 'Use copy only' : 'Not available yet', 'primary', async () => {
    if (S.routeDraft === 'endpoint') return;
    S.route = S.routeDraft; save();
    if (S.routeDraft === 'outbox' && !S.testWritten) {
      const r = await post('/agent/queue', { goal: S.goal, items: [{ title: 'launcher route test', evidence: 'test task written when the outbox route was saved', source: 'Route' }] });
      if (r.ok && r.body?.written) { S.testWritten = true; S.test = r.body.tids[0]; S.testConfirmed = !!r.body.confirmed_on_readback; }
    }
    render();
  });
  if (!S.routeDraft || S.routeDraft === 'endpoint') sb.disabled = true;
  box.append(sb);
  if (S.test) box.append(h('div', 'sent-card', [
    h('div', 'proofrow', [el('span', null, 'Test task ' + S.test + ' written'), tag(S.testConfirmed, 'launcher wrote and read back the outbox')]),
    h('div', 'proofrow', [el('span', 'dim', S.replies.find((r) => r.tid === S.test) ? S.replies.find((r) => r.tid === S.test).text : 'Waiting for a reply in ' + S.replyPath.split('/').pop() + '…'), tag(false, 'asserted — reply watcher only reads')]),
  ]));
  return box;
}

// ---------- shell ----------
function render() {
  win.replaceChildren();
  win.append(renderTitlebar(), renderRails());
  const banner = renderBanner(); if (banner) win.append(banner);
  const body = h('div', 'body');
  if (S.view === 'setup') body.append(renderSetup());
  else if (S.issueOpen) body.append(renderIssue());
  else if (S.mode === 'manage') {
    win.append(renderTabbar());
    body.append({ keys: renderKeys, config: renderConfig, parts: renderParts, conform: renderConform, hello: renderHello, baseline: renderBaseline }[S.tab]());
  } else {
    win.append(renderAgentbar());
    body.append(renderAgent());
  }
  win.append(body, footer());
  document.documentElement.dataset.theme = S.theme;
}

// first open = the living README (the setup walkthrough), on the same tabs.
render();
loadCfg();

// PWA app shell: register the service worker. sw.js caches static assets only (network-first)
// and steps aside from every dynamic route (/api, /ops, /agent, /health) - freshness by hash means
// nothing the server can change today is ever answered from yesterday's cache.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
