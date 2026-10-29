// keys.mjs - real Ed25519 node keys for the KEYS demo (EOM-KEYS-2026-10-28, owner GO xErah).
// Zero dependencies: node:crypto only. A key is an identity the gateway can CHECK, not a name it
// trusts: node_key is `key:ed25519:<base64>` where the base64 is the raw 32-byte Ed25519 public
// key. `body.sig` is the base64 Ed25519 signature over the canonical signing bytes: the canonical
// JSON of the whole ingest body MINUS the sig field, recursively key-sorted, no whitespace
// (the same canonicalization rule the payload hash already uses - pinned verbatim in
// eom/endpoint-surface/requirements.yaml, REQ-SIGN). creator_verified is true ONLY when this
// module verified the signature at ingest time. There is no KMS, no ceremony, no revocation list:
// keys are disposable and what the signature proves is control of the private key, nothing more.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// DER prefixes for raw 32-byte ed25519 keys (SPKI public / PKCS8 private). Constants of the
// format, not secrets; the same values the Node docs publish for this curve.
const PUB_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const PRIV_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

const KEY_PREFIX = 'key:ed25519:';
// base64 of exactly 32 bytes: 43 base64 chars + one '=' pad.
export const NODE_KEY_ED25519_RE = /^key:ed25519:[A-Za-z0-9+/]{43}=$/;
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

// Canonical signing bytes (REQ-SIGN-1). This duplicates lib.mjs's canonical() by design - the
// rule is PINNED here for the signing path and a unit test asserts the two implementations agree
// on every emit-shaped body; a drift on either side fails the suite. sig is never signed-over.
export function canonicalSigningBytes(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return Buffer.from('null', 'utf8');
  const { sig, ...rest } = body;
  return Buffer.from(canon(rest), 'utf8');
}
function canon(v) {
  return v === null || v === undefined || typeof v !== 'object' ? JSON.stringify(v ?? null)
    : Array.isArray(v) ? '[' + v.map(canon).join(',') + ']'
      : '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
}

// Mint a fresh keypair. privB64 is the base64 of the raw 32-byte private seed - the only form
// this module ever writes to disk, always at mode 0600, always outside the repo tree (the
// launcher enforces the location). Nothing here prints or logs a private key.
export function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pubB64 = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
  const privB64 = privateKey.export({ type: 'pkcs8', format: 'der' }).subarray(-32).toString('base64');
  return { nodeKey: KEY_PREFIX + pubB64, pubB64, privB64 };
}

export function pubKeyObjectFromNodeKey(nodeKey) {
  if (!NODE_KEY_ED25519_RE.test(String(nodeKey ?? ''))) return null;
  const raw = Buffer.from(String(nodeKey).slice(KEY_PREFIX.length), 'base64');
  if (raw.length !== 32) return null;
  try {
    return crypto.createPublicKey({ key: Buffer.concat([PUB_SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
  } catch { return null; }
}

// The gateway's check: true only when sig is a valid 64-byte Ed25519 signature, under the key
// EMBEDDED IN node_key itself, over the canonical signing bytes. Anything malformed or failing
// answers false - fail closed, never throws, never distinguishes "why" (a refusal must not
// become an oracle).
export function verifyBodySig(nodeKey, body) {
  const key = pubKeyObjectFromNodeKey(nodeKey);
  if (!key) return false;
  const sig = body?.sig;
  if (typeof sig !== 'string' || !B64_RE.test(sig)) return false;
  let sigBuf; try { sigBuf = Buffer.from(sig, 'base64'); } catch { return false; }
  if (sigBuf.length !== 64) return false;
  try { return crypto.verify(null, canonicalSigningBytes(body), key, sigBuf); } catch { return false; }
}

// The sender's half: sign the canonical bytes of body (minus any existing sig).
export function signBody(privB64, body) {
  if (typeof privB64 !== 'string' || !B64_RE.test(privB64)) throw new Error('private key must be base64 of a 32-byte ed25519 seed');
  const seed = Buffer.from(privB64, 'base64');
  if (seed.length !== 32) throw new Error('private key must be base64 of a 32-byte ed25519 seed');
  const key = crypto.createPrivateKey({ key: Buffer.concat([PRIV_PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' });
  return crypto.sign(null, canonicalSigningBytes(body), key).toString('base64');
}

// Fingerprint (REQ-SIGN-5): the first 8 characters of the base64 public half, the display form
// export/UI/deposits use. null for any key that is not a well-formed ed25519 node key.
export const fingerprintOf = (nodeKey) =>
  NODE_KEY_ED25519_RE.test(String(nodeKey ?? '')) ? String(nodeKey).slice(KEY_PREFIX.length, KEY_PREFIX.length + 8) : null;

// Key-file format: {v:1, node_key, priv_b64} written 0600 by the file's owner only. The public
// half is IN the file (it is public), the private seed never leaves it.
export function writeKeyPairFile(dir, pair) {
  if (!pair || !pair.nodeKey || !pair.privB64) throw new Error('need {nodeKey, privB64}');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, (fingerprintOf(pair.nodeKey) || 'anon') + '.ed25519.key');
  fs.writeFileSync(file, JSON.stringify({ v: 1, node_key: pair.nodeKey, priv_b64: pair.privB64 }) + '\n', { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch { /* best effort on odd filesystems */ }
  return file;
}
export function readKeyPairFile(file) {
  let raw; try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  if (!raw || raw.v !== 1 || !NODE_KEY_ED25519_RE.test(String(raw.node_key ?? '')) || typeof raw.priv_b64 !== 'string') return null;
  const pubB64 = String(raw.node_key).slice(KEY_PREFIX.length);
  // self-consistency: the private half must be the pair of the public half it claims
  // (createPublicKey(privateKey) is the derivation - KeyObject.publicKey is undefined for
  // DER-imported keys on Node 24, so that path would reject EVERY file; the test suite caught this)
  try {
    const key = crypto.createPrivateKey({ key: Buffer.concat([PRIV_PKCS8_PREFIX, Buffer.from(raw.priv_b64, 'base64')]), format: 'der', type: 'pkcs8' });
    const pub = crypto.createPublicKey(key).export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
    if (pub !== pubB64) return null;
  } catch { return null; }
  return { nodeKey: raw.node_key, pubB64, privB64: raw.priv_b64 };
}
