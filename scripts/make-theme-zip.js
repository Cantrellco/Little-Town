/* Build a Shopify-compatible theme.zip from ./theme.
   Uses forward-slash entry names at the zip root (Shopify rejects the
   backslash paths that PowerShell's Compress-Archive produces).
   Run: node scripts/make-theme-zip.js */
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.join(process.cwd(), "theme");
const OUT = path.join(process.cwd(), "theme.zip");

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function walk(dir, base = "") {
  let files = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    const rel = base ? base + "/" + e.name : e.name; // forward slashes
    if (e.isDirectory()) files = files.concat(walk(abs, rel));
    else files.push({ abs, rel });
  }
  return files;
}

const files = walk(ROOT);
const locals = [];
const centrals = [];
let offset = 0;

for (const f of files) {
  const data = fs.readFileSync(f.abs);
  const crc = crc32(data);
  const comp = zlib.deflateRawSync(data, { level: 9 });
  const name = Buffer.from(f.rel, "utf8");

  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0); // local file header sig
  lh.writeUInt16LE(20, 4); // version needed
  lh.writeUInt16LE(0, 6); // flags
  lh.writeUInt16LE(8, 8); // method: deflate
  lh.writeUInt16LE(0, 10); // mod time
  lh.writeUInt16LE(0x21, 12); // mod date (1980-01-01)
  lh.writeUInt32LE(crc, 14);
  lh.writeUInt32LE(comp.length, 18);
  lh.writeUInt32LE(data.length, 22);
  lh.writeUInt16LE(name.length, 26);
  lh.writeUInt16LE(0, 28); // extra len
  locals.push(lh, name, comp);

  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0); // central dir sig
  ch.writeUInt16LE(20, 4); // version made by
  ch.writeUInt16LE(20, 6); // version needed
  ch.writeUInt16LE(0, 8); // flags
  ch.writeUInt16LE(8, 10); // method
  ch.writeUInt16LE(0, 12); // time
  ch.writeUInt16LE(0x21, 14); // date
  ch.writeUInt32LE(crc, 16);
  ch.writeUInt32LE(comp.length, 20);
  ch.writeUInt32LE(data.length, 24);
  ch.writeUInt16LE(name.length, 28);
  ch.writeUInt16LE(0, 30); // extra
  ch.writeUInt16LE(0, 32); // comment
  ch.writeUInt16LE(0, 34); // disk
  ch.writeUInt16LE(0, 36); // internal attr
  ch.writeUInt32LE(0, 38); // external attr
  ch.writeUInt32LE(offset, 42); // local header offset
  centrals.push(ch, name);

  offset += lh.length + name.length + comp.length;
}

const localBuf = Buffer.concat(locals);
const centralBuf = Buffer.concat(centrals);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(0, 4);
eocd.writeUInt16LE(0, 6);
eocd.writeUInt16LE(files.length, 8);
eocd.writeUInt16LE(files.length, 10);
eocd.writeUInt32LE(centralBuf.length, 12);
eocd.writeUInt32LE(localBuf.length, 16);
eocd.writeUInt16LE(0, 20);

fs.writeFileSync(OUT, Buffer.concat([localBuf, centralBuf, eocd]));
const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log(`Wrote theme.zip — ${files.length} files, ${kb} KB`);
console.log("Sample entries:", files.slice(0, 3).map((f) => f.rel).join(", "), "...");
