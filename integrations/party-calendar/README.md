# Parties → Google Calendar

Every paid buyout lands on a **Little Town Parties** Google Calendar in the owner's own
account, with the customer's name, phone and package on it, and reminders 5 days / 1 day /
2 hours out. Cancelled parties remove themselves.

> This is the reference copy. The setup itself is walked through live — see the
> `feedback_walkthrough-not-docs` note. Don't hand this file to the owner.

## How it works

Shopify emails him the staff **new order** notification on every sale. That template
([`../../notifications/staff-order-notification.liquid`](../../notifications/staff-order-notification.liquid))
carries one machine-readable line starting `LTPCAL1|`. The script wakes up every 15 minutes,
finds those lines in Gmail, and builds an event from each.

No webhook, therefore no web app, therefore **no deployment** — which is what kept the owner
out of the script editor entirely.

Cancellations work off the storefront's own availability list (`LT_BOOKED_RAW`, which Flow
maintains): a future event whose slot has left that list has been cancelled.

## The owner's whole involvement — 4 clicks, no typing

1. Click the copy link you send him
2. **Make a copy**
3. Menu: **🎉 Little Town → Set up my party calendar**
4. **Allow** (via *Advanced → Go to… (unsafe)* — normal for a private script)

He owns the sheet, the script and the calendar. Nothing breaks if you part ways.

## Your prep

1. New Google Sheet in **your** account → **Extensions → Apps Script**
2. Paste [`Code.gs`](Code.gs), save
3. Back in the sheet: **Share** → add his address as Viewer
4. Take the sheet URL and replace everything after the id with **`/copy`** — that's the link
   you send him

Then run `runSelfTest` once from your own copy to confirm the calendar and date maths work
before he ever sees it.

### Prerequisites (both yours)

- **The staff notification template must be installed**, since the `LTPCAL1|` line is the
  data source. Shopify admin → Settings → Notifications → Staff notifications → New order.
  See [`../../notifications/README.md`](../../notifications/README.md). Also confirm
  `littletownplayhousellc@gmail.com` is a recipient, or no email arrives at all.
- **For cancellations to work**, Flow must remove the slot from `lt_booking.taken` on
  `Order cancelled` — see below. Without it nothing is ever pruned (which fails safe: stale
  events, never lost ones).

## Shopify: free the slot when an order is cancelled

Flow only ever *appended* to `lt_booking.taken`, so a cancelled party used to burn its slot
permanently. New workflow, trigger **`Order cancelled`**, one action:

**`Update shop metafield`** (the **Shop** one) → metafield `lt_booking.taken`. Read the
current value with **Add a variable → Shop → metafield** (Flow names the alias itself and
won't let you choose — note it), then paste as the **Value**, replacing `REPLACE_WITH_ALIAS`:

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
{%- assign target = pdate | append: "|" | append: ptime -%}
{%- assign out = "" -%}
{%- assign parts = existing | split: ";" -%}
{%- for part in parts -%}
  {%- unless part == target and pdate != blank -%}
    {%- if out == blank -%}{%- assign out = part -%}{%- else -%}{%- assign out = out | append: ";" | append: part -%}{%- endif -%}
  {%- endunless -%}
{%- endfor -%}
{{ out }}
```

Mirror image of the append Liquid on `Order created`. Matches on date **and** time so
cancelling the Sunday 1–3 party doesn't also free the Sunday 4–6 one. The `{%- -%}` trim tags
are load-bearing (a Single line text metafield rejects newlines). Never retype the slot
strings — they use an en dash.

> Refunding is not cancelling. Properly **Cancel** the order.

## Things worth knowing

- **`backfillExistingBookings()`** is pre-filled with the 6 parties live as of 2026-08-09,
  each checked against `SLOTS_BY_DOW`. Most will arrive via Gmail anyway; this covers any
  whose order email predates the `LTPCAL1` line.
- **Timezone is worked out per party**, so a copied sheet on any default is still correct in
  both CDT and CST. Verified against hosts on Chicago, UTC, Tokyo and Los Angeles.
- **The booking line is read from both the HTML and plain-text bodies**, whichever survives
  intact — Gmail hard-wraps long lines in plain text and would otherwise chop it in half.
- **Events are tagged with the order id**, so a re-read updates the same event rather than
  duplicating it. Every run re-scans the last year; that's deliberate and self-healing.
- **Failures email him**, throttled to once per 6 hours per distinct problem. Without that a
  broken sync would be silent.
- **`showStatus()`** ("Is it working?" in the menu) answers the question in plain English.
- Supersedes the Flow reminder workflows — see the ⛔ banners in
  [`../../FLOW-REMINDERS-SETUP.md`](../../FLOW-REMINDERS-SETUP.md) and `SHOPIFY-MIGRATION.md` §C.
