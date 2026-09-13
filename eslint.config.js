'use strict';

const globals = require('globals');

module.exports = [
  {
    ignores: ['node_modules/**', 'dist/**', 'tests/e2e/.artifacts/**']
  },
  {
    files: ['extension/**/*.js', 'demo/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        module: 'readonly',
        RequestProofFields: 'readonly',
        RequestProofZip: 'readonly',
        RequestProofSummary: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-sequences': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      // Privacy guardrails: extension code must not touch these APIs at all.
      'no-restricted-properties': [
        'error',
        { object: 'document', property: 'cookie', message: 'RequestProof never reads cookies.' },
        { object: 'chrome', property: 'cookies', message: 'RequestProof never reads cookies.' },
        { object: 'chrome', property: 'history', message: 'RequestProof never reads browser history.' },
        { object: 'window', property: 'localStorage', message: 'RequestProof never reads page storage.' },
        { object: 'window', property: 'sessionStorage', message: 'RequestProof never reads page storage.' },
        { object: 'window', property: 'indexedDB', message: 'RequestProof never reads page storage.' }
      ],
      'no-restricted-globals': [
        'error',
        { name: 'localStorage', message: 'RequestProof never reads page storage.' },
        { name: 'sessionStorage', message: 'RequestProof never reads page storage.' },
        { name: 'indexedDB', message: 'RequestProof never reads page storage.' },
        { name: 'fetch', message: 'RequestProof never talks to a network.' },
        { name: 'XMLHttpRequest', message: 'RequestProof never talks to a network.' },
        { name: 'WebSocket', message: 'RequestProof never talks to a network.' },
        { name: 'navigator', message: 'Use of navigator (sendBeacon etc.) is not allowed in RequestProof.' }
      ]
    }
  },
  {
    files: ['tests/**/*.js', 'scripts/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node }
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-undef': 'error'
    }
  }
];
