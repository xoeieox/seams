// Zero-dependency server: JSON API + static files. `node server.mjs` (PORT, DATA_DIR, ADMIN_TOKEN optional).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Store, StoreError, nameKey } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = process.env.DATA_DIR || path.join(here, 'data');
const EDIT_LIMIT = Number(process.env.EDIT_LIMIT || 10);          // per IP per window
const GLOBAL_LIMIT = Number(process.env.GLOBAL_LIMIT || 80);      // all IPs per window
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

// Rate limiting: sliding windows kept in memory. Behind a tunnel the real client IP arrives in a header.
const hits = new Map();
function limited(bucket, max) {
  const now = Date.now(), arr = (hits.get(bucket) || []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= max) { hits.set(bucket, arr); return Math.ceil((WINDOW_MS - (now - arr[0])) / 1000); }
  arr.push(now); hits.set(bucket, arr); return 0;
}
setInterval(() => { const now = Date.now(); for (const [k, a] of hits) if (!a.some((t) => now - t < WINDOW_MS)) hits.delete(k); }, 60000).unref();
const clientIp = (req) => String(req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress);

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
const STATUS = { name_required: 400, empty: 400, too_long: 413, bad_base: 400, bad_version: 404, no_change: 409, conflict: 409, too_big: 413, bad_json: 400 };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'), p = url.pathname;
  try {
    if (req.method === 'GET' && STATIC[p]) {
      const [file, type] = STATIC[p];
      return send(res, 200, fs.readFileSync(path.join(here, 'public', file)), type);
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
      return send(res, 200, JSON.stringify(store.export(), null, 2), 'application/json; charset=utf-8', { 'content-disposition': 'attachment; filename="attribution-log.json"' });
    }
    if (req.method === 'POST' && p === '/api/edit') {
      const ip = clientIp(req);
      const wait = limited('ip:' + ip, EDIT_LIMIT) || limited('global', GLOBAL_LIMIT);
      if (wait) return fail(res, 429, 'rate_limited', `Too many saves. Try again in ${Math.ceil(wait / 60)} min.`, {}, { 'retry-after': String(wait) });
      const b = await readJson(req);
      const e = store.edit({ name: b.name, text: b.text, baseV: Number(b.base_v) });
      return send(res, 200, { ok: true, state: store.state(), saved_v: e.v });
    }
    if (req.method === 'POST' && p === '/api/admin/revert') {
      if (limited('admin:' + clientIp(req), 10)) return fail(res, 429, 'rate_limited', 'Slow down.');
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
server.listen(PORT, () => {
  console.log(`attributed-text on http://localhost:${PORT}`);
  console.log(`admin token: ${adminToken}  (open /#/admin and paste it to enable "restore this version")`);
});
