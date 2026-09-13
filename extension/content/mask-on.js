/**
 * RequestProof — temporarily blur sensitive fields before the screenshot.
 * Injected AFTER lib/fields.js; undone by mask-off.js right after capture.
 * Uses the same classification as collect.js, so what is excluded from the
 * metadata is also unreadable on before.png.
 */
(() => {
  'use strict';
  const F = globalThis.RequestProofFields;
  let masked = 0;
  for (const el of document.querySelectorAll('input, textarea, select')) {
    const d = {
      tag: el.tagName.toLowerCase(),
      type: (el.getAttribute('type') || '').toLowerCase(),
      name: el.getAttribute('name') || '',
      id: el.id || '',
      autocomplete: el.getAttribute('autocomplete') || '',
      label: el.getAttribute('aria-label') || (el.labels && el.labels[0] ? el.labels[0].textContent : ''),
      placeholder: el.getAttribute('placeholder') || '',
      dataSensitive: el.hasAttribute('data-sensitive') || el.getAttribute('data-requestproof') === 'sensitive'
    };
    if (d.type === 'hidden' || !F.isSensitiveField(d)) continue;
    el.dataset.requestproofPrevFilter = el.style.filter || '';
    el.style.filter = 'blur(7px)';
    el.setAttribute('data-requestproof-masked', '1');
    masked += 1;
  }
  return { masked };
})();
