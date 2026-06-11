# Little Town Playhouse → Shopify

This repo's static site has been ported into a **pixel-faithful custom Shopify theme**
in [`theme/`](theme/). Rebuild it any time with `node scripts/build-shopify-theme.js`
(the script is the source of truth — edit it, not the generated `theme/` files, if you
want changes to survive a rebuild).

---

## Phase 1 — Theme (DONE ✅)

The 7 pages are now a real Shopify theme:

| Static file | Shopify template | Public URL |
|---|---|---|
| `index.html` | `templates/index.liquid` | `/` |
| `play-pricing.html` | `templates/page.play-pricing.liquid` | `/pages/play-pricing` |
| `parties.html` | `templates/page.parties.liquid` | `/pages/parties` |
| `memberships.html` | `templates/page.memberships.liquid` | `/pages/memberships` |
| `fusion.html` | `templates/page.fusion.liquid` | `/pages/fusion` |
| `photo-gallery.html` | `templates/page.photo-gallery.liquid` | `/pages/photo-gallery` |
| `visit-us.html` | `templates/page.visit-us.liquid` | `/pages/visit-us` |

- Shared head/header/footer live once in `layout/theme.liquid` + `sections/header.liquid` + `sections/footer.liquid`.
- The header nav highlights the current page automatically (via `request.path`).
- Each page keeps its exact `<title>`, meta description and page-specific CSS.
- All CSS/JS/56 images are in `theme/assets/` with paths rewritten for Shopify's flat asset folder.
- Commerce + system templates (`product`, `cart`, `collection`, `search`, `404`, customer accounts, password page, gift card) are included so the theme is valid and pushable.

---

## Phase 3 — Push the theme to the store (do this next)

You have a store already. From this repo:

```bash
# 1. Install Shopify CLI (one-time)
npm install -g @shopify/cli@latest

# 2. Push as an UNPUBLISHED draft using a Theme Access password (non-interactive).
#    (Newer stores use Shopify's Dev Dashboard; Theme Access is the simplest token.)
cd theme
shopify theme push --unpublished --store your-store.myshopify.com --password shptka_xxx
```

This uploads it as a **draft** so nothing changes. Preview from
**Online Store → Themes → (the new theme) → Preview**.

> **Ordering note:** Shopify only lists the custom `page.*` templates in the page editor's
> "Theme template" dropdown for the **published** theme. On a brand-new store that's still
> behind its password page, it's safe to **publish the Little Town theme now** (the store
> stays private until you pick a plan + remove the password). So the practical order is:
> push → publish → create products → create pages.

### Then, in the Shopify admin (required for the pages to render):

Each of the 6 sub-pages needs a Page record pointing at its template:

1. **Online Store → Pages → Add page** — create one page per row below.
   Set the **title**, then under **Theme template** pick the matching suffix, and make
   sure the **handle** (Edit website SEO → URL) matches exactly:

   | Page title | Template to select | Handle must be |
   |---|---|---|
   | Play & Pricing | `page.play-pricing` | `play-pricing` |
   | Parties | `page.parties` | `parties` |
   | Memberships | `page.memberships` | `memberships` |
   | Fusion | `page.fusion` | `fusion` |
   | Photo Gallery | `page.photo-gallery` | `photo-gallery` |
   | Visit Us | `page.visit-us` | `visit-us` |

   (Page body content can stay empty — the design is baked into the template.)

2. The homepage (`index.liquid`) is automatic — no Page record needed.
3. **Online Store → Navigation** — the theme links to `/pages/<handle>` directly, so the
   built-in header works as soon as the handles above match. (Optional: also wire the
   admin "Main menu" if you later switch the header to a dynamic menu.)
4. Publish the theme when you're happy: **Themes → Actions → Publish**.

---

## Phase 2 — Make the "Buy" buttons real commerce

The buttons are **already wired in the theme** — they link to product pages by handle.
You just need to create the products with the exact handles below, and the buttons light up.
The included `product.liquid` is subscription-aware: it shows a variant picker (the
child-count tiers), a subscription plan selector, and a working Add-to-cart → Shopify checkout.

### A. Day Pass + Household Family Pass → ordinary Products
1. **Products → Add product**: create two products.
   - **Day Pass** — price **$18**, URL handle **`day-pass`**.
   - **Household Family Pass** — price **$75**, URL handle **`household-family-pass`**.
     (Good for 2+ kids who live in the same household.)
2. For each: turn **off** "Track quantity" (unlimited) and **uncheck** "This is a physical
   product" (no shipping).
3. ✅ Buttons already point at `/products/day-pass` and `/products/household-family-pass`
   (on the home page and the Play & Pricing page). The theme also still recognizes a
   legacy `play-pack` handle, so a renamed existing product keeps working.

### B. Membership → Shopify Subscriptions (chosen)
We're modelling the 6 tiers as **two subscription products**, each with **3 variants**
(child-count) and its own billing interval. The theme's Join buttons already point at them:

| Product | Handle (must match) | Billing | Variants → price |
|---|---|---|---|
| **Monthly Membership** | `monthly-membership` | every **1 month** | 1 Child $45 · 2 Children $70 · 3+ Children $95 |
| **Annual Membership** | `annual-membership` | every **12 months** | 1 Child $450 · 2 Children $700 · 3+ Children $950 |

Setup steps:
1. **Apps → Shopify App Store → install "Shopify Subscriptions"** (free, first-party).
2. Create the two products above. For each:
   - Add an **option** named e.g. "Children" with values **1 Child / 2 Children / 3+ Children**,
     then set each variant's price per the table.
   - Turn **off** "Track quantity" and **uncheck** "physical product".
   - Set the **URL handle** exactly as in the table (Edit website SEO → URL).
3. In **Shopify Subscriptions → Subscriptions**, create a plan for each product:
   - Monthly Membership → "Deliver/charge every **1 month**".
   - Annual Membership → "Deliver/charge every **12 months**".
   - Apply the plan to **all variants** of that product. (No price adjustment needed —
     annual variant prices are already the discounted yearly totals.)
4. ✅ On the storefront, each membership product page now shows the child-tier dropdown +
   the subscription plan and a "Become a Member" button that subscribes through checkout.

> Note: the 6 Join buttons send the customer to the product page to pick their child-tier.
> If you'd rather each card jump straight to a pre-selected tier, after creating the
> products send me the variant IDs (or paste `?variant=<id>` onto each button) and I'll
> wire one-click tiers.

### C. Parties → custom calendar → Shopify checkout (NO app, $0)
Books parties end-to-end with a **custom calendar** — no booking app. Flow: pick a weekend
date on the calendar → pick a time → pick a package → Shopify checkout, paid in full,
all-sales-final. Built + live; needs only the product published (done).

1. **Product:** ONE `private-buyout` with variants **Little Town $185** / **Little Town +
   Fusion $295** (track-quantity off, physical off, published to Online Store). The build
   script splits variants by title (Fusion → $295), so no IDs to paste.
2. **How it works:** each package is a `<form>` POSTing to `/cart/add` (return_to=/checkout).
   The booking rides along as line-item properties:
   - `Party date and time` — human-readable (shows on order + email), e.g. "Saturday, June 13, 2026 · 4:30–6:30 PM".
   - `Party date` — `2026-06-13` (machine-readable, for Flow).
   - `Party time` — `4:30–6:30 PM` (machine-readable, for Flow).
   Calendar markup `.bk-cal`/`.bk-times` in `parties.html`; engine `partyBooking` in
   `main.js`; variant injection + the availability `<script>` in `build-shopify-theme.js`
   (`wireCommerce` `parties`). Slots are hard-coded (`SLOTS_BY_DOW` in `main.js`): Sat 4:30–6:30,
   Sun 1–3, Sun 4–6.

3. **Email on booking (Shopify-native):** Settings → Notifications → **Staff order
   notifications** → Add recipient → `littletownplayhousellc@gmail.com`. Every order emails
   that address; the party date/time is on the order. Customer also gets auto-confirmation.

4. **Date-blocking (Shopify Flow + shop metafield, $0):** the calendar greys out booked dates
   by reading a shop metafield. Set up once:
   1. **Metafield:** Settings → Custom data → **Metafields → Shop** → Add definition.
      Namespace+key `lt_booking.taken`, type **Single line text**. Leave value empty.
   2. **Flow** (Shopify Flow → Create workflow):
      - **Trigger:** Order created (or Order paid).
      - *(optional)* Condition: order contains product `Private Buyout`.
      - **Action: Update shop metafield** → `lt_booking` / `taken` / single line text.
        Value appends the new booking to the existing list (entries `YYYY-MM-DD|slot`,
        `;`-separated). Liquid sketch (finalize against your trigger's line-item vars):
        ```
        {{ shop.metafields.lt_booking.taken.value }};{{ <Party date prop> }}|{{ <Party time prop> }}
        ```
        Target stored value, e.g.: `2026-06-13|4:30–6:30 PM;2026-06-14|1:00–3:00 PM`
   3. The storefront reads `lt_booking.taken` on every load → `window.LT_BOOKED_RAW` →
      `partyBooking` greys out any date whose slots are all taken (partly-booked Sundays just
      hide the taken time). For multi-slot days (Sunday) the `Party time` string must match
      `SLOTS_BY_DOW` exactly to hide the right slot; single-slot days (Saturday) grey out on
      any booking for that date, so a Saturday time change can't un-block an existing order.

> **Residual race:** two people checking out the same slot in the same ~2-min window could
> both pay (Flow writes *after* the order). Near-zero at ~3 slots/week; all-sales-final +
> watching orders covers it. Only a booking app's slot-holds (or the date-as-inventory model)
> fully prevents it.

### D. Newsletter → email capture
The footer/newsletter signup should post to your email tool:
- **Shopify Email** (built-in) via a customer-signup form, or
- **Klaviyo / Mailchimp** app embed.

---

## Post-purchase email (order confirmation)

A branded order-confirmation email lives in [`notifications/order-confirmation.liquid`](notifications/order-confirmation.liquid).
It fires automatically after **every** checkout (day pass, household pass, membership,
party buyout) and includes a thank-you, a "Check-In Pass" QR, a "questions? see Fusion"
block, and a before-you-visit checklist. Install it once via **Settings → Notifications
→ Order confirmation → Edit code → paste**. Full steps + the QR explanation are in
[`notifications/README.md`](notifications/README.md). This template is admin-managed, so
it is **not** part of `shopify theme push`.

The email's QR opens a **check-in page** that plays a "peep" and shows "✓ checked in"
when the customer taps it on arrival. That page *is* in the theme
(`templates/page.check-in.liquid`, built by the script), so after pushing the theme,
add one more Page: title *Check in*, handle **`check-in`**, template **`page.check-in`**
(same Add-page flow as the table above). Preview locally via
[`notifications/check-in-preview.html`](notifications/check-in-preview.html).

## Notes / gotchas
- **Images / performance.** Run `npm install` once, then `npm run build` (which runs
  `optimize:img` → `build:theme`). `scripts/optimize-images.js` recompresses every raster in
  `assets/img/` in place and generates a `.webp`/`.avif` responsive ladder for the rendered
  photos; the marketing pages use `<picture>` to serve them. **When you add or replace a photo,
  re-run `npm run optimize:img`** so its ladder exists before you reference new `-600/-900/-1200`
  variants. The theme build also minifies the shipped CSS (source CSS in `assets/css/` stays
  readable). The optimizer is idempotent (cached via `scripts/.img-cache.json`).
- The old `.github/workflows/deploy.yml` still publishes the original static prototype to
  GitHub Pages. That's independent of Shopify — keep it as a reference preview or delete it.
- Social links in the footer are still `#` placeholders — drop in the client's real
  Instagram/Facebook URLs.
- Phone + email in the footer are now real `tel:` / `mailto:` links.
- The iOS SVG-animation enhancement (`main.js`) relies on `fetch()` to the Shopify CDN;
  it degrades gracefully to static images if a request is blocked.
