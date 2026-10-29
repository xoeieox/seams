// Zero-dependency server: JSON API + static files. `node server.mjs` (BIND_HOST, PORT, DATA_DIR, ADMIN_TOKEN optional).
// T1 pre-exposure hardening (EoM build leg, 2026-10-26; smoke T1a-T1d verdict):
//   - binds loopback, and since the go-public pass 2026-10-28 that is a RAIL not a default: a
//     non-loopback BIND_HOST refuses to boot unless SEAMS_ALLOW_PUBLIC_BIND=I-know-what-this-means
//     is set (the exposure-ruling escape hatch); the banner then says PUBLIC BIND, never "loopback";
//   - the published rate shape is enforced AT ORIGIN by default (read 300/1500, ingest 10, edit 10,
//     global 80 per 10-min window - Erah ruling 2026-10-26, ratified + shipped 2026-10-28).
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
import { Store, StoreError, nameKey, WIRE_VERSION, GATE_KINDS, KIND_MAP, MAX_TEXT, MAX_NAME, nodeKeyOk } from './lib.mjs';
import { fingerprintOf } from './keys.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const HOST = process.env.BIND_HOST || '127.0.0.1';   // T1: loopback until the exposure ruling
const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = process.env.DATA_DIR || path.join(here, 'data');
const EDIT_LIMIT = Number(process.env.EDIT_LIMIT || 10);          // per socket-IP per window
const INGEST_LIMIT = Number(process.env.INGEST_LIMIT || 10);      // per socket-IP per window - public shape (F3): the loopback default was 30; the ruling is 10
const GLOBAL_LIMIT = Number(process.env.GLOBAL_LIMIT || 80);      // all sockets per window, per write class
const READ_LIMIT = Number(process.env.READ_LIMIT ?? 300);         // all GET reads per socket-IP per window; 0 disables (loopback-dev escape)
const READ_GLOBAL_LIMIT = Number(process.env.READ_GLOBAL_LIMIT ?? 1500); // all GET reads, all sockets; 0 disables
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

// Site-impl wave (2026-10-28): '/' is the HOMEPAGE (board-1a/1b; live window + spine + grid +
// launcher card), the demo rides at '/demo' (and '/text'), and the old honest node-landing
// moves to '/protocol'. Static bytes are deterministic; no inline script (CSP script-src 'self').
const STATIC = { '/': ['home.html', 'text/html; charset=utf-8'], '/text': ['index.html', 'text/html; charset=utf-8'], '/demo': ['index.html', 'text/html; charset=utf-8'], '/attributed-text': ['index.html', 'text/html; charset=utf-8'], '/index.html': ['index.html', 'text/html; charset=utf-8'], '/protocol': ['landing.html', 'text/html; charset=utf-8'], '/home.js': ['home.js', 'text/javascript; charset=utf-8'], '/landing.js': ['landing.js', 'text/javascript; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/app.css': ['app.css', 'text/css; charset=utf-8'] };
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
  bad_origin: 400, already_deposited: 409, parents_on_original: 400, bad_signature: 400,
  consent_gate_unbuilt: 501, log_integrity: 503,
};

// F4 rail (go-public 2026-10-28, keeper F4): "BIND_HOST=0.0.0.0 is honored while the boot banner
// claims loopback-only" - the honesty line was an env DEFAULT, not enforcement. It is a rail now:
// a non-loopback BIND_HOST refuses to boot unless the operator sets the named escape-hatch env to
// the named value, and when they do the banner says PUBLIC BIND instead of lying about loopback.
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', '::ffff:127.0.0.1']);
const PUBLIC_BIND = !LOOPBACK_HOSTS.has(HOST);
if (PUBLIC_BIND && process.env.SEAMS_ALLOW_PUBLIC_BIND !== 'I-know-what-this-means') {
  console.error(`REFUSING TO BOOT: BIND_HOST=${JSON.stringify(HOST)} is not loopback.`);
  console.error('This node speaks the exposure ruling: the attribution node binds loopback ONLY;');
  console.error('public reach is cloudflared demo plumbing dialing IN to the loopback port, never');
  console.error('the server binding a public interface (requirements.yaml host_exposure_ruling).');
  console.error('If you truly mean to expose this process on a public interface, acknowledge the');
  console.error('exposure ruling deliberately:  SEAMS_ALLOW_PUBLIC_BIND=I-know-what-this-means');
  process.exit(1);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'), p = url.pathname;
  let emitRoute = false;   // REQ-EMIT-9: every emit-route response echoes wire - successes AND refusals (conformance suite, 2026-10-26)
  // F2 read tier (go-public 2026-10-28): all GETs share the generous read tier (keeper measured
  // 360/360 unthrottled reads against the published 300/1500 - fiction no more). Same peek/charge
  // machinery as the write tiers: at-limit answers 429 BEFORE serving, and only SUCCESSFUL
  // responses (<400) charge - 404/429/503 refusals burn nothing, so an error flood cannot exhaust
  // an honest visitor's window (the ruling's burn policy, mirrored onto reads).
  let readBucket = null;
  if (req.method === 'GET') {
    const ip = 'read-ip:' + socketIp(req);
    const wait = (READ_LIMIT > 0 && peek(ip, READ_LIMIT)) || (READ_GLOBAL_LIMIT > 0 && peek('read-global', READ_GLOBAL_LIMIT));
    if (wait) return fail(res, 429, 'rate_limited', `Too many reads. Try again in ${Math.ceil(wait / 60)} min.`, {}, { 'retry-after': String(wait) });
    readBucket = ip;
  }
  const _writeHead = res.writeHead.bind(res);
  res.writeHead = (code, ...rest) => {
    if (readBucket && code < 400) { charge(readBucket); if (READ_GLOBAL_LIMIT > 0) charge('read-global'); readBucket = null; }
    return _writeHead(code, ...rest);
  };
  try {
    if (req.method === 'GET' && STATIC[p]) {
      const [file, type] = STATIC[p];
      return send(res, 200, fs.readFileSync(path.join(here, 'public', file)), type);
    }
    if (req.method === 'GET' && p === '/api/hello') {
      return send(res, 200, {
        ok: true, node: 'node-one', ...wireEcho,
        format: 'seams-attribution-log/0-eom.2',
        gate: { kinds: GATE_KINDS, maps: KIND_MAP, on_unknown: 'refuse (unknown_kind), never accept-and-map-silently' },
        signing: 'ed25519: body.sig (base64) over the canonical body minus sig (REQ-SIGN, eom/endpoint-surface/requirements.yaml); verified-at-gate only; a bad sig refuses (bad_signature), never deposits',
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
    if (req.method === 'GET' && p === '/api/deposits') {
      // EOM-KEYS-2026-10-28: the public "what did THIS key deposit" view - a filtered read of
      // export, public exactly like export is (ruled), carrying the same verified/fingerprint
      // truth. A badly formed node_key refuses; an unknown-but-well-formed key answers count 0,
      // it is never a 404 (absence of deposits is an honest answer, not a missing page).
      const nk = url.searchParams.get('node_key');
      if (typeof nk !== 'string' || !nk.trim()) throw new StoreError('bad_node_key', 'node_key query parameter required (key:<ref> or key:ed25519:<base64>).');
      const key = nk.trim();
      if (!nodeKeyOk(key)) throw new StoreError('bad_node_key', 'node_key must look like key:<ref> or key:ed25519:<base64 public key>.');
      const x = store.export();   // refuses 503 log_integrity exactly like export does
      const reg = x.nodes.find((n) => n.node_key === key) ?? null;
      const entries = x.entries.filter((e) => e.creator_ref === key || e.creator_ref === `name:${key}`);
      return send(res, 200, { format: x.format, wire: x.wire, node_key: key, registered: !!reg, registry: reg, count: entries.length, entries });
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
      emitRoute = true;
      // The join gate. Closed set, fail-closed receipts, payload-hash idempotence (all in Store.ingest).
      const ip = 'ingest-ip:' + socketIp(req);
      const wait = peek(ip, INGEST_LIMIT) || peek('ingest-global', GLOBAL_LIMIT);
      if (wait) return fail(res, 429, 'rate_limited', `Too many emits. Try again in ${Math.ceil(wait / 60)} min.`, { ...wireEcho }, { 'retry-after': String(wait) });
      const b = await readJson(req);
      const receipt = store.ingest(b);                       // gate refusals throw => no rate burn
      if (receipt.status === 'deposited' && !receipt.duplicate) { charge(ip); charge('ingest-global'); }
      return send(res, 200, { ok: true, ...wireEcho, ...receipt });
    }
    if (req.method === 'POST' && p === '/api/consent') {
      // W3 (EOM-E2E-BATTLE-2026-10-29): the consent door exists so a client can be refused HONESTLY instead of
      // hitting a 404. Fail closed: the body must be a JSON object (readJson), then the answer is the same
      // consent_gate_unbuilt 501 every fork/remix attempt gets. Nothing is stored, nothing is charged, and no
      // consent grammar is invented here - the deposits-spec ruling is still open.
      await readJson(req);
      return fail(res, 501, 'consent_gate_unbuilt', 'The consent layer is not built on this node. Nothing was stored.', { ...wireEcho });
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
    if (err instanceof StoreError) return fail(res, STATUS[err.code] || 400, err.code, err.message, emitRoute ? { ...wireEcho, ...err.extra } : err.extra);
    console.error(err); fail(res, 500, 'server_error', 'Something went wrong.');
  }
});
server.listen(PORT, HOST, function () {
  const port = (server.address() || {}).port || PORT;
  console.log(`attributed-text node-one listening on http://${HOST}:${port} (wire ${WIRE_VERSION}; ${PUBLIC_BIND ? 'PUBLIC BIND - operator-acknowledged via SEAMS_ALLOW_PUBLIC_BIND, NOT the ruled posture; this box must sit behind the ruled cloudflared wiring' : 'loopback bind until the exposure ruling'})`);
  // T1 fix: the token is never printed. Its location is; the value is read from the 0600 file by the operator.
  console.log(`admin token: ${path.join(DATA_DIR, 'admin-token.txt')} (mode 0600) - open /#/admin and paste it to enable "restore this version"`);
});
// Port hygiene (launcher-app pass 2026-10-26): a second start on a taken port means a node-one
// is already running there - say so and exit clean, never a stack trace. (launch.mjs probes first; this is the race backstop.)
server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.log(`node-one already running on http://${HOST}:${PORT} - reusing it (nothing new started; if that is not node-one, free the port or set PORT= and run again)`);
    process.exit(0);
  }
  console.error(`node-one could not listen on ${HOST}:${PORT}: ${err && err.message ? err.message : err}`);
  process.exit(1);
});
