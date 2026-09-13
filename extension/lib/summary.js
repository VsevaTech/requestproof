/**
 * RequestProof — builds submission.json and summary.html from a recording.
 * Pure functions, testable in Node.
 */
(function (root) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return `${d.toISOString()} (local: ${d.toLocaleString()})`;
  }

  /**
   * @param {object} rec  recording from chrome.storage (see service-worker.js)
   * @param {object} hashes  { 'before.png': sha256hex, 'after.png': ..., 'summary.html': ... }
   */
  function buildSubmissionJson(rec, hashes) {
    const before = rec.before || {};
    const after = rec.after || null;
    return {
      schema: 'requestproof/submission',
      schemaVersion: 1,
      generator: { name: 'RequestProof', version: rec.extensionVersion || null },
      recordedAt: before.timestamp || null,
      timezoneOffsetMinutes: rec.timezoneOffsetMinutes ?? null,
      page: {
        url: before.url || null,
        title: before.title || null,
        origin: before.origin || null
      },
      forms: before.forms || [],
      fields: before.fields || [],
      filledFieldCount: before.filledFieldCount ?? null,
      excludedFieldCount: before.excludedFieldCount ?? 0,
      confirmation: after
        ? {
            url: after.url || null,
            title: after.title || null,
            capturedAt: after.timestamp || null,
            capturedBy: after.mode || 'manual',
            excerpt: after.excerpt || null
          }
        : null,
      files: {
        'before.png': hashes['before.png'] ? { sha256: hashes['before.png'] } : null,
        'after.png': hashes['after.png'] ? { sha256: hashes['after.png'] } : null,
        'summary.html': hashes['summary.html'] ? { sha256: hashes['summary.html'] } : null
      },
      privacy: {
        valuesRecorded: false,
        excludedCategories: ['passwords', 'hidden fields', 'payment card data', 'identity numbers', 'one-time codes'],
        cookies: false,
        browserHistory: false,
        localStorage: false,
        networkUpload: false
      }
    };
  }

  function buildSummaryHtml(rec) {
    const before = rec.before || {};
    const after = rec.after || null;
    const fields = (before.fields || []).filter((f) => f.filled);
    const notFilled = (before.fields || []).filter((f) => !f.filled);

    const row = (k, v) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`;
    const fieldRows = fields.length
      ? fields
          .map(
            (f) =>
              `<tr><td>${esc(f.label || '')}</td><td><code>${esc(f.name || f.id || '')}</code></td><td>${esc(f.type)}</td></tr>`
          )
          .join('')
      : '<tr><td colspan="3"><em>No filled fields recorded</em></td></tr>';

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>RequestProof — submission summary</title>
<style>
  body{font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;max-width:900px;margin:32px auto;padding:0 16px;color:#1b1b1f;background:#fff}
  h1{font-size:22px;margin:0 0 4px}
  .sub{color:#666;margin:0 0 24px}
  table{border-collapse:collapse;width:100%;margin:8px 0 24px}
  th,td{border:1px solid #ddd;padding:6px 10px;text-align:left;vertical-align:top;word-break:break-word}
  th{background:#f5f5f7;width:220px;font-weight:600}
  section h2{font-size:16px;margin:24px 0 8px}
  figure{margin:0 0 24px}
  figure img{max-width:100%;border:1px solid #ddd;border-radius:6px}
  figcaption{color:#666;font-size:12px;margin-top:4px}
  .badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;background:#e8f5e9;color:#1b5e20}
  .badge.warn{background:#fff3e0;color:#e65100}
  .privacy{background:#f5f5f7;border-radius:8px;padding:12px 16px;font-size:13px}
  code{font-size:12px}
</style>
</head>
<body>
<h1>RequestProof — submission summary</h1>
<p class="sub">Generated locally by the RequestProof browser extension. No data left this device.</p>

<section>
<h2>Submission</h2>
<table>
${row('URL', `<a href="${esc(before.url)}">${esc(before.url)}</a>`)}
${row('Date/time', esc(fmtDate(before.timestamp)))}
${row('Page title', esc(before.title || '—'))}
${row(
  'Form action',
  (before.forms || []).length
    ? before.forms.map((f) => `${esc(f.method)} <code>${esc(f.action || '—')}</code>`).join('<br>')
    : '—'
)}
${row('Filled fields', String(fields.length))}
${row(
  'Excluded (sensitive) fields',
  `${esc(before.excludedFieldCount ?? 0)} <span class="badge">names and values not recorded</span>`
)}
</table>
</section>

<section>
<h2>Recorded fields (names only — values are never stored)</h2>
<table>
<tr><th style="width:auto">Label</th><th style="width:auto">Name / id</th><th style="width:auto">Type</th></tr>
${fieldRows}
</table>
${
  notFilled.length
    ? `<p class="sub">Present but left empty: ${notFilled.map((f) => `<code>${esc(f.label || f.name || f.id)}</code>`).join(', ')}</p>`
    : ''
}
</section>

<section>
<h2>Confirmation page</h2>
${
  after
    ? `<table>
${row('Confirmation page URL', `<a href="${esc(after.url)}">${esc(after.url)}</a>`)}
${row('Captured at', esc(fmtDate(after.timestamp)))}
${row('Title', esc(after.title || '—'))}
${row('Captured', after.mode === 'auto' ? 'automatically after navigation' : 'manually via <em>Capture confirmation</em>')}
${after.excerpt ? row('Visible text (excerpt)', `<em>${esc(after.excerpt)}</em>`) : ''}
</table>`
    : '<p><span class="badge warn">No confirmation page captured</span></p>'
}
</section>

<section>
<h2>Screenshots</h2>
<figure><img src="before.png" alt="Page before submission"><figcaption>before.png — form page, immediately before submit</figcaption></figure>
${after ? '<figure><img src="after.png" alt="Confirmation page"><figcaption>after.png — confirmation page</figcaption></figure>' : ''}
</section>

<section class="privacy">
<strong>What this package does not contain:</strong> field values, passwords, hidden fields, payment card data, cookies,
browser history or local storage. File hashes are listed in <code>submission.json</code>.
</section>
</body>
</html>
`;
  }

  const api = { buildSubmissionJson, buildSummaryHtml, esc };
  root.RequestProofSummary = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
