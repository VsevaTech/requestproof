/**
 * RequestProof — field classification (pure, DOM-free).
 *
 * Decides which form fields may be *named* in a proof package and which must
 * never appear in it. Only field names/labels are ever recorded — values are
 * never stored for any field. This module only exists to make the exclusion
 * list explicit and unit-testable.
 *
 * Loaded both as a classic script in the page's isolated world (via
 * chrome.scripting) and via require() in Node tests, hence the UMD-ish shape.
 */
(function (root) {
  'use strict';

  /** Input types that are never recorded, not even by name. */
  const EXCLUDED_TYPES = new Set([
    'password',
    'hidden',
    'file',
    'submit',
    'button',
    'reset',
    'image'
  ]);

  /**
   * autocomplete tokens (WHATWG) that denote payment / credential data.
   * Any field carrying one of these is excluded entirely.
   */
  const EXCLUDED_AUTOCOMPLETE = [
    'cc-name',
    'cc-given-name',
    'cc-additional-name',
    'cc-family-name',
    'cc-number',
    'cc-exp',
    'cc-exp-month',
    'cc-exp-year',
    'cc-csc',
    'cc-type',
    'current-password',
    'new-password',
    'one-time-code'
  ];

  /**
   * Name / id / label / placeholder patterns that indicate sensitive content.
   * Deliberately broad: a false positive only costs one field name in the
   * proof; a false negative would leak a sensitive field name.
   */
  const SENSITIVE_PATTERNS = [
    /\bpass(word|wd|code|phrase)?\b/i,
    /пароль/i,
    /\bpwd\b/i,
    /\bpin\b/i,
    /\botp\b/i,
    /one[-_ ]?time/i,
    /secret/i,
    /token/i,
    /api[-_ ]?key/i,
    /\bcvv\b|\bcvc\b|\bcsc\b|\bcvn\b/i,
    /card[-_ ]?(number|num|no|holder|expir|exp)/i,
    /\bpan\b/i,
    /credit[-_ ]?card|debit[-_ ]?card/i,
    /карт/i,
    /\biban\b|\bswift\b|\bbic\b/i,
    /account[-_ ]?(number|no)/i,
    /routing/i,
    /\bssn\b|social[-_ ]?security/i,
    /passport|паспорт/i,
    /national[-_ ]?id|\bnin\b/i,
    /tax[-_ ]?id|\btin\b|\bинн\b|снилс/i,
    /license[-_ ]?(number|no)|licence[-_ ]?(number|no)/i,
    /security[-_ ]?(answer|question)/i,
    /\bdob\b|date[-_ ]?of[-_ ]?birth|birth[-_ ]?date/i,
    /2fa|mfa|verification[-_ ]?code|auth[-_ ]?code/i
  ];

  /**
   * @typedef {Object} FieldDescriptor
   * @property {string} [tag]          'input' | 'textarea' | 'select'
   * @property {string} [type]         input type attribute (lowercased)
   * @property {string} [name]
   * @property {string} [id]
   * @property {string} [autocomplete]
   * @property {string} [label]        visible label text
   * @property {string} [placeholder]
   * @property {boolean} [dataSensitive] element has data-requestproof="sensitive" / data-sensitive
   */

  function normalize(s) {
    return (s == null ? '' : String(s)).trim().toLowerCase();
  }

  /** "cardNumber", "card_number", "card-number" → "card number" for matching. */
  function tokenize(s) {
    return (s == null ? '' : String(s))
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_\-.\/\\[\]]+/g, ' ')
      .trim()
      .toLowerCase();
  }

  /**
   * @param {FieldDescriptor} f
   * @returns {boolean} true when the field must not appear in the proof at all
   */
  function isSensitiveField(f) {
    if (!f) return true;
    if (f.dataSensitive) return true;

    const tag = normalize(f.tag) || 'input';
    const type = normalize(f.type) || (tag === 'input' ? 'text' : tag);
    if (tag === 'input' && EXCLUDED_TYPES.has(type)) return true;

    const ac = normalize(f.autocomplete);
    if (ac) {
      const tokens = ac.split(/\s+/);
      if (tokens.some((t) => EXCLUDED_AUTOCOMPLETE.includes(t))) return true;
    }

    const haystack = [f.name, f.id, f.label, f.placeholder]
      .map(tokenize)
      .filter(Boolean)
      .join(' | ');
    if (!haystack) return false;
    return SENSITIVE_PATTERNS.some((re) => re.test(haystack));
  }

  /**
   * Produces the record stored in submission.json for one field.
   * Never includes the value.
   * @param {FieldDescriptor} f
   * @param {boolean} filled
   */
  function toProofRecord(f, filled) {
    const rec = {
      label: (f.label || '').trim() || null,
      name: (f.name || '').trim() || null,
      id: (f.id || '').trim() || null,
      type: normalize(f.type) || normalize(f.tag) || 'text',
      filled: Boolean(filled)
    };
    if (!rec.label && !rec.name && !rec.id) {
      rec.label = '(unnamed field)';
    }
    return rec;
  }

  /**
   * Splits a list of {descriptor, filled} into recordable records and a count
   * of excluded fields. Names of excluded fields are never returned.
   */
  function classifyFields(items) {
    const recorded = [];
    let excluded = 0;
    for (const item of items || []) {
      if (isSensitiveField(item.descriptor)) {
        excluded += 1;
        continue;
      }
      recorded.push(toProofRecord(item.descriptor, item.filled));
    }
    return { recorded, excludedCount: excluded };
  }

  const api = {
    isSensitiveField,
    toProofRecord,
    classifyFields,
    EXCLUDED_TYPES,
    EXCLUDED_AUTOCOMPLETE,
    SENSITIVE_PATTERNS
  };

  root.RequestProofFields = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
