'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../extension/lib/fields.js');

const input = (over) => ({ tag: 'input', type: 'text', name: '', id: '', autocomplete: '', label: '', placeholder: '', ...over });

test('password / hidden / file inputs are excluded regardless of name', () => {
  assert.equal(F.isSensitiveField(input({ type: 'password', name: 'q' })), true);
  assert.equal(F.isSensitiveField(input({ type: 'hidden', name: 'csrf_token' })), true);
  assert.equal(F.isSensitiveField(input({ type: 'file', name: 'attachment' })), true);
  assert.equal(F.isSensitiveField(input({ type: 'submit', name: 'go' })), true);
});

test('payment autocomplete tokens are excluded', () => {
  for (const ac of ['cc-number', 'cc-csc', 'cc-exp', 'cc-name', 'billing cc-number', 'current-password', 'one-time-code']) {
    assert.equal(F.isSensitiveField(input({ name: 'field', autocomplete: ac })), true, ac);
  }
});

test('sensitive names / ids / labels / placeholders are excluded', () => {
  const cases = [
    { name: 'card_number' },
    { name: 'cardNumber' },
    { id: 'cvv' },
    { label: 'CVC code' },
    { name: 'passport_number' },
    { label: 'Паспорт' },
    { name: 'pwd' },
    { label: 'Пароль' },
    { name: 'ssn' },
    { placeholder: 'Enter your PIN' },
    { name: 'otp_code' },
    { name: 'iban' },
    { label: 'Date of birth' },
    { name: 'tax_id' },
    { name: 'api_key' },
    { name: 'secret_answer' }
  ];
  for (const c of cases) {
    assert.equal(F.isSensitiveField(input(c)), true, JSON.stringify(c));
  }
});

test('data-sensitive opt-out is honoured', () => {
  assert.equal(F.isSensitiveField(input({ name: 'internal_note', dataSensitive: true })), true);
});

test('ordinary fields are recordable', () => {
  const cases = [
    { name: 'full_name', label: 'Full name' },
    { name: 'email', type: 'email' },
    { name: 'phone', type: 'tel' },
    { name: 'message', tag: 'textarea', type: '' },
    { name: 'category', tag: 'select', type: '' },
    { name: 'order_id', label: 'Order / contract ID' },
    { name: 'agree', type: 'checkbox' },
    { name: 'contact_pref', type: 'radio' },
    { name: 'company', placeholder: 'Company name' }
  ];
  for (const c of cases) {
    assert.equal(F.isSensitiveField(input(c)), false, JSON.stringify(c));
  }
});

test('toProofRecord never contains a value', () => {
  const rec = F.toProofRecord(input({ name: 'email', label: 'Email', value: 'a@b.c' }), true);
  assert.deepEqual(Object.keys(rec).sort(), ['filled', 'id', 'label', 'name', 'type']);
  assert.equal(JSON.stringify(rec).includes('a@b.c'), false);
});

test('classifyFields counts excluded fields without naming them', () => {
  const items = [
    { descriptor: input({ name: 'full_name' }), filled: true },
    { descriptor: input({ name: 'password', type: 'password' }), filled: true },
    { descriptor: input({ name: 'card_number', autocomplete: 'cc-number' }), filled: true },
    { descriptor: input({ name: 'message', tag: 'textarea' }), filled: false }
  ];
  const { recorded, excludedCount } = F.classifyFields(items);
  assert.equal(excludedCount, 2);
  assert.deepEqual(
    recorded.map((r) => r.name),
    ['full_name', 'message']
  );
  const serialized = JSON.stringify(recorded);
  assert.equal(/password|card_number/.test(serialized), false);
});
