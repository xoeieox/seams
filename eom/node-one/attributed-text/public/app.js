(() => {
  'use strict';
  const app = document.getElementById('app');
  let state = null;                 // current text + authors
  let colorOn = true;                 // Colour by author defaults ON (fix wave Leg 2); a persisted per-browser choice below still wins
  let draft = null;                 // unsaved edit text survives view changes
  let timer = null;

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  };
  colorOn = store.get('color') !== '0';   // only an explicit persisted '0' turns colours off; unset defaults ON

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
  // ===== HUE-CONTRACT-BEGIN (EOM-DEMO-UI-FIXWAVE-2026-10-28, Leg 1 - extracted verbatim by
  // test/hue.test.mjs and run in node: what the browser ships is what the suite certifies.
  // These functions are DOM-free and POSITION-free by contract - hue derives from author
  // identity alone and is stable everywhere and forever; the old positional rule (hue = the
  // author's place in a locally built list, mod ten) re-mapped authors under set churn and
  // let two distinct names render one hue.) =====
  const HUE_NC = 10;
  // Identity for the hue: the strongest stable identity in the name. For an ed25519 author that
  // is the base64 public half ITSELF (the full key, not the 8-char display fingerprint - keys
  // sharing a fingerprint still keep distinguishable hues; the verified badge is the second
  // token for checked rows). Keyless names hash on the name string. Same slot space for both.
  const hueIdentity = (name) => (typeof name === 'string' && name.startsWith('key:ed25519:') ? name.slice(12) : String(name));
  // FNV-1a 32-bit: pure, stateless, no position, no view memory - the same author lands in the
  // same hue class in every view, in every browser, forever.
  const hueHash = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; };
  const hueSlot = (name) => hueHash(hueIdentity(name)) % HUE_NC;
  // One author's class in one view: the identity slot, plus the `.alt` dotted-underline
  // fallback when ANOTHER author in this view shares the slot (hash collision). Symmetric and
  // order-free - collision is a property of the slot, never of anyone's position.
  const colorClass = (authors, name) => {
    const a = authors.find((x) => x.name === name);
    if (!a) return 'a0';
    const slot = hueSlot(a.name);
    const collides = authors.some((x) => x !== a && hueSlot(x.name) === slot);
    return `a${slot}${collides ? ' alt' : ''}`;
  };
  // ===== HUE-CONTRACT-END =====
  const short = (t) => (t.length > 220 ? t.slice(0, 100) + ' … ' + t.slice(-100) : t);

  // KEYS demo (EOM-KEYS-2026-10-28): verified ✓ + fingerprint come from ONE source - the export's
  // creator_verified, true only where the gateway checked an Ed25519 signature at ingest.
  // Nothing here computes trust: a key:ed25519 author without a checked signature stays a claim,
  // visibly. Site-impl wave (2026-10-28): one short-lived export cache now backs the verif map,
  // the /demo?landed=<hash> arrival banner, and the deposits view - one poll, off the read budget.
  let verif = { at: 0, map: null };
  let xs = { at: 0, x: null, pending: null };
  const XS_TTL = 15000;
  async function exportX(force) {
    if (!force && xs.x && Date.now() - xs.at < XS_TTL) return xs.x;
    if (!force && xs.pending) return xs.pending;
    xs.pending = api('/api/export').then((x) => { xs = { at: Date.now(), x, pending: null }; return x; })
      .catch((e) => { xs.pending = null; throw e; });
    return xs.pending;
  }
  async function verifMap() {
    if (verif.map && Date.now() - verif.at < 15000) return verif.map;
    try {
      const x = await exportX();
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
    // board-1c: badges in either state open the deposits view - every byte that key ever
    // deposited, straight from the public /api/deposits?node_key= truth.
    const b = el('a', rec && rec.verified ? 'vbadge' : 'claimtag');
    b.href = '#/d/' + encodeURIComponent(name);
    if (rec && rec.verified) {
      b.textContent = '✓ verified · ' + rec.fp;
      b.title = 'creator_verified true: the gateway checked this key\u2019s Ed25519 signature at ingest (REQ-SIGN). The fingerprint is the first 8 chars of the public key. No third party verified anything.';
    } else {
      b.textContent = 'claim';
      b.title = 'A key was used but no signature was verified at ingest - this attribution is a claim, not a check.';
    }
    return b;
  }
  function verifWord(name, map) {
    if (!isEdKey(name)) return '';
    const rec = map && map.get(name);
    return rec && rec.verified ? ' ✓ verified · ' + rec.fp : ' · claim';
  }

  // ---------- site-impl rework (board-1c/1d, EOM-SITE-IMPL-2026-10-28) ----------
  const landedHash = () => { try { return new URLSearchParams(location.search).get('landed') || ''; } catch { return ''; } };
  // arrival banner truth: the export is the only answer. A fingerprint match highlights the
  // landing; an entry not (yet) found says so honestly and keeps watching.
  async function landedBannerRecognition() {
    const q = landedHash();
    if (!q) return null;
    let found = null;
    try {
      const x = await exportX();
      const score = (e) => {
        const fp = String(e.node_key_fingerprint || '').toLowerCase();
        const ref = String(e.creator_ref || '');
        const dep = String(e.deposit_hash || '');
        if (fp && q.length >= 4 && (fp === q.toLowerCase() || (q.toLowerCase().startsWith(fp) && q.length <= 12))) return 3;
        if (dep && q === dep.replace(/^sha256:/, '').slice(0, 16)) return 2;
        if (q.length >= 8 && ref.endsWith(q)) return 2;
        return 0;
      };
      found = (x.entries || []).map((e) => [e, score(e)]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1])[0];
    } catch { /* gateway quiet: banner stays honest, no fake confirmation */ }
    const b = el('div', 'banner ui');
    let matched = null;
    if (found) {
      const e = found[0];
      matched = String(e.text || '');
      b.append('It landed. Version ' + e.v + ' is on the log, fingerprint ' + (e.node_key_fingerprint || '(none)') + '. ');
      const a = el('a', '', 'Every byte that key deposited'); a.href = '#/d/' + encodeURIComponent(e.creator_ref);
      b.append(a);
    } else {
      b.append('Looking for a landing from your launcher. This banner reads only the honest export: ');
      const a = el('a', '', 'check /api/export'); a.href = '/api/export';
      b.append(a);
      b.append(' - when the fingerprint shows up there, it is real. Until then, no confirmation is claimed.');
    }
    return { banner: b, matched, q };
  }
  // legend strip (board-1d option A), always visible; terms open a popover (option B).
  function legendStrip() {
    const strip = el('div', 'legend ui');
    const term = (node, label, text) => {
      const b = el('button', 'term'); b.type = 'button';
      b.append(node, el('span', '', label));
      b.addEventListener('click', () => showPop(text));
      return b;
    };
    strip.append(
      term(el('span', 'dot a0'), 'colour = author', 'Colour is identity, not position: each author derives one hue from a hash of who they are, so the same author is the same colour everywhere, forever.'),
      term(el('span', 'swchecked'), '✓ verified', 'The gateway checked this key’s Ed25519 signature at ingest, over the exact bytes deposited, against the key itself. That is the whole check - no third party, no vouch, no identity claim anywhere.'),
      term(el('span', 'swclaim'), 'claim', 'A name was typed, or a key was used with no verified signature. It stays a claim, forever, visible next to the checked rows.'),
    );
    return strip;
  }
  let popEl = null;
  function showPop(text) {
    if (!popEl) {
      popEl = el('div', 'pop ui');
      popEl.setAttribute('role', 'status');
      const x = el('button', 'x'); x.type = 'button'; x.textContent = '×'; x.title = 'Close';
      x.addEventListener('click', () => { popEl.hidden = true; });
      popEl.append(x, el('p', '', text));
      document.body.append(popEl);
    } else {
      const x = popEl.querySelector('.x');
      for (const n of Array.from(popEl.children)) if (n !== x) n.remove();
      popEl.append(el('p', '', text));
      popEl.hidden = false;
    }
  }
  function hidePop() { if (popEl) popEl.hidden = true; }
  // two-Erah note (board-1c): the honest seam, visible rather than smoothed over. Two keyless
  // names whose first word matches read as one claimed name; the log does not decide who is real.
  const nameStem = (n) => n.trim().toLowerCase().split(/[\s\-_.@]+/, 1)[0].replace(/[^a-z0-9]+/g, '') || n.toLowerCase();
  function nameNote(authors) {
    const names = authors.map((a) => a.name);
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
      const s1 = nameStem(names[i]), s2 = nameStem(names[j]);
      if (s1 && s2 && (s1 === s2 || s1.startsWith(s2) || s2.startsWith(s1))) {
        return `“${names[i]}” and “${names[j]}” share a name. Both stay, exactly as claimed - the log records who wrote what, and leaves who is real to the reader. Fingerprints are how an Ed25519 claim tells itself apart.`;
      }
    }
    return 'Names here are claims. Any name may be typed by anyone - what distinguishes is the signature the launcher can prove.';
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
  // demo header (board-1c): wordmark + ‹ seams home, always available on the main view
  const demoHeader = () => {
    const n = el('nav', 'nav ui');
    const mark = el('a', 'mark', 'Seams'); mark.href = '/';
    const home = el('a', 'home', '‹ seams home'); home.href = '/';
    n.append(mark, home);
    return n;
  };
  // the writing-as field (board-1c): whatever is typed here is the name of the claim; a typed
  // name is ALWAYS a claim (badge), and the honest proof path is the launcher, out of band.
  function writingAs() {
    const w = el('div', 'writeas ui');
    const lab = el('label', '', 'Writing as');
    const i = el('input'); i.maxLength = 40; i.autocomplete = 'nickname'; i.placeholder = 'Any name you like';
    i.id = 'writeas-name'; i.value = store.get('name') || '';
    lab.htmlFor = 'writeas-name';
    const badge = el('span', 'claimtag', 'claim');
    badge.title = 'Names on this page are claims: a typed name is not checked. Proof comes from the launcher, which mints keys and signs deposits.';
    i.addEventListener('input', () => store.set('name', i.value));
    w.append(lab, i, badge);
    const sub = el('span', 'sub', 'a name here is a claim - the launcher is how you get proof');
    w.append(sub);
    w.input = i;
    return w;
  }
  // names sidebar (board-1c): hue-stable dots, badges, counts + the open two-names note.
  function namesSide(map) {
    const side = el('aside', 'side');
    side.append(el('h3', '', 'Names'));
    const ul = el('ul');
    for (const a of state.authors) {
      const li = el('li');
      const dot = el('span', `dot a${hueSlot(a.name)}`);
      const name = el('a', `name a${hueSlot(a.name)}`, a.name); name.href = '#/a/' + encodeURIComponent(a.name);
      const sub = el('span', 'sub', `${a.edits}e · ${a.words}w`);
      li.append(dot, name, sub);
      const vb = verifyBadge(a.name, map); if (vb) li.append(vb);
      ul.append(li);
    }
    side.append(ul);
    const more = el('a', 'more', 'All names →'); more.href = '#/names';
    side.append(more, el('p', 'note', nameNote(state.authors)));
    return side;
  }
  const btn = (label, fn, cls) => { const b = el('button', cls || '', label); b.type = 'button'; b.addEventListener('click', fn); return b; };
  const linkBtn = (label, href) => { const a = el('a', 'btn', label); a.href = href; return a; };
  const foot = () => {
    const f = el('p', 'foot ui');
    f.append('Anyone may change this; your name stays on your words. ');
    const a = el('a', '', 'About this demo'); a.href = '#/about'; f.append(a);
    const h = el('a', '', '· ‹ seams home'); h.href = '/'; h.style.marginLeft = '0.4rem';
    f.append(h);
    return f;
  };
  const mount = (...nodes) => { app.replaceChildren(...nodes); app.classList.remove('wide'); hidePop(); window.scrollTo(0, 0); };

  async function refresh() { state = await api('/api/state'); return state; }

  // ---------- views ----------
  async function viewMain() {
    const map = await verifMap(); await refresh();
    const bar = el('div', 'bar ui');
    const color = btn('Colour by author', () => { colorOn = !colorOn; store.set('color', colorOn ? '1' : '0'); render(); });
    color.setAttribute('aria-pressed', String(colorOn));
    bar.append(btn('Edit', () => { location.hash = '#/edit'; }, 'primary'), color,
      linkBtn('Deposits', '#/deposits'), linkBtn(`Names (${state.authors.length})`, '#/names'), linkBtn('History', '#/history'), linkBtn('Timeline', '#/timeline'));
    app.classList.add('wide');
    const left = el('div');
    // arrival banner: /demo?landed=<hash> (the launcher's "see it land" ends here; the launcher
    // wiring is a separate wave - the banner refuses to claim confirmation the export hasn't given)
    const landed = await landedBannerRecognition();
    if (landed) left.append(landed.banner);
    const invite = el('p', 'invite', 'Change something. It\u2019ll stick.');
    left.append(invite, legendStrip());
    const wa = writingAs();
    left.append(wa);
    left.append(withTip(textBlock(state.segs, state.authors, { color: colorOn })));
    // last-line add (board-1c, mapped onto the one-text-block model): an append lands as
    // this browser's words, like any other edit - no separate data path, no seeded rows.
    const addIn = el('input'); addIn.maxLength = 400; addIn.placeholder = 'Add a line at the end\u2026';
    addIn.setAttribute('aria-label', 'Add a line at the end');
    const addMsg = el('div');
    const addBtn = btn('Add', async () => {
      const t = addIn.value.trim();
      const nm = wa.input.value.trim();
      if (!t) { addIn.focus(); return; }
      if (!nm) { addMsg.replaceChildren(el('p', 'notice err ui', 'Type the name this change carries first (writing as, above).')); wa.input.focus(); return; }
      addBtn.disabled = true;
      try {
        const fresh = await refresh();                                  // base on the newest v
        const text = fresh.segs.map((s) => s[0]).join('') + (/\n$/.test(fresh.segs.at(-1)[0]) ? '' : '\n') + t + '\n';
        const r = await post('/api/edit', { name: nm, text, base_v: fresh.v });
        state = r.state; addIn.value = ''; await viewMain();
      } catch (e) { addMsg.replaceChildren(el('p', 'notice err ui', e.message)); }
      addBtn.disabled = false;
    });
    const add = el('div', 'addline ui'); add.append(addIn, addBtn); left.append(add, addMsg);
    const meta = el('p', 'meta ui', `Version ${state.v} · ${state.kind === 'revert' ? 'restored by admin' : 'last changed by ' + state.name}, ${ago(state.ts)}`);
    const mb = verifyBadge(state.name, map); if (mb) meta.append(' ', mb);
    left.append(meta, bar, foot());
    const form = el('div', 'frame'); form.append(left); if (state.authors.length) form.append(namesSide(map));
    mount(demoHeader(), form);
    app.classList.add('wide');
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
      link.append(el('span', `dot a${hueSlot(a.name)}`), el('span', `name a${hueSlot(a.name)}`, a.name),
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
    const a = l.author, head = el('h2', '', ''); head.append(el('span', `dot a${hueSlot(a.name)}`), ' ' + a.name);
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


  // ---------- timeline river (R4 + W5) ----------
  // The demo's centerpiece: the linear change history laid out on REAL time. One lane per author
  // (first-appearance order), x = when it landed, node size = words changed. Two kinds of node:
  // page versions (/api/versions: seed, edit, revert) and signed/typed DEPOSITS that arrived through the
  // join gate (the export's ingest entries - what a launcher sends; /api/versions never carries them).
  // Verified key = solid ring, typed name or unchecked key = dashed ring (the page's claims-vs-proof
  // legend). The view computes no trust: `verified` comes from the export's creator_verified. A linear
  // chain is drawn linear; anything that CLAIMS lineage (parents, a derivation other than original) is
  // refused here and counted, because branches wait for the consent layer.
  // ===== RIVER-MODEL-BEGIN (pure: tests load this block alone; no DOM, no api) =====
  function riverModel(versions, entries, verifiedMap) {
    const rows = [], refused = [], skipped = [];
    const branchy = (r) => (Array.isArray(r.parents) && r.parents.length > 0) || (r.derivation !== undefined && r.derivation !== null && r.derivation !== 'original');
    const edKey = (n) => typeof n === 'string' && n.startsWith('key:ed25519:');
    for (const r of Array.isArray(versions) ? versions : []) {
      if (!r || typeof r !== 'object' || !Number.isInteger(r.v) || typeof r.name !== 'string' || !r.name) { skipped.push({ why: 'malformed version row' }); continue; }
      if (branchy(r)) { refused.push({ v: r.v, why: 'branch' }); continue; }
      const kind = r.kind === 'seed' || r.kind === 'revert' ? r.kind : 'edit';   // v1 rows carry no kind: an edit
      const words = r.stats && typeof r.stats === 'object' ? (Number(r.stats.added_words) || 0) + (Number(r.stats.removed_words) || 0) : null;
      const rec = verifiedMap && typeof verifiedMap.get === 'function' ? verifiedMap.get(r.name) : null;
      rows.push({ id: 'v' + r.v, lane: r.name, ts: Date.parse(r.ts), kind, words, v: r.v, restored_v: r.restored_v, href: '#/v/' + r.v, verified: edKey(r.name) && !!(rec && rec.verified) });
    }
    for (const e of Array.isArray(entries) ? entries : []) {
      if (!e || typeof e !== 'object' || !e.provenance || e.provenance.entry_kind !== 'ingest') continue;   // page entries come from versions
      if (typeof e.creator_ref !== 'string' || !e.creator_ref || !Number.isInteger(e.v)) { skipped.push({ why: 'malformed deposit entry' }); continue; }
      if (branchy(e)) { refused.push({ v: e.v, why: 'branch' }); continue; }
      rows.push({ id: 'd' + e.v, lane: e.creator_ref, ts: Date.parse(e.ts), kind: 'deposit', words: null, v: e.v, href: '#/d/' + encodeURIComponent(e.creator_ref), verified: edKey(e.creator_ref) && e.creator_verified === true });
    }
    const timed = rows.length > 0 && rows.every((r) => Number.isFinite(r.ts));   // any bad ts: honest sequence order, not a guessed clock
    rows.sort((x, y) => (timed && x.ts !== y.ts ? x.ts - y.ts : x.v - y.v));
    const lanes = [];
    for (const r of rows) if (!lanes.includes(r.lane)) lanes.push(r.lane);
    const t0 = timed ? rows[0].ts : 0, span = timed ? rows[rows.length - 1].ts - t0 : 0;
    const maxW = Math.max(1, ...rows.map((r) => r.words || 0));
    const nodes = rows.map((r, i) => ({
      ...r, laneIndex: lanes.indexOf(r.lane),
      x: Number((3 + (timed && span > 0 ? (r.ts - t0) / span : rows.length > 1 ? i / (rows.length - 1) : 0.5) * 94).toFixed(2)),
      size: r.words === null ? 16 : 14 + Math.round(18 * Math.sqrt(r.words / maxW)),
    }));
    return { axis: timed ? 'time' : 'order', lanes, nodes, refused, skipped };
  }
  // ===== RIVER-MODEL-END =====
  async function viewTimeline() {
    const [vs, map] = await Promise.all([api('/api/versions'), verifMap()]);
    let entries = []; try { entries = ((await exportX()) || {}).entries || []; } catch { /* export paused: page versions still draw, deposits wait */ }
    const m = riverModel(vs, entries, map);
    const river = el('div', 'river');
    river.style.setProperty('--lanes', String(Math.max(1, m.lanes.length)));
    m.lanes.forEach((name, li) => {
      const lane = el('div', 'lane'); lane.style.setProperty('--li', String(li));
      const lab = el('a', 'lanelabel ui'); lab.href = isEdKey(name) ? '#/d/' + encodeURIComponent(name) : '#/a/' + encodeURIComponent(name);
      lab.append(el('span', `dot a${hueSlot(name)}`), ' ' + (isEdKey(name) ? 'key · ' + name.slice(12, 20) : name.replace(/^name:/, '')));
      lane.append(lab); river.append(lane);
    });
    for (const n of m.nodes) {
      const a = el('a', `rnode a${hueSlot(n.lane)}${n.verified ? ' ok' : ' claim'}${n.kind === 'revert' ? ' rev' : ''}${n.kind === 'deposit' ? ' dep' : ''}`);
      a.href = n.href;
      a.style.setProperty('--x', n.x + '%'); a.style.setProperty('--li', String(n.laneIndex)); a.style.setProperty('--sz', n.size + 'px');
      const what = n.kind === 'seed' ? 'first text' : n.kind === 'revert' ? `restored v${n.restored_v}` : n.kind === 'deposit' ? 'deposit' : `${n.words === null ? 'edit' : n.words + ' words changed'}`;
      a.title = `v${n.v} · ${n.lane.replace(/^name:/, '')} · ${what}${Number.isFinite(n.ts) ? ' · ' + ago(new Date(n.ts).toISOString()) : ''}${n.verified ? ' · key checked at ingest' : isEdKey(n.lane) ? ' · signature not checked: a claim' : ' · typed name: a claim'}`;
      a.setAttribute('aria-label', a.title);
      river.append(a);
    }
    const first = m.nodes[0], last = m.nodes[m.nodes.length - 1];
    const ends = el('div', 'rends meta ui');
    ends.append(el('span', '', first && Number.isFinite(first.ts) ? `first · ${ago(new Date(first.ts).toISOString())}` : ''), el('span', '', last && Number.isFinite(last.ts) ? `latest · ${ago(new Date(last.ts).toISOString())}` : ''));
    const foot = ['This is one straight line of edits and deposits. Branches (forks and remixes) arrive with the consent layer.'];
    if (m.refused.length) foot.push(`${m.refused.length} ${m.refused.length === 1 ? 'entry claims' : 'entries claim'} a branch and ${m.refused.length === 1 ? 'is' : 'are'} not drawn.`);
    if (m.axis === 'order') foot.push('Some entries have no usable time, so dots are in sequence order, not clock time.');
    mount(nav('#/', '← Back'), el('h2', '', 'How this text changed'),
      el('p', 'meta ui', 'Left to right is real time. One row per author; bigger dot, bigger edit; a small square-cornered dot is a restore, a small dot is a deposit. Solid ring: a key whose signature the gateway checked. Dashed ring: a name as typed, or a key not checked, a claim. Tap a dot to open it.'),
      river, ends, el('p', 'meta ui', foot.join(' ')));
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
      p('Typed names are not verified, so anyone can use anyone\u2019s name - those entries are claims and stay claims. Real identity work is keys: an author mints an Ed25519 keypair with the Seams launcher, on their own machine (this site never mints), signs their deposit, and the gateway checks that signature at ingest; signature-checked entries carry a \u2713 and a key fingerprint, verified nowhere else, by anyone else, ever. There are no accounts. If you retype or move someone else\u2019s words, the diff sees new words and credits you. Very small edits can be credited oddly.'),
      p('Every save is logged and nothing is deleted. An admin can restore an earlier version, which is itself logged. Saves are rate limited.'),
      (() => { const q = el('p', 'ui'); const a = el('a', '', 'Download the full log (JSON)'); a.href = '/api/export'; q.append(a); return q; })());
  }

  // Browser key minting is REMOVED (design handoff 2026-10-28, owner-dictated: "REMOVE browser
  // mint from the site entirely. The launcher is the one story"). Keys are minted only by the
  // launcher on the user's machine; the demo's deposits views (above) are the identity surface
  // the boards kept. Nothing on this page mints, holds, or intermediates identity.
  function viewAdmin() {
    const i = el('input'); i.placeholder = 'Admin token'; i.type = 'password'; i.value = store.get('admin') || '';
    mount(nav('#/', '← Back'), el('h2', '', 'Admin'), el('p', 'ui', 'Paste the token to see “Restore this version” on old versions.'), i,
      (() => { const r = el('div', 'bar ui'); r.style.marginTop = '1rem'; r.append(btn('Save token', () => { store.set('admin', i.value.trim()); location.hash = '#/history'; }, 'primary'), btn('Forget it', () => { store.set('admin', ''); i.value = ''; })); return r; })());
  }

  // ---------- deposits (site-impl board-1c, EOM-SITE-IMPL-2026-10-28) ----------
  // The browser-mint key view is REMOVED (design handoff 2026-10-28: keys are minted only by the
  // launcher on the user's machine; the site never mints). In its place, the view the boards kept:
  // what every depositing key has deposited - driven end to end by the public export truth.
  const keyDisplay = (ref) => {
    if (isEdKey(ref)) { const fp = ref.slice(12, 20); return `key · ${fp}`; }
    return String(ref);
  };
  async function viewDeposits() {
    let x = null;
    try { x = await exportX(); } catch { /* quiet gateway: say so, never assume */ }
    const parts = [nav('#/', '← Back'), el('h2', '', 'Deposits'),
      el('p', 'meta ui', 'Every key and name that ever deposited on this node, with its honest state. The truth is the export; this page only reads it.')];
    if (!x) {
      parts.push(el('p', 'notice err ui', 'The gateway is not answering right now - no deposits shown, none invented. Try again in a moment.'));
    } else {
      const keys = [];
      const byRef = new Map();
      for (const e of x.entries) {
        const ref = typeof e.creator_ref === 'string' ? e.creator_ref : String(e.name || 'unknown');
        if (!byRef.has(ref)) byRef.set(ref, { ref, count: 0, verified: e.creator_verified === true, fp: e.node_key_fingerprint || '', lastTs: e.ts });
        const row = byRef.get(ref);
        row.count++;
        if (e.creator_verified === true) row.verified = true;
        if (ref.startsWith('key:ed25519:') && e.node_key_fingerprint) row.fp = e.node_key_fingerprint;
        if (typeof e.ts === 'string' && e.ts > row.lastTs) row.lastTs = e.ts;
      }
      for (const row of byRef.values()) keys.push(row);
      keys.sort((a, b) => (a.verified === b.verified ? b.lastTs.localeCompare(a.lastTs) : a.lastTs < b.lastTs ? 1 : -1));
      const lint = el('p', 'meta ui', `${x.entries.length} landings on the log · integrity ${x.integrity && x.integrity.ok ? 'ok' : 'QUARANTINED'} · wire ${x.wire}`);
      parts.push(lint, el('div', ''));
      const ul = el('ul', 'dcards');
      for (const k of keys) {
        const li = el('li');
        const a = el('a'); a.href = '#/d/' + encodeURIComponent(k.ref);
        const badge = el('span', k.verified ? 'vbadge' : 'claimtag', isEdKey(k.ref) ? (k.verified ? `✓ verified · ${k.fp}` : 'claim') : (k.verified ? '✓ verified · ' + k.fp : 'claim'));
        const who = el('span', '', isEdKey(k.ref) ? `key · ${k.fp}` : k.ref.replace(/^name:/, ''));
        const sub = el('span', 'sub', `${k.count} deposit${k.count === 1 ? '' : 's'} · last ${ago(k.lastTs)}`);
        a.append(who, badge, sub); li.append(a); ul.append(li);
      }
      parts.push(ul);
    }
    parts.push(foot());
    mount(...parts);
  }
  async function viewDepositsOne(ref) {
    // one view for both shapes: key refs mirror the public /api/deposits?node_key= truth,
    // name refs filter the same export (- the only public bytes there are).
    let x = null;
    try { x = await exportX(); } catch { /* quiet gateway: say so, never assume */ }
    const head = el('h2', '', typeof ref === 'string' && ref.startsWith('name:') ? ref.slice(5) : keyDisplay(ref));
    if (!x) {
      mount(nav('#/', '← Back'), nav('#/deposits', '← All deposits'), head,
        el('p', 'notice err ui', 'The gateway is not answering right now - nothing shown, nothing invented. Try again in a moment.'), foot());
      return;
    }
    const entries = (x.entries || []).filter((e) => e.creator_ref === ref);
    let verified = false, fp = '';
    for (const e of entries) {
      if (e.creator_verified === true) { verified = true; fp = e.node_key_fingerprint || fp; }
    }
    const reg = (x.nodes || []).find((n) => n.node_key === ref);
    if (reg && reg.verified) verified = true;
    const badge = el('span', verified ? 'vbadge' : 'claimtag',
      verified ? `✓ verified${fp ? ' · ' + fp : ''}` : 'claim');
    badge.title = verified
      ? 'creator_verified true: the gateway checked this key’s Ed25519 signature at ingest. No third party verified anything.'
      : 'No signature was verified for this creator - a claim, forever visible as one.';
    const isKeyRef = typeof ref === 'string' && ref.startsWith('key:');
    const meta = el('p', 'meta ui',
      `${entries.length} landing${entries.length === 1 ? '' : 's'} · integrity ${x.integrity && x.integrity.ok ? 'ok' : 'QUARANTINED'} · wire ${x.wire}`);
    if (isKeyRef) {
      const a = el('a', '', 'machine view: /api/deposits');
      a.href = '/api/deposits?node_key=' + encodeURIComponent(ref);
      meta.append(el('span', '', ' · '), a);
    }
    const ul = el('ul', 'dfeed');
    for (const e of [...entries].sort((a, b) => String(b.ts).localeCompare(String(a.ts)))) {
      const li = el('li');
      const when = el('span', 'when', `v${e.v} · ${e.kind ? e.kind : ''} · ${ago(e.ts)}${e.creator_verified === true ? ' · ✓ verified' : ' · claim'}`);
      const text = el('span', '', snippetOfEntry(e));
      li.append(when, text); ul.append(li);
    }
    if (!entries.length) ul.append(el('li', '', 'No deposits by this creator yet - absence of deposits is an honest answer.'));
    mount(nav('#/', '← Back'), nav('#/deposits', '← All deposits'), head, badge, el('div', ''), meta, ul, foot());
  }
  // honest one-line snippet derived from the entry's own fields (shared with the homepage rule)
  function snippetOfEntry(e) {
    if (typeof e.text === 'string' && e.text.trim()) return e.text;
    if (e.kind === 'node-key') return 'announced a key';
    return 'kind: ' + (e.kind || 'unknown');
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
      else if (h === '/timeline') await viewTimeline();
      else if (h === '/about') viewAbout();
      else if (h === '/deposits') await viewDeposits();
      else if (h === '/admin') viewAdmin();
      else if ((m = h.match(/^\/d\/(.+)$/))) await viewDepositsOne(decodeURIComponent(m[1]));
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
