#!/usr/bin/env node
// Seams launcher - the ONE command an end user runs. Zero deps, Node 18+.
//
//   repo:    node eom/launcher/launch.mjs      bundle: node launch.mjs
//   tauri dev (beforeDevCommand): node launch.mjs --dev   (self-locating; servers stay up, exits 0)
//
// It ensures BOTH halves of the experience are up, supervises what it starts, and takes both
// down on Ctrl-C: (1) the node-one attributed-text server, (2) the launcher window server that
// proxies it on the same origin. Port hygiene is the point of this file: a port already taken
// means "already running - open the URL", never an EADDRINUSE stack trace (the 2026-10-26 view
// commands hit exactly that). This process only ever touches 127.0.0.1.
//
// env knobs (all optional): PORT (4173) NODE_ONE_PORT (8080) OPS_DIR NODE_ONE_DATA_DIR
//   NODE_ONE_URL - expert override: point the proxy at an already-running loopback node-one
//   instead of having this command start one. Non-loopback is refused here AND by the server.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const LAUNCHER_SERVER = path.join(here, 'server.mjs');

// Mac run #1 triage (2026-10-26): sibling paths derive from import.meta.url ONLY and resolve by
// EXISTENCE PROBE - never from the shell's working directory, and never a single repo-shaped
// path. Two shipped
// layouts, bundle-first (inside an unpacked bundle the inner copy must always win):
//   bundle: launch.mjs at the bundle ROOT, node-one/ and public/ its siblings (Mac delivery)
//   repo:   launch.mjs at eom/launcher/, node-one/ the sibling under eom/ (BRIX working tree)
// The old hardcoded `here/../node-one/...` escaped an unpacked bundle by one '..' and died
// MODULE_NOT_FOUND outside it - Erah's first Mac run, killed before Rust ever compiled.
const DEV = process.argv.includes('--dev');
const NODE_ONE_CANDIDATES = [
  ['bundle', path.join(here, 'node-one', 'attributed-text', 'server.mjs')],
  ['repo', path.join(here, '..', 'node-one', 'attributed-text', 'server.mjs')],
];
const LAYOUT = (() => {
  for (const [name, p] of NODE_ONE_CANDIDATES) if (fs.existsSync(p)) return { name, server: p };
  return null;
})();

const PORT = Number(process.env.PORT || 4173);
const NODE_ONE_PORT = Number(process.env.NODE_ONE_PORT || 8080);
const CUSTOM_ONE = !!process.env.NODE_ONE_URL;
const NODE_ONE_URL = (process.env.NODE_ONE_URL || `http://127.0.0.1:${NODE_ONE_PORT}`).replace(/\/+$/, '');

const say = (msg) => console.log(`[seams] ${msg}`);
const relay = (tag) => (chunk) => {
  for (const line of String(chunk).split('\n')) if (line.trim()) process.stdout.write(`  ${tag} │ ${line}\n`);
};

// loopback gate, mirrored from server.mjs: this command never dials or spawns toward anything else.
function loopbackOnly(u) {
  try {
    const p = new URL(u);
    return p.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(p.hostname);
  } catch { return false; }
}
if (!loopbackOnly(NODE_ONE_URL)) {
  say(`refusing to start: NODE_ONE_URL=${JSON.stringify(NODE_ONE_URL)} is not loopback.`);
  say('the launcher runs local/loopback only; exposure is blocked-on-ruling.');
  process.exit(1);
}

const portInUse = (port) => new Promise((resolve) => {
  const s = net.connect({ host: '127.0.0.1', port });
  const done = (v) => { s.destroy(); resolve(v); };
  s.setTimeout(1000, () => done(false));
  s.once('connect', () => done(true));
  s.once('error', () => done(false));
});

const children = []; // {name, proc, out} - only what THIS process spawned; existing servers stay owned by whoever started them
let shuttingDown = false;

// dev mode (tauri beforeDevCommand) detaches the children with their logs in a file: they MUST
// outlive this launcher process, and pipes would EPIPE-kill them silently when we exit(0).
const DEV_LOG = DEV ? (process.env.SEAMS_DEV_LOG || path.join(os.tmpdir(), 'seams-launcher-dev.log')) : null;
let devLogFd = null;
if (DEV) {
  try { devLogFd = fs.openSync(DEV_LOG, 'a'); fs.writeSync(devLogFd, `\n--- dev boot ${new Date().toISOString()} ---\n`); }
  catch { devLogFd = null; say(`dev log unavailable at ${DEV_LOG}; children log to /dev/null instead`); }
}

function supervise(name, entry, env) {
  const detached = DEV;
  const proc = spawn(process.execPath, [entry], {
    env: { ...process.env, ...env },
    stdio: detached ? ['ignore', devLogFd ?? 'ignore', devLogFd ?? 'ignore'] : ['ignore', 'pipe', 'pipe'],
    detached,
  });
  if (detached) proc.unref();
  const child = { name, proc, out: '', exited: null, detached };
  const fwd = (stream) => (c) => {
    child.out += String(c);
    for (const line of String(c).split('\n')) if (line.trim()) stream.write(`  [${name}] │ ${line}\n`);
  };
  if (proc.stdout) proc.stdout.on('data', fwd(process.stdout));
  if (proc.stderr) proc.stderr.on('data', fwd(process.stderr));
  proc.on('error', (e) => { child.exited = { code: -1, signal: null }; child.out += String(e && e.message); });
  proc.on('exit', (code, signal) => { child.exited = { code, signal }; });
  children.push(child);
  say(`spawned ${name} pid=${proc.pid}`);
  return child;
}

// wait until the port answers; an 'already running' exit-0 is success (someone else holds it).
async function waitUp(child, port, what) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await portInUse(port)) return 'up';
    if (child.exited) {
      if (child.exited.code === 0 && (child.detached || /already running/i.test(child.out))) return 'reused';
      throw new Error(`${child.name} exited (${child.exited.code ?? child.exited.signal}) before ${what} came up`);
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error(`timed out waiting for ${child.name} to serve ${what} on 127.0.0.1:${port}`);
}

async function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.exited && !child.proc.killed) {
      say(`${reason}: stopping ${child.name} (pid ${child.proc.pid})`);
      child.proc.kill('SIGTERM');
    }
  }
  for (const child of children) {
    if (child.exited) continue;
    const dead = await Promise.race([
      new Promise((r) => child.proc.once('exit', () => r(true))),
      new Promise((r) => setTimeout(() => r(false), 2500)),
    ]);
    if (!dead) { say(`${child.name} ignored SIGTERM; SIGKILL`); child.proc.kill('SIGKILL'); await new Promise((r) => child.proc.once('exit', r)); }
  }
  // ps-verify: a child we do not see dead is a bug worth shouting about, not a silent exit.
  let dirty = 0;
  for (const child of children) {
    const alive = await new Promise((r) => {
      const ps = spawn('ps', ['-p', String(child.proc.pid)], { stdio: ['ignore', 'pipe', 'ignore'] });
      let o = ''; ps.stdout.on('data', (c) => { o += c; });
      ps.on('exit', () => r(/\bnode\b/.test(o.replace(/^\s*PID[^\n]*\n/, ''))));
    });
    if (alive) { dirty++; say(`WARNING: ${child.name} pid=${child.proc.pid} still visible in ps`); }
    else say(`${child.name} reaped (ps-verified gone)`);
  }
  process.exit(dirty ? 1 : 0);
}
process.on('SIGINT', () => shutdown('ctrl-c'));
process.on('SIGTERM', () => shutdown('sigterm'));

// ---------------- the ladder ----------------
say('seams launcher - one command, both servers, loopback only.');
say(`layout: ${LAYOUT ? LAYOUT.name : 'node-one not found on disk'} · launcher server ${LAUNCHER_SERVER}`);

async function boot() {
  let oneChild = null;
  if (CUSTOM_ONE) {
    say(`operator-provided node-one at ${NODE_ONE_URL} (not spawned here; leaving it alone)`);
  } else if (await portInUse(NODE_ONE_PORT)) {
    say(`node-one already running on 127.0.0.1:${NODE_ONE_PORT} - reusing it (nothing spawned)`);
  } else if (!LAYOUT) {
    say('refusing to start: node-one server.mjs not found. Looked in:');
    for (const [, p] of NODE_ONE_CANDIDATES) say(`  ${p}`);
    say('an unpacked Mac bundle ships node-one/ beside launch.mjs - rebuild with make-mac-bundle.sh,');
    say('or point NODE_ONE_URL at an already-running loopback node-one (expert override).');
    say('servers are DOWN - nothing was left running to talk to.');
    process.exit(1);
  } else {
    say(`node-one entry: ${LAYOUT.server}`);
    oneChild = supervise('node-one', LAYOUT.server, {
      PORT: String(NODE_ONE_PORT),
      ...(process.env.NODE_ONE_DATA_DIR ? { DATA_DIR: process.env.NODE_ONE_DATA_DIR } : {}),
    });
    await waitUp(oneChild, NODE_ONE_PORT, 'node-one');
  }

  let launcherChild = null;
  if (await portInUse(PORT)) {
    say(`launcher already running on 127.0.0.1:${PORT} - open http://127.0.0.1:${PORT} (reusing it; nothing new started${oneChild ? '' : ', nothing to supervise'})`);
  } else {
    launcherChild = supervise('launcher', LAUNCHER_SERVER, {
      PORT: String(PORT),
      NODE_ONE_URL,
      ...(process.env.OPS_DIR ? { OPS_DIR: process.env.OPS_DIR } : {}),
    });
    await waitUp(launcherChild, PORT, 'the launcher window');
  }

  if (!oneChild && !launcherChild) {
    say(`everything already running - open http://127.0.0.1:${PORT}`);
    process.exit(0);
  }

  if (DEV) {
    // beforeDevCommand posture: BOTH ports answered, children detached and left running, exit 0
    // so tauri dev proceeds. Any failure above lands in the catch below: printed refusal,
    // nonzero exit - beforeDevCommand fails LOUDLY instead of masking into a 180s poll timeout.
    say(`dev: both servers up and DETACHED (they stay up after this exits). child logs: ${devLogFd !== null ? DEV_LOG : '/dev/null'}`);
    process.exit(0);
  }

  // supervision: if a child we own dies on its own (not via shutdown), come down cleanly too -
  // half a launcher (window without node, or node without window) is not an experience.
  for (const child of children) {
    child.proc.on('exit', (code, signal) => {
      if (shuttingDown) return;
      if (code === 0 && /already running/i.test(child.out)) return; // benign bind race
      say(`${child.name} exited (${code ?? signal}); bringing the rest down.`);
      shutdown('child lost');
    });
  }

  console.log('');
  say(`Seams Launcher is up → http://127.0.0.1:${PORT}   (Ctrl-C stops what this command started)`);
  say('install it as an app: Chrome/Edge ⌘-menu → "Install Seams Launcher" · Safari Share → "Add to Dock" · Android ⋮ → "Install app"');
  say('127.0.0.1 is a secure context, so the install prompt works over plain http - no tunnel, no TLS, nothing leaves the machine.');
}

boot().catch((err) => {
  say(`FAILED: ${err.message}`);
  if (DEV && DEV_LOG && devLogFd !== null) {
    try {
      for (const l of fs.readFileSync(DEV_LOG, 'utf8').trimEnd().split('\n').slice(-20)) process.stdout.write(`  dev-log │ ${l}\n`);
    } catch { /* no log to show */ }
  }
  say('servers are DOWN - nothing was left running to talk to.');
  process.exit(1);
});
