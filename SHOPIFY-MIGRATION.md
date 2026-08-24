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

Each of the 7 sub-pages needs a Page record pointing at its template:

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
   | Visitor Agreement & Waiver | `page.terms` | `terms` |

   (Page body content can stay empty — the design is baked into the template.)

   ⚠ **`terms` is not optional.** The agreement box that gates every buy button
   links to `/pages/terms`, as does the footer. If that Page record doesn't exist,
   customers get a 404 when they try to read what they're agreeing to.

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

### A. Day Pass → one Product with child-count variants
The Household Family Pass is **gone** — it's folded into the Day Pass as a size dropdown.
Create **one** product:
   - **Day Pass** — URL handle **`day-pass`**.
   - Add an **option** named "Children" with **3 values**, then set each variant's price:
     **1 Child $10 · 2 Children $18 · 3+ Children $25**. (Match the value labels closely —
     the theme resolves each tier by title `1 Child` / `2 Children` / `3+ Children`, then
     falls back to variant order, so keep them in that order.)
   - Turn **off** "Track quantity" (unlimited) and **uncheck** "This is a physical product"
     (no shipping).
2. ✅ The Play & Pricing + home cards show a **How many children?** dropdown; picking a tier
   updates the price and sends "Buy Day Pass" straight to that variant's checkout. Until the
   product + its 3 variants exist and are **published to Online Store**, a "Setup needed"
   banner shows on Play & Pricing and the button falls back to `/products/day-pass`.
3. 🗑️ If you already created a separate **Household Family Pass** / `play-pack` product,
   you can delete or unpublish it — nothing links to it anymore.

### B. Membership → Shopify Subscriptions (chosen)
We're modelling the 6 tiers as **two subscription products**, each with **3 variants**
(child-count) and its own billing interval. The theme's Join buttons already point at them:

| Product | Handle (must match) | Billing | Variants → price |
|---|---|---|---|
| **Monthly Membership** | `monthly-membership` | every **1 month** | 1 Child $40 · 2 Children $60 · 3+ Children $75 |
| **Annual Membership** | `annual-membership` | every **12 months** | 1 Child $350 · 2 Children $550 · 3+ Children $675 |

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

1. **Product:** ONE `private-buyout` with variants **Little Town $195** / **Little Town +
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

3. **Email on booking (Shopify-native):** Settings → Notifications → **Staff notifications**
   → Add recipient → `littletownplayhousellc@gmail.com`. Every order emails that address.
   Shopify's *default* staff template buries the line-item properties, so also paste
   `notifications/staff-order-notification.liquid` into the **New order** template — it
   leads with the party date/time in large type and puts it in the inbox preview line.
   Customer also gets auto-confirmation (`notifications/order-confirmation.liquid`).

4. **Date-blocking (Shopify Flow + shop metafield, $0) — ✅ BUILT AND CONFIRMED LIVE
   (2026-08-09).** The calendar greys out booked dates by reading a shop metafield. Needs a
   paid plan (Basic+) for Flow.

   > **Verified working**, so don't rebuild this — the live parties page was serving a
   > populated `lt_booking.taken` on 2026-08-09 with 6 real bookings in it, which is only
   > possible if the metafield exists, the `Order created` workflow fires, and the line-item
   > properties are landing on orders. Flow is therefore already on the plan.
   >
   > **To re-check at any time without an admin login** (reads the public storefront):
   > ```powershell
   > (Invoke-WebRequest 'https://thelittletownplayhouse.com/pages/parties' -UseBasicParsing).Content |
   >   Select-String 'LT_BOOKED_RAW\s*=\s*"([^"]*)"' | ForEach-Object { $_.Matches[0].Groups[1].Value -split ';' }
   > ```
   > Entries are in **order-placed** sequence, not date order — don't read it as a schedule.

   Setup steps kept below for reference / disaster recovery (verified against Shopify's
   current Flow docs 2026-07):
   1. **Metafield:** Settings → **Metafields and metaobjects** (older admin labels it
      *Custom data*) → **Shop** → Add definition. Set **Name** to anything, then **click Edit
      on the auto-generated Namespace and key and overwrite them to exactly `lt_booking` /
      `taken`** (they default to a slug of the Name — if you skip this the theme path
      `shop.metafields.lt_booking.taken` silently misses). Type **Single line text**. Save,
      then open the metafield and set an initial value (empty string / placeholder) so it's
      reliably selectable in Flow's pickers. Also enable **Storefronts** access in the
      definition's Access section — *harmless belt-and-suspenders, not the actual gate:* per
      Shopify's docs a **defined** metafield is readable in Online Store Liquid regardless of
      that toggle (it only governs the headless Storefront API). So the real requirement is
      that the definition exists; if the theme still reads blank, suspect a namespace/key typo
      or that no value was ever written — not the Storefronts toggle.
   2. **Flow** (Apps → Flow → Create workflow). NB the 2026 editor is a **vertical** canvas
      (redesigned Dec 2025); add each step with the **+** icon under the previous block, not a
      "Then" button:
      - **Trigger:** `Order created` (abandoned checkouts never become orders, so this only
        fires on completed/paid bookings).
      - *(optional, recommended)* Condition: `Order` → line items → **Product / Handle**,
        list operator **At least one of**, **is equal to** `private-buyout`. Skips
        day-pass/membership orders. The Value Liquid below is self-guarding too (returns the
        list unchanged when there's no `Party date`), so this only saves needless writes.
      - **Action: `Update shop metafield`** (the SHOP one — 9 near-identical metafield actions
        exist) → pick metafield `lt_booking.taken` from the dropdown (auto-fills
        Namespace/Key/Type). Paste the **Value** below — it builds the whole new list in ONE
        action (Flow can't chain appends reliably in a single run).
      - **CRITICAL — read the existing value as a variable, NOT via dot-notation.** Flow does
        **not** resolve `{{ shop.metafields.lt_booking.taken.value }}`; it returns blank and
        every order would then *overwrite* instead of append. In the Value field click
        **Add a variable** → **Shop** → **metafield** (singular, not "metafields") → select
        `lt_booking.taken` → **Add**. Flow inserts a token like `{{ shop.XXXX.value }}` and
        **auto-names the alias `XXXX` — you can't choose it**. Note that exact alias, then
        paste this and replace `REPLACE_WITH_ALIAS` on line 1 with it:
        ```liquid
        {%- assign existing = shop.REPLACE_WITH_ALIAS.value -%}
        {%- assign pdate = "" -%}
        {%- assign ptime = "" -%}
        {%- for lineItem in order.lineItems -%}
          {%- for ca in lineItem.customAttributes -%}
            {%- if ca.key == "Party date" -%}{%- assign pdate = ca.value -%}{%- endif -%}
            {%- if ca.key == "Party time" -%}{%- assign ptime = ca.value -%}{%- endif -%}
          {%- endfor -%}
        {%- endfor -%}
        {%- if pdate == blank -%}{{ existing }}{%- elsif existing == blank -%}{{ pdate }}|{{ ptime }}{%- else -%}{{ existing }};{{ pdate }}|{{ ptime }}{%- endif -%}
        ```
        Flow Liquid uses GraphQL camelCase: `order.lineItems` → `lineItem.customAttributes`
        (`.key`/`.value`) — never theme-style `line_items`/`properties`, and no `[0]` indexing.
        Target stored value, e.g.: `2026-06-13|4:30–6:30 PM;2026-06-14|1:00–3:00 PM`. The
        `{%- -%}` trim tags are load-bearing (a Single line text metafield rejects newlines).
        Don't retype the slot strings anywhere — they use an en-dash (`–`); the Liquid carries
        the order's exact value through so it matches `SLOTS_BY_DOW`.
   3. The storefront reads `lt_booking.taken` on every load → `window.LT_BOOKED_RAW` →
      `partyBooking` greys out any date whose slots are all taken (partly-booked Sundays just
      hide the taken time). For multi-slot days (Sunday) the `Party time` string must match
      `SLOTS_BY_DOW` exactly to hide the right slot; single-slot days (Saturday) grey out on
      any booking for that date, so a Saturday time change can't un-block an existing order.

> **Residual race:** two people checking out the same slot in the same ~2-min window could
> both pay (Flow writes *after* the order). Near-zero at ~3 slots/week; all-sales-final +
> watching orders covers it. Only a booking app's slot-holds (or the date-as-inventory model)
> fully prevents it.

5. **"Unfulfilled" on every order — expected, and optional to change.** Shopify tracks a
   fulfillment state on *every* order even when nothing ships, so buyouts, day passes and
   memberships all land as **Unfulfilled**. It's cosmetic — the customer was charged and got
   their confirmation either way. Three ways to play it:
   - **Leave it.** "Unfulfilled" then doubles as the upcoming-bookings list: mark each party
     fulfilled after it happens and the Orders page becomes a de-facto calendar. Given there
     is no owner-facing booking calendar, this is the useful default.
   - **Auto-fulfill store-wide.** **Settings → General → *Order processing*** (verified
     2026-08 — this section used to live under Settings → Checkout, older guides still say
     that) → tick **"Automatically fulfill the order's line items."** Safe here because
     nothing in this store ships. **Leave "Notify customers of their shipment" UNTICKED** —
     it sends a *shipping* email, which is nonsense for a party booking. The
     "even those with a high risk of fraud" sub-option should also stay off.
   - **Mark fulfilled by hand** on each order.

   Also confirm `private-buyout` has **"This is a physical product" unchecked** in the
   product's Shipping section. If it's checked, Shopify collects a shipping address at
   checkout and may apply shipping rates — a separate bug from the fulfillment status.

6. **Reminder emails 5 days + 1 day before each party (Shopify Flow, $0, no app).**
   ⛔ **SUPERSEDED — build [`integrations/party-calendar`](integrations/party-calendar/README.md) instead.**

   > 👉 **Do not build the three workflows below.** Each party now becomes a **Google Calendar
   > event** in the owner's own account, and Google does the reminders natively — so the tag
   > stamping, both scheduled robots and the manual tag backfill are all unnecessary. It also
   > finally answers the "no owner-facing booking calendar" gap noted in step 5: he gets a real
   > month view on his phone, with the customer's name, phone and package on each entry.
   >
   > That guide also adds the piece this section never had — an **`Order cancelled`** workflow
   > that removes the booking from `lt_booking.taken`, so a killed party frees its slot on the
   > website again instead of burning it permanently.
   >
   > **Everything below stays** as the fallback and as the reference for Flow's Liquid quirks
   > (the auto-named metafield alias, `getOrderDataForeachitem`, camelCase GraphQL paths) —
   > all still accurate, and the calendar integration's HTTP action is built on the same rules.

   > 👉 The plain-English walkthrough for the superseded approach is
   > [`FLOW-REMINDERS-SETUP.md`](FLOW-REMINDERS-SETUP.md). The notes below are the reasoning and
   > the reference copy of the Liquid.

   Shopify has no native "email me X days before a date on an order" trigger, so this is
   three Flow workflows. Verified against Flow docs 2026-08. Requires Basic plan+ (same
   requirement as the date-blocking Flow above).

   **Why a tag is needed.** The party date lives in a *line-item property*, and Shopify's
   order search **cannot** query line-item properties. So the booking date is copied onto
   the order as a **tag** at checkout, and the scheduled reminders search by that tag.

   **Workflow 1 — stamp the date as a tag (`Order created`).** Add this to the *existing*
   Order-created workflow from step 4 (it already has the right trigger — just add another
   action underneath the metafield write), or build it standalone.
   - Trigger: **Order created**
   - Condition (recommended): `Order` → line items → **Product / Handle**, **At least one
     of**, **is equal to** `private-buyout`. Without it, every day-pass order runs this.
   - Action: **Add order tags** → Tags value:
     ```liquid
     {%- assign pdate = "" -%}
     {%- for lineItem in order.lineItems -%}
       {%- for ca in lineItem.customAttributes -%}
         {%- if ca.key == "Party date" -%}{%- assign pdate = ca.value -%}{%- endif -%}
       {%- endfor -%}
     {%- endfor -%}
     {%- if pdate != blank -%}party-{{ pdate }}{%- endif -%}
     ```
     Produces a tag like `party-2026-06-13`. Same camelCase Flow-Liquid rules as step 4
     (`order.lineItems` / `customAttributes`, never `line_items` / `properties`).

   **Workflows 2 & 3 — the reminders (`Scheduled time`).** Build these as **two separate
   workflows**, identical except for the interval and wording. Two workflows rather than one
   with two branches: each gets its own subject line and run history, so when one misfires
   you can see which.
   - Trigger: **Scheduled time** → **Daily**, around **8:00 AM** store time (it's a
     business-hours heads-up, not a 3 AM one). `scheduledAt` resolves in the store's timezone.
   - Action: **Get order data** → Query:
     ```
     tag:'party-{{ scheduledAt | date_plus: "5 days" | date: "%Y-%m-%d" }}' AND NOT status:cancelled
     ```
     For the 1-day workflow use `date_plus: "1 day"`. `date_plus` is a Flow-specific Liquid
     tag; `scheduledAt` only exists on Scheduled-time workflows.
   - Action: **For each** over the returned order list → inside the loop, **Send internal
     email**:
     - **Email address:** `littletownplayhousellc@gmail.com` (comma-separate for more —
       this field does **not** accept variables, it must be a literal address)
     - **Subject:** `Party in 5 days — {{ order.name }}` *(→ "Party TOMORROW —" on the 1-day one)*
     - **Message:** pull the human-readable slot back off the line item. Note the loop
       variable is **`getOrderDataForeachitem`**, not `order` — Flow auto-names it and won't
       let you choose (confirmed on this store 2026-08-09):
       ```liquid
       {%- assign pwhen = "" -%}
       {%- for lineItem in getOrderDataForeachitem.lineItems -%}
         {%- for ca in lineItem.customAttributes -%}
           {%- if ca.key == "Party date and time" -%}{%- assign pwhen = ca.value -%}{%- endif -%}
         {%- endfor -%}
       {%- endfor -%}
       {%- if pwhen != blank -%}
       Party coming up: {{ pwhen }}
       {%- else -%}
       Party coming up — date is in the tags: {{ getOrderDataForeachitem.tags }}
       {%- endif %}
       Order {{ getOrderDataForeachitem.name }}
       ```
       ⚠️ The picker also offers **`getOrderData`** — that's the whole *list*, not one order.
       Picking it fails silently.

   **Gotchas — read before trusting it:**
   - **Flow auto-names loop/step variables and you can't choose them** (same trap as the
     metafield alias in step 4). Inside the **For each**, the order may be exposed under a
     Flow-assigned name rather than `order` — build the Message with Flow's **variable
     picker** instead of pasting `order.` blind, then check a real run.
   - **Verify with run history, not the editor.** Apps → Flow → the workflow → **Runs** shows
     the *resolved* query string. If it reads `tag:'party-'` with no date, the
     `| date: "%Y-%m-%d"` format step is the thing to fix — that's the one piece of syntax
     most likely to need adjusting.
   - **Only tags orders placed after Workflow 1 is switched on.** Any party already booked
     will never fire a reminder. Tag those by hand: open the order → Tags → add
     `party-YYYY-MM-DD` matching its date. See the backfill checklist below — this is not
     hypothetical, there are already bookings on the books.
   - **A refund alone doesn't stop the reminder** — the tag survives. `NOT status:cancelled`
     only filters properly *cancelled* orders, so cancel (don't just refund) a killed booking.
   - **Get order data caps at 100 orders per run.** Irrelevant at ~3 slots/week — one date
     returns one or two orders.
   - Internal emails send from your store's sender address and may show as
     `store+<shop-id>@shopifyemail.com` until the sending domain is authenticated.

   > Flow is confirmed on the plan (see step 4), so the plan-tier fallback isn't needed.
   >
   > The "month view the owner can actually look at" this note used to describe as a manual
   > alternative is now **built and automatic** —
   > [`integrations/party-calendar`](integrations/party-calendar/README.md). A Google Calendar
   > event per booking, created at checkout, with the reminders set on the event. That's the
   > reason this whole section is superseded.

   #### ⚠️ Backfill checklist — tag the 6 existing bookings
   Snapshot of `lt_booking.taken` taken **2026-08-09**. These orders predate the tagging
   action, so **none of them will fire a reminder until tagged by hand.** For each: Orders →
   open it → **Tags** → add the tag → Save.

   **Hard deadline: 2026-08-18** — that's the 5-day ping for the Aug 23 party. Everything
   below must be tagged, and both scheduled workflows live, before that date.

   | ☐ | Party date | Day | Tag to add | 5-day ping | 1-day ping |
   | --- | --- | --- | --- | --- | --- |
   | ☐ | 2026-08-23 | Sunday | `party-2026-08-23` | **Aug 18** | Aug 22 |
   | ☐ | 2026-09-13 | Sunday | `party-2026-09-13` | Sep 08 | Sep 12 |
   | ☐ | 2026-09-20 | Sunday | `party-2026-09-20` | Sep 15 | Sep 19 |
   | ☐ | 2026-09-27 | Sunday | `party-2026-09-27` | Sep 22 | Sep 26 |
   | ☐ | 2026-10-10 | Saturday | `party-2026-10-10` | Oct 05 | Oct 09 |
   | ☐ | 2026-10-11 | Sunday | `party-2026-10-11` | Oct 06 | Oct 10 |

   Finding each order: the metafield stores only date + slot, not the order number. Search
   Orders for the `Private Buyout` product and match on the **Party date** line-item property
   shown under the line item. All 6 slot times above are valid `SLOTS_BY_DOW` values, so if
   an order's property doesn't match one of these rows, flag it rather than guessing.

   Re-run the PowerShell one-liner in step 4 before starting — if the list has grown since
   2026-08-09, the newer bookings need tagging too (and any placed *after* the tagging action
   goes live will already be tagged, so check before double-tagging).

### D. Newsletter → email capture
The footer/newsletter signup should post to your email tool:
- **Shopify Email** (built-in) via a customer-signup form, or
- **Klaviyo / Mailchimp** app embed.

---

## Post-purchase email (order confirmation)

A branded order-confirmation email lives in [`notifications/order-confirmation.liquid`](notifications/order-confirmation.liquid).
It fires automatically after **every** checkout (day pass, membership,
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

---

## Purchase agreement gate (customers must accept before they can buy)

Every buy button on the site is gated: clicking **Buy Day Pass**, any **Join
Monthly/Annual**, either **Book …** party button, the product-page Add-to-cart
fallback, or the cart's **Checkout** opens a small box with a summary of the
agreement, a link to the full text, and a checkbox. The **Agree & continue**
button stays disabled until the box is ticked — there is no path to Shopify
checkout on this site that skips it.

**Where the wording lives — edit both, together:**

| What | File | Notes |
|---|---|---|
| The short summary in the box | `assets/js/main.js` → `var AGREEMENT` | 4 bullets + the checkbox label |
| The full agreement | `terms.html` | The real Participant Agreement, 21 sections |
| Version stamp | `assets/js/main.js` → `AGREEMENT_VERSION` | Bump on **every** wording change |

**The agreement was adapted for one-checkbox acceptance.** It arrived written as a
paper form with blanks, so four things changed and nothing else:

1. Every *"listed below"* / *"identified below"* → *"in my care"* / *"I bring to
   the facility"*, since there is no place online to list children.
2. §16 photography: the two *"select one"* boxes are gone. It now says plainly
   that accepting **does not** give photo authorization, and that it's given or
   withdrawn in person or by email — so the single checkbox never bundles an
   optional consent that §16 says is not a condition of admission.
3. §17 and §21: *"signature"* / *"BY SIGNING BELOW"* → checkbox acceptance
   wording. §17 already treated a checkbox as a valid electronic signature.
4. §9: *"signing this Agreement"* → *"accepting this Agreement"*.

Every substantive clause — the release (§10), indemnification (§11), assumption
of risk (§9), medical authorization (§12), Illinois law and Wayne County venue
(§18) — is unchanged. Worth an attorney or insurer pass before it goes live.

**Proof of acceptance lands on the order.** When a customer agrees, the acceptance
is written as an `Agreement` **cart attribute** (`Accepted <ISO timestamp>
(v<version>)`), and — for the party and product forms — additionally as an
`Agreement` **line-item property**. Both are visible on the order in the Shopify
admin, so every order carries a record of which version of the agreement was
accepted and when. Bumping `AGREEMENT_VERSION` is what keeps old acceptances
distinguishable from new ones.

**Limits, stated plainly.** This is a front-of-site gate. It stops customers
using the site normally, and it records their acceptance — but it is enforced in
the browser, so someone who deliberately disables JavaScript or pastes a
`/cart/…` permalink straight into the address bar can still reach checkout.
Closing that off completely would need a Shopify checkout UI extension, which
requires Shopify Plus. For a play café this front-of-site gate plus the on-order
record is the normal, proportionate setup.

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
