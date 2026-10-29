// Seams launcher server - zero deps, Node 18+. `node server.mjs` (PORT, NODE_ONE_URL, OPS_DIR).
// EoM build leg 2026-10-26 (branch eom-node-one). Local/loopback only: this server binds 127.0.0.1
// and REFUSES to start if NODE_ONE_URL points anywhere but loopback - exposure (bind/TLS/proxy) is
// blocked-on-ruling and there is deliberately no exposure UI to configure one.
//
// What it is: a tiny static server for the launcher window plus a same-origin proxy for the three
// node-one endpoints (hello / ingest / export) so the browser CSP can stay 'self' and the pass-through
// is byte-verbatim (receipts and export bytes arrive exactly as node-one sent them - opaque hashes
// are never re-derived here either). It also owns the agent hand-off files: the outbox markdown
// (ops/agent-queue.md) and the reply-watcher reads (ops/agent-replies.md), plus the two ops files the
// Config tab edits (node.yaml, declarations.yaml) and parts.json. It does NOT run or talk to any
// agent - it leaves markdown where the agent's heartbeat looks.
//
// KEYS pass (EOM-KEYS-2026-10-28, owner GO xErah): the launcher holds the operator's node keypair
// (OPS_DIR/node-key.json, 0600, same file shape as scripts/send-hello.mjs) and is the ONLY signer
// for the window: POST /agent/emit attaches `sig` over the canonical body (keys.mjs, shared code -
// the launcher does not re-implement crypto, one implementation exists) and forwards the signed
// bytes to node-one verbatim; the upstream reply returns verbatim, so the receipt (and its honest
// creator_verified) is the gateway's own words, never the launcher's. The private half leaves this
// process only through the explicit POST /agent/keys/export (loopback-only server by ruling) so an
// operator can back their key up or move it - and never to any network but 127.0.0.1.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  WIRE_PIN, helloGate, canEmit, NODE_YAML_DEFAULT, renderDeclarations, appendPacket, parseReplies, parseQueueTasks,
  composeBrief, lintPointers,
} from './launcher-core.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const OPS_DIR = process.env.OPS_DIR || path.join(here, 'ops');
const NODE_ONE_URL = (process.env.NODE_ONE_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '');

// --- local/loopback posture gate (must-never: nothing external) -----------------------------
function loopbackOnly(u) {
  try {
    const p = new URL(u);
    if (p.protocol !== 'http:') return false;
    return ['127.0.0.1', 'localhost', '[::1]'].includes(p.hostname);
  } catch { return false; }
}
if (!loopbackOnly(NODE_ONE_URL)) {
  console.error(`launcher refuses to start: NODE_ONE_URL=${JSON.stringify(NODE_ONE_URL)} is not loopback.`);
  console.error('The launcher runs local/loopback only; exposure is blocked-on-ruling. Point NODE_ONE_URL at a 127.0.0.1 server.');
  process.exit(1);
}

// --- optional public gateway target (ruling R1, 2026-10-29: emit-only, config-injected, no UI) ----
// Set SEAMS_GATEWAY_URL to a bare origin (https, or loopback http for tests). There is no UI for it and
// no runtime setter: an operator injects it at boot or there is no remote surface at all. The surface it
// opens is exactly four routes (/gateway/hello|export|deposits GET, /gateway/emit POST); the local node
// stays loopback-only, the wire pin is checked against the gateway's own hello before every send, and
// only this server signs. Key material never leaves; /agent/keys* never touch the gateway.
const GATEWAY_URL = (process.env.SEAMS_GATEWAY_URL || '').replace(/\/+$/, '') || null;
function gatewayOk(u) {
  try {
    const p = new URL(u);
    if (p.username || p.password || p.search || p.hash || (p.pathname !== '/' && p.pathname !== '')) return false;
    return p.protocol === 'https:' || loopbackOnly(u);
  } catch { return false; }
}
if (GATEWAY_URL && !gatewayOk(GATEWAY_URL)) {
  console.error(`launcher refuses to start: SEAMS_GATEWAY_URL=${JSON.stringify(GATEWAY_URL)} must be a bare https origin (no credentials, path, query).`);
  process.exit(1);
}
fs.mkdirSync(OPS_DIR, { recursive: true });

const HEADERS = {
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; manifest-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store',
};
const send = (res, code, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(code, { 'content-type': type, ...HEADERS });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const fail = (res, code, error, message) => send(res, code, { error, message });

const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/app.css': ['app.css', 'text/css; charset=utf-8'],
  '/launcher-core.mjs': ['../launcher-core.mjs', 'text/javascript; charset=utf-8'],
  // PWA shell (installable app window). sw.js caches THESE only - never /api, /ops, /agent (see public/sw.js).
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json; charset=utf-8'],
  '/sw.js': ['sw.js', 'text/javascript; charset=utf-8'],
  '/icons/icon-192.png': ['icons/icon-192.png', 'image/png'],
  '/icons/icon-512.png': ['icons/icon-512.png', 'image/png'],
  '/icons/apple-touch-icon.png': ['icons/apple-touch-icon.png', 'image/png'],
};
const OPS_FILES = new Set(['node.yaml', 'declarations.yaml', 'parts.json']);
const OPS_DEFAULTS = {
  'node.yaml': NODE_YAML_DEFAULT,
  'declarations.yaml': renderDeclarations([]),
  'parts.json': '{}',
};
const opsFile = (name) => path.join(OPS_DIR, name);
const readOps = (name) => (fs.existsSync(opsFile(name)) ? fs.readFileSync(opsFile(name), 'utf8') : OPS_DEFAULTS[name]);
const writeOps = (name, text) => { fs.writeFileSync(opsFile(name), text); };

// keys.mjs lives in the node-one tree; resolve it across the repo/bundle layouts (same candidates
// the test suite uses). One implementation of the key format, signing and verification - here too.
const KEYS_CANDIDATES = [
  path.join(here, 'node-one', 'attributed-text', 'keys.mjs'),      // bundle layout (flat tree)
  path.join(here, '..', 'node-one', 'attributed-text', 'keys.mjs'), // repo layout
];
const K = await import('file://' + (KEYS_CANDIDATES.find((p) => fs.existsSync(p)) || KEYS_CANDIDATES[1]));

// The launcher's key custody file: the SAME {v:1, node_key, priv_b64} shape keys.mjs pins, at a
// fixed OPS_DIR path, written 0600 by its owner. Storage only - the format is validated by
// keys.mjs's reader (shape + private/public self-consistency) before anything reads it.
function writeLauncherKeyFile(pair) {
  if (!pair || !pair.nodeKey || !pair.privB64) throw new Error('need {nodeKey, privB64}');
  const file = opsFile('node-key.json');
  fs.writeFileSync(file, JSON.stringify({ v: 1, node_key: pair.nodeKey, priv_b64: pair.privB64 }) + '\n', { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch { /* best effort on odd filesystems */ }
  return file;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 64 * 1024) { reject(new Error('too_big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
const cleanStr = (s, max = 200) => String(s ?? '').normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

// The proxy: byte-verbatim pass-through. No re-serialization anywhere on the response path -
// an opaque hash that survives here unchanged is the whole honesty story of the Baseline tab.
async function proxy(res, method, apiPath, body, base = NODE_ONE_URL) {
  let r;
  try {
    r = await fetch(base + apiPath, {
      method,
      headers: method === 'POST' ? { 'content-type': 'application/json' } : {},
      body: method === 'POST' ? body : undefined,
    });
  } catch (e) {
    return fail(res, 502, 'node_unreachable', `Cannot reach ${base === NODE_ONE_URL ? 'node-one' : 'the gateway'} at ${base} (${e.cause?.code || e.message}).${base === NODE_ONE_URL ? ' Start it: node eom/node-one/attributed-text/server.mjs' : ''}`);
  }
  const text = await r.text();
  res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'application/json; charset=utf-8', ...HEADERS });
  res.end(text);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'), p = url.pathname;
  try {
    if (req.method === 'GET' && STATIC[p]) {
      const [file, type] = STATIC[p];
      return send(res, 200, fs.readFileSync(path.join(here, 'public', file)), type);
    }
    if (req.method === 'GET' && p === '/health') {
      return send(res, 200, {
        ok: true, node: 'seams-launcher', wire_pin: WIRE_PIN, posture: 'local-only',
        node_one: NODE_ONE_URL, gateway: GATEWAY_URL, ops_dir: OPS_DIR,
        agent_routes: ['outbox', 'copy'],
        agent_endpoint_route: 'out-of-scope this month: the credentials question is unresolved (see README)',
      });
    }

    // node-one, same origin, byte-verbatim
    if (p === '/api/hello' && req.method === 'GET') return proxy(res, 'GET', '/api/hello');
    if (p === '/api/export' && req.method === 'GET') return proxy(res, 'GET', '/api/export');
    if (p === '/api/ingest' && req.method === 'POST') return proxy(res, 'POST', '/api/ingest', await readBody(req));
    if (p === '/api/deposits' && req.method === 'GET') return proxy(res, 'GET', '/api/deposits' + url.search);

    // Public gateway (R1): present only when SEAMS_GATEWAY_URL was injected at boot; otherwise 404.
    if (p.startsWith('/gateway/')) {
      if (!GATEWAY_URL) return fail(res, 404, 'no_gateway', 'No gateway target is configured (SEAMS_GATEWAY_URL). Nothing was sent.');
      if (p === '/gateway/hello' && req.method === 'GET') return proxy(res, 'GET', '/api/hello', undefined, GATEWAY_URL);
      if (p === '/gateway/export' && req.method === 'GET') return proxy(res, 'GET', '/api/export', undefined, GATEWAY_URL);
      if (p === '/gateway/deposits' && req.method === 'GET') return proxy(res, 'GET', '/api/deposits' + url.search, undefined, GATEWAY_URL);
      if (p === '/gateway/emit' && req.method === 'POST') {
        let b; try { b = JSON.parse((await readBody(req)) || '{}'); } catch { return fail(res, 400, 'bad_json', 'Bad request.'); }
        const kf = K.readKeyPairFile(opsFile('node-key.json'));
        if (!kf) return fail(res, 400, 'no_key', 'The launcher holds no key yet - mint one in the Keys tab first. Nothing was sent.');
        const body = b.body && typeof b.body === 'object' ? { ...b.body } : null;
        if (!body) return fail(res, 400, 'bad_body', 'body must be an emit object.');
        if (body.op !== 'emit') return fail(res, 400, 'unknown_op', 'The gateway route sends op "emit" only.');
        if (body.node_key === undefined || body.node_key === null || body.node_key === '') body.node_key = kf.nodeKey;
        if (body.node_key !== kf.nodeKey) return fail(res, 400, 'foreign_key', 'This window signs only with the key it holds; a different node_key is refused before anything leaves.');
        // rails before emit, against the GATEWAY's own hello, fetched now: pinned wire, closed gate, not quarantined
        let hello = null;
        try { const h = await fetch(GATEWAY_URL + '/api/hello'); hello = await h.json(); } catch { /* unreachable: held below */ }
        const hold = canEmit({ rail: helloGate(hello), quarantined: hello && /QUARANTINED/i.test(String(hello.integrity || '')) });
        if (!hold.allow) return send(res, 409, { error: hold.hold.name, message: hold.hold.msg, foot: hold.hold.foot });
        delete body.sig;
        body.sig = K.signBody(kf.privB64, body);
        return proxy(res, 'POST', '/api/ingest', JSON.stringify(body), GATEWAY_URL);
      }
      return fail(res, 404, 'not_found', 'Not found.');
    }

    // KEYS custody (EOM-KEYS-2026-10-28): the window's node keypair lives here, at 0600, in OPS_DIR.
    // The only signer is this server; /agent/emit adds `sig` and forwards verbatim - nothing else on
    // the request path changes, and the upstream reply is byte-verbatim like every other proxy leg.
    if (p === '/agent/keys' && req.method === 'GET') {
      const kf = K.readKeyPairFile(opsFile('node-key.json'));
      if (!kf) return send(res, 200, { present: false });
      let registered = null; let verifiedDeposits = null;
      try { // fetched, never asserted: registration and the verified count come from the gateway itself
        const r = await fetch(NODE_ONE_URL + '/api/deposits?node_key=' + encodeURIComponent(kf.nodeKey));
        if (r.ok) { const j = await r.json(); registered = !!j.registered; verifiedDeposits = (j.entries || []).filter((e) => e.creator_verified === true).length; }
      } catch { /* gateway unreachable: honest null, not a fabricated false */ }
      return send(res, 200, { present: true, node_key: kf.nodeKey, fingerprint: K.fingerprintOf(kf.nodeKey), registered, verified_deposits: verifiedDeposits, file: opsFile('node-key.json') });
    }
    if (p === '/agent/keys/mint' && req.method === 'POST') {
      let b = {}; try { b = JSON.parse((await readBody(req)) || '{}'); } catch { /* {} fine */ }
      if (K.readKeyPairFile(opsFile('node-key.json')) && !b.replace) return fail(res, 409, 'key_exists', 'A key is already held. Rotate explicitly (replace:true) - minting over a live key without saying so is not offered.');
      const pair = K.generateKeyPair();
      writeLauncherKeyFile(pair);
      return send(res, 200, { ok: true, node_key: pair.nodeKey, fingerprint: pair.pubB64.slice(0, 8) });
    }
    if (p === '/agent/keys/export' && req.method === 'POST') {
      const raw = opsFile('node-key.json');
      if (!fs.existsSync(raw)) return fail(res, 404, 'no_key', 'The launcher holds no key yet. Mint one first.');
      const buf = fs.readFileSync(raw); // verbatim file bytes; the operator's own key, loopback-only server
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-disposition': 'attachment; filename="seams-node-key.json"', ...HEADERS });
      return res.end(buf);
    }
    if (p === '/agent/keys/import' && req.method === 'POST') {
      let b; try { b = JSON.parse((await readBody(req)) || '{}'); } catch { return fail(res, 400, 'bad_json', 'Bad request.'); }
      const text = typeof b.key_file === 'string' ? b.key_file : JSON.stringify(b.key ?? {});
      if (K.readKeyPairFile(opsFile('node-key.json')) && !b.replace) return fail(res, 409, 'key_exists', 'A key is already held; pass replace:true to swap deliberately.');
      // validate through the SAME parser the custody read uses: shape, base64, private/public match - or nothing lands
      const tmp = opsFile('node-key.json.importing');
      fs.writeFileSync(tmp, text, { mode: 0o600 });
      const kf = K.readKeyPairFile(tmp);
      if (!kf) { try { fs.unlinkSync(tmp); } catch { /* ours, seconds old */ } return fail(res, 400, 'bad_key_file', 'Not a seams node key file: shape, key/priv match, or pubkey format failed.'); }
      fs.renameSync(tmp, opsFile('node-key.json'));
      try { fs.chmodSync(opsFile('node-key.json'), 0o600); } catch { /* best effort on odd filesystems */ }
      return send(res, 200, { ok: true, node_key: kf.nodeKey, fingerprint: K.fingerprintOf(kf.nodeKey) });
    }
    if (p === '/agent/emit' && req.method === 'POST') {
      let b; try { b = JSON.parse((await readBody(req)) || '{}'); } catch { return fail(res, 400, 'bad_json', 'Bad request.'); }
      const kf = K.readKeyPairFile(opsFile('node-key.json'));
      if (!kf) return fail(res, 400, 'no_key', 'The launcher holds no key yet - mint one in the Keys tab first. Nothing was sent.');
      const body = b.body && typeof b.body === 'object' ? { ...b.body } : null;
      if (!body) return fail(res, 400, 'bad_body', 'body must be an emit object.');
      if (body.node_key === undefined || body.node_key === null || body.node_key === '') body.node_key = kf.nodeKey;
      if (body.node_key !== kf.nodeKey) return fail(res, 400, 'foreign_key', 'This window signs only with the key it holds; a different node_key is refused before anything leaves.');
      delete body.sig; // never sign over a signature: the canonical form is the body MINUS sig
      body.sig = K.signBody(kf.privB64, body);
      return proxy(res, 'POST', '/api/ingest', JSON.stringify(body));
    }

    // ops file editors (the three files the launcher owns; names whitelisted, traversal dead on arrival)
    if (p === '/ops/file' && req.method === 'GET') {
      const name = url.searchParams.get('name') || '';
      if (!OPS_FILES.has(name)) return fail(res, 400, 'bad_file', 'name must be one of: ' + [...OPS_FILES].join(', '));
      return send(res, 200, { name, text: readOps(name) });
    }
    if (p === '/ops/file' && req.method === 'POST') {
      let b; try { b = JSON.parse((await readBody(req)) || '{}'); } catch { return fail(res, 400, 'bad_json', 'Bad request.'); }
      const name = b.name;
      if (!OPS_FILES.has(name)) return fail(res, 400, 'bad_file', 'name must be one of: ' + [...OPS_FILES].join(', '));
      const text = String(b.text ?? '').slice(0, 64 * 1024);
      writeOps(name, text);
      return send(res, 200, { ok: true, name, written: true, at: new Date().toISOString() });
    }

    // agent hand-off, Route 1 (outbox) + Route 3 (copy is client-side clipboard)
    if (p === '/agent/queue' && req.method === 'POST') {
      let b; try { b = JSON.parse((await readBody(req)) || '{}'); } catch { return fail(res, 400, 'bad_json', 'Bad request.'); }
      const items = Array.isArray(b.items) ? b.items.slice(0, 50) : [];
      const clean = items
        .map((it) => ({
          title: cleanStr(it.title, 120), evidence: cleanStr(it.evidence, 400), source: cleanStr(it.source, 40),
          brief: it.brief && typeof it.brief === 'object' ? {
            goal: cleanStr(it.brief.goal, 200),
            accept: cleanStr(it.brief.accept, 300),
            pointers: Array.isArray(it.brief.pointers) ? it.brief.pointers.slice(0, 8).map((p2) => cleanStr(p2, 200)).filter(Boolean) : null,
          } : null,
        }))
        .filter((it) => it.title);
      if (!clean.length) return fail(res, 400, 'empty_queue', 'Nothing to write: no queue items.');
      const goal = cleanStr(b.goal, 200);
      // Self-contained hand-off briefs (Mac run #4): every open entry carries a brief. The human's
      // typed goal wins; otherwise the launcher COMPOSES one from queue-time tab context
      // (source + title + evidence), pointing at packet docs the agent can read for itself.
      // No goal AND nothing to compose from = readable refusal: the outbox takes no silent
      // open tasks. Every pointer is linted against the packet on disk - bundle-first,
      // repo-sibling fallback (the launch.mjs layout doctrine). One bad field refuses the whole
      // write; nothing partial ever lands.
      const built = [];
      for (const it of clean) {
        const br = composeBrief(it, goal);
        if (!br) return fail(res, 400, 'unbriefed_task',
          `Task '${it.title}' has no goal and no queue-time tab context to compose a brief from (source: ${it.source || 'none'}). ` +
          'Write a goal, or queue the item from the tab that has the context - the outbox takes no silent open tasks.');
        const bad = lintPointers(br.pointers, (cands) => cands.some((c) => fs.existsSync(path.resolve(here, c))));
        if (bad.length) return fail(res, 400, 'bad_pointer',
          `Brief for '${it.title}' points at packet paths that do not exist: ${bad.join(', ')}. ` +
          'Pointer lint refused the whole write; nothing was queued.');
        built.push({ ...it, brief: br });
      }
      const file = opsFile('agent-queue.md');
      const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      const { text, tids } = appendPacket(existing, goal, built);
      fs.writeFileSync(file, text);
      const readback = fs.readFileSync(file, 'utf8');
      const confirmed = tids.every((t) => readback.includes('## ' + t + ' '));
      return send(res, 200, { ok: true, written: true, path: path.relative(here, file), tids, briefed: true, confirmed_on_readback: confirmed });
    }
    if (p === '/agent/state' && req.method === 'GET') {
      const file = opsFile('agent-queue.md');
      const exists = fs.existsSync(file);
      return send(res, 200, {
        outbox: { path: path.relative(here, file), exists, tasks: exists ? parseQueueTasks(fs.readFileSync(file, 'utf8')) : [] },
      });
    }
    if (p === '/agent/replies' && req.method === 'GET') {
      const file = opsFile('agent-replies.md');
      const exists = fs.existsSync(file);
      // every entry honesty:'asserted' - parseReplies guarantees it; a fresh conform run is what
      // turns an item verified, never a line in a reply file.
      const entries = exists ? parseReplies(fs.readFileSync(file, 'utf8')) : [];
      return send(res, 200, { exists, path: path.relative(here, file), entries, honesty: 'asserted' });
    }

    fail(res, 404, 'not_found', 'Not found.');
  } catch (err) {
    if (err && /too_big/.test(String(err.message || ''))) return fail(res, 413, 'too_big', 'Body over 64 KB.');
    console.error(err); fail(res, 500, 'server_error', 'Something went wrong.');
  }
});
server.listen(PORT, '127.0.0.1', () => {
  const port = (server.address() || {}).port || PORT;
  console.log(`seams-launcher listening on http://127.0.0.1:${port} (local only; node-one ${NODE_ONE_URL}; ops ${OPS_DIR}; wire pin ${WIRE_PIN})`);
});
// Port hygiene: a second start on a taken port is an already-running launcher, not a crash.
// (launch.mjs probes first; this catches the race and the bare `node server.mjs` path Erah hit today.)
server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.log(`seams-launcher already running on 127.0.0.1:${PORT} - open http://127.0.0.1:${PORT} (nothing new started; if that is not the launcher, free the port or set PORT= and run again)`);
    process.exit(0);
  }
  console.error(`seams-launcher could not listen on 127.0.0.1:${PORT}: ${err && err.message ? err.message : err}`);
  process.exit(1);
});
