/* global chrome, RequestProofZip, RequestProofSummary */
'use strict';

const $ = (id) => document.getElementById(id);

function send(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (res) => {
      if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
      else resolve(res || { ok: false, error: 'No response' });
    });
  });
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error('No active tab');
  if (!/^(https?|file):/i.test(tab.url || '')) {
    throw new Error('RequestProof works on http(s) pages (and file:// if allowed in extension settings).');
  }
  return { id: tab.id, windowId: tab.windowId, url: tab.url, title: tab.title };
}

function showError(msg) {
  const el = $('error');
  el.textContent = msg || '';
  el.hidden = !msg;
}

function fmt(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString();
}

function render(state) {
  showError('');
  const badge = $('status-badge');
  badge.textContent = state.status;
  badge.className = `badge ${state.status}`;

  $('view-idle').hidden = state.status !== 'idle';
  $('view-recording').hidden = state.status !== 'recording';
  $('view-complete').hidden = state.status !== 'complete';

  if (state.status === 'recording' || state.status === 'complete') {
    const b = state.before;
    $('rec-title').textContent = b.title || '(no title)';
    $('rec-url').textContent = b.url;
    $('rec-time').textContent = fmt(b.timestamp);
    const filled = (b.fields || []).filter((f) => f.filled);
    $('rec-fields').textContent =
      `${filled.length} filled` +
      (b.excludedFieldCount ? `, ${b.excludedFieldCount} sensitive excluded` : '') +
      (filled.length ? `: ${filled.map((f) => f.label || f.name || f.id).join(', ')}` : '');
    const autoErr = $('rec-auto-error');
    if (state.autoCapture && state.autoCapture.error) {
      autoErr.hidden = false;
      autoErr.textContent = `Automatic capture did not work (${state.autoCapture.error}). Open this popup on the confirmation page and click "Capture confirmation".`;
    } else {
      autoErr.hidden = true;
    }
  }
  if (state.status === 'complete') {
    $('done-before-url').textContent = state.before.url;
    $('done-after-url').textContent = state.after.url || '—';
    $('done-after-time').textContent = `${fmt(state.after.timestamp)} (${state.after.mode})`;
  }
}

async function refresh() {
  const res = await send({ type: 'GET_STATE' });
  if (!res.ok) return showError(res.error);
  render(res.state);
}

// ---------- proof package ----------

function dataUrlToBytes(dataUrl) {
  const comma = dataUrl.indexOf(',');
  const bin = atob(dataUrl.slice(comma + 1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function safeHost(url) {
  try {
    return new URL(url).hostname.replace(/[^a-z0-9.-]/gi, '_') || 'page';
  } catch {
    return 'page';
  }
}

async function buildPackage(state) {
  const enc = new TextEncoder();
  const beforePng = dataUrlToBytes(state.before.screenshot);
  const afterPng = state.after && state.after.screenshot ? dataUrlToBytes(state.after.screenshot) : null;
  const summaryHtml = enc.encode(RequestProofSummary.buildSummaryHtml(state));

  const hashes = {
    'before.png': await sha256Hex(beforePng),
    'after.png': afterPng ? await sha256Hex(afterPng) : null,
    'summary.html': await sha256Hex(summaryHtml)
  };
  const submission = RequestProofSummary.buildSubmissionJson(state, hashes);
  const entries = [
    { name: 'submission.json', data: JSON.stringify(submission, null, 2) },
    { name: 'before.png', data: beforePng },
    { name: 'summary.html', data: summaryHtml }
  ];
  if (afterPng) entries.splice(2, 0, { name: 'after.png', data: afterPng });

  const zip = RequestProofZip.buildZip(entries);
  const stamp = (state.before.timestamp || new Date().toISOString()).replace(/[:.]/g, '-').slice(0, 19);
  const filename = `requestproof-${safeHost(state.before.url)}-${stamp}.zip`;
  return { zip, filename };
}

async function downloadPackage() {
  const res = await send({ type: 'GET_STATE', full: true });
  if (!res.ok) throw new Error(res.error);
  const state = res.state;
  if (state.status === 'idle') throw new Error('Nothing recorded');

  const { zip, filename } = await buildPackage(state);
  const blob = new Blob([zip], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename, saveAs: false, conflictAction: 'uniquify' });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  await send({ type: 'DISCARD' });
  await refresh();
}

// ---------- wiring ----------

function busy(fn) {
  return async () => {
    const all = document.querySelectorAll('button');
    all.forEach((b) => (b.disabled = true));
    try {
      await fn();
    } catch (err) {
      showError(err && err.message ? err.message : String(err));
    } finally {
      all.forEach((b) => (b.disabled = false));
    }
  };
}

$('btn-record').addEventListener(
  'click',
  busy(async () => {
    const tab = await activeTab();
    const res = await send({ type: 'START_RECORDING', tab });
    if (!res.ok) throw new Error(res.error);
    render(res.state);
  })
);

const capture = busy(async () => {
  const tab = await activeTab();
  const res = await send({ type: 'CAPTURE_CONFIRMATION', tab });
  if (!res.ok) throw new Error(res.error);
  render(res.state);
});
$('btn-capture').addEventListener('click', capture);
$('btn-recapture').addEventListener('click', capture);

const discard = busy(async () => {
  const res = await send({ type: 'DISCARD' });
  if (!res.ok) throw new Error(res.error);
  render(res.state);
});
$('btn-discard').addEventListener('click', discard);
$('btn-discard-2').addEventListener('click', discard);

$('btn-download').addEventListener('click', busy(downloadPackage));
$('btn-download-partial').addEventListener('click', busy(downloadPackage));

refresh();

// Exposed for the end-to-end test harness (tests/e2e/run.js); no runtime effect.
globalThis.__requestproofBuildPackage = buildPackage;
