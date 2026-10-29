// Shared helpers for the battle-wave suites (battle.test.mjs, e2e.test.mjs). launcher.test.mjs keeps its own
// inline copies on purpose (untouched, byte-stable); these mirror them.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const LAUNCHER = path.join(here, '..', 'server.mjs');
export const NODE_ONE = [path.join(here, '..', 'node-one', 'attributed-text', 'server.mjs'),   // bundle layout
                         path.join(here, '..', '..', 'node-one', 'attributed-text', 'server.mjs')] // repo layout
                        .find((p) => fs.existsSync(p)) || path.join(here, '..', '..', 'node-one', 'attributed-text', 'server.mjs');
export const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

// Boot a server and resolve its printed loopback URL. Rejects on early exit or after 8s.
export function serve(entry, env) {
  const proc = spawn(process.execPath, [entry], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  const url = new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error(`boot timeout:\n${out}`)), 8000);
    proc.stdout.on('data', (c) => { out += c; const m = out.match(/listening on (http:\/\/127\.0\.0\.1:\d+)/); if (m) { clearTimeout(to); resolve(m[1]); } });
    proc.stderr.on('data', (c) => { out += c; });
    proc.on('exit', (code) => { clearTimeout(to); reject(new Error(`exited ${code} before listening:\n${out}`)); });
  });
  url.catch(() => {});
  return { proc, url, out: () => out };
}
export async function killed(proc) {
  if (proc.exitCode === null && !proc.killed) proc.kill('SIGKILL');
  await new Promise((r) => (proc.exitCode !== null || proc.signalCode ? r() : proc.on('exit', r)));
  return true;
}
export const exited = (proc) => new Promise((r) => (proc.exitCode !== null ? r(proc.exitCode) : proc.on('exit', (c) => r(c))));
export const jfetch = async (u, opt) => { const r = await fetch(u, opt); const raw = await r.text(); let body = null; try { body = JSON.parse(raw); } catch { /* not JSON */ } return { status: r.status, body, raw, headers: r.headers }; };
export const POSTJ = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
