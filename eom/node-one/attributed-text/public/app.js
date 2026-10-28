(() => {
  'use strict';
  const app = document.getElementById('app');
  const NCOLORS = 10;
  let state = null;                 // current text + authors
  let colorOn = false;
  let draft = null;                 // unsaved edit text survives view changes
  let timer = null;

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  };
  colorOn = store.get('color') === '1';

  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const api = async (path, opts) => {
    const r = await fetch(path, opts);
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(body.message || 'Request failed'), { status: r.status, body });
    return body;
  };
  const post = (path, data) => api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });

  const ago = (iso) => {
    const s = Math.max(1, (Date.now() - new Date(iso)) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    if (s < 30 * 86400) return `${Math.floor(s / 86400)} d ago`;
    return new Date(iso).toLocaleDateString();
  };
  const colorClass = (authors, name) => {
    const a = authors.find((x) => x.name === name);
    return a ? `a${a.idx % NCOLORS}${a.idx >= NCOLORS ? ' alt' : ''}` : 'a0';
  };
  const short = (t) => (t.length > 220 ? t.slice(0, 100) + ' … ' + t.slice(-100) : t);

  // KEYS demo (EOM-KEYS-2026-10-28): verified ✓ + fingerprint come from ONE source - the export's
  // creator_verified, true only where the gateway checked an Ed25519 signature at ingest.
  // Nothing here computes trust: a key:ed25519 author without a checked signature stays a claim,
  // visibly. The export is public; one short-lived cache keeps the 20 s auto-refresh off the
  // read budget while the map stays fresh enough for a live demo.
  let verif = { at: 0, map: null };
  async function verifMap() {
    if (verif.map && Date.now() - verif.at < 15000) return verif.map;
    try {
      const x = await api('/api/export');
      const m = new Map();
      for (const e of (x.entries || [])) {
        const ref = e.creator_ref;
        if (typeof ref !== 'string' || !ref.startsWith('key:ed25519:')) continue;
        if (e.creator_verified === true) m.set(ref, { verified: true, fp: e.node_key_fingerprint || ref.slice(12, 20) });
        else if (!m.has(ref)) m.set(ref, { verified: false, fp: ref.slice(12, 20) });
      }
      verif = { at: Date.now(), map: m };
    } catch { /* offline/paused: keep the last map, badges degrade honestly to claim */ }
    return verif.map;
  }
  const isEdKey = (n) => typeof n === 'string' && n.startsWith('key:ed25519:');
  function verifyBadge(name, map) {
    if (!isEdKey(name)) return null;
    const rec = map && map.get(name);
    if (rec && rec.verified) {
      const b = el('span', 'vbadge', '✓ verified · ' + rec.fp);
      b.title = 'creator_verified true: the gateway checked this key\u2019s Ed25519 signature at ingest (REQ-SIGN). The fingerprint is the first 8 chars of the public key.';
      return b;
    }
    const b = el('span', 'claimtag', 'claim');
    b.title = 'A key was used but no signature was verified at ingest - this attribution is a claim, not a check.';
    return b;
  }
  function verifWord(name, map) {
    if (!isEdKey(name)) return '';
    const rec = map && map.get(name);
    return rec && rec.verified ? ' ✓ verified · ' + rec.fp : ' · claim';
  }

  // Render segments as spans. opts.color: tint by author. opts.only: highlight just this author name.
  function textBlock(segs, authors, opts = {}) {
    const box = el('p', 'text' + (opts.color ? ' color' : '') + (opts.only ? ' dim' : ''));
    box.setAttribute('role', 'document');
    for (const [t, a, v] of segs) {
      const s = el('span', `seg ${colorClass(authors, a)}${opts.only === a ? ' hl' : ''}`, t);
      s.dataset.who = a; s.dataset.v = v;
      box.append(s);
    }
    if (opts.color || opts.only) {
      const tip = el('div', 'who ui'); tip.hidden = true;
      const show = (e) => {
        const s = e.target.closest('.seg'); if (!s) { tip.hidden = true; return; }
        tip.textContent = `“${short(s.textContent.trim() || s.textContent)}” — ${s.dataset.who}${verifWord(s.dataset.who, verif.map)}, added in version ${s.dataset.v}`;
        tip.hidden = false;
      };
      box.addEventListener('click', show);
      box.addEventListener('mouseover', show);
      box._tip = tip;
    }
    return box;
  }
  function withTip(box) { const w = el('div'); w.append(box); if (box._tip) w.append(box._tip); return w; }

  const nav = (href, label) => { const a = el('a', 'back ui', label); a.href = href; return a; };
  const btn = (label, fn, cls) => { const b = el('button', cls || '', label); b.type = 'button'; b.addEventListener('click', fn); return b; };
  const linkBtn = (label, href) => { const a = el('a', 'btn', label); a.href = href; return a; };
  const foot = () => {
    const f = el('p', 'foot ui');
    f.append('Anyone may change this; your name stays on your words. ');
    const a = el('a', '', 'About this demo'); a.href = '#/about'; f.append(a);
    return f;
  };
  const mount = (...nodes) => { app.replaceChildren(...nodes); window.scrollTo(0, 0); };

  async function refresh() { state = await api('/api/state'); return state; }

  // ---------- views ----------
  async function viewMain() {
    const map = await verifMap(); await refresh();
    const meta = el('p', 'meta ui', `Version ${state.v} · ${state.kind === 'revert' ? 'restored by admin' : 'last changed by ' + state.name}, ${ago(state.ts)}`);
    const mb = verifyBadge(state.name, map); if (mb) meta.append(' ', mb);
    const bar = el('div', 'bar ui');
    const color = btn('Colour by author', () => { colorOn = !colorOn; store.set('color', colorOn ? '1' : '0'); render(); });
    color.setAttribute('aria-pressed', String(colorOn));
    bar.append(btn('Edit', () => { location.hash = '#/edit'; }, 'primary'), color, linkBtn('Keys', '#/keys'), linkBtn(`Names (${state.authors.length})`, '#/names'), linkBtn('History', '#/history'));
    mount(withTip(textBlock(state.segs, state.authors, { color: colorOn })), meta, bar, foot());
  }

  async function viewEdit() {
    if (!state) await refresh();
    const text = draft ? draft.text : state.segs.map((s) => s[0]).join('');
    const baseV = draft ? draft.baseV : state.v;
    const ta = el('textarea'); ta.value = text; ta.setAttribute('aria-label', 'Text');
    ta.addEventListener('input', () => { draft = { text: ta.value, baseV }; });
    const name = el('input'); name.value = store.get('name') || ''; name.maxLength = 40; name.autocomplete = 'nickname'; name.placeholder = 'Any name you like'; name.id = 'nm';
    const lab = el('label', 'ui', 'Your name — typed, not verified. Anyone can use any name.'); lab.htmlFor = 'nm';
    const msg = el('div'); const save = btn('Save', async () => {
      msg.replaceChildren();
      if (!name.value.trim()) { msg.append(el('p', 'notice err ui', 'Please enter a name to save.')); name.focus(); return; }
      save.disabled = true;
      try {
        store.set('name', name.value.trim());
        const r = await post('/api/edit', { name: name.value, text: ta.value, base_v: baseV });
        state = r.state; draft = null; location.hash = '#/';
      } catch (e) {
        save.disabled = false;
        const n = el('div', 'notice err ui', e.message);
        if (e.body && e.body.error === 'conflict') {
          n.append(' Your draft is kept below. ');
          n.append(btn('Load the latest text', async () => {
            const mine = ta.value; await refresh();
            draft = { text: state.segs.map((s) => s[0]).join(''), baseV: state.v }; await viewEdit();
            const keep = el('textarea'); keep.readOnly = true; keep.value = mine; keep.style.minHeight = '8rem';
            app.append(el('label', 'ui', 'Your previous draft (copy what you need)'), keep);
          }));
        }
        msg.replaceChildren(n);
      }
    }, 'primary');
    const row = el('div', 'bar ui'); row.style.marginTop = '1rem';
    row.append(save, btn('Cancel', () => { draft = null; location.hash = '#/'; }));
    mount(nav('#/', '← Back'), ta, lab, name, msg, row);
    ta.focus();
  }

  async function viewNames() {
    const map = await verifMap(); await refresh();
    const ul = el('ul', 'list ui');
    for (const a of state.authors) {
      const li = el('li'); const link = el('a'); link.href = '#/a/' + encodeURIComponent(a.name);
      link.append(el('span', `dot a${a.idx % NCOLORS}`), el('span', '', a.name),
        el('span', 'sub', `${a.edits} edit${a.edits === 1 ? '' : 's'} · ${a.words} word${a.words === 1 ? '' : 's'} left`));
      const vb = verifyBadge(a.name, map); if (vb) { vb.style.marginLeft = '.5rem'; link.append(vb); }
      li.append(link); ul.append(li);
    }
    mount(nav('#/', '← Back'), el('h2', '', 'Everyone who has changed this'),
      el('p', 'meta ui', 'Tap a name to see what they wrote, deleted and replaced. Typed names stay claims; a key:ed25519 name earns its ✓ only where the gateway checked that key\u2019s signature at ingest.'), ul);
  }

  function chips(segs, authors, strike) {
    const f = document.createDocumentFragment();
    if (!segs.length) { f.append(el('span', 'meta', '(nothing)')); return f; }
    for (const [t, a] of segs) {
      const s = el('span', `chip ${colorClass(authors, a)}${strike ? ' rm' : ''}`, short(t)); s.title = a; f.append(s);
    }
    return f;
  }
  const changeRow = (when, h, authors) => {
    const d = el('div', 'change'); d.append(el('span', 'when ui', when));
    d.append(chips(h.rm, authors, true), el('span', 'arrow', '→'), chips(h.add, authors, false)); return d;
  };

  async function viewAuthor(name) {
    const map = await verifMap();
    const l = await api('/api/author/' + encodeURIComponent(name));
    const a = l.author, head = el('h2', '', ''); head.append(el('span', `dot a${a.idx % NCOLORS}`), ' ' + a.name);
    const vb = verifyBadge(a.name, map); if (vb) { vb.style.marginLeft = '.5rem'; head.append(vb); }
    const parts = [nav('#/names', '← Names'), head,
      el('p', 'meta ui', `${a.edits} edit${a.edits === 1 ? '' : 's'}, ${a.words} of their words are still in the text. Highlighted below.`),
      withTip(textBlock(l.segs, l.authors, { only: a.name }))];
    parts.push(el('h2', 'ui', `What ${a.name} changed`));
    const mine = [];
    for (const e of l.edits) for (const h of e.hunks) mine.push(changeRow(`Version ${e.v} · ${ago(e.ts)}`, h, l.authors));
    parts.push(...(mine.length ? mine : [el('p', 'meta ui', 'No edits of their own: they wrote the first words.')]));
    if (l.lost.length) {
      parts.push(el('h2', 'ui', `What others did to ${a.name}'s words`));
      for (const x of l.lost) parts.push(changeRow(`Version ${x.v} · ${x.kind === 'revert' ? 'restored by admin' : x.by} · ${ago(x.ts)}`, { rm: x.rm, add: x.add }, l.authors));
    }
    mount(...parts);
  }

  async function viewHistory() {
    const vs = await api('/api/versions');
    const ul = el('ul', 'list ui');
    for (const v of vs) {
      const li = el('li'), a = el('a'); a.href = '#/v/' + v.v;
      const who = v.kind === 'revert' ? `restored v${v.restored_v}` : v.name;
      a.append(el('span', '', `v${v.v}`), el('span', '', who), el('span', 'sub', `${v.kind === 'seed' ? 'first text' : `+${v.stats.added_words} −${v.stats.removed_words} words`} · ${ago(v.ts)}`));
      li.append(a); ul.append(li);
    }
    mount(nav('#/', '← Back to the current text'), el('h2', '', 'Every version'), el('p', 'meta ui', 'Nothing is ever deleted. Tap a version to read it.'), ul);
  }

  async function viewVersion(n) {
    const [e, cur] = await Promise.all([api('/api/version/' + n), refresh()]);
    const b = el('div', 'banner ui', `You are reading version ${e.v} (${e.kind === 'revert' ? 'restored by admin' : e.name}, ${ago(e.ts)}). `);
    if (e.v === cur.v) b.append('This is the current version.');
    else {
      const a = el('a', '', 'Back to the current text'); a.href = '#/'; b.append(a);
      const tok = store.get('admin');
      if (tok) b.append(' · ', btn('Restore this version', async () => {
        if (!confirm(`Restore version ${e.v}? This adds a new version; nothing is deleted.`)) return;
        try { await post('/api/admin/revert', { token: tok, to_v: e.v }); location.hash = '#/'; } catch (err) { alert(err.message); }
      }));
    }
    const color = btn('Colour by author', () => { colorOn = !colorOn; store.set('color', colorOn ? '1' : '0'); render(); });
    color.setAttribute('aria-pressed', String(colorOn));
    const bar = el('div', 'bar ui'); bar.append(color);
    mount(nav('#/history', '← History'), b, withTip(textBlock(e.segs, e.authors, { color: colorOn })), bar);
  }

  function viewAbout() {
    const p = (t) => el('p', 'ui', t);
    mount(nav('#/', '← Back'), el('h2', '', 'About this demo'),
      p('This page is a small demonstration of recording who wrote what, which is the attribution part of the Seams protocol. Consent here is simple: anyone may change the text, and nobody is paid.'),
      p('How authorship is worked out: each save is compared word by word with the version before it. Words you keep stay with whoever wrote them; words you type are yours.'),
      el('h2', '', 'Gaps compared with the real protocol'),
      p('Typed names are not verified, so anyone can use anyone\u2019s name - those entries are claims and stay claims. Real identity work is keys: an author can mint an Ed25519 key (key:ed25519:...) and sign their deposit, and the gateway checks that signature at ingest; signature-checked entries carry a \u2713 and a key fingerprint, verified nowhere else, by anyone else, ever. There are no accounts. If you retype or move someone else\u2019s words, the diff sees new words and credits you. Very small edits can be credited oddly.'),
      p('Every save is logged and nothing is deleted. An admin can restore an earlier version, which is itself logged. Saves are rate limited.'),
      (() => { const q = el('p', 'ui'); const a = el('a', '', 'Download the full log (JSON)'); a.href = '/api/export'; q.append(a); return q; })());
  }

  // ---------- KEYS: the outside visitor's own key (EOM-KEYS-2026-10-28, owner GO xErah) ----------
  // The browser is the custody: WebCrypto mints a real Ed25519 pair, the private half stays in
  // this origin's localStorage (and in the file only YOU download), and the gateway's own reply
  // is the only source of a verified badge - nothing on this page computes trust. The canonical
  // bytes below MUST equal canonicalSigningBytes in keys.mjs: same rule, duplicated by design
  // (sorted keys, no whitespace, JSON scalars); the conformance suite pins the node side.
  const KEYFILE = 'seam…e-v1';
  const canon = (v) =>
    v === null || v === undefined || typeof v !== 'object' ? JSON.stringify(v ?? null)
      : Array.isArray(v) ? '[' + v.map(canon).join(',') + ']'
        : '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  const toB64 = (buf) => { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); };
  const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const PRIV_PKCS8_PREFIX = Uint8Array.from('302e020100300506032b657004220420'.match(/../g).map((h) => parseInt(h, 16)));
  async function edSupported() {
    try { const k = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']); return !!(k && k.privateKey); } catch { return false; }
  }
  async function myKey() {
    const raw = store.get(KEYFILE);
    if (!raw) return null;
    try {
      const kf = JSON.parse(raw);
      if (!kf || kf.v !== 1 || !/^key:ed25519:[A-Za-z0-9+/]{43}=$/.test(String(kf.node_key || '')) || typeof kf.priv_b64 !== 'string') return null;
      const seed = fromB64(kf.priv_b64);
      if (seed.length !== 32) return null;
      const der = new Uint8Array(PRIV_PKCS8_PREFIX.length + 32); der.set(PRIV_PKCS8_PREFIX); der.set(seed, PRIV_PKCS8_PREFIX.length);
      const priv = await crypto.subtle.importKey('pkcs8', der, 'Ed25519', false, ['sign']);
      return { nodeKey: kf.node_key, priv, fileText: raw };
    } catch { return null; }
  }
  async function mintKey() {
    const pair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
    const pubRaw = await crypto.subtle.exportKey('raw', pair.publicKey);
    const der = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
    const derU = new Uint8Array(der);
    const kf = { v: 1, node_key: 'key:ed25519:' + toB64(pubRaw), priv_b64: toB64(derU.subarray(derU.length - 32)) };
    store.set(KEYFILE, JSON.stringify(kf));
    return kf;
  }
  async function signWith(priv, body) { return toB64(await crypto.subtle.sign('Ed25519', priv, new TextEncoder().encode(canon(body)))); }

  async function viewKeys() {
    const head = [nav('#/', '← Back'), el('h2', '', 'Your key')];
    if (!(await edSupported())) {
      mount(...head, el('p', 'notice err ui', 'This browser has no WebCrypto Ed25519 - try a current Chrome, Safari, or Firefox. Nothing was minted.'));
      return;
    }
    if (!store.get(KEYFILE)) {
      mount(...head,
        el('p', 'ui', 'A key is an identity the gateway can CHECK, not a name it trusts. Mint a real Ed25519 keypair in this browser: the private half stays here (plus a file only you download), the gateway verifies your signature at ingest, and a checked deposit carries \u2713 verified - verified at that moment, for those bytes, nothing more. No accounts, no recovery: lose the key, lose the name.'),
        (() => { const r = el('div', 'bar ui'); r.append(btn('Mint my key', async () => {
          try { await mintKey(); render(); } catch (e) { mount(...head, el('p', 'notice err ui', 'Mint failed: ' + e.message)); }
        }, 'primary')); return r; })());
      return;
    }
    let kf;
    try { kf = JSON.parse(store.get(KEYFILE)); } catch { store.set(KEYFILE, ''); render(); return; }
    const mine = await myKey();
    if (!mine) {
      const redo = (() => { const r = el('div', 'bar ui'); r.append(btn('Mint a new key', async () => { store.set(KEYFILE, ''); await mintKey(); render(); }, 'primary')); return r; })();
      mount(...head, el('p', 'notice err ui', 'The stored key file failed its own checks (shape, or private half not matching the public half). Nothing sends with a broken key - mint a new one.'), redo, foot());
      return;
    }
    const fp = kf.node_key.slice(12, 20);
    let status = null;
    try { status = await api('/api/deposits?node_key=' + encodeURIComponent(kf.node_key)); } catch { /* gateway quiet: stay honest, never assume */ }
    const keyLine = el('p', 'meta ui', kf.node_key.slice(0, 24) + '\u2026' + kf.node_key.slice(-6) + ' \u00b7 fingerprint ' + fp);
    const statusLine = el('p', 'meta ui', status === null ? 'Gateway status unknown right now - nothing is assumed.'
      : status.registered ? `Registered with the gateway \u00b7 ${status.count} deposit${status.count === 1 ? '' : 's'} \u00b7 registry verified: ${status.registry && status.registry.verified ? '\u2713 true' : 'false (claim)'}`
        : 'Not registered yet - announce it (below) to turn your key into a registered identity.');
    const who = el('input'); who.maxLength = 40; who.placeholder = 'Name to register (optional)'; who.value = store.get('name') || '';
    const out = el('div');
    const say = (t, err) => { out.replaceChildren(el('p', 'notice' + (err ? ' err' : '') + ' ui', t)); };
    const sendBtn = btn('Announce (register)', async () => {
      sendBtn.disabled = true;
      try {
        const body = { op: 'emit', kind: 'node-key', node_key: kf.node_key };
        if (who.value.trim()) body.provenance = { attributed_to: { name: who.value.trim() } };
        body.sig = await signWith(mine.priv, body);
        const r = await post('/api/ingest', body);
        say('Gateway answer: ' + (r.status === 'deposited' ? 'deposited' : r.status) + (r.duplicate ? ' (replay of the same announce)' : '') + ' \u00b7 verified: ' + (r.verified === true ? '\u2713 true - the gateway checked your signature against your key' : 'false (claim)') + ' \u00b7 receipt ' + r.receipt);
        statusLine.textContent = 'Registered with the gateway \u00b7 registry verified: ' + (r.verified === true ? '\u2713 true' : 'false (claim)');
      } catch (e) { say(e.message, true); }
      sendBtn.disabled = false;
    }, 'primary');
    const hello = el('input'); hello.maxLength = 200; hello.placeholder = 'Say something, signed';
    const helloBtn = btn('Sign my first deposit', async () => {
      helloBtn.disabled = true;
      try {
        const t = hello.value.trim();
        if (!t) { say('Type something first.', true); helloBtn.disabled = false; return; }
        const body = { op: 'emit', kind: 'session-log', node_key: kf.node_key, text: t, provenance: { origin: 'authored' } };
        body.sig = await signWith(mine.priv, body);
        const r = await post('/api/ingest', body);
        say(r.status === 'deposited' ? `Deposited v${r.v} \u00b7 creator_verified: ${r.creator_verified === true ? '\u2713 true' : 'false (claim)'} \u00b7 fingerprint ${r.node_key_fingerprint || 'none'} \u00b7 receipt ${r.receipt}${r.duplicate ? ' (replay: identical bytes were already in the log)' : ''}` : 'Answer: ' + JSON.stringify(r));
      } catch (e) { say((e.body && e.body.message) || e.message, true); }
      helloBtn.disabled = false;
    });
    const dl = el('a', 'btn', 'Download key file');
    dl.href = URL.createObjectURL(new Blob([mine.fileText], { type: 'application/json' }));
    dl.download = 'seams-node-key-' + fp + '.json';
    const bar = el('div', 'bar ui');
    bar.append(sendBtn, dl, btn('Forget on this device', () => {
      if (confirm('Forget this key on this device? The log keeps what it deposited - the key cannot be recovered, and neither can the name.')) { store.set(KEYFILE, ''); render(); }
    }));
    mount(...head,
      el('p', 'ui', 'This is YOUR key: generated here, held here. The private half leaves only through the download, and signatures are the only thing it ever produces.'),
      keyLine, statusLine,
      el('label', 'ui', 'Register (announce is self-signed; signing it is what proves you hold the private half).'), who, bar, out,
      el('label', 'ui', 'Signed deposit (the gateway checks it at its gate - a bad signature deposits nothing).'), hello,
      (() => { const r = el('div', 'bar ui'); r.append(helloBtn); return r; })(),
      foot());
  }

  function viewAdmin() {
    const i = el('input'); i.placeholder = 'Admin token'; i.type = 'password'; i.value = store.get('admin') || '';
    mount(nav('#/', '← Back'), el('h2', '', 'Admin'), el('p', 'ui', 'Paste the token to see “Restore this version” on old versions.'), i,
      (() => { const r = el('div', 'bar ui'); r.style.marginTop = '1rem'; r.append(btn('Save token', () => { store.set('admin', i.value.trim()); location.hash = '#/history'; }, 'primary'), btn('Forget it', () => { store.set('admin', ''); i.value = ''; })); return r; })());
  }

  // ---------- routing ----------
  async function render() {
    clearTimeout(timer);
    const h = location.hash.replace(/^#/, '') || '/';
    try {
      let m;
      if (h === '/') { await viewMain(); timer = setTimeout(() => { if ((location.hash || '#/') === '#/') render(); }, 20000); }
      else if (h === '/edit') await viewEdit();
      else if (h === '/names') await viewNames();
      else if (h === '/history') await viewHistory();
      else if (h === '/about') viewAbout();
      else if (h === '/keys') await viewKeys();
      else if (h === '/admin') viewAdmin();
      else if ((m = h.match(/^\/a\/(.+)$/))) await viewAuthor(decodeURIComponent(m[1]));
      else if ((m = h.match(/^\/v\/(\d+)$/))) await viewVersion(Number(m[1]));
      else location.hash = '#/';
    } catch (e) {
      mount(el('p', 'notice err ui', 'Could not load: ' + e.message), btn('Try again', render));
    }
  }
  window.addEventListener('hashchange', render);
  render();
})();
