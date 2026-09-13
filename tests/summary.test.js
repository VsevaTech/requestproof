'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../extension/lib/summary.js');

const recording = {
  status: 'complete',
  extensionVersion: '0.1.0',
  timezoneOffsetMinutes: 180,
  before: {
    timestamp: '2026-09-13T10:00:00.000Z',
    url: 'https://example.org/complaint',
    title: 'Complaint <form>',
    origin: 'https://example.org',
    forms: [{ id: 'f', name: null, action: 'https://example.org/submit', method: 'POST', fieldCount: 5 }],
    fields: [
      { label: 'Full name', name: 'full_name', id: 'fullName', type: 'text', filled: true },
      { label: 'Phone', name: 'phone', id: 'phone', type: 'tel', filled: false }
    ],
    filledFieldCount: 1,
    excludedFieldCount: 3,
    screenshot: 'data:image/png;base64,AAAA'
  },
  after: {
    timestamp: '2026-09-13T10:01:00.000Z',
    url: 'https://example.org/thanks?ref=42',
    title: 'Thanks',
    excerpt: 'Your complaint was received. Ref 42',
    mode: 'auto',
    screenshot: 'data:image/png;base64,BBBB'
  }
};
const hashes = { 'before.png': 'aa', 'after.png': 'bb', 'summary.html': 'cc' };

test('submission.json has the required content and no screenshots/values', () => {
  const j = S.buildSubmissionJson(recording, hashes);
  assert.equal(j.page.url, recording.before.url);
  assert.equal(j.page.title, recording.before.title);
  assert.equal(j.recordedAt, recording.before.timestamp);
  assert.equal(j.confirmation.url, recording.after.url);
  assert.equal(j.fields.length, 2);
  assert.equal(j.excludedFieldCount, 3);
  assert.equal(j.files['before.png'].sha256, 'aa');
  assert.equal(j.privacy.valuesRecorded, false);
  const s = JSON.stringify(j);
  assert.equal(s.includes('data:image'), false, 'screenshots must not be embedded in JSON');
  assert.equal(s.includes('screenshot'), false);
});

test('summary.html contains URL, date, title, fields and confirmation URL, escaped', () => {
  const html = S.buildSummaryHtml(recording);
  assert.match(html, /https:\/\/example\.org\/complaint/);
  assert.match(html, /2026-09-13T10:00:00\.000Z/);
  assert.match(html, /Complaint &lt;form&gt;/);
  assert.equal(html.includes('<form>'), false, 'title must be escaped');
  assert.match(html, /Full name/);
  assert.match(html, /https:\/\/example\.org\/thanks\?ref=42/);
  assert.match(html, /before\.png/);
  assert.match(html, /after\.png/);
});

test('summary.html handles a recording without confirmation', () => {
  const html = S.buildSummaryHtml({ ...recording, after: null, status: 'recording' });
  assert.match(html, /No confirmation page captured/);
  assert.equal(html.includes('after.png'), false);
});
