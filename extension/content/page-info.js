/**
 * RequestProof — minimal confirmation-page info.
 * Injected on the confirmation page. Reads only URL, title and a short
 * visible-text excerpt (first ~600 chars of body text) so the summary can
 * show the confirmation message. No storage, cookies or history access.
 */
(() => {
  'use strict';
  const text = (document.body ? document.body.innerText : '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600);
  return {
    url: location.href,
    title: document.title || '',
    excerpt: text,
    collectedAt: new Date().toISOString()
  };
})();
