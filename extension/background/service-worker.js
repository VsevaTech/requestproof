/* global chrome */
/**
 * RequestProof — background service worker (MV3).
 *
 * Owns the recording state machine:
 *   idle → recording (before captured) → complete (after captured)
 *
 * All state lives in chrome.storage.local under a single key and is removed
 * when the user downloads or discards the proof. Nothing is sent anywhere.
 *
 * Permission model: `activeTab` only. Access to a page is granted when the
 * user clicks the extension on that tab. It survives same-origin navigations
 * (form → confirmation on the same site), which lets us auto-capture the
 * confirmation. If the site redirects to another origin, auto-capture fails
 * and the popup asks the user to click "Capture confirmation".
 */
'use strict';

const STORAGE_KEY = 'requestproof.recording';

const defaultState = () => ({ status: 'idle' });

async function getState() {
  const res = await chrome.storage.local.get(STORAGE_KEY);
  return res[STORAGE_KEY] || defaultState();
}

async function setState(state) {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
  return state;
}

async function clearState() {
  await chrome.storage.local.remove(STORAGE_KEY);
  return defaultState();
}

async function runInTab(tabId, files) {
  const results = await chrome.scripting.executeScript({ target: { tabId }, files });
  return results && results[0] ? results[0].result : null;
}

async function screenshot(windowId) {
  return chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
}

async function startRecording(tab) {
  const meta = await runInTab(tab.id, ['lib/fields.js', 'content/collect.js']);
  if (!meta) throw new Error('Could not read page metadata');
  // Blur sensitive inputs (passwords, card data, …) so their values are not
  // readable on the screenshot either; restore immediately afterwards.
  let png;
  try {
    await runInTab(tab.id, ['lib/fields.js', 'content/mask-on.js']);
    await new Promise((r) => setTimeout(r, 50)); // let the style apply
    png = await screenshot(tab.windowId);
  } finally {
    await runInTab(tab.id, ['content/mask-off.js']).catch(() => {});
  }
  const now = new Date();
  const state = {
    status: 'recording',
    tabId: tab.id,
    windowId: tab.windowId,
    extensionVersion: chrome.runtime.getManifest().version,
    timezoneOffsetMinutes: -now.getTimezoneOffset(),
    before: {
      timestamp: now.toISOString(),
      url: meta.url,
      title: meta.title,
      origin: meta.origin,
      forms: meta.forms,
      fields: meta.fields,
      filledFieldCount: meta.filledFieldCount,
      excludedFieldCount: meta.excludedFieldCount,
      screenshot: png
    },
    after: null,
    autoCapture: { attempted: false, error: null }
  };
  return setState(state);
}

async function captureConfirmation(tab, mode) {
  const state = await getState();
  if (state.status === 'idle') throw new Error('No active recording');
  const info = await runInTab(tab.id, ['content/page-info.js']);
  const png = await screenshot(tab.windowId);
  state.after = {
    timestamp: new Date().toISOString(),
    url: info ? info.url : tab.url || null,
    title: info ? info.title : tab.title || null,
    excerpt: info ? info.excerpt : null,
    mode,
    screenshot: png
  };
  state.status = 'complete';
  state.autoCapture = { attempted: true, error: null };
  return setState(state);
}

/**
 * Auto-capture: when the recorded tab finishes loading a *different* URL,
 * try to capture it. Wait a moment so the page renders.
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  const state = await getState();
  if (state.status !== 'recording' || state.tabId !== tabId) return;
  if (!tab.url || tab.url === state.before.url) return;

  await new Promise((r) => setTimeout(r, 400));
  try {
    await captureConfirmation(tab, 'auto');
  } catch (err) {
    // Typically: cross-origin navigation → activeTab no longer applies.
    const fresh = await getState();
    if (fresh.status === 'recording') {
      fresh.autoCapture = { attempted: true, error: String(err && err.message ? err.message : err) };
      await setState(fresh);
    }
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const state = await getState();
  if (state.status === 'recording' && state.tabId === tabId) {
    // Keep the "before" evidence; user can still download a partial package.
    state.autoCapture = { attempted: true, error: 'Tab was closed before confirmation was captured' };
    await setState(state);
  }
});

function stripScreenshots(state) {
  const copy = JSON.parse(JSON.stringify(state));
  for (const key of ['before', 'after']) {
    if (copy[key]) {
      copy[key].hasScreenshot = Boolean(copy[key].screenshot);
      delete copy[key].screenshot;
    }
  }
  return copy;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg && msg.type) {
        case 'GET_STATE': {
          const state = await getState();
          return sendResponse({ ok: true, state: msg.full ? state : stripScreenshots(state) });
        }
        case 'START_RECORDING': {
          const state = await startRecording(msg.tab);
          return sendResponse({ ok: true, state: stripScreenshots(state) });
        }
        case 'CAPTURE_CONFIRMATION': {
          const state = await captureConfirmation(msg.tab, 'manual');
          return sendResponse({ ok: true, state: stripScreenshots(state) });
        }
        case 'DISCARD': {
          const state = await clearState();
          return sendResponse({ ok: true, state });
        }
        default:
          return sendResponse({ ok: false, error: 'Unknown message' });
      }
    } catch (err) {
      return sendResponse({ ok: false, error: String(err && err.message ? err.message : err) });
    }
  })();
  return true; // async response
});
