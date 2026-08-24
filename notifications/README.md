# Post-purchase emails

Two templates, both pasted into the Shopify admin (neither is pushed by `shopify theme push`):

| File | Goes to | Admin location |
| --- | --- | --- |
| [`order-confirmation.liquid`](order-confirmation.liquid) | the **customer** | Settings → Notifications → *Order confirmation* |
| [`staff-order-notification.liquid`](staff-order-notification.liquid) | **Little Town** | Settings → Notifications → *Staff notifications* → **New order** |

---

# Staff notification — "there's a new party on <date>"

Shopify's default staff email does not put the party date anywhere you can see it on a
phone. This replacement leads with it: the **date & time is the biggest thing in the
email**, in a bordered banner above the customer and order details, and it's also the
hidden preview text — so the date shows in the inbox list *before* you even open it.

It reads the booking off the order's line-item properties written by the calendar on
`/pages/parties` (`Party date and time`, `Party date`, `Party time` — see
[`../SHOPIFY-MIGRATION.md`](../SHOPIFY-MIGRATION.md) §C). Non-party orders (day passes,
memberships) skip the banner and just render as a normal order summary.

If a party order ever arrives with no date attached, the banner says **"⚠️ NOT ON THIS
ORDER — call the customer"** rather than rendering blank, so it can't fail silently.

## Install (2 minutes, one time)
1. Shopify admin → **Settings → Notifications**.
2. Scroll to **Staff notifications** → confirm `littletownplayhousellc@gmail.com` is a
   recipient (**Add recipient** if not — without this, nobody gets order emails at all).
3. Open the **New order** template → **Edit code** (`</>`) → select all → delete.
4. Paste the entire contents of `staff-order-notification.liquid`. **Save**.

> **Testing gotcha:** Shopify's **Send test** button sends a *fake sample order* that has
> no line-item properties on it — so a test email will always show the ⚠️ fallback instead
> of a date. That is not a bug. To verify for real, place a live party booking through
> `/pages/parties` (refund it afterwards).

The "View order in admin" button links to `{{ shop.url }}/admin/orders/{{ id }}`. If that
ever bounces, delete that one table block — nothing else depends on it.

---

# Customer email — Order confirmation

A branded, on-brand **Order confirmation** email for Little Town Playhouse.
It replaces Shopify's plain default and fires **automatically after every checkout** —
day pass, membership, or party buyout. No app, no extra cost.

Source of truth: [`order-confirmation.liquid`](order-confirmation.liquid).

## What it contains
- A warm **thank-you** hero with the customer's first name + order number.
- A **"Check-In Pass"** — a boarding-pass-style card with a scannable QR, the
  customer's name and order number printed below it.
- A **"Questions? We're right next door"** block that sends people to **Fusion**
  (the staffed sister café) — matching the no-front-desk / honor-system setup.
- A **"Good to know before you visit"** checklist: address, hours, socks-only,
  watch-your-own-child, the gated parent lounge, grown-ups play free.
- An itemized **order summary** + **"View your order"** button.
- **Smart banners**: a *party* order shows a "your party is booked" note (and, for
  the **+Fusion** tier, calls out the barista/café); a *membership* shows a
  "welcome to the family" note. The party's date & time print automatically from
  the order's line-item properties.

## How to install (2 minutes, one time)
1. Shopify admin → **Settings → Notifications**.
2. Open **Order confirmation** (under *Customer notifications*).
3. Click **Edit code** (`</>`), select **all** the existing HTML, delete it.
4. Paste the entire contents of `order-confirmation.liquid`. **Save**.
5. Click **Send test** (top right) to email yourself a preview. Open it on a phone
   and in Gmail/Apple Mail to confirm the QR and layout look right.

> Editing only changes *this one* template. To revert, Shopify has a
> **"Revert to default"** button on the same screen.

## The QR "check-in" — what happens when they scan it
A QR code can't make a sound by itself; it just holds a link. So the QR opens a tiny
**check-in page** in the theme, and *that page* does the "peep":

1. Customer scans the QR with their phone camera → it opens
   `https://your-store/pages/check-in?o=1001`.
2. The page shows a big **"🎟️ Tap to check in"** button.
3. They tap → the phone plays a short two-tone **"peep"** (Web Audio — no sound file)
   + a quick vibrate, and the screen flips to **"✓ You're checked in!"** with their
   order number.

(The tap is needed because phones block auto-playing sound until the user interacts —
and it makes it feel more like a real turnstile check-in anyway.) It's a friendly
ritual: Little Town is unstaffed/honor-system, so nothing is actually validated, but
to the customer it looks and sounds like a legit sign-in. Only the **order number**
goes in the QR link — no name/PII is sent to the QR image host.

**Preview it now:** open [`check-in-preview.html`](check-in-preview.html) in any
browser and tap the button to hear the peep. (The live page sits behind the store's
"Opening soon" password until launch — enter the store password once to test it on
the real domain.)

### One-time setup for the check-in page
The page is built into the theme by `scripts/build-shopify-theme.js`
(`templates/page.check-in.liquid` + `snippets/page-check-in.liquid`). After pushing the
theme, create its page in the admin like the other pages:

1. **Online Store → Pages → Add page.** Title it e.g. *Check in*.
2. **Edit website SEO → URL handle** must be exactly **`check-in`**.
3. **Theme template** → pick **`page.check-in`** (the full-screen, no-nav version).
4. Save. Test by visiting `/pages/check-in?o=1001`.

> If you forget step 3, it still works (the default page template renders the same
> check-in screen, just with the site header/footer around it).

**Want a different sound?** Tweak the two `tone(freq, start, dur)` calls in
`page-check-in.liquid` (in the build script) — e.g. `tone(660,…)`/`tone(990,…)` for a
lower chime. Rebuild with `node scripts/build-shopify-theme.js`.

## Notes & gotchas
- **QR image host.** The QR is rendered by a free third-party service
  (`api.qrserver.com`). If it's ever down or images are blocked, the card shows a
  caption telling the customer their name + order number *are* the pass — so it never
  looks broken. A drop-in alternative is `https://quickchart.io/qr?text=...`.
- **Fonts.** Quicksand/Fraunces load in Apple Mail; Gmail/Outlook fall back to
  Trebuchet/Georgia (already wired). Either way it reads on-brand.
- **Subscriptions (memberships).** The initial purchase still triggers this Order
  confirmation. Monthly/annual *renewal* receipts are sent separately by the Shopify
  Subscriptions app and are not styled by this file.
- **Staff copy.** Add `littletownplayhousellc@gmail.com` under **Staff notifications** so
  the shop is alerted on every order, and install
  [`staff-order-notification.liquid`](staff-order-notification.liquid) on the **New order**
  template so the party date is actually legible in that email (see above).
- This template lives in the **admin**, not the theme — it is *not* pushed by
  `shopify theme push`. Keep this repo copy in sync if you edit it in the admin.
