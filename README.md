# RequestProof

**Local, privacy-first proof that you submitted a web form.**
Chrome extension (Manifest V3). No backend, no accounts, no network — everything stays on your device.

[![CI](https://github.com/VsevaTech/requestproof/actions/workflows/ci.yml/badge.svg)](https://github.com/VsevaTech/requestproof/actions/workflows/ci.yml)

## Why

You fill in a complaint, an application or a support request on some organisation's website and press *Submit*.
Weeks later they say they never received anything. You have no confirmation e-mail, the site kept no visible trace,
and a screenshot from your phone proves little on its own.

RequestProof gives you a small, self-contained **proof package** for each submission: what page you were on, when,
which fields you filled in, what the site showed you afterwards — plus two screenshots and SHA-256 hashes of the
files, all generated locally and downloaded as one ZIP.

It is not a notary and does not make claims about the receiving side. It is the evidence you would otherwise wish
you had taken the time to collect.

## How it works

```text
user opens web form
→ clicks Record Submission           (popup)
→ extension captures safe metadata + before.png
→ user submits form                  (site navigates to its confirmation page)
→ extension captures confirmation    (automatic on same-site navigation, or manual "Capture confirmation")
→ creates proof package              (ZIP, built and downloaded locally)
```

### Proof package

```text
requestproof-<host>-<timestamp>.zip
├── submission.json   # machine-readable record (schema requestproof/submission v1)
├── before.png        # viewport screenshot of the form right before submit (sensitive inputs blurred)
├── after.png         # viewport screenshot of the confirmation page
└── summary.html      # human-readable summary, opens in any browser
```

`summary.html` shows: URL, date/time (UTC + local), page title, form action, recorded fields, confirmation page URL,
a short excerpt of the confirmation text, and both screenshots. `submission.json` additionally carries SHA-256 hashes
of `before.png`, `after.png` and `summary.html`, so later tampering with any of them is detectable.

## What is collected

Only when **you** click *Record Submission* / *Capture confirmation*, and only from the tab you clicked on:

| Data | Details |
|---|---|
| Page URL, title, origin | of the form page and of the confirmation page, as shown in the address bar |
| Timestamps | ISO-8601 UTC + your timezone offset |
| Form action / method | e.g. `POST https://site.example/submit` |
| **Names** of form fields | `name`, `id`, visible label, input type, and whether the field was filled (`true/false`) |
| Confirmation text excerpt | first ≈600 characters of visible text on the confirmation page (usually "Thank you, reference № …") |
| Two viewport screenshots | what was visible on screen; sensitive inputs are blurred on `before.png` |

## What is *not* collected — by design

- **Field values.** Never. Not for any field, not even non-sensitive ones. The proof lists *which* fields were
  filled, not *what* you typed. (Values that are visible on screen naturally appear on the screenshots — see below.)
- **Passwords, card data, one-time codes, identity numbers.** Fields of type `password`, with payment
  `autocomplete` tokens (`cc-number`, `cc-csc`, …), or whose name/label/placeholder matches a sensitive pattern
  (card, CVV, IBAN, passport, SSN, PIN, OTP, date of birth, …) are excluded **entirely — not even their names** are
  recorded; the proof only states how many fields were excluded. They are also blurred on `before.png`.
  A site can mark any field `data-sensitive` to force exclusion.
- **Hidden fields** (`type=hidden`, CSRF tokens, etc.) — skipped and not counted.
- **Cookies** — the extension has no `cookies` permission and never reads `document.cookie`.
- **Browser history** — no `history` permission.
- **Page storage** — no `localStorage`, `sessionStorage` or IndexedDB access on any site.
- **Other tabs** — access is limited to the tab you clicked on (`activeTab`), for that page only.
- **Anything sent anywhere** — no server, no analytics, no telemetry. The extension's CSP is
  `connect-src 'none'`; the codebase contains no `fetch`/`XMLHttpRequest`/`WebSocket`/`sendBeacon`, and CI fails
  if one appears.

The exclusion list lives in [`extension/lib/fields.js`](extension/lib/fields.js) and is unit-tested. The permission
allowlist and the "no network / no storage API" source scan live in [`scripts/validate-manifest.js`](scripts/validate-manifest.js)
and run on every commit.

### Honest caveats

- **Screenshots show what was on screen.** Sensitive *inputs* are blurred on `before.png`, but page text,
  e.g. your name in a greeting, is not. Review the package before sending it to anyone.
- **URLs are recorded verbatim.** If a site puts data into the confirmation URL (`?email=…`), it will be in the proof.
- **Viewport only.** Screenshots capture the visible part of the page (Chrome's `captureVisibleTab`), not the full
  scroll height. Scroll to the relevant part before clicking.
- **Temporary storage.** Between *Record Submission* and download, the recording (incl. screenshots) is kept in the
  extension's own `chrome.storage.local` — on your disk, not synced, not accessible to web pages. It is deleted when
  you download or discard the package.
- **The proof is only as strong as your custody of it.** Hashes let a third party detect modification of the files
  *after* the package was created; they do not prove the moment of creation. For high-stakes cases, e-mail the ZIP to
  yourself right away or store it with a trusted timestamping service.

## Permissions

| Permission | Why |
|---|---|
| `activeTab` | read URL/title and take a screenshot of the tab you clicked on — access is granted per click and lasts only while you stay on that site |
| `scripting` | inject the small metadata collector into that tab on demand (no persistent content scripts) |
| `storage` | keep the recording locally until you download it |
| `downloads` | save the ZIP |

No `host_permissions`, no `tabs`, no `cookies`, no `history`, no `webRequest`.

## Install locally (Chrome / Edge / Brave)

1. Clone or download this repository.
2. Open `chrome://extensions`, enable **Developer mode** (top right).
3. Click **Load unpacked** and select the [`extension/`](extension) folder.
4. Pin RequestProof to the toolbar (puzzle icon → pin).

To use it on `file://` pages (not needed for the demo below), enable *Allow access to file URLs* in the extension's
details.

## Try the demo

The repo ships a fake complaint form and confirmation page so you can test without any real website.

```bash
git clone https://github.com/VsevaTech/requestproof.git
cd requestproof
python3 -m http.server 8080 --directory demo     # or: npx serve demo
```

Then:

1. Open <http://localhost:8080/form.html> and fill in the fields — including the "sensitive" ones (passport, password,
   card number, CVV, internal note).
2. Click the RequestProof icon → **Record Submission**. The popup switches to *recording* and lists the fields it
   recorded: 8 filled, **5 sensitive excluded**.
3. Click **Submit complaint** on the page. The site navigates to `success.html`; RequestProof captures it
   automatically and the popup shows *Confirmation captured*.
   If a real site navigates to a different domain, automatic capture is not possible — open the popup on the
   confirmation page and click **Capture confirmation** instead.
4. Click **Download proof package**. A `requestproof-localhost-….zip` lands in your Downloads folder.
5. Unzip and open `summary.html`. Check for yourself: no passwords, card numbers or field values anywhere;
   `before.png` has the sensitive inputs blurred.

## Development

```bash
npm install
npm run lint               # eslint, incl. privacy guardrails (no fetch / cookies / storage APIs)
npm run validate:manifest  # MV3 shape, referenced files, permission allowlist, CSP, source scan
npm test                   # unit tests: field classifier, ZIP writer, summary/JSON builders
npm run e2e                # loads the extension into real Chromium (Playwright) and runs the demo flow end-to-end
```

The end-to-end test fills the demo form, records, submits, verifies auto-capture and manual capture, builds and
downloads the package, unzips it and asserts that no sensitive field name or any field value appears in it
(`tests/e2e/run.js`). Because `activeTab` can only be granted by a real user click, the harness loads a temporary
copy of the extension with `<all_urls>` host access; the shipped manifest is validated separately. Artifacts
(package + popup screenshots) are uploaded on every CI run.

### Layout

```text
extension/
  manifest.json              MV3 manifest
  background/service-worker.js   recording state machine, screenshots, auto-capture
  content/collect.js         reads URL/title/forms/field *names* (injected on demand)
  content/page-info.js       confirmation page URL/title/excerpt
  content/mask-on.js|off.js  blur sensitive inputs for the screenshot, then restore
  lib/fields.js              sensitive-field classifier (pure, unit-tested)
  lib/zip.js                 dependency-free ZIP (STORE) writer
  lib/summary.js             submission.json + summary.html builders
  popup/                     UI: Record Submission / Capture confirmation / Download
demo/                        form.html, success.html — local test site
tests/                       unit tests + tests/e2e/run.js
scripts/validate-manifest.js static manifest + privacy checks
scripts/generate-icons.js    deterministic icon generator (no binary assets needed)
.github/workflows/ci.yml     lint → validate → unit → e2e in Chromium
```

## Roadmap (not in MVP)

Full-page screenshots, optional PDF export of the summary, RFC 3161 timestamping of the package hash, Firefox build,
i18n of the popup and summary.

## License

[MIT](LICENSE)
