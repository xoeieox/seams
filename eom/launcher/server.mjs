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
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  WIRE_PIN, NODE_YAML_DEFAULT, renderDeclarations, appendPacket, parseReplies, parseQueueTasks,
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
fs.mkdirSync(OPS_DIR, { recursive: true });

const HEADERS = {
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
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
async function proxy(res, method, apiPath, body) {
  let r;
  try {
    r = await fetch(NODE_ONE_URL + apiPath, {
      method,
      headers: method === 'POST' ? { 'content-type': 'application/json' } : {},
      body: method === 'POST' ? body : undefined,
    });
  } catch (e) {
    return fail(res, 502, 'node_unreachable', `Cannot reach node-one at ${NODE_ONE_URL} (${e.cause?.code || e.message}). Start it: node eom/node-one/attributed-text/server.mjs`);
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
        node_one: NODE_ONE_URL, ops_dir: OPS_DIR,
        agent_routes: ['outbox', 'copy'],
        agent_endpoint_route: 'out-of-scope this month: the credentials question is unresolved (see README)',
      });
    }

    // node-one, same origin, byte-verbatim
    if (p === '/api/hello' && req.method === 'GET') return proxy(res, 'GET', '/api/hello');
    if (p === '/api/export' && req.method === 'GET') return proxy(res, 'GET', '/api/export');
    if (p === '/api/ingest' && req.method === 'POST') return proxy(res, 'POST', '/api/ingest', await readBody(req));

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
        .map((it) => ({ title: cleanStr(it.title, 120), evidence: cleanStr(it.evidence, 400), source: cleanStr(it.source, 40) }))
        .filter((it) => it.title);
      if (!clean.length) return fail(res, 400, 'empty_queue', 'Nothing to write: no queue items.');
      const goal = cleanStr(b.goal, 200);
      const file = opsFile('agent-queue.md');
      const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      const { text, tids } = appendPacket(existing, goal, clean);
      fs.writeFileSync(file, text);
      const readback = fs.readFileSync(file, 'utf8');
      const confirmed = tids.every((t) => readback.includes('## ' + t + ' '));
      return send(res, 200, { ok: true, written: true, path: path.relative(here, file), tids, confirmed_on_readback: confirmed });
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
