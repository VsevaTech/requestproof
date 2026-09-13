'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Z = require('../extension/lib/zip.js');

test('crc32 matches zlib', () => {
  const data = Buffer.from('The quick brown fox jumps over the lazy dog');
  assert.equal(Z.crc32(new Uint8Array(data)), zlib.crc32(data));
  assert.equal(Z.crc32(new Uint8Array(0)), 0);
});

test('buildZip produces a parseable STORE archive', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
  const bytes = Z.buildZip([
    { name: 'submission.json', data: '{"a":1}' },
    { name: 'before.png', data: png },
    { name: 'summary.html', data: '<p>hi</p>' }
  ]);
  const buf = Buffer.from(bytes);

  // local header signature
  assert.equal(buf.readUInt32LE(0), 0x04034b50);
  // EOCD at end
  const eocd = buf.length - 22;
  assert.equal(buf.readUInt32LE(eocd), 0x06054b50);
  assert.equal(buf.readUInt16LE(eocd + 8), 3, 'entry count');
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  assert.equal(cdOffset + cdSize, eocd, 'central directory placement');

  // walk central directory
  let p = cdOffset;
  const names = [];
  for (let i = 0; i < 3; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    assert.equal(buf.readUInt16LE(p + 10), 0, 'method STORE');
    const nameLen = buf.readUInt16LE(p + 28);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    names.push(name);
    // verify local header of this entry
    assert.equal(buf.readUInt32LE(localOff), 0x04034b50);
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const size = buf.readUInt32LE(localOff + 18);
    const crc = buf.readUInt32LE(localOff + 14);
    const dataStart = localOff + 30 + lNameLen;
    const data = buf.subarray(dataStart, dataStart + size);
    assert.equal(zlib.crc32(data), crc, `crc of ${name}`);
    p += 46 + nameLen;
  }
  assert.deepEqual(names, ['submission.json', 'before.png', 'summary.html']);
});

test('archive is accepted by system unzip when available', (t) => {
  let hasUnzip = true;
  try {
    execFileSync('unzip', ['-v'], { stdio: 'ignore' });
  } catch {
    hasUnzip = false;
  }
  if (!hasUnzip) return t.skip('unzip not installed');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-zip-'));
  const file = path.join(dir, 'p.zip');
  fs.writeFileSync(file, Buffer.from(Z.buildZip([{ name: 'a.txt', data: 'hello' }, { name: 'ünï.txt', data: 'ü' }])));
  const out = execFileSync('unzip', ['-t', file]).toString();
  assert.match(out, /No errors detected/);
});
