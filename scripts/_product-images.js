/* TEMP — attach product images via Shopify Admin API. Safe to delete.
   Run: node scripts/_product-images.js
   Reads .env.shopify (SHOPIFY_STORE + SHOPIFY_ADMIN_TOKEN), finds each product by
   handle, and uploads its image from product-images/ only if it has none yet. */
"use strict";
const fs = require("fs");
const path = require("path");

// --- load .env.shopify (simple KEY=VALUE) ---
const env = {};
for (const line of fs.readFileSync(path.join(process.cwd(), ".env.shopify"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const STORE = env.SHOPIFY_STORE;
const TOKEN = env.SHOPIFY_ADMIN_TOKEN;
const API = "2024-07";
const base = `https://${STORE}/admin/api/${API}`;
const IMG = path.join(process.cwd(), "product-images");

const PRODUCTS = [
  { handle: "day-pass",           file: "day-pass.png",           alt: "Little Town Day Pass ticket" },
  { handle: "play-pack",          file: "play-pack.png",          alt: "Little Town Play Pack — five day passes" },
  { handle: "monthly-membership", file: "monthly-membership.png", alt: "Little Town family membership card" },
  { handle: "annual-membership",  file: "annual-membership.png",  alt: "Little Town family membership card" },
];

async function api(pathname, opts = {}) {
  const res = await fetch(base + pathname, {
    ...opts,
    headers: { "X-Shopify-Access-Token": TOKEN, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

(async () => {
  console.log(`store=${STORE} api=${API} token=${TOKEN ? TOKEN.slice(0, 6) + "…" : "MISSING"}`);
  for (const p of PRODUCTS) {
    const found = await api(`/products.json?handle=${p.handle}&fields=id,title,handle,images`);
    if (found.status !== 200) { console.log(`  ${p.handle}: lookup HTTP ${found.status} ${JSON.stringify(found.json).slice(0, 160)}`); continue; }
    const prod = (found.json.products || [])[0];
    if (!prod) { console.log(`  ${p.handle}: NOT FOUND on store`); continue; }
    if ((prod.images || []).length > 0) { console.log(`  ${p.handle}: already has ${prod.images.length} image(s) — skipping`); continue; }
    const attachment = fs.readFileSync(path.join(IMG, p.file)).toString("base64");
    const up = await api(`/products/${prod.id}/images.json`, {
      method: "POST",
      body: JSON.stringify({ image: { attachment, alt: p.alt, filename: p.file } }),
    });
    console.log(`  ${p.handle}: ${up.status === 200 || up.status === 201 ? "UPLOADED ✓" : "FAILED " + up.status + " " + JSON.stringify(up.json).slice(0, 160)}`);
  }
})();
