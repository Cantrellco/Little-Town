# Parties → Google Calendar — setup guide

**What this does:** the moment someone pays for a party on the website, it appears on a
Google Calendar called **Little Town Parties**, with the customer's name, phone number and
package on it. His phone buzzes 5 days before, 1 day before, and 2 hours before. If a booking
is cancelled, the event removes itself.

**Who does what:**

| | Who | How long |
| --- | --- | --- |
| Google side (Part 1) | **you**, signed into his Google account | ~15 min |
| Shopify side (Parts 2–3) | **you**, in the Shopify admin | ~10 min |
| Existing bookings (Part 4) | **you** | ~2 min |
| **The owner** | clicks **Allow** twice, once, ever | ~60 sec |

If you can borrow his Google login for twenty minutes, he does nothing at all.

> **Why it lives in his Google account and not a server:** the store runs on
> `littletownplayhousellc@gmail.com`, a consumer Gmail. Consumer accounts have no Workspace
> admin console, so the normal service-account route is unavailable, and a stored OAuth
> refresh token would expire every 7 days until the app passed Google verification. A script
> running *inside* his own account needs none of that — it just has calendar access, forever.

---

## Part 1 — The Google side

Signed in as **littletownplayhousellc@gmail.com**:

1. Go to **[script.google.com](https://script.google.com)** → **New project**.
2. Rename it (top left) to **Little Town — Party Calendar**.
3. Delete the sample `myFunction` code. Paste in the entire contents of
   [`Code.gs`](Code.gs).
4. **Show the manifest:** ⚙️ **Project Settings** → tick **"Show `appsscript.json` manifest
   file in editor"**. Go back to the editor, open `appsscript.json`, and replace it with the
   contents of [`appsscript.json`](appsscript.json).

   *This is what sets the timezone to Central. Skip it and every party lands on the calendar
   at the wrong hour.*

5. **Make up a password** — long and random, e.g. from a password manager. In `Code.gs`,
   put it on the `SHARED_SECRET` line:

   ```javascript
   var SHARED_SECRET = 'the-long-random-thing-you-just-made';
   ```

   Keep it somewhere — you'll paste it into Shopify in Part 2.

6. *(optional)* Fill in `STORE_HANDLE` — it's the bit in the middle of your admin URL,
   `admin.shopify.com/store/`**`this-part`**`/orders`. It adds a tap-through link to the
   Shopify order on every calendar entry. Leave it blank and everything still works.

7. **Save** (💾).

### Test it before going anywhere near Shopify

8. In the function dropdown at the top, choose **`runSelfTest`** → **Run**.

9. **This is the moment the owner clicks Allow.** Google will ask permission for the script
   to use Calendar and to send mail. You'll see a scary-looking **"Google hasn't verified this
   app"** screen — that's normal and expected for a private script. Click **Advanced** →
   **Go to Little Town — Party Calendar (unsafe)** → **Allow**.

   *It says "unsafe" because the script isn't published to the world. It's his own script, in
   his own account, doing exactly what's in the file above.*

10. Look at the **Execution log** at the bottom. You want the last line to read:

    > ✅ PASS — create, update-in-place and delete all work.

    Open Google Calendar and you'll see a new **Little Town Parties** calendar in the
    sidebar. The test party created and deleted itself, so it should be empty.

    ❌ If it fails, the log says why. Almost always it's the `SHARED_SECRET` line still
    holding the placeholder text.

### Publish it so Shopify can reach it

11. Top right → **Deploy** → **New deployment**.
12. Click the ⚙️ next to "Select type" → choose **Web app**.
13. Set:
    - **Execute as:** **Me** (`littletownplayhousellc@gmail.com`)
    - **Who has access:** **Anyone**
14. **Deploy**. Copy the **Web app URL** — it ends in `/exec`. You need it in Part 2.

> **"Anyone" sounds alarming — it isn't.** It means Shopify can reach the URL without logging
> in. The script refuses any request that doesn't carry your secret from step 5. That's the
> lock; the URL is just the door.

15. **Check the deployment is live:** paste the `/exec` URL into a browser. You should see:
    ```json
    {"ok":true,"service":"little-town-party-calendar","version":"1.0.0"}
    ```

---

## Part 2 — Shopify: send new bookings over

You're **adding one action to the workflow that already exists** — the `Order created` one
that writes `lt_booking.taken`. Don't build a new workflow.

1. Shopify admin → **Apps** → **Flow**.
2. Open the workflow triggered by **Order created**.
3. Find the **last box** in the chain → click the **＋** under it → **Action**.
4. Search for **`Send HTTP request`**. Click it.
5. Fill it in:
   - **URL:** your `/exec` URL from Part 1 step 14
   - **Method:** **POST**
   - **Headers:** name `Content-Type`, value `application/json`
   - **Body:** paste this, then replace `YOUR_SECRET_HERE` with your secret:

   ```liquid
   {%- assign pdate = "" -%}
   {%- assign ptime = "" -%}
   {%- assign pwhen = "" -%}
   {%- assign pkg = "" -%}
   {%- for lineItem in order.lineItems -%}
     {%- for ca in lineItem.customAttributes -%}
       {%- if ca.key == "Party date" -%}{%- assign pdate = ca.value -%}{%- assign pkg = lineItem.name -%}{%- endif -%}
       {%- if ca.key == "Party time" -%}{%- assign ptime = ca.value -%}{%- endif -%}
       {%- if ca.key == "Party date and time" -%}{%- assign pwhen = ca.value -%}{%- endif -%}
     {%- endfor -%}
   {%- endfor -%}
   {
     "secret": "YOUR_SECRET_HERE",
     "action": "upsert",
     "orderId": {{ order.id | split: "/" | last | json }},
     "orderName": {{ order.name | json }},
     "partyDate": {{ pdate | json }},
     "partyTime": {{ ptime | json }},
     "partyWhen": {{ pwhen | json }},
     "package": {{ pkg | json }},
     "customerName": {{ order.customer.displayName | json }},
     "customerEmail": {{ order.customer.email | json }},
     "customerPhone": {{ order.customer.phone | json }},
     "total": {{ order.totalPriceSet.shopMoney.amount | json }}
   }
   ```

6. **Save**, and make sure the workflow is still **on**.

**Notes on that Liquid:**
- **The `| json` filter supplies its own quote marks** — that's why those lines have no `"`
  around them, unlike the `"secret"` line. It also does the escaping, which is what stops a
  customer named *O'Brien* or *Sarah "Sam" Miller* from breaking the whole request.
- **If Flow rejects `json` outright**, fall back to writing the quotes yourself —
  `"orderName": "{{ order.name }}",` — on every one of those lines. It works, but a quote mark
  or backslash in a customer's name will break that booking. You'd get the ⚠️ alert email, so
  it won't pass silently.
- If Flow rejects one *individual* line (the `total` line is the likeliest), **just delete
  that line**. Everything is optional except `secret`, `action`, `orderId` and `partyDate`.
  Remember to drop the trailing comma from the line above it.
- Day-pass and membership orders hit this too. They have no `Party date`, so the script
  answers *"skipped: no party order"* and does nothing. That's correct.
- Same camelCase rule as the rest of your Flow work: `order.lineItems` and
  `customAttributes`, never theme-style `line_items`/`properties`.

---

## Part 3 — Shopify: make cancellations clean up after themselves

A brand-new, very short workflow.

1. Flow → **Create workflow** → trigger **`Order cancelled`**.
2. **＋** → **Action** → **`Send HTTP request`**.
3. Same **URL**, same **POST**, same `Content-Type` header. Body:

   ```liquid
   {
     "secret": "YOUR_SECRET_HERE",
     "action": "cancel",
     "orderId": {{ order.id | split: "/" | last | json }},
     "orderName": {{ order.name | json }}
   }
   ```
4. **Save** and **turn it on**.

> **Refunding is not cancelling.** A refund leaves the order active and the party stays on the
> calendar. To kill a booking, properly **Cancel** the order. Same trap as the old tag-based
> reminders had.

### Part 3b — and free the slot back up on the website

**Do this one too.** Removing the calendar event does *not* make the date bookable again —
the website greys dates out from the `lt_booking.taken` metafield, which until now only ever
got **added** to. Without this, a cancelled party leaves its slot dead forever and you quietly
lose the booking.

Staying in the same **Order cancelled** workflow:

1. **＋** under the HTTP action → **Action** → **`Update shop metafield`** (the **Shop** one —
   there are 9 near-identical metafield actions).
2. Pick metafield **`lt_booking.taken`** from the dropdown.
3. **Read the current value as a variable, not with dot-notation.** In the Value field click
   **Add a variable** → **Shop** → **metafield** (singular) → `lt_booking.taken` → **Add**.
   Flow inserts a token like `{{ shop.XXXX.value }}` and **names the alias itself — you can't
   choose it.** Note that alias.
4. Paste this as the **Value**, replacing `REPLACE_WITH_ALIAS` on line 1 with that alias:

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

   It's the mirror image of the append Liquid on your `Order created` workflow: rebuild the
   whole list in one action, minus this one booking.

5. **Save.**

**Why it's built this way:**
- It matches on **date *and* time**, so cancelling the Sunday 1–3 party doesn't also free the
  Sunday 4–6 one. Both live on the same date.
- A non-party cancellation has no `Party date`, nothing matches, and the list is rewritten
  identically. Harmless.
- The `{%- -%}` trim tags are load-bearing — a Single line text metafield rejects newlines.
- Never retype the slot strings. They use an **en dash** (`–`), not a hyphen; this Liquid
  carries the order's own value through so it always matches.

---

## Part 4 — Put the 6 existing parties on the calendar

Parties booked before today know nothing about any of this. Two minutes to fix:

1. Run this in PowerShell — it reads the live site, so no admin login needed:

   ```powershell
   (Invoke-WebRequest 'https://thelittletownplayhouse.com/pages/parties' -UseBasicParsing).Content |
     Select-String 'LT_BOOKED_RAW\s*=\s*"([^"]*)"' | ForEach-Object { $_.Matches[0].Groups[1].Value }
   ```

   You'll get something like `2026-08-23|1:00–3:00 PM;2026-09-13|4:00–6:00 PM;...`

2. Back in the Apps Script editor, find `backfillExistingBookings` near the bottom of
   `Code.gs` and paste that string between the quotes on the `var RAW = '';` line.
3. Choose **`backfillExistingBookings`** in the function dropdown → **Run**.
4. The log tells you how many it added. Check the calendar.

These land without a customer name (the site only records date + slot), so they're labelled
*"booked before calendar sync"* — look the order up in Shopify for the details. Safe to run
twice; it updates rather than duplicates.

---

## Part 5 — Prove the whole chain works

1. Go to the live parties page and book any slot. Complete checkout for real.
2. Within a few seconds the party should appear on **Little Town Parties**, with the
   customer's name and phone on it. Reload the parties page — that slot should now be gone.
3. **Refund AND cancel** the test order. Two things should happen on their own:
   - the calendar event disappears (Part 3), and
   - the slot comes **back** on the parties page (Part 3b).

   Watching the slot vanish and return is the real end-to-end proof. If it vanishes but never
   comes back, Part 3b isn't wired up and every future cancellation will silently burn a slot.

Where to look if it doesn't:

| Symptom | Look here |
| --- | --- |
| Nothing happened at all | Flow → the workflow → **Runs** tab. Did the HTTP action run? |
| Flow ran fine, no event | Apps Script → **Executions** (left sidebar). Every request is logged with its error. |
| An email arrived saying a party didn't reach the calendar | That's the safety net working — the email contains the exact reason. |
| Flow logs a **302** | **Not a failure.** Apps Script always answers with a redirect. The script already ran and the event is made. Check the calendar before chasing it. |

---

## Things worth knowing

- **The redeploy trap.** If you ever edit `Code.gs`, Apps Script keeps serving the *old* code
  until you publish a new version: **Deploy → Manage deployments → ✏️ → Version: New version
  → Deploy**. Do NOT create a *new deployment* — that mints a different URL and Shopify keeps
  calling the old one. Confirm by loading the `/exec` URL and checking the `version` number.
- **Reschedules move the event, they don't duplicate it.** Each event carries its Shopify
  order id as a hidden tag; a repeat send finds it and updates it in place.
- **Reminders live on the event**, so he can change them right in Google Calendar without
  touching any of this. Or change `POPUP_REMINDERS_MIN` in `Code.gs` and redeploy.
- **Share the calendar with staff** any time: Google Calendar → hover *Little Town Parties* →
  ⋮ → **Settings and sharing**. Nothing here needs changing.
- **A silent failure emails him.** That's the one thing this design can't do without, since
  an Apps Script web app can only ever answer "200 OK" and Flow would otherwise never know
  anything went wrong.
- **This replaces the old reminder plan.** See
  [`../../FLOW-REMINDERS-SETUP.md`](../../FLOW-REMINDERS-SETUP.md) — the tag-stamping action
  and both scheduled reminder robots are no longer needed.
