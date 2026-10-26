#!/usr/bin/env node
// EoM build-leg (2026-10-26): hello-world one-shot send script for node-one's ingest gate.
// Zero dependencies, Node 18+. Local/loopback only - exposure is a separate ruling.
//
// Usage:
//   node scripts/send-hello.mjs [--url http://127.0.0.1:8080] [--key key:hello-world] [--text "..."] [--replay] [--no-announce]
//
// Flow: GET /api/hello (pin the A3-style wire echo), announce the node key (op emit kind node-key,
// unless --no-announce), then one hello-world emit. The gate maps kind "text" to session-log; that
// mapping is asserted, not assumed. With --replay the identical payload is sent twice: the second
// must ack duplicate:true with a byte-identical receipt (idempotence keyed on payload hash).
import { WIRE_VERSION } from '../lib.mjs';

const arg = (name, dflt) => {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return dflt;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : '';
};
const flag = (name) => process.argv.includes('--' + name);

const base = (arg('url', 'http://127.0.0.1:8080') || 'http://127.0.0.1:8080').replace(/\/+$/, '');
const nodeKey = arg('key', 'key:hello-world') || 'key:hello-world';
const text = arg('text', 'hello world from node-one - EoM build leg, 2026-10-26') || 'hello world from node-one - EoM build leg, 2026-10-26';

const die = (msg, detail) => { console.error(`FAIL: ${msg}`); if (detail) console.error(JSON.stringify(detail, null, 2)); process.exit(1); };

const jget = async (path, opts) => {
  let r;
  try { r = await fetch(base + path, opts); } catch (e) { die(`cannot reach ${base}${path}: ${e.cause?.code || e.message}`, null); }
  let body;
  try { body = await r.json(); } catch { die(`non-JSON response from ${path} (HTTP ${r.status})`); }
  return { status: r.status, body };
};

// 1. hello handshake: the server must echo the wire version it actually speaks (A3 lesson).
const hello = await jget('/api/hello');
if (hello.status !== 200) die(`hello returned HTTP ${hello.status}`, hello.body);
if (hello.body.wire !== WIRE_VERSION) die(`wire mismatch: server says ${JSON.stringify(hello.body.wire)}, client pins ${WIRE_VERSION} - do not speak past a version skew`, hello.body);
console.log(`hello: ${base} speaks ${hello.body.wire}; gate accepts ${JSON.stringify(hello.body.gate?.kinds)}, maps ${JSON.stringify(hello.body.gate?.maps)}`);

// 2. node-key announce (registry only; carries no content).
if (!flag('no-announce')) {
  const ann = await jget('/api/ingest', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op: 'emit', kind: 'node-key', node_key: nodeKey, provenance: { attributed_to: { name: nodeKey.replace(/^key:/, '') } } }) });
  if (ann.status !== 200 || ann.body.status !== 'deposited') die('node-key announce refused', ann.body);
  console.log(`announce: ${nodeKey} -> ${ann.body.kind} ${ann.body.receipt}${ann.body.duplicate ? ' (duplicate ack)' : ''}`);
}

// 3. the hello-world emit. kind "text" exercises the gate's ruling-mapping to session-log.
const emit = { op: 'emit', kind: 'text', node_key: nodeKey, text, provenance: { origin: 'authored' } };
const post = async () => jget('/api/ingest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(emit) });

const first = await post();
if (first.status !== 200 || first.body.status !== 'deposited') die('emit refused', first.body);
if (first.body.kind !== 'session-log') die(`gate mapping broken: kind "text" must map to session-log, gate returned ${first.body.kind}`, first.body);
console.log(`emit: deposited as ${first.body.kind} (mapped at the closed gate), v${first.body.v}, ${first.body.content_hash}, receipt ${first.body.receipt}`);

if (flag('replay')) {
  const second = await post();
  if (second.status !== 200 || second.body.duplicate !== true) die('idempotence broken: replay was not acked as duplicate', second.body);
  const { duplicate: _d, ...a } = first.body; const { duplicate: _e, ...b } = second.body;
  if (JSON.stringify(a) !== JSON.stringify(b)) die('idempotence broken: replay receipt differs from the original', { a, b });
  console.log('replay: duplicate ack, receipt byte-identical - the log did not grow');
}
console.log('OK: hello-world sent through the closed gate.');
