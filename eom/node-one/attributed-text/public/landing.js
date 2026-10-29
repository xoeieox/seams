// Self-status for the landing page: fetched, never asserted. No inline script anywhere (CSP script-src 'self').
(function () {
  var el = document.getElementById('live');
  if (!el) return;
  function show(lines) { el.textContent = lines.join('\n'); }
  fetch('/api/hello', { headers: { 'accept': 'application/json' } })
    .then(function (r) { return r.json().then(function (b) { return { st: r.status, b: b }; }); })
    .then(function (res) {
      if (res.st !== 200 || !res.b.ok) { show(['GET /api/hello -> ' + res.st, JSON.stringify(res.b)]); return; }
      var b = res.b;
      show([
        'GET /api/hello -> 200',
        'node:            ' + b.node,
        'wire:            ' + b.wire + '  (pinned by conforming clients)',
        'format:          ' + b.format,
        'gate kinds:      ' + (b.gate && b.gate.kinds ? b.gate.kinds.join(', ') : '?') + '  (closed list; unknown kinds refused)',
        'integrity:       ' + (b.integrity || '?'),
        'limits:          ' + JSON.stringify(b.limits),
        'idempotence:     ' + (b.idempotence || '?'),
      ]);
    })
    .catch(function (e) { show(['GET /api/hello failed: ' + e]); });
})();
