// Homepage live window (board-1a/1b, EOM-SITE-IMPL-2026-10-28). Zero deps, no third-party
// anything. The window polls the public /api/export at the demo's accepted 20 s cadence,
// renders newest-first from the REAL export only, and fails CLOSED: on a read error it shows
// the paused state backed by this browser's last cached view (localStorage) - never empty,
// never fabricated. A fresh window with no cache and a dead gateway shows the honest
// nothing-to-show state; it never invents rows to look alive.
(() => {
  'use strict';
  // ===== FEED-CONTRACT-BEGIN (EOM-SITE-IMPL-2026-10-28 - extracted verbatim by
  // test/home.test.mjs; DOM-free by contract: what the browser ships is what the suite
  // certifies. All states are derived from the export's own fields; no function in this
  // block may invent an entry, a name, or a snippet.) =====
  const POLL_MS = 20000;      // the accepted published cadence: 20 s, never faster (read budget)
  const FRESH_MS = 30000;     // a landing under 30 s carries the accent tint
  const CAP = 50;             // window depth: newest 50 landings
  const EMPTY_TEXT = 'nothing landed yet - change something on the page';
  const PAUSED_TEXT = 'Reads are paused - the gateway is not answering. Showing the last view this browser cached.';
  const NOCACHE_TEXT = 'Reads are paused - the gateway is not answering, and this browser has no cached view of the log. Nothing to show, honestly.';
  const LIVE_TEXT = 'live';
  // display name from creator_ref ONLY: an ed25519 key renders as its 8-char fingerprint,
  // name:<x> renders as x, other key references render verbatim (they are what the log says).
  const displayName = (e) => {
    const ref = e && typeof e.creator_ref === 'string' ? e.creator_ref : '';
    if (ref.startsWith('key:ed25519:')) return 'key · ' + (e.node_key_fingerprint || ref.slice(12, 20));
    if (ref.startsWith('name:')) return ref.slice(5);
    return ref || 'unknown';
  };
  const isEdKey = (e) => typeof (e && e.creator_ref) === 'string' && e.creator_ref.startsWith('key:ed25519:');
  // honest snippet from the entry's own fields (summary language only where no text exists)
  const snippetOf = (e) => {
    if (e && typeof e.text === 'string' && e.text.trim()) return e.text.length > 160 ? e.text.slice(0, 159) + '…' : e.text;
    if (e && e.kind === 'node-key') return 'announced a key';
    return 'kind: ' + (e && e.kind ? e.kind : 'unknown');
  };
  const tsOf = (e) => (e && typeof e.ts === 'string' ? e.ts : '');
  // newest first. The DEPOSITS-page contract (one-line: a row links to what that creator
  // ever deposited) lives here too: rows for ed25519 creators carry a deposits link.
  const feedRows = (entries, now) => {
    if (!Array.isArray(entries)) return [];
    return entries
      .map((e) => ({ e, t: Date.parse(tsOf(e)) }))
      .filter((r) => Number.isFinite(r.t))
      .sort((a, b) => b.t - a.t)
      .slice(0, CAP)
      .map(({ e, t }) => ({
        name: displayName(e),
        ident: isEdKey(e) ? e.creator_ref.slice(12) : displayName(e),
        verified: isEdKey(e) ? e.creator_verified === true : null,
        fp: e && typeof e.node_key_fingerprint === 'string' ? e.node_key_fingerprint : '',
        snippet: snippetOf(e),
        ts: e.ts,
        depositsHref: isEdKey(e) ? '#/d/' + encodeURIComponent(e.creator_ref) : null,
        fresh: now - t < FRESH_MS && now - t >= 0,
      }));
  };
  // fail-closed reducer. liveJson: parsed export or null-on-error. Errors NEVER produce
  // fabricated rows - they degrade to the cached view, or to the honest no-cache state.
  const nextFeed = (prev, liveJson) => {
    if (liveJson && Array.isArray(liveJson.entries)) {
      return { mode: LIVE_TEXT.toLowerCase(), entries: liveJson.entries, error: false };
    }
    const cached = prev && Array.isArray(prev.entries) && prev.entries.length ? prev.entries : [];
    return { mode: cached.length ? 'paused' : 'paused-nocache', entries: cached, error: true };
  };
  // what we may persist to localStorage: raw entry shapes only (name/badges/snippets are
  // re-derived at render; the cache is a view of the real export, nothing synthetic).
  const cacheWorth = (liveJson) => (liveJson && Array.isArray(liveJson.entries) ? { at: Date.now(), entries: liveJson.entries.slice(0, CAP) } : null);
  // ===== FEED-CONTRACT-END =====

  // ---------- DOM wiring (below the contract block; the suite does not certify this half) ----------
  const $ = (id) => document.getElementById(id);
  const rowsEl = $('rows'), stateEl = $('state'), refreshBtn = $('refresh'), themeBtn = $('theme');
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  };
  let feed = { mode: '', entries: [], error: false };
  let cache = null;
  try { cache = JSON.parse(store.get('homefeed') || ''); } catch { cache = null; }
  if (cache && !Array.isArray(cache.entries)) cache = null;

  const ago = (ts) => {
    const s = Math.max(1, (Date.now() - (Date.parse(ts) || Date.now())) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    return new Date(ts).toLocaleDateString();
  };
  // dot hue: the app.css author classes need a slot; the rules are the same identity rule the
  // demo certifies (hue.test.mjs): FNV-1a over the identity string (the pub half for keys,
  // the name itself otherwise), mod ten - a private copy, never importing state.
  const hueSlot = (ident) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < String(ident).length; i++) { h ^= String(ident).charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return (h >>> 0) % 10;
  };
  const badge = (r) => {
    if (r.verified === null) return null;
    const b = document.createElement('span');
    b.className = r.verified ? 'vbadge' : 'claimtag';
    b.textContent = r.verified ? '✓ verified · ' + r.fp : 'claim';
    b.title = r.verified
      ? 'creator_verified true: the gateway checked this key’s Ed25519 signature at ingest (REQ-SIGN). No third party verified anything.'
      : 'A name was used but no signature was verified - this attribution is a claim, not a check.';
    return b;
  };
  const rowNode = (r) => {
    const a = document.createElement('a');
    a.className = 'feedrow' + (r.fresh ? ' fresh' : '');
    if (r.depositsHref) a.href = r.depositsHref;
    const head = document.createElement('div'); head.className = 'rowhead';
    const dot = document.createElement('span');
    dot.className = `dot a${hueSlot(r.ident)}`;
    head.append(dot, Object.assign(document.createElement('span'), { textContent: r.name, className: 'name' }));
    const bd = badge(r); if (bd) head.append(bd);
    head.append(Object.assign(document.createElement('span'), { className: 'when', textContent: ago(r.ts) }));
    const sn = document.createElement('div'); sn.className = 'snippet'; sn.textContent = r.snippet;
    a.append(head, sn);
    return a;
  };
  const render = () => {
    rowsEl.replaceChildren();
    const now = Date.now();
    const rows = feedRows(feed.entries, now);
    if (rows.length) {
      const frag = document.createDocumentFragment();
      for (const r of rows) frag.append(rowNode(r));
      rowsEl.append(frag);
    } else {
      const p = document.createElement('p'); p.className = 'empty';
      p.textContent = feed.error ? NOCACHE_TEXT : EMPTY_TEXT;
      rowsEl.append(p);
    }
    stateEl.textContent = feed.error ? PAUSED_TEXT : feed.mode;
  };
  let timer = null;
  async function poll() {
    clearTimeout(timer);
    let live = null;
    try {
      const r = await fetch('/api/export', { headers: { accept: 'application/json' } });
      if (!r.ok) throw new Error('export ' + r.status);
      live = await r.json();
      const c = cacheWorth(live);
      if (c) { cache = c; store.set('homefeed', JSON.stringify(c)); }
    } catch { live = null; }   // fail closed: nextFeed degrades to cache, never fabricates
    feed = nextFeed(feed, live);
    render();
    timer = setTimeout(poll, POLL_MS);
  }
  refreshBtn.addEventListener('click', poll);

  // theme: ◐ toggles light/dark and remembers; unset follows the system (token block handles all three)
  const setTheme = (t) => {
    if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
    store.set('theme', t || '');
  };
  const savedTheme = store.get('theme');
  if (savedTheme === 'light' || savedTheme === 'dark') document.documentElement.dataset.theme = savedTheme;
  themeBtn.addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme
      || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    setTheme(cur === 'dark' ? 'light' : 'dark');
    render();
  });

  poll();
})();
