/* ============================================================
   Little Town Playhouse — image optimizer
   Run with: node scripts/optimize-images.js   (or: npm run optimize:img)

   What it does (idempotent — safe to re-run, no quality drift):
   - Recompresses every .jpg / .png in assets/img IN PLACE, but only the FIRST
     time it sees a given file (tracked by post-optimization size in
     scripts/.img-cache.json). A file is only re-touched if its bytes change
     (i.e. you dropped in a new original), so re-runs never re-encode an
     already-optimized image.
       · photos (photo-*.jpg) are capped at PHOTO_MAX px wide, mozjpeg q80
       · everything else (logos, illustrations) keeps its size; PNGs are
         palette-quantized at high quality
   - For the photos that are actually rendered (RESPONSIVE), emits a .webp +
     .avif ladder at LADDER widths, generated from the ORIGINAL bytes. Stale
     rungs from an old ladder are removed.
   - Emits logo.webp (full size, alpha kept) for the hero <picture>.

   Requires: sharp (devDependency). Run `npm install` first.
   ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const ROOT = process.cwd();
const IMG = path.join(ROOT, "assets", "img");
const CACHE = path.join(ROOT, "scripts", ".img-cache.json");

const PHOTO_MAX = 1600; // cap longest dimension for photographic JPGs
const LADDER = [600, 900, 1200]; // responsive widths (source photos are 1200px wide)

// Photos that are actually rendered on a page -> get the responsive ladder.
const RESPONSIVE = new Set([
  "photo-play-bridge.jpg",
  "photo-play-slide.jpg",
  "photo-play-blocks.jpg",
  "photo-play-climb.jpg",
  "photo-bigsmiles.jpg",
  "photo-cafe-table.jpg",
]);

const KB = (b) => (b / 1024).toFixed(1) + " KB";
const pad = (s, n) => String(s).padEnd(n);

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE, "utf8"));
  } catch {
    return {};
  }
}

// Remove ladder rungs whose width isn't a current target (e.g. after a width change).
function cleanStaleRungs(base, targets) {
  const re = new RegExp("^" + base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "-(\\d+)\\.(webp|avif)$");
  for (const f of fs.readdirSync(IMG)) {
    const m = f.match(re);
    if (m && !targets.includes(Number(m[1]))) fs.unlinkSync(path.join(IMG, f));
  }
}

async function buildLadder(input, base, targets, force) {
  let bytes = 0;
  for (const w of targets) {
    const wv = path.join(IMG, `${base}-${w}.webp`);
    const av = path.join(IMG, `${base}-${w}.avif`);
    if (force || !fs.existsSync(wv)) {
      const webp = await sharp(input).resize({ width: w }).webp({ quality: 78 }).toBuffer();
      fs.writeFileSync(wv, webp);
    }
    if (force || !fs.existsSync(av)) {
      const avif = await sharp(input).resize({ width: w }).avif({ quality: 55 }).toBuffer();
      fs.writeFileSync(av, avif);
    }
    bytes += fs.statSync(wv).size + fs.statSync(av).size;
  }
  return bytes;
}

async function main() {
  sharp.cache(false);
  const cache = loadCache();
  const files = fs
    .readdirSync(IMG)
    .filter((f) => /\.(jpe?g|png)$/i.test(f))
    .sort();

  let before = 0;
  let after = 0;
  let derived = 0;
  const rows = [];
  const widths = [];

  for (const file of files) {
    const src = path.join(IMG, file);
    const size0 = fs.statSync(src).size;
    before += size0;
    after += size0; // adjusted below if we shrink it

    const isJpg = /\.jpe?g$/i.test(file);
    const responsive = RESPONSIVE.has(file);
    const alreadyOptimized = cache[file] === size0;

    let status = "cached";
    let input = null;

    if (!alreadyOptimized) {
      // First time we've seen these bytes -> optimize in place.
      input = fs.readFileSync(src);
      const meta = await sharp(input).metadata();
      let pipe = sharp(input);
      if (isJpg && meta.width > PHOTO_MAX) pipe = pipe.resize({ width: PHOTO_MAX, withoutEnlargement: true });
      const out = isJpg
        ? await pipe.jpeg({ quality: 80, mozjpeg: true }).toBuffer()
        : await pipe.png({ palette: true, quality: 90, effort: 10, compressionLevel: 9 }).toBuffer();
      if (out.length < size0) {
        fs.writeFileSync(src, out);
        after += out.length - size0;
        cache[file] = out.length;
        status = "recompressed";
      } else {
        cache[file] = size0;
        status = "kept";
      }
    }

    if (responsive) {
      if (!input) input = fs.readFileSync(src);
      const meta = await sharp(input).metadata();
      const targets = [...new Set(LADDER.map((w) => Math.min(w, meta.width)))]; // clamp to source, dedupe
      widths.push([file, meta.width + "×" + meta.height + "  rungs: " + targets.join("/")]);
      const base = file.replace(/\.jpe?g$/i, "");
      cleanStaleRungs(base, targets);
      derived += await buildLadder(input, base, targets, !alreadyOptimized);
    }

    rows.push([file, KB(size0), KB(cache[file]), status]);
  }

  // ---- logo.webp for the hero <picture> (full size, keep alpha) ---------
  const logoSrc = path.join(IMG, "logo.png");
  const logoWebp = path.join(IMG, "logo.webp");
  if (fs.existsSync(logoSrc) && (!fs.existsSync(logoWebp) || cache["__logo_webp_for"] !== cache["logo.png"])) {
    const lw = await sharp(fs.readFileSync(logoSrc)).webp({ quality: 90 }).toBuffer();
    fs.writeFileSync(logoWebp, lw);
    cache["__logo_webp_for"] = cache["logo.png"];
    console.log("  logo.webp written: " + KB(lw.length));
  }
  if (fs.existsSync(logoWebp)) derived += fs.statSync(logoWebp).size;

  fs.writeFileSync(CACHE, JSON.stringify(cache, null, 2) + "\n");

  // ---- report -----------------------------------------------------------
  console.log("\n  " + pad("file", 28) + pad("before", 12) + pad("after", 12) + "status");
  console.log("  " + "-".repeat(60));
  for (const [f, b, a, s] of rows) console.log("  " + pad(f, 28) + pad(b, 12) + pad(a, 12) + s);
  if (widths.length) {
    console.log("\n  responsive photo dimensions (confirm ladder fits):");
    for (const [f, d] of widths) console.log("    " + pad(f, 28) + d);
  }
  console.log("\n  in-place total : " + KB(before) + "  ->  " + KB(after) + "  (saved " + KB(before - after) + ")");
  console.log("  ladder + logo derivatives on disk: " + KB(derived));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
