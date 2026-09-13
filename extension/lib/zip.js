/**
 * RequestProof — dependency-free ZIP writer (STORE method, no compression).
 *
 * Produces a standard PKZIP archive readable by any unzip tool. Screenshots
 * are already PNG-compressed and JSON/HTML are tiny, so STORE is fine and
 * keeps the code auditable. Uses a UTF-8 filename flag (bit 11).
 *
 * UMD-ish: usable via ES import (see zip.esm.js shim), classic script and Node.
 */
(function (root) {
  'use strict';

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date) {
    const d = date instanceof Date ? date : new Date(date || Date.now());
    const year = Math.max(1980, d.getFullYear());
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
    const dt = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { time: time & 0xffff, date: dt & 0xffff };
  }

  function toBytes(data) {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (typeof data === 'string') return new TextEncoder().encode(data);
    throw new TypeError('zip entry data must be string, ArrayBuffer or Uint8Array');
  }

  /**
   * @param {{name:string, data:string|Uint8Array|ArrayBuffer, date?:Date}[]} entries
   * @returns {Uint8Array} the .zip bytes
   */
  function buildZip(entries, opts) {
    const now = (opts && opts.date) || new Date();
    const enc = new TextEncoder();
    const locals = [];
    const centrals = [];
    let offset = 0;

    for (const e of entries) {
      const nameBytes = enc.encode(e.name);
      const data = toBytes(e.data);
      const crc = crc32(data);
      const { time, date } = dosDateTime(e.date || now);

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true); // local file header signature
      local.setUint16(4, 20, true); // version needed (2.0)
      local.setUint16(6, 0x0800, true); // flags: UTF-8 names
      local.setUint16(8, 0, true); // method: STORE
      local.setUint16(10, time, true);
      local.setUint16(12, date, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, nameBytes.length, true);
      local.setUint16(28, 0, true); // extra length
      locals.push(new Uint8Array(local.buffer), nameBytes, data);

      const central = new DataView(new ArrayBuffer(46));
      central.setUint32(0, 0x02014b50, true);
      central.setUint16(4, 20, true); // version made by
      central.setUint16(6, 20, true); // version needed
      central.setUint16(8, 0x0800, true);
      central.setUint16(10, 0, true);
      central.setUint16(12, time, true);
      central.setUint16(14, date, true);
      central.setUint32(16, crc, true);
      central.setUint32(20, data.length, true);
      central.setUint32(24, data.length, true);
      central.setUint16(28, nameBytes.length, true);
      central.setUint16(30, 0, true); // extra
      central.setUint16(32, 0, true); // comment
      central.setUint16(34, 0, true); // disk
      central.setUint16(36, 0, true); // internal attrs
      central.setUint32(38, 0, true); // external attrs
      central.setUint32(42, offset, true); // local header offset
      centrals.push(new Uint8Array(central.buffer), nameBytes);

      offset += 30 + nameBytes.length + data.length;
    }

    const centralSize = centrals.reduce((n, b) => n + b.length, 0);
    const eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true);
    eocd.setUint16(4, 0, true);
    eocd.setUint16(6, 0, true);
    eocd.setUint16(8, entries.length, true);
    eocd.setUint16(10, entries.length, true);
    eocd.setUint32(12, centralSize, true);
    eocd.setUint32(16, offset, true);
    eocd.setUint16(20, 0, true);

    const parts = [...locals, ...centrals, new Uint8Array(eocd.buffer)];
    const total = parts.reduce((n, b) => n + b.length, 0);
    const out = new Uint8Array(total);
    let p = 0;
    for (const b of parts) {
      out.set(b, p);
      p += b.length;
    }
    return out;
  }

  const api = { buildZip, crc32 };
  root.RequestProofZip = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
