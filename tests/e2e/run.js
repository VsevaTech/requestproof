#!/usr/bin/env node
'use strict';
/* global chrome */ // used inside page.evaluate() callbacks only
/**
 * End-to-end check of the RequestProof extension in real Chromium (Playwright).
 *
 * Flow under test (mirrors README "Demo"):
 *   open demo form → fill fields (incl. sensitive ones) → Record Submission
 *   → submit → confirmation auto-captured → proof package built
 *   → package inspected: structure, metadata, NO sensitive names/values.
 *
 * Note on permissions: the real extension relies on `activeTab`, which is
 * granted by a user click on the toolbar icon — something automation cannot
 * do. The harness therefore loads a *copy* of the extension whose manifest
 * additionally declares `<all_urls>` host access (captureVisibleTab accepts
 * only `<all_urls>` or `activeTab`; a narrower host pattern is rejected).
 * The copy is written to a temp dir and deleted afterwards. Everything else
 * (service worker, content scripts, popup, packaging) runs unmodified, and
 * the shipped manifest is separately checked by scripts/validate-manifest.js.
 *
 * Usage: node tests/e2e/run.js   (env: CHROME_PATH to override the binary,
 *        HEADED=1 to watch)
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const EXT_SRC = path.join(ROOT, 'extension');
const DEMO = path.join(ROOT, 'demo');
const ART = path.join(__dirname, '.artifacts');

const SENSITIVE_VALUES = {
  full_name: 'Ivan Petrov',
  email: 'ivan.petrov@example.com',
  phone: '+971501234567',
  passport_number: 'P1234567',
  order_id: 'ORD-2026-0913',
  message: 'The delivered device was defective. Requesting a refund.',
  password: 'S3cretPassw0rd!',
  card_number: '4111111111111111',
  cvv: '123',
  internal_note: 'internal-note-value'
};
// Names that must never appear anywhere in the proof.
const FORBIDDEN_NAMES = ['password', 'card_number', 'cardNumber', 'cvv', 'internal_note', 'csrf_token', 'form_version', 'passport'];
// Values that must never appear anywhere in the proof (all values, in fact).
// (short values like a 3-digit CVV are skipped: they could collide with digits inside hashes/timestamps)
const FORBIDDEN_VALUES = Object.values(SENSITIVE_VALUES).concat(['9f1c2e7a-demo-token']).filter((v) => v.length >= 6);

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
  console.log('  ✓ ' + msg);
}

function serveDemo() {
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png' };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const file = path.join(DEMO, path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(DEMO) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end('not found');
    }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

function buildTestExtension() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'requestproof-e2e-'));
  fs.cpSync(EXT_SRC, dir, { recursive: true });
  const manifestPath = path.join(dir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.host_permissions = ['<all_urls>']; // test-only, see header comment
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return dir;
}

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const local = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  return fs.existsSync(local) ? local : undefined;
}

async function main() {
  fs.rmSync(ART, { recursive: true, force: true });
  fs.mkdirSync(ART, { recursive: true });

  const { server, port } = await serveDemo();
  const origin = `http://127.0.0.1:${port}`;
  const extDir = buildTestExtension();
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'requestproof-profile-'));

  const context = await chromium.launchPersistentContext(userData, {
    headless: !process.env.HEADED,
    channel: chromePath() ? undefined : 'chromium',
    executablePath: chromePath(),
    viewport: { width: 1100, height: 900 },
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`]
  });

  try {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    const extId = new URL(sw.url()).host;
    console.log(`extension loaded: ${extId}`);

    const swState = () =>
      sw.evaluate(async () => {
        const r = await chrome.storage.local.get('requestproof.recording');
        return r['requestproof.recording'] || { status: 'idle' };
      });

    // 1. open demo form, fill all fields (including sensitive ones)
    const page = await context.newPage();
    await page.goto(`${origin}/form.html`);
    await page.bringToFront();
    for (const [name, value] of Object.entries(SENSITIVE_VALUES)) {
      await page.fill(`[name="${name}"]`, value);
    }
    await page.selectOption('#category', 'refund');
    await page.check('[name="agree"]');
    await page.check('[name="contact_pref"][value="phone"]');
    console.log('demo form filled');

    // 2. Record Submission (what the popup button does)
    const tabId = await sw.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({ url });
      return tabs[0].id;
    }, `${origin}/form.html`);
    assert(Number.isInteger(tabId), 'form tab located');

    // Drive the same message the popup sends.
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
    await page.bringToFront(); // captureVisibleTab needs the form tab to be active
    const recRes = await popup.evaluate(
      (tab) => new Promise((resolve) => chrome.runtime.sendMessage({ type: 'START_RECORDING', tab }, resolve)),
      { id: tabId, windowId: await sw.evaluate(async (id) => (await chrome.tabs.get(id)).windowId, tabId) }
    );
    assert(recRes && recRes.ok, `Record Submission ok (${recRes && recRes.error})`);
    let state = await swState();
    assert(state.status === 'recording', 'state is recording');
    assert(state.before.url === `${origin}/form.html`, 'before.url recorded');
    assert(state.before.title.includes('Complaint form'), 'before.title recorded');
    assert(/^\d{4}-\d{2}-\d{2}T/.test(state.before.timestamp), 'timestamp recorded');
    assert(state.before.screenshot.startsWith('data:image/png;base64,'), 'before screenshot captured');
    const filled = state.before.fields.filter((f) => f.filled).map((f) => f.name);
    assert(
      ['full_name', 'email', 'phone', 'category', 'order_id', 'message', 'contact_pref', 'agree'].every((n) => filled.includes(n)),
      `filled non-sensitive fields recorded: ${filled.join(', ')}`
    );
    assert(state.before.excludedFieldCount === 5, `5 sensitive fields excluded (passport, password, card, cvv, note) — got ${state.before.excludedFieldCount}`);
    const recordedNames = JSON.stringify(state.before.fields);
    for (const bad of FORBIDDEN_NAMES) assert(!recordedNames.includes(bad), `field list does not mention "${bad}"`);

    // sensitive fields were blurred only for the screenshot and fully restored
    assert((await page.locator('[data-requestproof-masked]').count()) === 0, 'sensitive fields un-masked after screenshot');
    assert((await page.inputValue('[name="card_number"]')) === SENSITIVE_VALUES.card_number, 'page values untouched');
    assert((await page.locator('[name="card_number"]').evaluate((el) => el.style.filter)) === '', 'inline style restored');

    // popup should render the recording view
    await popup.bringToFront();
    await popup.reload();
    await popup.waitForSelector('#view-recording:not([hidden])');
    assert((await popup.textContent('#status-badge')).trim() === 'recording', 'popup shows recording state');
    await popup.screenshot({ path: path.join(ART, 'popup-recording.png') });

    // 3. submit → confirmation page → auto capture
    await page.bringToFront();
    await page.click('#submit');
    await page.waitForURL(/success\.html/);
    for (let i = 0; i < 40 && (await swState()).status !== 'complete'; i++) await page.waitForTimeout(250);
    state = await swState();
    assert(state.status === 'complete', `confirmation auto-captured (autoCapture=${JSON.stringify(state.autoCapture)})`);
    assert(state.after.mode === 'auto', 'capture mode = auto');
    assert(state.after.url.startsWith(`${origin}/success.html`), 'confirmation URL recorded');
    assert(state.after.screenshot.startsWith('data:image/png;base64,'), 'after screenshot captured');

    // 3b. manual Capture confirmation also works (re-capture)
    await popup.bringToFront();
    await popup.reload();
    await popup.waitForSelector('#view-complete:not([hidden])');
    await popup.screenshot({ path: path.join(ART, 'popup-complete.png') });
    await page.bringToFront();
    const manualRes = await popup.evaluate(
      (tab) => new Promise((resolve) => chrome.runtime.sendMessage({ type: 'CAPTURE_CONFIRMATION', tab }, resolve)),
      { id: tabId, windowId: state.windowId }
    );
    assert(manualRes.ok && manualRes.state.after.mode === 'manual', 'manual Capture confirmation works');

    // 4. build the proof package exactly as the Download button does
    await popup.bringToFront();
    const pkg = await popup.evaluate(async () => {
      const res = await new Promise((resolve) => chrome.runtime.sendMessage({ type: 'GET_STATE', full: true }, resolve));
      const { zip, filename } = await globalThis.__requestproofBuildPackage(res.state);
      let bin = '';
      for (let i = 0; i < zip.length; i += 0x8000) bin += String.fromCharCode.apply(null, zip.subarray(i, i + 0x8000));
      return { filename, b64: btoa(bin) };
    });
    const zipPath = path.join(ART, pkg.filename);
    fs.writeFileSync(zipPath, Buffer.from(pkg.b64, 'base64'));
    assert(/^requestproof-127\.0\.0\.1-\d{4}-\d{2}-\d{2}T/.test(pkg.filename), `package filename: ${pkg.filename}`);

    // 4b. the real download path (chrome.downloads) completes
    await popup.click('#btn-download');
    const dl = await sw.evaluate(
      () =>
        new Promise((resolve) => {
          const started = Date.now();
          const poll = async () => {
            const items = await chrome.downloads.search({ orderBy: ['-startTime'], limit: 1 });
            if (items[0] && items[0].state === 'complete') return resolve(items[0]);
            if (Date.now() - started > 10000) return resolve(items[0] || null);
            setTimeout(poll, 200);
          };
          poll();
        })
    );
    assert(dl && dl.state === 'complete', `chrome.downloads completed: ${dl && path.basename(dl.filename)}`);
    assert((await swState()).status === 'idle', 'recording cleared after download');

    // 5. inspect the package
    const outDir = path.join(ART, 'package');
    fs.mkdirSync(outDir, { recursive: true });
    execFileSync('unzip', ['-o', '-q', zipPath, '-d', outDir]);
    const files = fs.readdirSync(outDir).sort();
    assert(JSON.stringify(files) === JSON.stringify(['after.png', 'before.png', 'submission.json', 'summary.html']), `package files: ${files.join(', ')}`);
    const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    for (const f of ['before.png', 'after.png']) {
      const buf = fs.readFileSync(path.join(outDir, f));
      assert(buf.subarray(0, 4).equals(PNG_SIG) && buf.length > 1000, `${f} is a real PNG (${buf.length} bytes)`);
    }
    const submission = JSON.parse(fs.readFileSync(path.join(outDir, 'submission.json'), 'utf8'));
    const summary = fs.readFileSync(path.join(outDir, 'summary.html'), 'utf8');
    assert(submission.page.url === `${origin}/form.html`, 'submission.json: page.url');
    assert(submission.page.title.includes('Complaint form'), 'submission.json: page.title');
    assert(submission.recordedAt && submission.confirmation.url.startsWith(`${origin}/success.html`), 'submission.json: timestamp + confirmation url');
    assert(submission.fields.filter((f) => f.filled).length === 8, 'submission.json: 8 filled fields');
    assert(submission.excludedFieldCount === 5, 'submission.json: excludedFieldCount = 5');
    assert(submission.privacy.valuesRecorded === false, 'submission.json: privacy.valuesRecorded=false');
    for (const f of ['before.png', 'after.png', 'summary.html']) {
      const sha = execFileSync('sha256sum', [path.join(outDir, f)]).toString().split(' ')[0];
      assert(submission.files[f].sha256 === sha, `sha256 of ${f} matches submission.json`);
    }
    for (const s of ['URL', 'Date/time', 'Page title', 'Recorded fields', 'Confirmation page URL']) {
      assert(summary.includes(s), `summary.html has "${s}" section`);
    }
    // Data parts of the proof (the static privacy notice legitimately says the word "passwords").
    const dataParts =
      JSON.stringify({ page: submission.page, forms: submission.forms, fields: submission.fields, confirmation: submission.confirmation }) +
      summary.slice(0, summary.indexOf('<section class="privacy">'));
    for (const bad of FORBIDDEN_NAMES) assert(!dataParts.includes(bad), `proof does not mention sensitive field "${bad}"`);
    const everything = JSON.stringify(submission) + summary;
    for (const bad of FORBIDDEN_VALUES) assert(!everything.includes(bad), `proof does not contain value "${bad.slice(0, 6)}…"`);

    console.log('\nE2E PASSED. Artifacts in', path.relative(ROOT, ART));
  } finally {
    await context.close();
    server.close();
    fs.rmSync(extDir, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('\nE2E FAILED:', err.message || err);
  process.exit(1);
});
