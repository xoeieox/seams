// Zero-dependency server: JSON API + static files. `node server.mjs` (BIND_HOST, PORT, DATA_DIR, ADMIN_TOKEN optional).
// T1 pre-exposure hardening (EoM build leg, 2026-10-26; smoke T1a-T1d verdict):
//   - binds loopback by default; exposure beyond loopback is a separate host/exposure ruling;
//   - the rate key is the socket peer address ONLY. cf-connecting-ip / x-forwarded-for are
//     attacker-controlled headers and are NEVER read for identity (T1: the kit trusted them);
//   - a request that fails validation or the store does not burn rate budget (peek/charge split);
//   - the admin token is never echoed to stdout: it lives only in DATA_DIR/admin-token.txt (0600).
// The ingest gate is net-new (build-leg item 1): fail-closed, idempotent, closed kind set.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Store, StoreError, nameKey, WIRE_VERSION, GATE_KINDS, KIND_MAP, MAX_TEXT, MAX_NAME } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const HOST = process.env.BIND_HOST || '127.0.0.1';   // T1: loopback until the exposure ruling
const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = process.env.DATA_DIR || path.join(here, 'data');
const EDIT_LIMIT = Number(process.env.EDIT_LIMIT || 10);          // per socket-IP per window
const INGEST_LIMIT = Number(process.env.INGEST_LIMIT || 30);      // per socket-IP per window
const GLOBAL_LIMIT = Number(process.env.GLOBAL_LIMIT || 80);      // all sockets per window, per class
const WINDOW_MS = Number(process.env.WINDOW_MS || 10 * 60 * 1000);

fs.mkdirSync(DATA_DIR, { recursive: true });
const store = new Store(path.join(DATA_DIR, 'log.jsonl'));
if (store.empty) {
  const seed = JSON.parse(fs.readFileSync(path.join(here, 'seed.json'), 'utf8'));
  store.seed(seed.text, seed.author);
}

let adminToken = process.env.ADMIN_TOKEN;
if (!adminToken) {
  const f = path.join(DATA_DIR, 'admin-token.txt');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(12).toString('hex') + '\n', { mode: 0o600 });
  adminToken = fs.readFileSync(f, 'utf8').trim();
}
const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();
const tokenOk = (t) => crypto.timingSafeEqual(digest(t), digest(adminToken));

// Rate limiting: sliding windows in memory, keyed on the socket peer address (T1 fix -
// header-supplied "client IPs" were spoofable and let one client burn or bypass another's budget).
// peek() answers "at limit?" without recording; charge() records a SUCCESSFUL mutation only,
// so malformed/hostile requests and store rejections cannot exhaust an honest client's window.
const hits = new Map();
function peek(bucket, max) {
  const now = Date.now(), arr = (hits.get(bucket) || []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= max) { hits.set(bucket, arr); return Math.ceil((WINDOW_MS - (now - arr[0])) / 1000); }
  hits.set(bucket, arr); return 0;
}
function charge(bucket) {
  const now = Date.now(), arr = (hits.get(bucket) || []).filter((t) => now - t < WINDOW_MS);
  arr.push(now); hits.set(bucket, arr);
}
setInterval(() => { const now = Date.now(); for (const [k, a] of hits) if (!a.some((t) => now - t < WINDOW_MS)) hits.delete(k); }, 60000).unref();
const socketIp = (req) => req.socket.remoteAddress || 'unknown-socket';

const STATIC = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/app.css': ['app.css', 'text/css; charset=utf-8'] };
const HEADERS = {
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store',
};

const send = (res, code, body, type = 'application/json; charset=utf-8', extra = {}) => {
  res.writeHead(code, { 'content-type': type, ...HEADERS, ...extra });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const fail = (res, code, error, message, extra = {}, headers = {}) => send(res, code, { error, message, ...extra }, undefined, headers);

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 64 * 1024) { reject(new StoreError('too_big', 'Request too large.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new StoreError('bad_json', 'Bad request.')); } });
    req.on('error', reject);
  });
}
// A3-style version echo: every ingest/emit response and the hello handshake carry the wire
// version the server actually speaks, so a client can pin instead of guessing.
const wireEcho = { wire: WIRE_VERSION };
const STATUS = {
  name_required: 400, empty: 400, too_long: 413, bad_base: 400, bad_version: 404, no_change: 409,
  conflict: 409, too_big: 413, bad_json: 400,
  // ingest-gate codes (net-new in this build leg):
  unknown_op: 400, bad_node_key: 400, unknown_kind: 400, bad_request: 400, bad_content: 400,
  bad_origin: 400, already_deposited: 409, parents_on_original: 400,
  consent_gate_unbuilt: 501, log_integrity: 503,
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'), p = url.pathname;
  try {
    if (req.method === 'GET' && STATIC[p]) {
      const [file, type] = STATIC[p];
      return send(res, 200, fs.readFileSync(path.join(here, 'public', file)), type);
    }
    if (req.method === 'GET' && p === '/api/hello') {
      return send(res, 200, {
        ok: true, node: 'node-one', ...wireEcho,
        format: 'seams-attribution-log/0-eom.1',
        gate: { kinds: GATE_KINDS, maps: KIND_MAP, on_unknown: 'refuse (unknown_kind), never accept-and-map-silently' },
        limits: { max_text: MAX_TEXT, max_name: MAX_NAME, max_body_bytes: 64 * 1024 },
        idempotence: 'keyed on payload hash of the canonical emit body; replays ack the original receipt',
        integrity: store.integrity.ok ? 'ok' : 'QUARANTINED (export refuses until operator review)',
      });
    }
    if (req.method === 'GET' && p === '/api/state') return send(res, 200, store.state());
    if (req.method === 'GET' && p === '/api/versions') return send(res, 200, store.versions());
    let m;
    if (req.method === 'GET' && (m = p.match(/^\/api\/version\/(\d+)$/))) {
      const e = store.entry(Number(m[1]));
      return e ? send(res, 200, { v: e.v, ts: e.ts, name: e.name, kind: e.kind, restored_v: e.restored_v, segs: e.segs, authors: store.authors() }) : fail(res, 404, 'bad_version', 'Unknown version.');
    }
    if (req.method === 'GET' && (m = p.match(/^\/api\/author\/(.+)$/))) {
      const l = store.lineage(nameKey(decodeURIComponent(m[1])));
      return l ? send(res, 200, { ...l, authors: store.authors() }) : fail(res, 404, 'unknown_author', 'No such name.');
    }
    if (req.method === 'GET' && p === '/api/export') {
      // export() itself refuses when the load-time chain check flagged tampering (T5a:
      // a tampered log is quarantined, never re-hashed into cleanliness and never served).
      return send(res, 200, JSON.stringify(store.export(), null, 2), 'application/json; charset=utf-8', { 'content-disposition': 'attachment; filename="attribution-log.json"' });
    }
    if (req.method === 'POST' && p === '/api/edit') {
      const ip = 'edit-ip:' + socketIp(req);
      const wait = peek(ip, EDIT_LIMIT) || peek('edit-global', GLOBAL_LIMIT);
      if (wait) return fail(res, 429, 'rate_limited', `Too many saves. Try again in ${Math.ceil(wait / 60)} min.`, {}, { 'retry-after': String(wait) });
      const b = await readJson(req);
      const e = store.edit({ name: b.name, text: b.text, baseV: Number(b.base_v) });   // throw => no charge
      charge(ip); charge('edit-global');
      return send(res, 200, { ok: true, ...wireEcho, state: store.state(), saved_v: e.v });
    }
    if (req.method === 'POST' && p === '/api/ingest') {
      // The join gate. Closed set, fail-closed receipts, payload-hash idempotence (all in Store.ingest).
      const ip = 'ingest-ip:' + socketIp(req);
      const wait = peek(ip, INGEST_LIMIT) || peek('ingest-global', GLOBAL_LIMIT);
      if (wait) return fail(res, 429, 'rate_limited', `Too many emits. Try again in ${Math.ceil(wait / 60)} min.`, {}, { 'retry-after': String(wait) });
      const b = await readJson(req);
      const receipt = store.ingest(b);                       // gate refusals throw => no rate burn
      if (receipt.status === 'deposited' && !receipt.duplicate) { charge(ip); charge('ingest-global'); }
      return send(res, 200, { ok: true, ...wireEcho, ...receipt });
    }
    if (req.method === 'POST' && p === '/api/admin/revert') {
      // Admin attempts charge up front: failed-token retries are the attack to price here,
      // not an honest user's validation slip.
      if (peek('admin:' + socketIp(req), 10)) return fail(res, 429, 'rate_limited', 'Slow down.');
      charge('admin:' + socketIp(req));
      const b = await readJson(req);
      if (!b.token || !tokenOk(b.token)) return fail(res, 403, 'forbidden', 'Wrong admin token.');
      store.revert(Number(b.to_v));
      return send(res, 200, { ok: true, state: store.state() });
    }
    fail(res, 404, 'not_found', 'Not found.');
  } catch (err) {
    if (err instanceof StoreError) return fail(res, STATUS[err.code] || 400, err.code, err.message, err.extra);
    console.error(err); fail(res, 500, 'server_error', 'Something went wrong.');
  }
});
server.listen(PORT, HOST, function () {
  const port = (server.address() || {}).port || PORT;
  console.log(`attributed-text node-one listening on http://${HOST}:${port} (wire ${WIRE_VERSION}; loopback bind until the exposure ruling)`);
  // T1 fix: the token is never printed. Its location is; the value is read from the 0600 file by the operator.
  console.log(`admin token: ${path.join(DATA_DIR, 'admin-token.txt')} (mode 0600) - open /#/admin and paste it to enable "restore this version"`);
});
