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

// ---- 2. css (flatten image url() paths to same-folder filenames) -------
const flattenCss = (css) =>
  css.replace(/\.\.\/\.\.\/img\//g, "").replace(/\.\.\/img\//g, "");

write("assets/styles.css", flattenCss(read("assets/css/styles.css")));
const pagesCssDir = path.join(root, "assets", "css", "pages");
for (const f of fs.readdirSync(pagesCssDir)) {
  write("assets/" + f, flattenCss(fs.readFileSync(path.join(pagesCssDir, f), "utf8")));
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
  "our-story.html": "/pages/photo-gallery",
  "visit-us.html": "/pages/visit-us",
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

// Commerce wiring: turn placeholder "buy" buttons into links to the matching
// Shopify product. Handles below must match the product handles you create.
function wireCommerce(html, key) {
  if (key === "memberships") {
    // Resilient lookup: try the exact handle first, then fall back to any
    // product whose handle contains both 'monthly'+'membership' (or annual).
    // Shows a diagnostic banner if either product can't be found on the
    // storefront — usually means it isn't published to the Online Store
    // sales channel, or has an unexpected handle.
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
      "",
    ].join("\n");
    html = prelude + html
      .replace(
        /<button class="([^"]*)" type="button" data-noop>Join Monthly<\/button>/g,
        `<a class="$1" href="{{ monthly_prod.url | default: '/products/monthly-membership' }}">Join Monthly</a>`
      )
      .replace(
        /<button class="([^"]*)" type="button" data-noop>Join Annual<\/button>/g,
        `<a class="$1" href="{{ annual_prod.url | default: '/products/annual-membership' }}">Join Annual</a>`
      );
  }
  if (key === "play-pricing" || key === "index") {
    html = html
      .replace(
        /<button class="([^"]*)" type="button" data-noop[^>]*>Buy Day Pass<\/button>/g,
        '<a class="$1" href="/products/day-pass">Buy Day Pass</a>'
      )
      .replace(
        /<button class="([^"]*)" type="button" data-noop[^>]*>Buy Play Pack<\/button>/g,
        '<a class="$1" href="/products/play-pack">Buy Play Pack</a>'
      );
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

// ---- 4. the 7 marketing pages -----------------------------------------
const PAGES = [
  { file: "index.html",        tmpl: "index.liquid",            key: "index" },
  { file: "play-pricing.html", tmpl: "page.play-pricing.liquid", key: "play-pricing" },
  { file: "parties.html",      tmpl: "page.parties.liquid",      key: "parties" },
  { file: "memberships.html",  tmpl: "page.memberships.liquid",  key: "memberships" },
  { file: "fusion.html",       tmpl: "page.fusion.liquid",       key: "fusion" },
  { file: "our-story.html",    tmpl: "page.our-story.liquid",    key: "our-story" },
  { file: "visit-us.html",     tmpl: "page.visit-us.liquid",     key: "visit-us" },
];

const meta = {}; // key -> { title, desc, css }
for (const p of PAGES) {
  const src = read(p.file);
  const body = wireCommerce(transformBody(extractMain(src)), p.key);
  write("templates/" + p.tmpl, body + "\n");
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
  {%- liquid
    assign meta_key = template.suffix
    if template.name == 'index'
      assign meta_key = 'index'
    endif
  -%}
${metaCase}
  <title>{{ meta_title }}</title>
  {%- if meta_desc != blank -%}<meta name="description" content="{{ meta_desc }}">{%- endif -%}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Quicksand:wght@400;500;600;700&family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,700;1,9..144,400;1,9..144,500;1,9..144,700&display=swap" rel="stylesheet">
  <link rel="icon" href="{{ 'logo.png' | asset_url }}" type="image/png">
  {{ 'styles.css' | asset_url | stylesheet_tag }}
  {%- if page_css != blank -%}{{ page_css | asset_url | stylesheet_tag }}{%- endif -%}
  {{ content_for_header }}
</head>
<body>
  {% section 'header' %}
  {{ content_for_layout }}
  {% section 'footer' %}
  {{ 'main.js' | asset_url | script_tag }}
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
      <a class="btn btn--terracotta btn--cta" href="/pages/memberships"><span class="cta-full">Become a Member</span><span class="cta-short">Join</span></a>
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
          <a href="#" aria-label="Instagram"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg></a>
          <a href="#" aria-label="Facebook"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 22v-8h2.5l.5-3H13V9.2c0-.9.3-1.5 1.6-1.5H16V5.1A21 21 0 0 0 13.9 5C11.7 5 10 6.3 10 9v2H7.5v3H10v8z"/></svg></a>
          <a href="#" aria-label="TikTok"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 3c.3 2.1 1.5 3.6 3.5 3.9V10c-1.3 0-2.5-.4-3.5-1v6.5A5.5 5.5 0 1 1 10.5 10v3a2.5 2.5 0 1 0 2.5 2.5V3z"/></svg></a>
        </div>
      </div>
      <div class="footer-col">
        <h4>Hours</h4>
        <ul>
          <li>Mon – Thu · 9am – 6pm</li>
          <li>Fri – Sat · 9am – 8pm</li>
          <li>Sunday · 10am – 5pm</li>
        </ul>
      </div>
      <div class="footer-col">
        <h4>Visit Us</h4>
        <ul>
          <li>12 Main Street</li>
          <li>Riverbend, CA 90210</li>
          <li><a href="tel:+15550142025">(555) 014-2025</a></li>
          <li><a href="mailto:hello@littletownplay.com">hello@littletownplay.com</a></li>
        </ul>
      </div>
      <div class="footer-col">
        <h4>Find Us</h4>
        <div class="map-placeholder"><img src="{{ 'map-dark.svg' | asset_url }}" alt="Stylized map placeholder showing 12 Main Street." width="320" height="180" loading="lazy" decoding="async"></div>
      </div>
    </div>
    <div class="footer-bottom">
      <span>© {{ 'now' | date: '%Y' }} Little Town Playhouse</span>
      <span>Made with imagination in Riverbend</span>
    </div>
  </div>
</footer>
{% schema %}
{ "name": "Footer" }
{% endschema %}
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
        {%- form 'product', product, id: 'pdp-form' -%}
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
            {% if product.available %}{% if product.selling_plan_groups.size > 0 %}Become a Member{% else %}Add to cart{% endif %}{% else %}Sold out{% endif %}
          </button>
        {%- endform -%}
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
  `<main class="section">
  <div class="container">
    <div class="center reveal"><span class="eyebrow">Almost there</span><h1>Your cart</h1></div>
    {%- if cart.item_count == 0 -%}
      <p class="center" style="margin-top:1rem">Your cart is empty.</p>
      <div class="flex-cta center" style="margin-top:1rem"><a class="btn btn--terracotta btn--lg" href="/collections/all">Browse passes</a></div>
    {%- else -%}
      {%- form 'cart', cart -%}
        {%- for item in cart.items -%}
          <div style="display:flex;gap:1rem;align-items:center;padding:1rem 0;border-bottom:1px solid rgba(0,0,0,.08)">
            <div style="flex:1"><strong>{{ item.product.title }}</strong><br><small>{{ item.final_price | money }}</small></div>
            <input type="number" name="updates[]" value="{{ item.quantity }}" min="0" aria-label="Quantity" style="width:64px;padding:.4rem">
            <a href="{{ item.url_to_remove }}" aria-label="Remove">✕</a>
          </div>
        {%- endfor -%}
        <p style="margin-top:1.2rem;text-align:right"><strong>Subtotal: {{ cart.total_price | money }}</strong></p>
        <div class="flex-cta" style="justify-content:flex-end;margin-top:1rem">
          <button class="btn btn--ghost" type="submit" name="update">Update</button>
          <button class="btn btn--terracotta btn--lg btn--pop" type="submit" name="checkout">Checkout</button>
        </div>
      {%- endform -%}
    {%- endif -%}
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
          <h3>{{ product.title }}</h3>
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
        <article class="card reveal"><h3>{{ collection.title }}</h3><a class="btn btn--block btn--terracotta" href="{{ collection.url }}">Browse</a></article>
      {%- endfor -%}
    </div>
</div></main>
`
);

write(
  "templates/page.liquid",
  `<main class="section"><div class="container reveal">
    <div class="center"><h1>{{ page.title }}</h1></div>
    <div class="rte" style="max-width:740px;margin:1.5rem auto 0">{{ page.content }}</div>
</div></main>
`
);

write(
  "templates/blog.liquid",
  `<main class="section"><div class="container">
    <div class="center reveal"><h1>{{ blog.title }}</h1></div>
    <div class="grid grid-3 mt-4">
      {%- for article in blog.articles -%}
        <article class="card reveal"><h3><a href="{{ article.url }}">{{ article.title }}</a></h3><p>{{ article.excerpt_or_content | strip_html | truncatewords: 24 }}</p></article>
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
      <input type="search" name="q" value="{{ search.terms | escape }}" placeholder="Search…" style="padding:.6rem 1rem;border-radius:999px;border:1px solid rgba(0,0,0,.15)">
      <button class="btn btn--terracotta" type="submit">Go</button>
    </form>
    <div class="grid grid-3 mt-4">
      {%- for item in search.results -%}
        <article class="card reveal"><h3><a href="{{ item.url }}">{{ item.title }}</a></h3></article>
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
    <input type="email" name="customer[email]" placeholder="Email" required style="display:block;width:100%;margin:.5rem 0;padding:.6rem">
    <input type="password" name="customer[password]" placeholder="Password" required style="display:block;width:100%;margin:.5rem 0;padding:.6rem">
    <button class="btn btn--block btn--terracotta" type="submit">Log in</button>
  {%- endform -%}
  <p class="center" style="margin-top:1rem"><a href="/account/register">Create account</a></p>
</div></main>`,
  "register.liquid": `<main class="section"><div class="container reveal" style="max-width:420px">
  <div class="center"><h1>Create account</h1></div>
  {%- form 'create_customer' -%}
    <input type="text" name="customer[first_name]" placeholder="First name" style="display:block;width:100%;margin:.5rem 0;padding:.6rem">
    <input type="text" name="customer[last_name]" placeholder="Last name" style="display:block;width:100%;margin:.5rem 0;padding:.6rem">
    <input type="email" name="customer[email]" placeholder="Email" required style="display:block;width:100%;margin:.5rem 0;padding:.6rem">
    <input type="password" name="customer[password]" placeholder="Password" required style="display:block;width:100%;margin:.5rem 0;padding:.6rem">
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
    <input type="password" name="customer[password]" placeholder="New password" required style="display:block;width:100%;margin:.5rem 0;padding:.6rem">
    <input type="password" name="customer[password_confirmation]" placeholder="Confirm" required style="display:block;width:100%;margin:.5rem 0;padding:.6rem">
    <button class="btn btn--block btn--terracotta" type="submit">Reset</button>
  {%- endform -%}
</div></main>`,
  "activate_account.liquid": `<main class="section"><div class="container reveal" style="max-width:420px"><div class="center"><h1>Activate account</h1></div>
  {%- form 'activate_customer_password' -%}
    <input type="password" name="customer[password]" placeholder="Password" required style="display:block;width:100%;margin:.5rem 0;padding:.6rem">
    <input type="password" name="customer[password_confirmation]" placeholder="Confirm" required style="display:block;width:100%;margin:.5rem 0;padding:.6rem">
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
    <input type="password" name="password" placeholder="Password" style="padding:.6rem 1rem;border-radius:999px;border:1px solid rgba(0,0,0,.15)">
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
