// Test-only mock https gateway (W4, EOM-E2E-BATTLE-2026-10-29): a loopback https server with a
// throwaway self-signed cert made by openssl at test time (nothing is committed, no key material in the
// tree). The launcher child trusts it through NODE_EXTRA_CA_CERTS, the same way an operator would trust
// a private CA. Behaviours are knobs so each hardening leg can make the gateway misbehave on purpose.
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

export function haveOpenssl() { try { execFileSync('openssl', ['version'], { stdio: 'ignore' }); return true; } catch { return false; } }

export function makeCert() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seams-mockgw-'));
  const key = path.join(dir, 'k.pem'), crt = path.join(dir, 'c.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', key, '-out', crt, '-days', '2', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
  return { dir, key: fs.readFileSync(key), cert: fs.readFileSync(crt), certPath: crt };
}

export async function startMockGateway(opts = {}) {
  const c = makeCert();
  const o = { wire: 'seams-wire/0.3-draft', kinds: ['node-key', 'session-log'], integrity: 'ok', helloStatus: 200, dropIngests: 0, ingestStatus: 200, consent: 501, ...opts };
  const calls = []; const receipts = new Map(); let dropped = 0;
  const srv = https.createServer({ key: c.key, cert: c.cert }, (req, res) => {
    const chunks = []; req.on('data', (d) => chunks.push(d));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      calls.push({ method: req.method, path: req.url, raw });
      const json = (code, b) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
      if (req.url === '/api/hello') {
        if (o.helloStatus !== 200) return json(o.helloStatus, { error: 'not_found' });
        return json(200, { ok: true, node: 'mock-gateway', wire: o.wire, format: 'seams-attribution-log/0-eom.2', gate: { kinds: o.kinds, maps: { text: 'session-log', page: 'session-log' } }, integrity: o.integrity });
      }
      if (req.url === '/api/ingest' && req.method === 'POST') {
        if (dropped < o.dropIngests) { dropped++; req.socket.destroy(); return; }
        if (o.ingestStatus !== 200) return json(o.ingestStatus, { error: 'server_error', message: 'mock failure' });
        let b; try { b = JSON.parse(raw); } catch { return json(400, { error: 'bad_json' }); }
        const key = crypto.createHash('sha256').update(raw).digest('hex');
        const seen = receipts.get(key);
        if (seen) return json(200, { ...seen, duplicate: true });
        const rcpt = { ok: true, wire: o.wire, status: 'deposited', kind: 'session-log', receipt: 'rcpt:' + key.slice(0, 16), creator_verified: false, v: receipts.size + 2, duplicate: false, echo_sig: typeof b.sig === 'string' };
        receipts.set(key, rcpt); return json(200, rcpt);
      }
      if (req.url === '/api/consent' && req.method === 'POST') {
        if (o.consent === 501) return json(501, { error: 'consent_gate_unbuilt', message: 'mock: not built', wire: o.wire });
        return json(200, { ok: true, wire: o.wire, status: 'recorded-shape-only' });
      }
      if (req.url.startsWith('/api/deposits') || req.url === '/api/export') return json(200, { ok: true, entries: [] });
      json(404, { error: 'not_found' });
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  return { url: 'https://127.0.0.1:' + port, caPath: c.certPath, calls, ingestCalls: () => calls.filter((x) => x.path === '/api/ingest'), set: (k, v) => { o[k] = v; }, close: () => new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }) };
}
