/* TEMP — rasterize a single brand SVG into a square product image.
   Mirrors scripts/_gen-product-images.js exactly so it matches the rest of
   the product-image family.
   Run: node scripts/_gen-buyout-image.js [price-buyout.svg private-buyout.png]
   Safe to delete. */
"use strict";
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const SRC = path.join(process.cwd(), "assets", "img");
const OUT = path.join(process.cwd(), "product-images");
fs.mkdirSync(OUT, { recursive: true });

const SIZE = 1200;          // square canvas
const INNER = Math.round(SIZE * 0.8);
const BG = "#FBF4EC";       // soft brand cream

const JOB = {
  svg: process.argv[2] || "price-buyout.svg",
  out: process.argv[3] || "private-buyout.png",
};

(async () => {
  const art = await sharp(path.join(SRC, JOB.svg), { density: 384 })
    .resize({ width: INNER, height: INNER, fit: "inside" })
    .png()
    .toBuffer();
  await sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: BG } })
    .composite([{ input: art, gravity: "center" }])
    .png()
    .toFile(path.join(OUT, JOB.out));
  const { size } = fs.statSync(path.join(OUT, JOB.out));
  console.log(`  ${JOB.out.padEnd(22)} <- ${JOB.svg.padEnd(22)} (${(size / 1024).toFixed(0)} KB)`);
  console.log(`Done -> ${path.join(OUT, JOB.out)}`);
})();
