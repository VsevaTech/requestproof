/** RequestProof — undo mask-on.js. */
(() => {
  'use strict';
  let restored = 0;
  for (const el of document.querySelectorAll('[data-requestproof-masked]')) {
    el.style.filter = el.dataset.requestproofPrevFilter || '';
    delete el.dataset.requestproofPrevFilter;
    el.removeAttribute('data-requestproof-masked');
    restored += 1;
  }
  return { restored };
})();
