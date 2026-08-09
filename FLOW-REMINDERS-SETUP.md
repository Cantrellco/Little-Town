# Party reminder emails — plain-English setup guide

> ## ⛔ SUPERSEDED — build [`integrations/party-calendar`](integrations/party-calendar/README.md) instead
>
> Everything below exists for one reason: Shopify can't search line-item properties, so the
> party date had to be smuggled onto a **tag** to become findable, and then two scheduled
> robots had to go hunting for those tags every morning.
>
> **Google Calendar does reminders natively.** Putting each party on a calendar makes all
> three workflows here unnecessary — the tag stamping (Part 1), the 5-day robot (Part 2), the
> 1-day robot (Part 3) and the manual backfill (Part 4). It also gives the owner the month
> view Shopify has never provided, on the phone he already carries.
>
> The **2026-08-18 deadline** below is still real (it's the 5-day mark for the Aug 23 party),
> and the calendar route covers it — Part 4 of that guide backfills all 6 existing bookings,
> Aug 23 included.
>
> **Keep this file** as the fallback if the calendar route is ever abandoned, and for the Flow
> Liquid patterns, which are still accurate and still useful.

**Goal:** Little Town gets an email **5 days before** every party, and again **1 day before**.

You will do all of this by clicking in the Shopify admin. Nothing here touches the website
code. Total time: about 20 minutes.

---

## ✅ AS BUILT — 2026-08-09

All of this was set up on 2026-08-09. Kept below as the record of what exists and how to
rebuild it. What's live now:

- **Tag stamp** — added as a final `Add order tags` action on the pre-existing
  `Order created` workflow (still named **"New Workflow"** in the Flow list).
- **5-day reminder** — new `Scheduled time` workflow, daily 8:00 AM. Query entered via the
  **Advanced** option ("Write a query for custom use cases") — the presets can't search tags.
  Loop added via **Repeat for each item**.
- **1-day reminder** — a **Duplicate** of the 5-day workflow with `"5 days"` → `"1 day"` and
  the subject changed.
- **6 backfill tags** — applied by hand to the parties booked before the stamp existed.

**⚠️ One thing was deliberately skipped: the live test booking.** Nobody has yet confirmed
that the tag stamp fires automatically on a new order — that would have meant a real charge
and would have blocked a live slot in the availability metafield.

**So the open item is:** on the **next real party booking**, open the order and check the
**Tags** field shows `party-YYYY-MM-DD`.
- ✅ Present → automatic stamping works, nothing more to do, ever.
- ❌ Missing → the Part 1 Liquid needs fixing; until then every new booking must be tagged
  by hand or it gets no reminders.

The 6 backfilled parties (through 2026-10-11) are unaffected either way — they're tagged
manually, so their reminders don't depend on the stamp working.

**First email expected: 2026-08-18** (5-day warning for the 2026-08-23 party). Silence before
then is correct.

---

## First — what are we actually building?

Read this bit. It makes the clicking make sense.

When someone books a party, the date they picked gets tucked **inside** the order, attached
to the product line, like a note stapled inside a folder.

The problem: **Shopify cannot search those stapled notes.** So there's no way to ask Shopify
"which parties are happening in 5 days?" It simply can't answer.

So we use a trick:

1. **When an order comes in, stamp the date on the OUTSIDE of the folder.** In Shopify that
   outside label is called a **tag**. We'll stamp `party-2026-08-23` on it.
   Shopify *can* search tags. That's the whole point.
2. **Every morning, a robot checks the tags.** It asks: "any folder tagged with the date
   5 days from today?" If yes → email Little Town.
3. **A second robot does the same for tomorrow.**

That's it. Three things to build:

| # | What | Why |
| --- | --- | --- |
| 1 | Stamp the tag when an order comes in | so the date is searchable |
| 2 | Morning robot: "anything 5 days out?" | the 5-day email |
| 3 | Morning robot: "anything tomorrow?" | the 1-day email |

Then one cleanup job: **6 parties are already booked** and never got stamped, so we stamp
those 6 by hand.

> **Where is all this?** Shopify admin → left sidebar → **Apps** → **Flow**.
> Flow is already installed and already running one workflow for this site, so you're not
> starting from zero.

---

## Part 1 — Stamp the tag on new orders

You are **adding one step to a workflow that already exists.** Not building a new one.

1. Shopify admin → **Apps** → **Flow**.
2. You'll see a list of workflows. Open the one triggered by **Order created** — it's the one
   that updates party availability (it writes `lt_booking.taken`).
3. You're now looking at a vertical flowchart: a trigger box at top, then boxes below it.
4. Find the **last box** in the chain. Under it there's a **＋** icon. Click it.
5. Choose **Action**.
6. Search for **`Add order tags`**. Click it.
7. There's a **Tags** field. Paste exactly this:

   ```liquid
   {%- assign pdate = "" -%}
   {%- for lineItem in order.lineItems -%}
     {%- for ca in lineItem.customAttributes -%}
       {%- if ca.key == "Party date" -%}{%- assign pdate = ca.value -%}{%- endif -%}
     {%- endfor -%}
   {%- endfor -%}
   {%- if pdate != blank -%}party-{{ pdate }}{%- endif -%}
   ```

   *(In plain terms: "look through the order, find the note that says **Party date**, and
   make a tag out of it." If it's not a party order, it makes no tag at all.)*
8. Click **Save**, then make sure the workflow is **turned on** (toggle at the top right).

### Prove it works before moving on
Don't skip this — everything else depends on this step being right.

1. Go to your live site's parties page, book any slot, complete checkout.
2. Shopify admin → **Orders** → open that order.
3. Look at the **Tags** area. You want to see something like **`party-2026-09-05`**.
4. **Refund and cancel** that test order when you're done.

- ✅ Tag is there → carry on to Part 2.
- ❌ No tag → the workflow is off, or the Liquid didn't paste cleanly. Check **Runs** (see
  Part 5) before continuing.

---

## Part 2 — The 5-day robot

Now a brand-new workflow.

1. Apps → **Flow** → **Create workflow**.
2. Click **Select a trigger** → search **`Scheduled time`** → pick it.
3. Set it to run **Daily**, at **8:00 AM**. (Morning, so it's a useful heads-up during
   business hours.)
4. Click the **＋** under the trigger → **Action** → search **`Get order data`**.
5. In its **Query** field, paste exactly:

   ```
   tag:'party-{{ scheduledAt | date_plus: "5 days" | date: "%Y-%m-%d" }}' AND NOT status:cancelled
   ```

   *(Plain terms: "find orders tagged with the date that is 5 days from today, ignoring
   cancelled ones.")*
6. Click the **＋** under that → choose **For each** (it may be listed under "For each loop").
   Point it at the list of orders that **Get order data** returned.
7. Click the **＋** *inside* the For-each box → **Action** → search **`Send internal email`**.
8. Fill it in:
   - **Email address:** `littletownplayhousellc@gmail.com`
     *(type it literally — this field does NOT accept variables)*
   - **Subject:** `Party in 5 days`
   - **Message:** paste:

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
     Party coming up — check the order, date is in the tags: {{ getOrderDataForeachitem.tags }}
     {%- endif %}
     Order {{ getOrderDataForeachitem.name }}
     ```

   > **Why `getOrderDataForeachitem` and not `order`:** Flow auto-names the loop variable and
   > won't let you choose it. Confirmed on this store 2026-08-09 via the variable picker.
   > Two similar names appear in the picker — **`getOrderDataForeachitem`** is the single
   > order inside the loop (correct); **`getOrderData`** is the whole list (wrong, and fails
   > silently). If Flow ever renames it, read the real name off the **Add a variable** picker
   > rather than guessing.
9. **Save**, and **turn the workflow on**.

---

## Part 3 — The 1-day robot (the easy one)

Don't build this from scratch. Copy the one you just made.

1. In the Flow workflow list, find your 5-day workflow.
2. **More actions** → **Duplicate**.
3. Open the copy and change exactly **two** things:
   - In the **Get order data** query, change `"5 days"` → `"1 day"`
   - Change the **Subject** to `Party TOMORROW`
4. **Save**, and **turn it on**.

---

## Part 4 — Stamp the 6 parties already booked

These were booked before the tag stamp existed, so they have no tag and **will never trigger
a reminder** until you add one by hand.

For each row: **Orders** → open the order → **Tags** → type the tag → **Save**.

| ☐ | Party date | Day | Tag to type |
| --- | --- | --- | --- |
| ☐ | 2026-08-23 | Sunday | `party-2026-08-23` |
| ☐ | 2026-09-13 | Sunday | `party-2026-09-13` |
| ☐ | 2026-09-20 | Sunday | `party-2026-09-20` |
| ☐ | 2026-09-27 | Sunday | `party-2026-09-27` |
| ☐ | 2026-10-10 | Saturday | `party-2026-10-10` |
| ☐ | 2026-10-11 | Sunday | `party-2026-10-11` |

**How to find each order:** Orders → search/filter for the **Private Buyout** product. Open
each one and look under the product line for **Party date** — that tells you which row it is.

> ⏰ **Deadline: August 18, 2026.** That's 5 days before the August 23 party — the first
> reminder that should fire. Parts 1–4 all need to be done before then.

---

## Part 5 — Check it's actually working

Flow keeps a log of every run.

1. Apps → **Flow** → open a workflow → **Runs** tab.
2. Each morning's run is listed. Click one to see what it actually did.

**What you want to see:** the query showing a real date, e.g.
`tag:'party-2026-08-23' AND NOT status:cancelled`

**Two things that commonly go wrong:**

| You see | Meaning | Fix |
| --- | --- | --- |
| `tag:'party-'` — no date | the date formatting didn't work | in the Query, try removing `\| date: "%Y-%m-%d"`, save, check the next run |
| Runs fine, 0 orders, but you expected one | the order has no tag | Part 1 wasn't on when it was booked, or Part 4 wasn't done for that date |

A run finding **0 orders on a day with no party is correct** — most days there's nothing, and
Flow will just do nothing quietly. No email is the right answer on those days.

---

## Things worth knowing

- **Refunding does not cancel the reminder.** The tag survives a refund. If a booking dies,
  properly **Cancel** the order, don't just refund it.
- **Reminders only cover orders that have a tag.** New ones get tagged automatically after
  Part 1; older ones only via Part 4.
- **Emails may arrive from `store+<shop-id>@shopifyemail.com`** until the sending domain is
  authenticated. That's normal.
- **This is separate from the "new booking" email.** That one is already live and fires at
  purchase time (`notifications/staff-order-notification.liquid`). These reminders are extra.

---

## If Flow turns out to be too fiddly

Fallback with zero setup: when the "new booking" email arrives, make a **Google Calendar**
event for the party and set two alerts on it — 5 days and 1 day before. More manual per
booking, but it also gives the owner an actual month view, which Shopify does not provide.

---

*Reference version of this — the reasoning, the Flow gotchas, and how the availability
metafield fits in — lives in [`SHOPIFY-MIGRATION.md`](SHOPIFY-MIGRATION.md) §C steps 4 and 6.*
