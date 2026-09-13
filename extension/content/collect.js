/**
 * RequestProof — page metadata collector.
 *
 * Injected on demand (chrome.scripting.executeScript, activeTab) AFTER
 * lib/fields.js. Runs in the extension's isolated world; reads only:
 *   - location.href, document.title
 *   - form action/method
 *   - field descriptors (tag/type/name/id/label/placeholder/autocomplete)
 *   - whether each field currently has a value (boolean)
 *
 * It never reads field values into the result, never touches cookies,
 * localStorage, sessionStorage, IndexedDB or history. The completion value of
 * this script is what chrome.scripting returns to the service worker.
 */
(() => {
  'use strict';

  const F = globalThis.RequestProofFields;

  function textOf(el) {
    return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }

  function labelFor(el) {
    if (el.id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lbl) return textOf(lbl);
    }
    const wrapping = el.closest('label');
    if (wrapping) {
      const clone = wrapping.cloneNode(true);
      clone.querySelectorAll('input,select,textarea').forEach((n) => n.remove());
      const t = textOf(clone);
      if (t) return t;
    }
    const aria = el.getAttribute('aria-label');
    if (aria) return aria.trim();
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const t = labelledBy
        .split(/\s+/)
        .map((id) => textOf(document.getElementById(id)))
        .filter(Boolean)
        .join(' ');
      if (t) return t;
    }
    return '';
  }

  function isVisible(el) {
    if (el.type === 'hidden') return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function isFilled(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'select') return el.value !== '' && el.selectedIndex >= 0;
    if (tag === 'input') {
      const type = (el.type || 'text').toLowerCase();
      if (type === 'checkbox' || type === 'radio') return el.checked;
      return String(el.value || '').trim().length > 0;
    }
    return String(el.value || '').trim().length > 0;
  }

  function describe(el) {
    return {
      tag: el.tagName.toLowerCase(),
      type: (el.getAttribute('type') || '').toLowerCase(),
      name: el.getAttribute('name') || '',
      id: el.id || '',
      autocomplete: el.getAttribute('autocomplete') || '',
      label: labelFor(el),
      placeholder: el.getAttribute('placeholder') || '',
      dataSensitive:
        el.hasAttribute('data-sensitive') ||
        el.getAttribute('data-requestproof') === 'sensitive'
    };
  }

  const controls = Array.from(document.querySelectorAll('input, textarea, select'));
  const seenRadioGroups = new Set();
  const items = [];

  for (const el of controls) {
    // Hidden / invisible controls are technical (CSRF tokens etc.) — skipped
    // entirely, not even counted.
    if (!isVisible(el)) continue;
    const d = describe(el);
    // Collapse radio groups to a single record (the group name).
    if (d.tag === 'input' && d.type === 'radio' && d.name) {
      if (seenRadioGroups.has(d.name)) continue;
      seenRadioGroups.add(d.name);
      const group = document.querySelectorAll(`input[type="radio"][name="${CSS.escape(d.name)}"]`);
      const checked = Array.from(group).some((r) => r.checked);
      items.push({ descriptor: { ...d, label: d.name }, filled: checked }); // group name, not the first option's label
      continue;
    }
    items.push({ descriptor: d, filled: isFilled(el) });
  }

  const { recorded, excludedCount } = F.classifyFields(items);
  const filledRecorded = recorded.filter((r) => r.filled);

  const forms = Array.from(document.forms).map((form) => ({
    id: form.id || null,
    name: form.getAttribute('name') || null,
    action: form.action || null,
    method: (form.method || 'get').toUpperCase(),
    fieldCount: form.elements.length
  }));

  // Return value of the IIFE = completion value of the script → returned to the service worker.
  return {
    url: location.href,
    title: document.title || '',
    origin: location.origin,
    forms,
    fields: recorded,
    filledFieldCount: filledRecorded.length,
    excludedFieldCount: excludedCount,
    collectedAt: new Date().toISOString()
  };
})();
