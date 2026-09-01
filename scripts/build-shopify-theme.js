/* ============================================================
   Little Town Playhouse — static site -> Shopify theme builder
   Run with: node scripts/build-shopify-theme.js
   Produces a pixel-faithful custom theme in ./theme

   What it does:
   - copies every image into theme/assets (Shopify uses one flat folder)
   - copies CSS, flattening ../img/ + ../../img/ url() refs to bare filenames
   - copies main.js, broadening the SVG-inline selector for Shopify CDN urls
   - lifts each page's <main> into a Liquid template, rewriting asset urls
     ('assets/img/x.svg' -> {{ 'x.svg' | asset_url }}) and internal .html
     links to Shopify routes (memberships.html -> /pages/memberships)
   - authors the shared head/header/footer once, in layout + sections
   - adds product / cart / system templates so the theme is valid + pushable
   ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");

const root = process.cwd();
const T = path.join(root, "theme");

// ---- fs helpers --------------------------------------------------------
const mkdir = (d) => fs.mkdirSync(path.join(T, d), { recursive: true });
const write = (p, c) => fs.writeFileSync(path.join(T, p), c);
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

// fresh theme dir
fs.rmSync(T, { recursive: true, force: true });
["layout", "templates", "templates/customers", "sections", "snippets", "assets", "config", "locales"].forEach(mkdir);

// ---- 1. images ---------------------------------------------------------
const imgDir = path.join(root, "assets", "img");
let imgCount = 0;
for (const f of fs.readdirSync(imgDir)) {
  fs.copyFileSync(path.join(imgDir, f), path.join(T, "assets", f));
  imgCount++;
}

// ---- 2. css (flatten image url() paths, then minify for the storefront) --
const flattenCss = (css) =>
  css.replace(/\.\.\/\.\.\/img\//g, "").replace(/\.\.\/img\//g, "");

// Source CSS in assets/css stays human-readable (documented design tokens);
// only the shipped theme copy is minified. Degrades gracefully if csso isn't
// installed — run `npm install` to enable minification.
let minifyCss = (css) => css;
try {
  const csso = require("csso");
  minifyCss = (css) => csso.minify(css).css;
} catch {
  console.warn("  (csso not installed — shipping unminified CSS; run `npm install`)");
}
const buildCss = (css) => minifyCss(flattenCss(css));

write("assets/styles.css", buildCss(read("assets/css/styles.css")));
const pagesCssDir = path.join(root, "assets", "css", "pages");
for (const f of fs.readdirSync(pagesCssDir)) {
  write("assets/" + f, buildCss(fs.readFileSync(path.join(pagesCssDir, f), "utf8")));
}

// ---- 3. js (selector matched assets/img/ paths; on Shopify the src is a
//        CDN url, so match any .svg instead — the ANIMATED list still narrows)
let js = read("assets/js/main.js").replace('img[src*="assets/img/"]', 'img[src*=".svg"]');
write("assets/main.js", js);

// ---- shared body transforms -------------------------------------------
const LINKS = {
  "index.html": "/",
  "play-pricing.html": "/pages/play-pricing",
  "parties.html": "/pages/parties",
  "memberships.html": "/pages/memberships",
  "fusion.html": "/pages/fusion",
  "photo-gallery.html": "/pages/photo-gallery",
  "visit-us.html": "/pages/visit-us",
  "terms.html": "/pages/terms",
};

function rewriteAssets(html) {
  // src/href="assets/img/foo.svg" -> {{ 'foo.svg' | asset_url }}
  return html.replace(/assets\/img\/([A-Za-z0-9._-]+)/g, (_m, file) => `{{ '${file}' | asset_url }}`);
}
function rewriteLinks(html) {
  return html.replace(/(href=")([a-z][a-z-]*\.html)(#[\w-]+)?(")/g, (_m, a, file, hash, z) => {
    const base = LINKS[file] || "/" + file;
    return a + base + (hash || "") + z;
  });
}
const transformBody = (html) => rewriteLinks(rewriteAssets(html));

// Build a one-tap "buy" link for a single membership tier.
//
// The checkout URL goes in **data-buy-href**, NOT href. href points at the
// product page. That split matters: every purchase has to pass the agreement gate,
// and a live checkout URL sitting in href would walk straight past it via
// ctrl/cmd-click, middle-click, or right-click → "Open in new tab" — none of which
// JavaScript can gate. With the permalink in a data attribute, those all land on the
// product page instead, where the add-to-cart form is itself gated.
//
// It also degrades safely: if main.js never runs, the button is still a working link
// to the product page rather than a dead one — a JS hiccup must never cost a sale.
//
// Resolves the tier's variant by title first (e.g. "2 Children"), then by position;
// if neither resolves, data-buy-href is empty and the plain product-page href is used.
//
// The URL is the /cart/add?items[][…] form, NOT the short /cart/{variant}:{qty}
// permalink. The short form silently DROPS ?selling_plan= — verified against live
// checkout, which returned "sellingPlan": null and billed the membership as a
// one-time charge instead of a subscription. Only items[][selling_plan] attaches
// the plan.
//
// return_to=/cart (2026-09-01): buys land on the CART PAGE now, not straight on
// checkout. The owner chose this after the straight-to-checkout flow made
// "add socks to my day pass" impossible to recover once you'd left — Shopify's
// checkout has no remove/add controls, so the cart page is the only place a
// customer can review, combine, or drop items. The agreement gate rides on the
// cart's Checkout button (see cart.liquid + main.js), so nothing skips it.
function memberCta(prod, plan, label, idx, handle, text) {
  return (
    `{%- assign _v = blank -%}` +
    `{%- if ${prod} != blank -%}` +
    `{%- for v in ${prod}.variants -%}{%- if v.title contains '${label}' -%}{%- assign _v = v -%}{%- break -%}{%- endif -%}{%- endfor -%}` +
    `{%- if _v == blank -%}{%- assign _v = ${prod}.variants[${idx}] -%}{%- endif -%}` +
    `{%- endif -%}` +
    `<a class="$1" data-membership-buy href="/products/${handle}" data-buy-href="{%- if _v != blank -%}/cart/add?items[][id]={{ _v.id }}&amp;items[][quantity]=1{%- if ${plan} != blank %}&amp;items[][selling_plan]={{ ${plan} }}{%- endif -%}&amp;return_to=/cart{%- endif -%}">${text}</a>`
  );
}

// The Day Pass is now a 3-tier product (1 / 2 / 3+ children) bought straight from
// a dropdown on the card — no product page. Resolve the product (exact 'day-pass'
// handle first, then any handle with 'day'+'pass'), then pin its three tier
// variants by title ("1 Child" / "2 Children" / "3+ Children") with a positional
// fallback, mirroring memberCta. Pass withBanner=true to surface a "Setup needed"
// note when the product/variants aren't published yet (home page stays clean).
function dayPassPrelude(withBanner) {
  const lines = [
    "{%- assign daypass_prod = all_products['day-pass'] -%}",
    "{%- if daypass_prod == blank -%}{%- for p in collections.all.products -%}{%- if p.handle contains 'day' and p.handle contains 'pass' -%}{%- assign daypass_prod = p -%}{%- break -%}{%- endif -%}{%- endfor -%}{%- endif -%}",
    "{%- assign dp_v1 = blank -%}{%- assign dp_v2 = blank -%}{%- assign dp_v3 = blank -%}",
    "{%- if daypass_prod != blank -%}",
    "{%- for v in daypass_prod.variants -%}{%- if v.title contains '1 Child' -%}{%- assign dp_v1 = v -%}{%- elsif v.title contains '2 Child' -%}{%- assign dp_v2 = v -%}{%- elsif v.title contains '3' -%}{%- assign dp_v3 = v -%}{%- endif -%}{%- endfor -%}",
    "{%- if dp_v1 == blank -%}{%- assign dp_v1 = daypass_prod.variants[0] -%}{%- endif -%}",
    "{%- if dp_v2 == blank -%}{%- assign dp_v2 = daypass_prod.variants[1] -%}{%- endif -%}",
    "{%- if dp_v3 == blank -%}{%- assign dp_v3 = daypass_prod.variants[2] -%}{%- endif -%}",
    "{%- endif -%}",
  ];
  if (withBanner) {
    lines.push(
      "{%- if daypass_prod == blank -%}",
      '<div role="status" style="background:#fcecd8;color:#3a3128;padding:1rem 1.2rem;margin:1.2rem auto;max-width:960px;border-radius:14px;text-align:left;font-size:0.95rem;border:2px dashed rgba(217,119,78,.55)">',
      "  <strong>⚠ Setup needed.</strong> The storefront can't see the <em>Day Pass</em> product, so its buy button can't reach checkout yet. ",
      '  Check its <strong>URL handle</strong> is <code>day-pass</code> (Search engine listing), that it is <strong>published to Online Store</strong>, and that it carries the three child-count variants.',
      "</div>",
      "{%- endif -%}"
    );
  }
  lines.push("");
  return lines.join("\n");
}

// Point the Day Pass tier <option>s + buy button at real add-to-cart URLs.
// Each option carries data-daypass-opt="1|2|3"; we add data-href for its tier
// variant. The buy button defaults to tier 1; pricePickers() in main.js copies
// the selected option's data-href onto the button as the dropdown changes.
//
// return_to=/cart, same reasoning as memberCta: the buy lands on the cart page
// for review, and the agreement gate rides on the cart's Checkout button.
// (The old short /cart/{id}:1 permalink went straight to checkout — that's why
// it's gone.) href still points at the product page as a JS-off fallback.
function wireDayPass(html) {
  const buy = (v) => `{%- if ${v} != blank -%}/cart/add?items[][id]={{ ${v}.id }}&amp;items[][quantity]=1&amp;return_to=/cart{%- endif -%}`;
  return html
    .replace(/(<option [^>]*\bdata-daypass-opt="1"[^>]*)>/g, `$1 data-href="${buy("dp_v1")}">`)
    .replace(/(<option [^>]*\bdata-daypass-opt="2"[^>]*)>/g, `$1 data-href="${buy("dp_v2")}">`)
    .replace(/(<option [^>]*\bdata-daypass-opt="3"[^>]*)>/g, `$1 data-href="${buy("dp_v3")}">`)
    .replace(
      /<button class="([^"]*)" type="button" data-noop data-daypass-buy[^>]*>Buy Day Pass<\/button>/g,
      `<a class="$1" data-daypass-buy href="/products/day-pass" data-buy-href="${buy("dp_v1")}">Buy Day Pass</a>`
    );
}

// Socks are one product, one variant, one price ($4.00 a pair). There are no
// sizes, so the card's dropdown only chooses HOW MANY pairs — carried by the
// quantity on the add-to-cart URL. That keeps the Shopify side to
// a single product with no variants for the owner to maintain.
//
// Resolve 'socks' by exact handle first, then any handle containing 'sock', and
// take variant[0] (the default variant Shopify creates for a single-price
// product). Banner shows on Play & Pricing until the product is published.
function socksPrelude() {
  return [
    "{%- assign socks_prod = all_products['socks'] -%}",
    "{%- if socks_prod == blank -%}{%- for p in collections.all.products -%}{%- if p.handle contains 'sock' -%}{%- assign socks_prod = p -%}{%- break -%}{%- endif -%}{%- endfor -%}{%- endif -%}",
    "{%- assign socks_v = blank -%}",
    "{%- if socks_prod != blank -%}{%- assign socks_v = socks_prod.variants[0] -%}{%- endif -%}",
    "{%- if socks_prod == blank -%}",
    '<div role="status" style="background:#fcecd8;color:#3a3128;padding:1rem 1.2rem;margin:1.2rem auto;max-width:960px;border-radius:14px;text-align:left;font-size:0.95rem;border:2px dashed rgba(217,119,78,.55)">',
    "  <strong>⚠ Setup needed.</strong> The storefront can't see the <em>Socks</em> product, so its buy button can't reach checkout yet. ",
    '  Check its <strong>URL handle</strong> is <code>socks</code> (Search engine listing), that it is <strong>published to Online Store</strong>, and that it is priced $4.00 with no variants.',
    "</div>",
    "{%- endif -%}",
    "",
  ].join("\n");
}

// Point the socks quantity <option>s + buy button at real add-to-cart URLs.
// Each option carries data-socks-opt="1|2|3|4"; we add data-href with that many
// pairs of the one variant. The button defaults to 1 pair; pricePickers() in
// main.js copies the selected option's data-href onto it as the dropdown moves.
//
// return_to=/cart like the Day Pass and memberships: socks ADD to whatever's
// already in the cart (that's the whole point — a pair on top of the Day Pass)
// and the customer reviews the combined order on the cart page.
function wireSocks(html) {
  const buy = (qty) => `{%- if socks_v != blank -%}/cart/add?items[][id]={{ socks_v.id }}&amp;items[][quantity]=${qty}&amp;return_to=/cart{%- endif -%}`;
  let out = html;
  for (const qty of [1, 2, 3, 4]) {
    out = out.replace(
      new RegExp(`(<option [^>]*\\bdata-socks-opt="${qty}"[^>]*)>`, "g"),
      `$1 data-href="${buy(qty)}">`
    );
  }
  return out.replace(
    /<button class="([^"]*)" type="button" data-noop data-socks-buy[^>]*>Buy socks<\/button>/g,
    `<a class="$1" data-socks-buy href="/products/socks" data-buy-href="${buy(1)}">Buy socks</a>`
  );
}

// Commerce wiring: turn placeholder "buy" buttons into one-tap add-to-cart links.
// Day Pass / membership / socks buys land on the CART PAGE to review + combine
// (the agreement gate rides on its Checkout button); only the party buyout still
// goes straight to checkout, because it's date-bound and single-purchase. Handles
// below must match the products you create; if a product/variant can't be resolved
// the link falls back to its product page and a diagnostic banner appears, so
// nothing breaks pre-setup.
function wireCommerce(html, key) {
  if (key === "memberships") {
    // Resilient lookup: try the exact handle first, then fall back to any
    // product whose handle contains both 'monthly'+'membership' (or annual).
    // Shows a diagnostic banner if either product can't be found on the
    // storefront — usually means it isn't published to the Online Store
    // sales channel, or has an unexpected handle. m_plan/a_plan capture each
    // product's subscription selling-plan id once, for the permalinks below.
    const prelude = [
      "{%- assign monthly_prod = all_products['monthly-membership'] -%}",
      "{%- if monthly_prod == blank -%}{%- for p in collections.all.products -%}{%- if p.handle contains 'monthly' and p.handle contains 'membership' -%}{%- assign monthly_prod = p -%}{%- break -%}{%- endif -%}{%- endfor -%}{%- endif -%}",
      "{%- assign annual_prod = all_products['annual-membership'] -%}",
      "{%- if annual_prod == blank -%}{%- for p in collections.all.products -%}{%- if p.handle contains 'annual' and p.handle contains 'membership' -%}{%- assign annual_prod = p -%}{%- break -%}{%- endif -%}{%- endfor -%}{%- endif -%}",
      "{%- if monthly_prod == blank or annual_prod == blank -%}",
      '<div role="status" style="background:#fcecd8;color:#3a3128;padding:1rem 1.2rem;margin:1.2rem auto;max-width:960px;border-radius:14px;text-align:left;font-size:0.95rem;border:2px dashed rgba(217,119,78,.55)">',
      "  <strong>⚠ Setup needed.</strong> The storefront can't see ",
      "  {%- if monthly_prod == blank %} <em>Monthly Membership</em>{%- endif -%}",
      "  {%- if monthly_prod == blank and annual_prod == blank %} +{%- endif -%}",
      "  {%- if annual_prod == blank %} <em>Annual Membership</em>{%- endif %}. ",
      '  Check the product’s <strong>URL handle</strong> (Search engine listing) and that it’s <strong>published to Online Store</strong> under Sales channels.',
      "</div>",
      "{%- endif -%}",
      "{%- assign m_plan = blank -%}{%- if monthly_prod.selling_plan_groups.size > 0 -%}{%- assign m_plan = monthly_prod.selling_plan_groups.first.selling_plans.first.id -%}{%- endif -%}",
      "{%- assign a_plan = blank -%}{%- if annual_prod.selling_plan_groups.size > 0 -%}{%- assign a_plan = annual_prod.selling_plan_groups.first.selling_plans.first.id -%}{%- endif -%}",
      "",
    ].join("\n");
    html = prelude + html
      .replace(/<button class="([^"]*)" type="button" data-noop data-tier="1">Join Monthly<\/button>/g, memberCta("monthly_prod", "m_plan", "1 Child", 0, "monthly-membership", "Join Monthly"))
      .replace(/<button class="([^"]*)" type="button" data-noop data-tier="2">Join Monthly<\/button>/g, memberCta("monthly_prod", "m_plan", "2 Children", 1, "monthly-membership", "Join Monthly"))
      .replace(/<button class="([^"]*)" type="button" data-noop data-tier="3">Join Monthly<\/button>/g, memberCta("monthly_prod", "m_plan", "3+ Children", 2, "monthly-membership", "Join Monthly"))
      .replace(/<button class="([^"]*)" type="button" data-noop data-tier="1">Join Annual<\/button>/g, memberCta("annual_prod", "a_plan", "1 Child", 0, "annual-membership", "Join Annual"))
      .replace(/<button class="([^"]*)" type="button" data-noop data-tier="2">Join Annual<\/button>/g, memberCta("annual_prod", "a_plan", "2 Children", 1, "annual-membership", "Join Annual"))
      .replace(/<button class="([^"]*)" type="button" data-noop data-tier="3">Join Annual<\/button>/g, memberCta("annual_prod", "a_plan", "3+ Children", 2, "annual-membership", "Join Annual"));
  }
  if (key === "index") {
    // Day Pass card carries the tier dropdown (wireDayPass); the hero's secondary
    // "Day Pass" button just links to the pricing section so visitors pick their
    // group size there. No setup banner on the home page — it stays clean; the
    // buy button falls back to the product page until the product is published.
    html = dayPassPrelude(false) + wireDayPass(html)
      // Newsletter: swap the prototype's noop demo form for a real Shopify
      // customer signup that posts and shows a success note.
      .replace(
        /<form class="newsletter-form" onsubmit="return false">[\s\S]*?<\/form>/,
        `{% form 'customer', class: 'newsletter-form' %}{%- if form.posted_successfully? -%}<p style="color:#fff;font-weight:600;margin:0">Thanks — you're on the list! 🎉</p>{%- else -%}<input type="hidden" name="contact[tags]" value="newsletter"><label for="nl-email" style="position:absolute;left:-9999px">Email address</label><input id="nl-email" type="email" name="contact[email]" placeholder="you@email.com" autocomplete="email" required><button class="btn" type="submit" style="background:#fff;color:var(--accent)">Subscribe</button>{%- endif -%}{% endform %}`
      );
  }
  if (key === "play-pricing") {
    // Day Pass is the one open-play product now (the Household Family Pass folded
    // into its 2-/3+-child tiers). The dropdown holds the choice and the buy
    // button goes straight to the selected tier's checkout; a setup banner shows
    // until the product + its three variants exist and are published.
    // Socks ride alongside as their own single-variant product; the dropdown
    // there picks a quantity rather than a variant.
    html = dayPassPrelude(true) + socksPrelude() + wireSocks(wireDayPass(html));
  }
  if (key === "parties") {
    // One bookable product `private-buyout` carries both prices as variants:
    // "Little Town" ($195) and "Little Town + Fusion" ($295). Resolve it, split
    // the two variants by title (the Fusion one contains "Fusion"), and inject
    // their ids into the booking forms' hidden id inputs so each form POSTs the
    // right variant to /cart/add -> checkout. Setup banner until it's published.
    const prelude = [
      "{%- assign buyout_prod = all_products['private-buyout'] -%}",
      "{%- if buyout_prod == blank -%}{%- for p in collections.all.products -%}{%- if p.handle contains 'buyout' -%}{%- assign buyout_prod = p -%}{%- break -%}{%- endif -%}{%- endfor -%}{%- endif -%}",
      "{%- assign lt_variant = blank -%}{%- assign fusion_variant = blank -%}",
      "{%- if buyout_prod != blank -%}{%- for v in buyout_prod.variants -%}{%- if v.title contains 'Fusion' -%}{%- assign fusion_variant = v -%}{%- else -%}{%- assign lt_variant = v -%}{%- endif -%}{%- endfor -%}{%- endif -%}",
      "{%- if buyout_prod == blank -%}",
      '<div role="status" style="background:#fcecd8;color:#3a3128;padding:1rem 1.2rem;margin:1.2rem auto;max-width:960px;border-radius:14px;text-align:left;font-size:0.95rem;border:2px dashed rgba(217,119,78,.55)">',
      "  <strong>⚠ Setup needed.</strong> The storefront can't see the <em>Private Buyout</em> product, so the party booking buttons can't reach checkout yet. ",
      '  Check its <strong>URL handle</strong> is <code>private-buyout</code> (Search engine listing) and that it is <strong>published to Online Store</strong> under Sales channels.',
      "</div>",
      "{%- endif -%}",
      // Date-blocking: expose the booked-slots shop metafield to the calendar.
      // Shopify Flow appends "YYYY-MM-DD|slot;" to lt_booking.taken on each order;
      // main.js (partyBooking) reads window.LT_BOOKED_RAW and greys those out.
      '<script>window.LT_BOOKED_RAW = {%- if shop.metafields.lt_booking.taken.value != blank -%}{{ shop.metafields.lt_booking.taken.value | json }}{%- else -%}""{%- endif -%};</script>',
      // The café next door, which the "+ Fusion" package needs. Second metafield,
      // written by BOTH sides: Fusion's own checkout on fusioncoffeeshop.com, and
      // our Flow when an order contains the Fusion variant (those entries carry a
      // third "|lt" field so Fusion can tell whose booking it was — see
      // SHOPIFY-MIGRATION.md §E). main.js reads window.LT_FUSION_TAKEN and
      // disables ONLY the "+ Fusion" card on those dates; the Little Town-only
      // buyout is never affected, so the date itself is never blocked.
      //
      // Needs a Shop metafield definition at lt_booking / fusion_taken
      // (Single line text). Missing definition = blank = nothing disabled,
      // which is the same fail-open the taken ledger already has.
      '<script>window.LT_FUSION_TAKEN = {%- if shop.metafields.lt_booking.fusion_taken.value != blank -%}{{ shop.metafields.lt_booking.fusion_taken.value | json }}{%- else -%}""{%- endif -%};</script>',
      "",
    ].join("\n");
    html = prelude + html
      .replace(/data-bk-variant="little-town" value=""/g, 'data-bk-variant="little-town" value="{{ lt_variant.id }}"')
      .replace(/data-bk-variant="fusion" value=""/g, 'data-bk-variant="fusion" value="{{ fusion_variant.id }}"');
  }
  return html;
}

function extractMain(html) {
  const m = html.match(/<main[\s\S]*?<\/main>/i);
  if (!m) throw new Error("no <main> found");
  return m[0];
}
function head(html, re) {
  const m = html.match(re);
  return m ? m[1].trim() : "";
}

// ---- 4. the marketing pages (+ the legal one) -------------------------
// terms is not in the nav — it's reached from the footer and from the
// agreement box that gates every buy button.
const PAGES = [
  { file: "index.html",        tmpl: "index.liquid",            key: "index" },
  { file: "play-pricing.html", tmpl: "page.play-pricing.liquid", key: "play-pricing" },
  { file: "parties.html",      tmpl: "page.parties.liquid",      key: "parties" },
  { file: "memberships.html",  tmpl: "page.memberships.liquid",  key: "memberships" },
  { file: "fusion.html",       tmpl: "page.fusion.liquid",       key: "fusion" },
  { file: "photo-gallery.html", tmpl: "page.photo-gallery.liquid", key: "photo-gallery" },
  { file: "visit-us.html",      tmpl: "page.visit-us.liquid",      key: "visit-us" },
  { file: "terms.html",         tmpl: "page.terms.liquid",         key: "terms" },
];

const meta = {}; // key -> { title, desc, css }
for (const p of PAGES) {
  const src = read(p.file);
  const body = wireCommerce(transformBody(extractMain(src)), p.key);
  write("templates/" + p.tmpl, body + "\n");
  /* Also emit each page body as a snippet, so the default page.liquid can
     auto-route by page.handle when an admin hasn't manually assigned the
     custom template. This makes the page render correctly even if the
     "Theme template" dropdown in admin is left on the default "page". */
  if (p.key !== "index") write("snippets/page-" + p.key + ".liquid", body + "\n");
  meta[p.key] = {
    title: head(src, /<title>([\s\S]*?)<\/title>/i),
    desc: head(src, /<meta name="description" content="([^"]*)"/i),
    css: (src.match(/pages\/([a-z-]+\.css)/i) || [])[1] || "",
  };
}

// ---- 5. layout/theme.liquid (head + meta case-block + header/footer) ---
const esc = (s) => String(s).replace(/"/g, "&quot;");
let metaCase = "  {%- case meta_key -%}\n";
for (const key of Object.keys(meta)) {
  const m = meta[key];
  metaCase +=
    `    {%- when '${key}' -%}` +
    `{%- assign meta_title = "${esc(m.title)}" -%}` +
    `{%- assign meta_desc = "${esc(m.desc)}" -%}` +
    `{%- assign page_css = "${m.css}" -%}\n`;
}
metaCase +=
  "    {%- else -%}{%- assign meta_title = page_title -%}{%- assign meta_desc = page_description -%}{%- assign page_css = blank -%}\n" +
  "  {%- endcase -%}";

write(
  "layout/theme.liquid",
  `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#F7F3EC">
  {%- liquid
    assign meta_key = template.suffix
    if template.name == 'index'
      assign meta_key = 'index'
    endif
    # Fail-safe: when a page sits on the default page template (no suffix),
    # use the page's own handle as the key so it still picks up the right CSS
    # + meta. Pairs with the handle-routed default page.liquid below.
    if meta_key == blank and template.name == 'page'
      assign meta_key = page.handle
    endif
  -%}
${metaCase}
  <title>{{ meta_title }}</title>
  {%- if meta_desc != blank -%}<meta name="description" content="{{ meta_desc }}">{%- endif -%}
  <meta property="og:type" content="website">
  <meta property="og:title" content="{{ meta_title }}">
  {%- if meta_desc != blank -%}<meta property="og:description" content="{{ meta_desc }}">{%- endif -%}
  <meta property="og:url" content="{{ canonical_url }}">
  <meta property="og:image" content="https:{{ 'logo-full.png' | asset_url }}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Quicksand:wght@400;500;600;700&family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,700;1,9..144,400;1,9..144,500;1,9..144,700&display=swap" rel="stylesheet">
  <link rel="icon" href="{{ 'logo.png' | asset_url }}" type="image/png">
  <link rel="apple-touch-icon" sizes="180x180" href="{{ 'apple-touch-icon.png' | asset_url }}">
  {{ 'styles.css' | asset_url | stylesheet_tag }}
  {%- if page_css != blank -%}{{ page_css | asset_url | stylesheet_tag }}{%- endif -%}
  {%- if meta_key == 'index' or meta_key == 'play-pricing' -%}<link rel="preload" as="image" href="{{ 'logo.webp' | asset_url }}" type="image/webp" fetchpriority="high">{%- endif -%}
  {{ content_for_header }}
</head>
<body>
  {% section 'header' %}
  {{ content_for_layout }}
  {% section 'footer' %}
  {%- comment -%}
    Site-wide socks lookup, for the "Don't forget socks!" upsell that fires
    after the agreement is accepted on a Day Pass or membership buy (see
    data-daypass-buy / data-membership-buy in main.js). Lives here rather than
    in socksPrelude() (which only runs on Play & Pricing) so the upsell also
    works from the home page's Day Pass card and from Memberships. A blank
    variant id means the socks product isn't published yet; main.js skips the
    upsell in that case rather than offering something it can't sell.
  {%- endcomment -%}
  {%- assign lt_socks_prod = all_products['socks'] -%}
  {%- if lt_socks_prod == blank -%}{%- for p in collections.all.products -%}{%- if p.handle contains 'sock' -%}{%- assign lt_socks_prod = p -%}{%- break -%}{%- endif -%}{%- endfor -%}{%- endif -%}
  {%- assign lt_socks_v = blank -%}{%- if lt_socks_prod != blank -%}{%- assign lt_socks_v = lt_socks_prod.variants[0] -%}{%- endif -%}
  <script>
    window.LT_SOCKS_VARIANT_ID = {%- if lt_socks_v != blank -%}{{ lt_socks_v.id | json }}{%- else -%}null{%- endif -%};
    window.LT_SOCKS_PRICE = {%- if lt_socks_v != blank -%}{{ lt_socks_v.price | divided_by: 100.0 | json }}{%- else -%}4.00{%- endif -%};
  </script>
  <script src="{{ 'main.js' | asset_url }}" defer></script>
</body>
</html>
`
);

// ---- 6. header + footer sections (active nav via request.path) ---------
const NAV = [
  ["/", "Home", "__home__"],
  ["/pages/play-pricing", "Play &amp; Pricing", "/play-pricing"],
  ["/pages/parties", "Parties", "/parties"],
  ["/pages/memberships", "Memberships", "/memberships"],
  ["/pages/fusion", "Fusion", "/fusion"],
  ["/pages/photo-gallery", "Photo Gallery", "/photo-gallery"],
  ["/pages/visit-us", "Visit Us", "/visit-us"],
];
const navLinks = (indent) =>
  NAV.map(([href, label, match]) => {
    const cond = match === "__home__" ? "p == '/'" : `p contains '${match}'`;
    return `${indent}<a href="${href}"{% if ${cond} %} class="active"{% endif %}>${label}</a>`;
  }).join("\n");

write(
  "sections/header.liquid",
  `{%- assign p = request.path -%}
<header class="site-header">
  <div class="container header-inner">
    <a class="brand" href="/" aria-label="Little Town Playhouse home">
      <img src="{{ 'logo.png' | asset_url }}" alt="" width="83" height="40">
      <span class="brand-text">
        <span class="brand-name">LITTLE TOWN</span>
        <span class="brand-sub script">Playhouse</span>
      </span>
    </a>
    <nav class="nav" aria-label="Primary">
${navLinks("      ")}
    </nav>
    <div class="header-cta">
      <button class="nav-toggle" aria-label="Open menu" aria-expanded="false" aria-controls="mobileMenu">
        <span></span><span></span><span></span>
      </button>
    </div>
  </div>
  <div class="mobile-menu" id="mobileMenu">
    <div>
      <nav aria-label="Mobile">
${navLinks("        ")}
      </nav>
    </div>
  </div>
</header>
{% schema %}
{ "name": "Header" }
{% endschema %}
`
);

write(
  "sections/footer.liquid",
  `<footer class="site-footer">
  <div class="container">
    <div class="footer-notice" role="note">
      <span class="footer-notice__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg></span>
      <p>Little Town is a <strong>watch-your-own-child</strong> space — please stay with your little ones and always know where they are. Grown-ups are responsible for supervising their own children while they play.</p>
    </div>
    <div class="footer-grid">
      <div class="footer-brand footer-col">
        <a class="brand" href="/" aria-label="Little Town Playhouse home">
          <img src="{{ 'logo.png' | asset_url }}" alt="" width="83" height="40">
          <span class="brand-text">
            <span class="brand-name">LITTLE TOWN</span>
            <span class="brand-sub script">Playhouse</span>
          </span>
        </a>
        <p style="margin-top:1rem">A little town built for big imaginations. Family memberships, indoor imaginative play, and great coffee next door at Fusion.</p>
        <div class="socials">
          <a href="https://www.instagram.com/littletownplayhouse" target="_blank" rel="noopener" aria-label="Instagram"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg></a>
          <a href="https://www.facebook.com/people/Little-Town-Playhouse/61590424400382/" target="_blank" rel="noopener" aria-label="Facebook"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 22v-8h2.5l.5-3H13V9.2c0-.9.3-1.5 1.6-1.5H16V5.1A21 21 0 0 0 13.9 5C11.7 5 10 6.3 10 9v2H7.5v3H10v8z"/></svg></a>        </div>
      </div>
      <div class="footer-col">
        <h3>Hours</h3>
        <ul>
          <li>Mon – Fri · 8am – 6pm</li>
          <li>Saturday · 8am – 4pm</li>
          <li>Sunday · Closed</li>
        </ul>
      </div>
      <div class="footer-col">
        <h3>Visit Us</h3>
        <ul>
          <li>205 East Main Street</li>
          <li>Fairfield, IL 62837</li>
          <li><a href="mailto:littletownplayhousellc@gmail.com">littletownplayhousellc@gmail.com</a></li>
        </ul>
      </div>
      <div class="footer-col">
        <h3>Find Us</h3>
        <div class="map-placeholder"><a href="https://maps.google.com/?q=205+East+Main+Street+Fairfield+IL+62837" target="_blank" rel="noopener" style="display:block" aria-label="Open map and directions to 205 East Main Street"><img src="{{ 'map-dark.png' | asset_url }}" alt="Map of 205 East Main Street, Fairfield, IL — Little Town Playhouse, next door to Fusion Coffee." width="320" height="180" loading="lazy" decoding="async"></a></div>
      </div>
    </div>
    <div class="footer-bottom">
      <span>© {{ 'now' | date: '%Y' }} Little Town Playhouse</span>
      {%- comment -%} main.js reads this link's href to point the buy-time agreement box at the full terms. {%- endcomment -%}
      <span><a href="/pages/terms" data-terms-link>Terms &amp; Waiver</a></span>
      <span>Made with imagination in Fairfield</span>
    </div>
  </div>
</footer>
{% schema %}
{ "name": "Footer" }
{% endschema %}
`
);

// ---- 6b. check-in page (the QR in the order-confirmation email opens this) ----
// A standalone "kiosk" screen: customer taps a button, the phone plays a short
// two-tone "peep" (Web Audio, no audio file) + vibrates, then shows "checked in".
// It's the arrival ritual referenced by notifications/order-confirmation.liquid.
// The order number rides in as ?o=1001 and is shown for a legit feel.
const CHECKIN_SNIPPET = `<style>
  .lt-ci-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#F7F3EC;padding:24px;box-sizing:border-box;font-family:'Quicksand','Trebuchet MS','Segoe UI',Verdana,Arial,sans-serif;color:#333}
  .lt-ci-card{width:100%;max-width:380px;background:#fff;border:3px solid #333;border-radius:24px;box-shadow:0 16px 0 -4px rgba(51,51,51,.10);padding:30px 26px 34px;text-align:center;box-sizing:border-box}
  .lt-ci-eyebrow{font-size:12px;letter-spacing:3px;font-weight:700;color:#B35A37;text-transform:uppercase}
  .lt-ci-script{font-family:'Fraunces',Georgia,serif;font-style:italic;font-size:30px;line-height:1;margin-top:2px;color:#333}
  .lt-ci-bar{height:8px;background:#F4AE92;border-radius:999px;width:70px;margin:14px auto 0}
  .lt-ci-h{font-size:26px;font-weight:700;margin:18px 0 4px}
  .lt-ci-order{display:none;font-size:14px;font-weight:600;color:#6f675b;margin:0 0 6px}
  .lt-ci-sub{font-size:15px;color:#5b5750;line-height:1.5;margin:0 0 22px}
  .lt-ci-btn{appearance:none;-webkit-appearance:none;border:3px solid #333;background:#F4AE92;color:#333;font:inherit;font-weight:700;font-size:18px;padding:16px 26px;border-radius:999px;cursor:pointer;box-shadow:0 5px 0 #333;transition:transform .08s,box-shadow .08s;width:100%;max-width:300px}
  .lt-ci-btn:active{transform:translateY(4px);box-shadow:0 1px 0 #333}
  .lt-ci-done{display:none}
  .lt-ci-check{width:96px;height:96px;border-radius:50%;background:#BFD6A8;border:3px solid #333;line-height:90px;margin:6px auto 14px;font-size:52px;animation:lt-ci-pop .5s cubic-bezier(.2,1.4,.4,1)}
  @keyframes lt-ci-pop{0%{transform:scale(0)}100%{transform:scale(1)}}
  .lt-ci-foot{font-size:12px;color:#6f675b;margin-top:18px}
</style>
<div class="lt-ci-wrap">
  <div class="lt-ci-card">
    <div class="lt-ci-eyebrow">Little Town</div>
    <div class="lt-ci-script">Playhouse</div>
    <div class="lt-ci-bar"></div>
    <div id="lt-ci-pre">
      <div class="lt-ci-h">Welcome! &#128075;</div>
      <div class="lt-ci-order" id="lt-ci-order"></div>
      <p class="lt-ci-sub">Ready to play? Tap below to check in.</p>
      <button class="lt-ci-btn" id="lt-ci-btn" type="button">&#127915; Tap to check in</button>
    </div>
    <div class="lt-ci-done" id="lt-ci-done">
      <div class="lt-ci-check">&#10003;</div>
      <div class="lt-ci-h">You're checked in!</div>
      <p class="lt-ci-sub">Come on in and have fun &mdash; enjoy your play. Need anything? Pop into Fusion next door.</p>
      <div class="lt-ci-foot">Show this screen if anyone asks.</div>
    </div>
  </div>
</div>
<script>
(function(){
  var p=new URLSearchParams(location.search);
  var o=(p.get('o')||p.get('order')||'').replace(/[^-0-9A-Za-z]/g,'');
  if(o){var el=document.getElementById('lt-ci-order');if(el){el.textContent='Order #'+o;el.style.display='block';}}
  var btn=document.getElementById('lt-ci-btn'),pre=document.getElementById('lt-ci-pre'),done=document.getElementById('lt-ci-done');
  function peep(){try{var AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;var ctx=new AC();if(ctx.state==='suspended'&&ctx.resume){ctx.resume();}function tone(f,s,d){var osc=ctx.createOscillator(),g=ctx.createGain();osc.type='sine';osc.frequency.value=f;osc.connect(g);g.connect(ctx.destination);var t=ctx.currentTime+s;g.gain.setValueAtTime(0.0001,t);g.gain.exponentialRampToValueAtTime(0.5,t+0.02);g.gain.exponentialRampToValueAtTime(0.0001,t+d);osc.start(t);osc.stop(t+d+0.03);}tone(880,0,0.12);tone(1320,0.12,0.2);}catch(e){}}
  function checkin(){peep();if(navigator.vibrate){try{navigator.vibrate([60,40,90]);}catch(e){}}if(pre){pre.style.display='none';}if(done){done.style.display='block';}}
  if(btn){btn.addEventListener('click',checkin);}
})();
</script>
`;
write("snippets/page-check-in.liquid", CHECKIN_SNIPPET);
// Standalone full-screen version (no site header/footer) — this is what /pages/check-in
// renders once its Page has the page.check-in template assigned.
write(
  "templates/page.check-in.liquid",
  `{% layout none %}
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#F7F3EC">
<title>Check in &mdash; Little Town Playhouse</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Quicksand:wght@400;600;700&family=Fraunces:ital,wght@1,500&display=swap" rel="stylesheet">
<style>html,body{margin:0;padding:0;background:#F7F3EC}</style>
</head>
<body>
{% render 'page-check-in' %}
</body>
</html>
`
);

// ---- 7. commerce + system templates -----------------------------------
write(
  "templates/product.liquid",
  `<style>
  .pdp-field{display:block;margin:0 0 1.1rem}
  .pdp-label{display:block;font-weight:700;margin-bottom:.45rem}
  #pdp-variant{width:100%;max-width:380px;padding:.7rem 1rem;border:2px solid rgba(58,49,40,.18);border-radius:var(--r-md,14px);font:inherit;background:#fff}
  .selling-plans{border:0;padding:0;margin:0 0 1.1rem}
  .selling-plan{display:flex;align-items:center;gap:.6rem;padding:.7rem 1rem;border:2px solid rgba(58,49,40,.14);border-radius:var(--r-md,14px);margin-bottom:.5rem;max-width:380px;cursor:pointer}
  .selling-plan:has(input:checked){border-color:var(--accent,#d9774e);background:var(--terra-tint,#fbeee7)}
  .pdp-booknote{margin:0 0 1.1rem;max-width:420px}
</style>
{%- assign cv = product.selected_or_first_available_variant -%}
<main class="section">
  <div class="container">
    <div class="split">
      <div class="split-art reveal">
        {%- if product.featured_image -%}
        <img src="{{ product.featured_image | image_url: width: 900 }}" alt="{{ product.featured_image.alt | escape }}" width="900" loading="eager" decoding="async" style="border-radius:var(--r-lg);box-shadow:var(--shadow-md)">
        {%- endif -%}
      </div>
      <div class="reveal" data-delay="1">
        <span class="eyebrow">Little Town</span>
        <h1>{{ product.title }}</h1>
        <div class="price-tag" id="pdp-price">{{ cv.price | money }}</div>
        <div class="rte" style="margin:1rem 0">{{ product.description }}</div>
        {%- comment -%}
          Private Buyout is date-bound: a party is only real once a weekend slot is
          attached to the order as the properties[Party date and time] line-item
          property, which ONLY the calendar on /pages/parties writes. This PDP is
          publicly reachable (product sitemap, /search, /collections/all), so left
          as a generic add-to-cart it sells a $195/$295 party — paid in full, all
          sales final — against no date at all, and never checks the Sat / Sun
          availability windows. Send buyers to the calendar instead of selling here.
        {%- endcomment -%}
        {%- if product.handle == 'private-buyout' -%}
          <p class="pdp-booknote">Buyouts are booked by date and time. Pick your weekend slot on the Parties page — you'll go straight to checkout from there.</p>
          <a class="btn btn--lg btn--terracotta btn--pop" href="/pages/parties#booking">Check availability</a>
        {%- else -%}
        {%- form 'product', product, id: 'pdp-form' -%}
          {%- comment -%} Land on the cart page to review, matching the one-tap buy buttons; the agreement gate rides on the cart's Checkout button {%- endcomment -%}
          <input type="hidden" name="return_to" value="/cart">
          {%- comment -%} Mirrors data-daypass-buy / data-membership-buy on the one-tap buttons: only day passes and memberships get the socks upsell, not socks' own PDP or the buyout. {%- endcomment -%}
          {%- if product.handle == 'day-pass' or product.handle contains 'membership' -%}<input type="hidden" data-pdp-offer-socks value="1">{%- endif -%}
          {%- comment -%} Variant picker — e.g. membership child-tiers (1 / 2 / 3+) {%- endcomment -%}
          {%- if product.variants.size > 1 -%}
            <label class="pdp-field">
              <span class="pdp-label">Choose your option</span>
              <select name="id" id="pdp-variant">
                {%- for v in product.variants -%}
                  <option value="{{ v.id }}" data-price="{{ v.price }}"{% if v == cv %} selected{% endif %}{% unless v.available %} disabled{% endunless %}>{{ v.title }} — {{ v.price | money }}{% unless v.available %} (sold out){% endunless %}</option>
                {%- endfor -%}
              </select>
            </label>
          {%- else -%}
            <input type="hidden" name="id" value="{{ cv.id }}">
          {%- endif -%}
          {%- comment -%} Subscription plans, surfaced by Shopify Subscriptions {%- endcomment -%}
          {%- if product.selling_plan_groups.size > 0 -%}
            {%- assign default_plan = product.selling_plan_groups.first.selling_plans.first -%}
            <fieldset class="pdp-field selling-plans">
              <legend class="pdp-label">Choose your plan</legend>
              {%- for group in product.selling_plan_groups -%}
                {%- for plan in group.selling_plans -%}
                  <label class="selling-plan">
                    <input type="radio" name="selling_plan" value="{{ plan.id }}"{% if plan.id == default_plan.id %} checked{% endif %}>
                    <span>{{ plan.name }}</span>
                  </label>
                {%- endfor -%}
              {%- endfor -%}
            </fieldset>
          {%- endif -%}
          <button class="btn btn--lg btn--terracotta btn--pop" type="submit" name="add"{% unless product.available %} disabled{% endunless %}>
            {% if product.available %}{% if product.selling_plan_groups.size > 0 %}Become a Member{% else %}Buy now{% endif %}{% else %}Sold out{% endif %}
          </button>
        {%- endform -%}
        {%- endif -%}
      </div>
    </div>
  </div>
</main>
<script>
(function(){
  var sel=document.getElementById('pdp-variant'),price=document.getElementById('pdp-price');
  if(!sel||!price)return;
  sel.addEventListener('change',function(){
    var o=sel.options[sel.selectedIndex],c=parseInt(o.getAttribute('data-price'),10);
    if(!isNaN(c)){price.textContent=(c/100).toLocaleString(undefined,{style:'currency',currency:'{{ cart.currency.iso_code }}'});}
  });
})();
</script>
`
);

write(
  "templates/cart.liquid",
  `{%- comment -%}
  The order-review step. Day Pass / membership / socks buys all land here
  (return_to=/cart on every buy URL) so a customer can combine items, fix
  quantities, or drop something — Shopify's checkout itself has no cart
  controls, which is why this page is in the flow at all. The Checkout button
  carries name="checkout": main.js gates it behind the participant agreement
  (stamp-without-clear path), so nothing reaches checkout ungated. Quantity
  steppers and remove are plain /cart/change links — no JS required.
{%- endcomment -%}
<style>
  .lt-cart{max-width:660px;margin:0 auto;padding:0 2px}
  .lt-cart-card{background:var(--white,#fff);border:2px solid var(--ink,#3a3128);border-radius:var(--r-lg,20px);box-shadow:5px 5px 0 0 var(--ink,#3a3128);padding:clamp(1.1rem,3.5vw,1.7rem)}
  .lt-cart-items{list-style:none;margin:1.6rem 0 0;padding:0}
  .lt-cart-item{display:flex;gap:.95rem;align-items:center;padding:1.05rem 0;border-bottom:2px dashed rgba(58,49,40,.16)}
  .lt-cart-item:first-child{padding-top:.2rem}
  .lt-cart-item:last-child{border-bottom:0;padding-bottom:.2rem}
  .lt-cart-thumb{width:60px;height:60px;flex:0 0 60px;border:2px solid var(--ink,#3a3128);border-radius:14px;background:var(--sun-tint,#fdf3dc);display:grid;place-items:center;overflow:hidden}
  .lt-cart-thumb img{width:100%;height:100%;object-fit:cover}
  .lt-cart-thumb img.lt-cart-ico{width:30px;height:30px;object-fit:contain}
  .lt-cart-body{flex:1;min-width:0}
  .lt-cart-name{font-weight:700;line-height:1.25}
  .lt-cart-sub{display:block;font-size:.82rem;color:var(--ink-soft,#6f675b);margin-top:.15rem}
  .lt-cart-line2{display:flex;align-items:center;gap:.8rem;margin-top:.55rem;flex-wrap:wrap}
  .lt-cart-qty{display:inline-flex;align-items:center;gap:.15rem;border:2px solid var(--ink,#3a3128);border-radius:999px;padding:.1rem .3rem;background:var(--white,#fff)}
  .lt-cart-step{display:grid;place-items:center;width:30px;height:30px;border-radius:50%;font-weight:700;font-size:1.05rem;color:var(--ink,#3a3128);text-decoration:none;line-height:1}
  .lt-cart-step:hover{background:var(--sun-tint,#fdf3dc)}
  .lt-cart-qty span{min-width:1.4ch;text-align:center;font-weight:700;font-size:.95rem}
  .lt-cart-remove{font-size:.82rem;color:var(--ink-soft,#6f675b);text-decoration:underline;text-underline-offset:2px}
  .lt-cart-remove:hover{color:var(--ink,#3a3128)}
  .lt-cart-price{font-weight:700;white-space:nowrap;margin-left:auto;align-self:flex-start;padding-top:.15rem}
  .lt-cart-addon{display:flex;gap:.9rem;align-items:center;margin-top:1.1rem;padding:.95rem 1.05rem;border:2px dashed var(--accent,#d9774e);border-radius:var(--r-md,16px);background:var(--terra-tint,#fbeee7)}
  .lt-cart-addon-ic{width:44px;height:44px;flex:0 0 44px;border-radius:50%;background:var(--white,#fff);border:2px solid var(--ink,#3a3128);display:grid;place-items:center}
  .lt-cart-addon-body{flex:1;min-width:0}
  .lt-cart-addon-body strong{display:block;line-height:1.2}
  .lt-cart-addon-body small{color:var(--ink-soft,#6f675b);line-height:1.35;display:block;margin-top:.1rem}
  .lt-cart-addon .btn{padding:.55rem 1rem;font-size:.9rem;white-space:nowrap}
  .lt-cart-summary{margin-top:1.4rem}
  .lt-cart-total{display:flex;justify-content:space-between;align-items:baseline;font-size:1.05rem;padding-bottom:1rem;border-bottom:2px dashed rgba(58,49,40,.16);margin-bottom:1rem}
  .lt-cart-total strong{font-size:1.45rem}
  .lt-cart-note{font-size:.85rem;color:var(--ink-soft,#6f675b);margin:0 0 1rem;line-height:1.45}
  .lt-cart-back{display:block;text-align:center;margin-top:1.3rem;font-weight:600;color:var(--ink-soft,#6f675b);text-decoration:none}
  .lt-cart-back:hover{color:var(--ink,#3a3128);text-decoration:underline;text-underline-offset:3px}
  .lt-cart-empty{text-align:center;padding:clamp(1.8rem,5vw,2.6rem)}
  .lt-cart-empty-ic{width:72px;height:72px;border-radius:50%;background:var(--sun-tint,#fdf3dc);border:2px solid var(--ink,#3a3128);display:grid;place-items:center;margin:0 auto 1rem}
  .lt-cart-empty h2{margin:0 0 .4rem}
  .lt-cart-empty p{color:var(--ink-soft,#6f675b);margin:0 auto 1.3rem;max-width:34ch}
  @media (max-width:430px){
    .lt-cart-addon{flex-wrap:wrap}
    .lt-cart-addon .btn{flex:1 1 100%}
  }
</style>
<main class="section">
  <div class="container">
    <div class="lt-cart">
      <div class="center reveal">
        <span class="eyebrow">Almost time to play</span>
        <h1>Your <span class="hl">order</span></h1>
      </div>

      {%- if cart.item_count == 0 -%}
      <div class="lt-cart-card lt-cart-empty reveal" style="margin-top:1.6rem">
        <span class="lt-cart-empty-ic" aria-hidden="true"><img src="{{ 'icon-ticket.svg' | asset_url }}" alt="" width="34" height="34"></span>
        <h2>Nothing in here yet!</h2>
        <p>Grab a Day Pass for today's adventure, or a membership for all the days after.</p>
        <div class="flex-cta" style="justify-content:center">
          <a class="btn btn--terracotta btn--pop" href="/pages/play-pricing">Day passes</a>
          <a class="btn btn--ghost" href="/pages/memberships">Memberships</a>
        </div>
      </div>
      {%- else -%}

      <div class="lt-cart-card reveal" style="margin-top:1.6rem">
        <ul class="lt-cart-items">
          {%- for item in cart.items -%}
          <li class="lt-cart-item">
            {%- if item.image -%}
              <span class="lt-cart-thumb"><img src="{{ item.image | image_url: width: 120 }}" alt="" width="60" height="60" loading="lazy"></span>
            {%- elsif item.product.handle contains 'sock' -%}
              <span class="lt-cart-thumb"><img class="lt-cart-ico" src="{{ 'icon-socks.svg' | asset_url }}" alt="" width="30" height="30"></span>
            {%- else -%}
              <span class="lt-cart-thumb"><img class="lt-cart-ico" src="{{ 'icon-ticket.svg' | asset_url }}" alt="" width="30" height="30"></span>
            {%- endif -%}
            <div class="lt-cart-body">
              <span class="lt-cart-name">{{ item.product.title }}</span>
              {%- if item.variant.title != 'Default Title' -%}<span class="lt-cart-sub">{{ item.variant.title }}</span>{%- endif -%}
              {%- if item.selling_plan_allocation -%}<span class="lt-cart-sub">{{ item.selling_plan_allocation.selling_plan.name }}</span>{%- endif -%}
              {%- for p in item.properties -%}{%- unless p.last == blank or p.first == 'Agreement' -%}<span class="lt-cart-sub">{{ p.first }}: {{ p.last }}</span>{%- endunless -%}{%- endfor -%}
              <div class="lt-cart-line2">
                <span class="lt-cart-qty">
                  <a class="lt-cart-step" href="/cart/change?line={{ forloop.index }}&amp;quantity={{ item.quantity | minus: 1 }}" aria-label="One fewer {{ item.product.title | escape }}">&minus;</a>
                  <span aria-label="Quantity">{{ item.quantity }}</span>
                  <a class="lt-cart-step" href="/cart/change?line={{ forloop.index }}&amp;quantity={{ item.quantity | plus: 1 }}" aria-label="One more {{ item.product.title | escape }}">+</a>
                </span>
                <a class="lt-cart-remove" href="{{ item.url_to_remove }}">Remove</a>
              </div>
            </div>
            <span class="lt-cart-price">{{ item.final_line_price | money }}</span>
          </li>
          {%- endfor -%}
        </ul>

        {%- comment -%} Socks add-on, right where they're reviewing the order —
            the last easy chance to grab a pair. Hidden once socks are in the
            cart (the stepper handles quantity from there) or if the product
            isn't published. {%- endcomment -%}
        {%- assign lt_c_socks = all_products['socks'] -%}
        {%- if lt_c_socks == blank -%}{%- for p in collections.all.products -%}{%- if p.handle contains 'sock' -%}{%- assign lt_c_socks = p -%}{%- break -%}{%- endif -%}{%- endfor -%}{%- endif -%}
        {%- assign lt_c_socks_v = blank -%}{%- if lt_c_socks != blank -%}{%- assign lt_c_socks_v = lt_c_socks.variants[0] -%}{%- endif -%}
        {%- assign lt_has_socks = false -%}
        {%- for item in cart.items -%}{%- if item.product.handle contains 'sock' -%}{%- assign lt_has_socks = true -%}{%- endif -%}{%- endfor -%}
        {%- if lt_c_socks_v != blank and lt_has_socks == false -%}
        <div class="lt-cart-addon">
          <span class="lt-cart-addon-ic" aria-hidden="true"><img src="{{ 'icon-socks.svg' | asset_url }}" alt="" width="24" height="24"></span>
          <div class="lt-cart-addon-body">
            <strong>Don't forget socks!</strong>
            <small>Socks only on the play floor — {{ lt_c_socks_v.price | money }} a pair, ready for you at Little Town.</small>
          </div>
          <form action="/cart/add" method="post">
            <input type="hidden" name="id" value="{{ lt_c_socks_v.id }}">
            <input type="hidden" name="quantity" value="1">
            <input type="hidden" name="return_to" value="/cart">
            <button class="btn btn--terracotta" type="submit">Add a pair</button>
          </form>
        </div>
        {%- endif -%}

        <div class="lt-cart-summary">
          <div class="lt-cart-total"><span>Total</span><strong>{{ cart.total_price | money }}</strong></div>
          <p class="lt-cart-note">Next you'll accept our participant agreement, then it's straight to secure checkout.</p>
          {%- form 'cart', cart -%}
            <button class="btn btn--block btn--terracotta btn--lg btn--pop" type="submit" name="checkout">Checkout &middot; {{ cart.total_price | money }}</button>
          {%- endform -%}
        </div>
      </div>

      <a class="lt-cart-back" href="/pages/play-pricing">&larr; Keep looking around</a>
      {%- endif -%}
    </div>
  </div>
</main>
`
);

write(
  "templates/collection.liquid",
  `<main class="section">
  <div class="container">
    <div class="center reveal"><span class="eyebrow">Little Town</span><h1>{{ collection.title }}</h1></div>
    <div class="grid grid-3 mt-4">
      {%- for product in collection.products -%}
        <article class="card reveal">
          {%- if product.featured_image -%}<div class="card-art"><img src="{{ product.featured_image | image_url: width: 400 }}" alt="{{ product.featured_image.alt | escape }}" width="400" loading="lazy"></div>{%- endif -%}
          <h2>{{ product.title }}</h2>
          <div class="price-tag">{{ product.price | money }}</div>
          <a class="btn btn--block btn--terracotta" href="{{ product.url }}">View</a>
        </article>
      {%- else -%}
        <p>No products yet.</p>
      {%- endfor -%}
    </div>
    {{ paginate | default: '' }}
  </div>
</main>
`
);

write(
  "templates/list-collections.liquid",
  `<main class="section"><div class="container">
    <div class="center reveal"><h1>Collections</h1></div>
    <div class="grid grid-3 mt-4">
      {%- for collection in collections -%}
        <article class="card reveal"><h2>{{ collection.title }}</h2><a class="btn btn--block btn--terracotta" href="{{ collection.url }}">Browse</a></article>
      {%- endfor -%}
    </div>
</div></main>
`
);

/* Smart default page.liquid — if a Shopify page's handle matches one of our
   custom marketing pages, render that page's snippet body. Otherwise fall
   back to the generic title + content layout. This way the marketing pages
   render correctly even when the admin "Theme template" dropdown is left on
   the default "page" instead of the matching custom template. */
const pageHandleCases = [
  ...PAGES.filter((p) => p.key !== "index").map(
    (p) => `    {%- when '${p.key}' -%}{%- render 'page-${p.key}' -%}`
  ),
  // check-in is a bespoke page (no root .html); render its snippet too, so the
  // QR's /pages/check-in still works even if the page is left on the default template.
  `    {%- when 'check-in' -%}{%- render 'page-check-in' -%}`,
].join("\n");
write(
  "templates/page.liquid",
  `{%- case page.handle -%}
${pageHandleCases}
    {%- else -%}
<main class="section"><div class="container reveal">
  <div class="center"><h1>{{ page.title }}</h1></div>
  <div class="rte" style="max-width:740px;margin:1.5rem auto 0">{{ page.content }}</div>
</div></main>
{%- endcase -%}
`
);

write(
  "templates/blog.liquid",
  `<main class="section"><div class="container">
    <div class="center reveal"><h1>{{ blog.title }}</h1></div>
    <div class="grid grid-3 mt-4">
      {%- for article in blog.articles -%}
        <article class="card reveal"><h2><a href="{{ article.url }}">{{ article.title }}</a></h2><p>{{ article.excerpt_or_content | strip_html | truncatewords: 24 }}</p></article>
      {%- endfor -%}
    </div>
</div></main>
`
);

write(
  "templates/article.liquid",
  `<main class="section"><div class="container reveal" style="max-width:740px">
    <div class="center"><span class="eyebrow">{{ article.published_at | date: '%B %-d, %Y' }}</span><h1>{{ article.title }}</h1></div>
    <div class="rte" style="margin-top:1.5rem">{{ article.content }}</div>
</div></main>
`
);

write(
  "templates/search.liquid",
  `<main class="section"><div class="container">
    <div class="center reveal"><h1>Search</h1></div>
    <form action="/search" method="get" role="search" class="center" style="margin-top:1rem">
      <input type="search" name="q" value="{{ search.terms | escape }}" placeholder="Search…" aria-label="Search" style="padding:.6rem 1rem;border-radius:999px;border:1px solid rgba(0,0,0,.15)">
      <button class="btn btn--terracotta" type="submit">Go</button>
    </form>
    <div class="grid grid-3 mt-4">
      {%- for item in search.results -%}
        <article class="card reveal"><h2><a href="{{ item.url }}">{{ item.title }}</a></h2></article>
      {%- endfor -%}
    </div>
</div></main>
`
);

write(
  "templates/404.liquid",
  `<main class="section"><div class="container center reveal" style="padding:4rem 0">
    <span class="eyebrow">Oops</span>
    <h1>This little street doesn't exist</h1>
    <p>The page you're after wandered off. Let's get you back to town.</p>
    <div class="flex-cta center" style="margin-top:1.2rem"><a class="btn btn--lg btn--terracotta btn--pop" href="/">Back home</a></div>
</div></main>
`
);

write(
  "templates/gift_card.liquid",
  `<main class="section"><div class="container center reveal">
    <h1>Little Town gift card</h1>
    <div class="price-tag">{{ gift_card.balance | money }}</div>
    <p>Gift card code: <strong>{{ gift_card.code | format_code }}</strong></p>
</div></main>
`
);

// minimal customer account templates (only used if classic accounts are on)
const cust = {
  "login.liquid": `<main class="section"><div class="container reveal" style="max-width:420px">
  <div class="center"><h1>Log in</h1></div>
  {%- form 'customer_login' -%}
    <input type="email" name="customer[email]" placeholder="Email" aria-label="Email" required style="display:block;width:100%;margin:.5rem 0;padding:.6rem">
    <input type="password" name="customer[password]" placeholder="Password" aria-label="Password" required style="display:block;width:100%;margin:.5rem 0;padding:.6rem">
    <button class="btn btn--block btn--terracotta" type="submit">Log in</button>
  {%- endform -%}
  <p class="center" style="margin-top:1rem"><a href="/account/register">Create account</a></p>
</div></main>`,
  "register.liquid": `<main class="section"><div class="container reveal" style="max-width:420px">
  <div class="center"><h1>Create account</h1></div>
  {%- form 'create_customer' -%}
    <input type="text" name="customer[first_name]" placeholder="First name" aria-label="First name" style="display:block;width:100%;margin:.5rem 0;padding:.6rem">
    <input type="text" name="customer[last_name]" placeholder="Last name" aria-label="Last name" style="display:block;width:100%;margin:.5rem 0;padding:.6rem">
    <input type="email" name="customer[email]" placeholder="Email" aria-label="Email" required style="display:block;width:100%;margin:.5rem 0;padding:.6rem">
    <input type="password" name="customer[password]" placeholder="Password" aria-label="Password" required style="display:block;width:100%;margin:.5rem 0;padding:.6rem">
    <button class="btn btn--block btn--terracotta" type="submit">Create</button>
  {%- endform -%}
</div></main>`,
  "account.liquid": `<main class="section"><div class="container reveal">
  <div class="center"><h1>Hello, {{ customer.first_name | default: 'friend' }}</h1></div>
  <p class="center"><a href="/account/logout">Log out</a></p>
  <h2>Order history</h2>
  {%- for order in customer.orders -%}
    <p><a href="{{ order.customer_url }}">{{ order.name }}</a> — {{ order.created_at | date: '%b %-d, %Y' }} — {{ order.total_price | money }}</p>
  {%- else -%}<p>No orders yet.</p>{%- endfor -%}
</div></main>`,
  "addresses.liquid": `<main class="section"><div class="container reveal"><div class="center"><h1>Your addresses</h1></div><p class="center"><a href="/account">Back to account</a></p></div></main>`,
  "order.liquid": `<main class="section"><div class="container reveal"><div class="center"><h1>Order {{ order.name }}</h1></div><p class="center">{{ order.created_at | date: '%B %-d, %Y' }} — {{ order.total_price | money }}</p></div></main>`,
  "reset_password.liquid": `<main class="section"><div class="container reveal" style="max-width:420px"><div class="center"><h1>Reset password</h1></div>
  {%- form 'reset_customer_password' -%}
    <input type="password" name="customer[password]" placeholder="New password" aria-label="New password" required style="display:block;width:100%;margin:.5rem 0;padding:.6rem">
    <input type="password" name="customer[password_confirmation]" placeholder="Confirm" aria-label="Confirm password" required style="display:block;width:100%;margin:.5rem 0;padding:.6rem">
    <button class="btn btn--block btn--terracotta" type="submit">Reset</button>
  {%- endform -%}
</div></main>`,
  "activate_account.liquid": `<main class="section"><div class="container reveal" style="max-width:420px"><div class="center"><h1>Activate account</h1></div>
  {%- form 'activate_customer_password' -%}
    <input type="password" name="customer[password]" placeholder="Password" aria-label="Password" required style="display:block;width:100%;margin:.5rem 0;padding:.6rem">
    <input type="password" name="customer[password_confirmation]" placeholder="Confirm" aria-label="Confirm password" required style="display:block;width:100%;margin:.5rem 0;padding:.6rem">
    <button class="btn btn--block btn--terracotta" type="submit">Activate</button>
  {%- endform -%}
</div></main>`,
};
for (const [f, c] of Object.entries(cust)) write("templates/customers/" + f, c + "\n");

// ---- 8. password page (dev stores are password-protected) -------------
write(
  "layout/password.liquid",
  `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#F7F3EC">
  <title>{{ shop.name }}</title>
  <link href="https://fonts.googleapis.com/css2?family=Quicksand:wght@400;600;700&family=Fraunces:ital,wght@1,500&display=swap" rel="stylesheet">
  {{ 'styles.css' | asset_url | stylesheet_tag }}
  {{ content_for_header }}
</head>
<body>
  {{ content_for_layout }}
</body>
</html>
`
);
write(
  "templates/password.liquid",
  `<main class="section"><div class="container center reveal" style="padding:5rem 0">
  <img src="{{ 'logo-full.png' | asset_url }}" alt="Little Town Playhouse" width="200" style="margin-bottom:1rem">
  <h1>Opening soon</h1>
  <p>{{ shop.password_message }}</p>
  {%- form 'storefront_password' -%}
    <input type="password" name="password" placeholder="Password" aria-label="Password" style="padding:.6rem 1rem;border-radius:999px;border:1px solid rgba(0,0,0,.15)">
    <button class="btn btn--terracotta" type="submit">Enter</button>
  {%- endform -%}
</div></main>
`
);

// ---- 9. config + locales ----------------------------------------------
write(
  "config/settings_schema.json",
  JSON.stringify(
    [
      {
        name: "theme_info",
        theme_name: "Little Town Playhouse",
        theme_version: "1.0.0",
        theme_author: "Cantrellco",
        theme_documentation_url: "https://littletownplay.com",
        theme_support_url: "https://littletownplay.com",
      },
    ],
    null,
    2
  ) + "\n"
);
write("config/settings_data.json", JSON.stringify({ current: "Default", presets: { Default: {} } }, null, 2) + "\n");
write(
  "locales/en.default.json",
  JSON.stringify({ general: { search: { placeholder: "Search" }, "404": { title: "Page not found" } } }, null, 2) + "\n"
);

// ---- done --------------------------------------------------------------
console.log("Theme built in ./theme");
console.log("  images copied : " + imgCount);
console.log("  page meta map :");
for (const k of Object.keys(meta)) console.log(`    ${k.padEnd(14)} -> "${meta[k].title}"  [${meta[k].css || "no page css"}]`);
