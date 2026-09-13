#!/usr/bin/env node
'use strict';
/**
 * Static validation of extension/manifest.json:
 *  - Manifest V3 shape (required keys, MV3-only keys, no MV2 leftovers)
 *  - every referenced file exists
 *  - permission allowlist — the privacy promise is enforced here:
 *    no cookies / history / webRequest / tabs / <all_urls> / broad host perms
 *  - CSP forbids remote code and network connections
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', 'extension');
const manifestPath = path.join(root, 'manifest.json');
const errors = [];
const fail = (m) => errors.push(m);

const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

if (m.manifest_version !== 3) fail('manifest_version must be 3');
for (const k of ['name', 'version', 'description', 'action', 'background', 'icons']) {
  if (!(k in m)) fail(`missing required key: ${k}`);
}
if (!/^\d+(\.\d+){0,3}$/.test(m.version || '')) fail(`invalid version: ${m.version}`);
if (!m.background || !m.background.service_worker) fail('background.service_worker required in MV3');
if (m.background && m.background.scripts) fail('background.scripts is MV2-only');
if (m.browser_action || m.page_action) fail('browser_action/page_action are MV2-only; use action');
if (typeof m.content_security_policy === 'string') fail('content_security_policy must be an object in MV3');
if (m.web_accessible_resources && !Array.isArray(m.web_accessible_resources)) fail('web_accessible_resources must be an array of objects');

const exists = (rel) => fs.existsSync(path.join(root, rel));
const checkFile = (rel, what) => {
  if (rel && !exists(rel)) fail(`${what} references missing file: ${rel}`);
};
checkFile(m.background && m.background.service_worker, 'background.service_worker');
checkFile(m.action && m.action.default_popup, 'action.default_popup');
for (const [size, file] of Object.entries(m.icons || {})) checkFile(file, `icons[${size}]`);
for (const [size, file] of Object.entries((m.action && m.action.default_icon) || {})) checkFile(file, `action.default_icon[${size}]`);
for (const cs of m.content_scripts || []) {
  for (const f of cs.js || []) checkFile(f, 'content_scripts.js');
}

// Also validate files injected at runtime by the service worker.
for (const rel of ['lib/fields.js', 'content/collect.js', 'content/page-info.js', 'content/mask-on.js', 'content/mask-off.js', 'lib/zip.js', 'lib/summary.js']) {
  checkFile(rel, 'runtime injection');
}

// ---- privacy allowlist ----
const ALLOWED_PERMISSIONS = new Set(['activeTab', 'scripting', 'storage', 'downloads']);
const FORBIDDEN = ['cookies', 'history', 'tabs', 'webRequest', 'webRequestBlocking', 'webNavigation', 'browsingData', 'identity', 'management', 'nativeMessaging', 'proxy', 'unlimitedStorage', 'clipboardRead', 'geolocation', 'topSites', 'sessions', 'bookmarks'];
for (const p of m.permissions || []) {
  if (!ALLOWED_PERMISSIONS.has(p)) fail(`permission not on allowlist: ${p}`);
  if (FORBIDDEN.includes(p)) fail(`forbidden permission: ${p}`);
}
if ((m.optional_permissions || []).length) fail('optional_permissions must be empty');
if ((m.host_permissions || []).length) fail(`host_permissions must be empty (activeTab only), got: ${m.host_permissions.join(', ')}`);
if ((m.optional_host_permissions || []).length) fail('optional_host_permissions must be empty');
if (m.content_scripts && m.content_scripts.length) fail('no declarative content_scripts: inject on demand via activeTab');

const csp = (m.content_security_policy && m.content_security_policy.extension_pages) || '';
if (!/script-src 'self'/.test(csp)) fail("CSP must restrict script-src to 'self'");
if (/https?:|unsafe-eval|unsafe-inline/.test(csp)) fail('CSP must not allow remote or unsafe script sources');
if (!/connect-src 'none'/.test(csp)) fail("CSP should set connect-src 'none' (no network)");

// ---- source scan: no network / storage / cookie APIs anywhere in extension code ----
const banned = [
  /\bfetch\s*\(/,
  /XMLHttpRequest/,
  /WebSocket/,
  /sendBeacon/,
  /document\.cookie/,
  /chrome\.cookies/,
  /chrome\.history/,
  /\b(localStorage|sessionStorage)\s*[.[]/,
  /\bindexedDB\s*[.[]/,
  /\bchrome\.storage\.sync\b/,
  /importScripts\s*\(\s*['"]https?:/
];
function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p);
    else if (/\.(js|html)$/.test(ent.name)) {
      const src = fs.readFileSync(p, 'utf8');
      for (const re of banned) {
        if (re.test(src)) fail(`${path.relative(root, p)} uses banned API ${re}`);
      }
      if (/<script[^>]+src=["']https?:/i.test(src)) fail(`${path.relative(root, p)} loads a remote script`);
    }
  }
}
walk(root);

if (errors.length) {
  console.error('manifest validation FAILED:');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(`manifest OK: ${m.name} v${m.version} (MV3), permissions: ${(m.permissions || []).join(', ')}`);
