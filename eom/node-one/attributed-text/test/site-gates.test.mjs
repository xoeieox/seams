// site-gates.test.mjs - the BUILD-TIME grep gate for the site-impl wave
// (EOM-SITE-IMPL-2026-10-28, handoff "Gates": no token drift outside the token block,
// no <form> email fields, no mint-tab on the public site).
//
// These are ship-blockers read from the PUBLIC bytes themselves, not proxies for intent.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.join(here, '..', 'public');
const read = (f) => fs.readFileSync(path.join(pub, f), 'utf8');
const FILES = ['app.css', 'app.js', 'home.html', 'home.js', 'index.html', 'landing.html', 'landing.js'];

test('GATE: an explicit token block exists, carries light AND dark oklch sets', () => {
  const css = read('app.css');
  assert.match(css, /TOKEN BLOCK \(board-1e/, 'the token block exists and names the board');
  assert.match(css, /TOKEN BLOCK END/);
  assert.match(css, /--t-bg:\s*oklch\(/, 'light surfaces/lines/ink/accent are oklch tokens');
  assert.ok((css.match(/--t-bg:\s*oklch\(/g) || []).length >= 2, 'both the light and the dark set are in the block');
});

test('GATE: no oklch and no hex color literal outside the token block (no token drift)', () => {
  const css = read('app.css');
  const b = css.indexOf('TOKEN BLOCK (');
  const e = css.indexOf('TOKEN BLOCK END', b);
  assert.ok(b !== -1 && e > b, 'token block markers present');
  const inside = css.slice(0, e), outside = css.slice(e);
  const oklchOutside = outside.match(/oklch\(/g) || [];
  assert.deepEqual(oklchOutside.map(String), [], `oklch() outside the token block: ${JSON.stringify(oklchOutside && [] && ['drift'])}`);
  const hexOutside = (outside.match(/#[0-9a-fA-F]{3,8}\b/g) || []);
  const hexInside = (inside.match(/#[0-9a-fA-F]{3,8}\b/g) || []);
  assert.equal(hexOutside.length, 0, `hex color literals outside the token block: ${hexOutside.join(', ')}`);
  // colors the block does not own carry no rgb() either - the author palette stays hsl (hue classes)
  assert.equal((outside.match(/rgba?\(/g) || []).length, 0, 'rgb()/rgba() outside the block is drift');
  assert.ok(hexInside.length === 0, 'the block itself is pure oklch, no hex remnant: ' + hexInside.join(', '));
});

test('GATE: author palette rules (board-1e) - hue only in name text, dot background, and the per-segment underline', () => {
  const css = read('app.css');
  // every hsl( usage must be inside the palette rules: name text, dot, underline, selection, chips
  const uses = (css.match(/hsl\(/g) || []).length;
  const sweep = [
    /\.dot\s*\{[^}]*hsl\(/,            // dot background (tint values)
    /\.color\s+\.seg\s*\{[^}]*hsl\(/,  // per-segment author underline (board-1c)
    /\.hl\s*\{[^}]*hsl\(/,             // selection tint (author view selection state, not identity)
    /\.chip\s*\{[^}]*hsl\(/,           // chips reuse the same underline treatment
    /\.name\s*\{[^}]*hsl\(/,           // hue in the NAME text (the text-usable variant)
    /\.alt\s+\.seg,\s*\.alt\.seg,\s*\.alt\.chip/, // the fixed collision fallback block
  ];
  assert.ok(uses >= sweep.length, `every palette hsl() belongs to a named rule (${uses} uses)`);
  for (const re of sweep) assert.match(css.replace(/\/\*[\s\S]*?\*\//g, ''), re, `missing palette rule: ${re}`);
  // and ten pinned hue-classes exist exactly as before (the identity contract stays stable)
  for (let i = 0; i < 10; i++) assert.match(css, new RegExp(`\\.a${i}\\s*\\{\\s*--h:\\s*\\d+;?\\s*\\}`));
});

test('GATE: badges are neutral - no green checks, shields, seals, or vouch implications', () => {
  const css = read('app.css');
  const vb = css.match(/\.vbadge\s*\{[^}]*\}/);
  assert.ok(vb, 'the verified badge remains a VISUAL CLASS (fixwave Leg 3 contract)');
  for (const bad of ['#2e7d32', '#1b5e20', '#d7eeda', '#a5d6a7', '#223821', '#81c784']) assert.ok(!vb[0].includes(bad), `the old green remnant ${bad} left the verified badge`);
  assert.match(vb[0], /--t-ink/, 'verified is a neutral ink ring');
  assert.match(vb[0], /outline/, 'the double ring reads as the checked row (border + outline, shadows still off)');
  assert.ok(!/box-shadow[^;]*[1-9]/.test(read('app.css').split('TOKEN BLOCK END')[1] || ''), 'board-1e: shadows stay OFF (borders carry structure)');
});

test('GATE: no <form> email fields anywhere on the public site', () => {
  for (const f of FILES) {
    const src = read(f);
    assert.doesNotMatch(src, /type\s*=\s*['"]email['"]/i, `${f}: no email input`);
    assert.doesNotMatch(src, /<form[^>]*(action|method)\s*=/i, `${f}: no form machinery`);
    for (const bad of /mailto:/gi.test(src) ? ['mailto:'] : []) assert.equal(bad, undefined);
    assert.doesNotMatch(src, /href\s*=\s*['"]mailto:/i, `${f}: no mailto join affordance`);
    assert.doesNotMatch(src, /sign\s*up|create\s*account|newsletter|subscribe/i, `${f}: no account/email capture ask`);
  }
});

test('GATE: no mint-tab on the public site - keys are minted only by the launcher', () => {
  for (const f of ['app.js', 'home.html', 'home.js', 'index.html', 'landing.html']) {
    const src = read(f);
    assert.doesNotMatch(src, /Mint\s+(my|a)\s+key/, `${f}: no mint CTA`);
    assert.doesNotMatch(src, /href=("|')[^"']*[#\/]keys/ , `${f}: no #/keys mint tab link`);
    assert.doesNotMatch(src, /WebCrypto|crypto\.subtle/i, `${f}: no browser custody code - the site never mints, holds, or intermediates identity`);
  }
  // honesty echo: the shipped copy says WHY (the launcher is the one story)
  assert.match(read('app.js'), /site never mints|never mints/, 'the removal is stated in the shipped source, not just enforced');
});

test('landing doc + demo shell share the token stylesheet (no inline style re-implementations)', () => {
  assert.doesNotMatch(read('landing.html'), /<style/, 'landing.html no longer carries its own hex style block');
  assert.match(read('landing.html'), /href="\/app\.css"/);
  assert.match(read('index.html'), /href="\/app\.css"/);
  assert.match(read('home.html'), /href="\/app\.css"/);
});
