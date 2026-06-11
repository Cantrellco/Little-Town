/* TEMP — rasterize brand SVGs into square product images. Safe to delete. */
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

const JOBS = [
  { svg: "price-daypass.svg",    out: "day-pass.png" },
  { svg: "price-playpack.svg",   out: "play-pack.png" },
  { svg: "price-membership.svg", out: "monthly-membership.png" },
  { svg: "price-membership.svg", out: "annual-membership.png" },
];

(async () => {
  for (const j of JOBS) {
    const art = await sharp(path.join(SRC, j.svg), { density: 384 })
      .resize({ width: INNER, height: INNER, fit: "inside" })
      .png()
      .toBuffer();
    await sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: BG } })
      .composite([{ input: art, gravity: "center" }])
      .png()
      .toFile(path.join(OUT, j.out));
    const { size } = fs.statSync(path.join(OUT, j.out));
    console.log(`  ${j.out.padEnd(22)} <- ${j.svg.padEnd(22)} (${(size / 1024).toFixed(0)} KB)`);
  }
  console.log(`Done -> ${OUT}`);
})();
