// R4 (2026-10-29): the timeline-river view is wired, read-only, and uses the existing hue classes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const pub = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const js = fs.readFileSync(path.join(pub, 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(pub, 'app.css'), 'utf8');
const home = fs.readFileSync(path.join(pub, 'home.html'), 'utf8');

test('timeline route exists and reads only /api/versions + the export-backed verif map', () => {
  assert.match(js, /h === '\/timeline'\) await viewTimeline\(\)/);
  const body = js.slice(js.indexOf('async function viewTimeline'), js.indexOf('async function viewVersion'));
  assert.match(body, /api\('\/api\/versions'\)/);
  assert.doesNotMatch(body, /post\(|method:\s*'POST'|localStorage|generateKey/, 'read-only; no mint, no write');
  assert.match(body, /hueSlot\(/, 'author colour comes from the pinned hue contract, not a new palette');
});
test('the hue saturation token is defined (author colours must actually render)', () => {
  assert.match(css, /:root \{[^}]*--s:\s*\d+%/);
});
test('home copy carries no placeholder text', () => {
  assert.doesNotMatch(home, /placeholder|Erah finalizes/i);
});
