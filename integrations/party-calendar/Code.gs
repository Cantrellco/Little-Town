/**
 * Little Town Playhouse — party bookings → Google Calendar
 * ---------------------------------------------------------------------------
 * Runs as a Google Apps Script web app inside the OWNER'S Google account, so it
 * writes to the owner's calendar with no OAuth tokens, no service account and
 * nothing that expires. (The store runs on a consumer @gmail address, which
 * rules out Workspace domain-wide delegation — see README.)
 *
 * Shopify Flow POSTs a small JSON blob here on "Order created" and
 * "Order cancelled". This script turns that into a calendar event on a
 * dedicated "Little Town Parties" calendar, with its own reminders.
 *
 * Because each event is tagged with the Shopify order id, a re-send updates the
 * same event instead of duplicating it — so reschedules move and cancellations
 * delete.
 *
 * Setup + the exact Flow config: see README.md next to this file.
 */

// ─── SETTINGS — the only part you edit ──────────────────────────────────────

/** Must match the "secret" value in the Flow request body. Long + random. */
var SHARED_SECRET = 'PASTE_A_LONG_RANDOM_STRING_HERE';

/** Created automatically on first run if it doesn't exist yet. */
var CALENDAR_NAME = 'Little Town Parties';

/** Where error alerts and cancellation notices go. */
var OWNER_EMAIL = 'littletownplayhousellc@gmail.com';

/** Printed on every event so map/directions work from the calendar entry. */
var VENUE_ADDRESS = '205 East Main Street, Fairfield, IL 62837';

/**
 * Shopify store handle, for the "open this order" link in the event.
 * From your admin URL: admin.shopify.com/store/THIS-BIT/orders
 * Leave '' and the link is simply omitted — nothing breaks.
 */
var STORE_HANDLE = '';

/** Popup reminders, in minutes before the party. 7200 = 5 days, 1440 = 1 day. */
var POPUP_REMINDERS_MIN = [7200, 1440, 120];

/** Also send one email reminder this far ahead. Set to 0 to turn off. */
var EMAIL_REMINDER_MIN = 7200;

/**
 * true  → a cancelled order removes the event outright.
 * false → the event stays and is retitled "CANCELLED — ...", reminders stripped.
 */
var DELETE_ON_CANCEL = true;

var VERSION = '1.0.0';

// ─── WEB APP ENTRY POINTS ───────────────────────────────────────────────────

/**
 * Health check. Open the web app URL in a browser — if you see JSON with
 * "ok": true, the deployment is live and serving THIS version of the code.
 * (Apps Script keeps serving old code until you publish a new version, so this
 * is the fastest way to catch the classic redeploy mistake.)
 */
function doGet() {
  return jsonOut_({ ok: true, service: 'little-town-party-calendar', version: VERSION });
}

/** Called by Shopify Flow. */
function doPost(e) {
  var payload = null;
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error('Empty request body — Flow sent nothing.');
    }
    payload = JSON.parse(e.postData.contents);

    if (!secretOk_(payload.secret)) {
      // Not an error worth emailing about — this is what a stray bot request
      // looks like. Just refuse it.
      return jsonOut_({ ok: false, error: 'bad secret' });
    }

    var action = String(payload.action || 'upsert').toLowerCase();
    if (action === 'cancel') return jsonOut_(cancelEvent_(payload));

    // Day passes and memberships come through the same trigger. No party date
    // means it isn't a booking — say so plainly rather than failing.
    if (!payload.partyDate) return jsonOut_({ ok: true, skipped: 'no party date on this order' });

    return jsonOut_(upsertEvent_(payload));
  } catch (err) {
    // A web app can only ever answer 200, so Flow's run log won't show this as
    // a failure. The email IS the alarm bell — without it this fails silently.
    alertOwner_(err, payload);
    return jsonOut_({ ok: false, error: String((err && err.message) || err) });
  }
}

// ─── CREATE / UPDATE / CANCEL ───────────────────────────────────────────────

function upsertEvent_(p) {
  var cal = getCalendar_();
  var slot = parseSlot_(p.partyDate, p.partyTime);
  var existing = findEventByOrderId_(cal, p.orderId);
  var title = buildTitle_(p);
  var description = buildDescription_(p);
  var created;

  if (existing) {
    // Reschedule or edited details — move the event we already made.
    existing.setTime(slot.start, slot.end);
    existing.setTitle(title);
    existing.setDescription(description);
    existing.setLocation(VENUE_ADDRESS);
    created = false;
  } else {
    existing = cal.createEvent(title, slot.start, slot.end, {
      description: description,
      location: VENUE_ADDRESS
    });
    // The tag is what makes this whole thing idempotent. Without it, a resend
    // would pile up duplicate parties.
    existing.setTag('ltOrderId', String(p.orderId || ''));
    created = true;
  }

  applyReminders_(existing);

  return {
    ok: true,
    action: created ? 'created' : 'updated',
    order: p.orderName || p.orderId || '',
    start: existing.getStartTime().toISOString(),
    eventId: existing.getId()
  };
}

function cancelEvent_(p) {
  var cal = getCalendar_();
  var ev = findEventByOrderId_(cal, p.orderId);

  if (!ev) {
    return { ok: true, action: 'nothing-to-cancel', order: p.orderName || p.orderId || '' };
  }

  var when = Utilities.formatDate(ev.getStartTime(), scriptTz_(), "EEEE, MMMM d, yyyy 'at' h:mm a");

  if (DELETE_ON_CANCEL) {
    ev.deleteEvent();
  } else {
    ev.removeAllReminders();
    if (ev.getTitle().indexOf('CANCELLED') !== 0) ev.setTitle('CANCELLED — ' + ev.getTitle());
  }

  // A party vanishing off the calendar with no explanation is alarming. Say why.
  // Freeing the slot on the website is a SEPARATE Flow action (README Part 3b) —
  // don't promise it here, just point at the page so it gets eyeballed either way.
  notify_(
    'Party cancelled — ' + when,
    'Order ' + (p.orderName || p.orderId || '(unknown)') + ' was cancelled in Shopify, so ' +
    (DELETE_ON_CANCEL ? 'its event has been removed from' : 'its event has been marked cancelled on') +
    ' the "' + CALENDAR_NAME + '" calendar.\n\nThe slot was: ' + when +
    '\n\nWorth a quick check: thelittletownplayhouse.com/pages/parties should now offer ' +
    'that date again. If it still looks booked, the slot needs clearing in Shopify.'
  );

  return { ok: true, action: DELETE_ON_CANCEL ? 'deleted' : 'marked-cancelled', when: when };
}

function applyReminders_(ev) {
  ev.removeAllReminders();
  for (var i = 0; i < POPUP_REMINDERS_MIN.length; i++) {
    ev.addPopupReminder(POPUP_REMINDERS_MIN[i]);
  }
  if (EMAIL_REMINDER_MIN > 0) ev.addEmailReminder(EMAIL_REMINDER_MIN);
}

// ─── READING THE BOOKING ────────────────────────────────────────────────────

/**
 * "2026-06-13" + "4:30–6:30 PM"  →  { start: Date, end: Date }
 *
 * The slot strings are written by SLOTS_BY_DOW in the theme's main.js and use
 * an EN DASH, with AM/PM only on the second half. Both are handled, along with
 * plain hyphens and em dashes in case the source ever changes.
 *
 * Dates are built with the script's timezone (America/Chicago, set in
 * appsscript.json), so daylight saving is handled for us — never hardcode a
 * UTC offset here.
 */
function parseSlot_(dateStr, timeStr) {
  var d = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!d) throw new Error('Party date is not YYYY-MM-DD: "' + dateStr + '"');

  var halves = String(timeStr || '').split(/\s*[–—-]\s*/);
  if (halves.length !== 2) throw new Error('Could not split Party time in two: "' + timeStr + '"');

  var a = readClock_(halves[0]);
  var b = readClock_(halves[1]);
  if (!a || !b) throw new Error('Could not read Party time: "' + timeStr + '"');

  if (a.mer === null) a.mer = b.mer;
  if (b.mer === null) b.mer = a.mer;
  if (a.mer === null || b.mer === null) throw new Error('No AM/PM found in Party time: "' + timeStr + '"');

  var start = new Date(+d[1], +d[2] - 1, +d[3], to24_(a.h, a.mer), a.m, 0);
  var end = new Date(+d[1], +d[2] - 1, +d[3], to24_(b.h, b.mer), b.m, 0);

  if (end <= start) throw new Error('Party ends before it starts: "' + timeStr + '"');
  return { start: start, end: end };
}

function readClock_(s) {
  var m = String(s).match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!m) return null;
  return { h: +m[1], m: m[2] ? +m[2] : 0, mer: m[3] ? m[3].toUpperCase() : null };
}

function to24_(h, mer) {
  if (mer === 'AM') return h === 12 ? 0 : h;
  return h === 12 ? 12 : h + 12;
}

// ─── EVENT TEXT ─────────────────────────────────────────────────────────────

function buildTitle_(p) {
  var who = (p.customerName || '').trim();
  var pkg = /fusion/i.test(String(p.package || '')) ? ' +Fusion' : '';
  return '🎉 Party' + pkg + (who ? ' — ' + who : '');
}

/** Everything he'd otherwise have to open Shopify to find. */
function buildDescription_(p) {
  var lines = [];
  if (p.partyWhen) lines.push(p.partyWhen);
  if (p.package) lines.push('Package: ' + p.package);
  lines.push('');
  if (p.customerName) lines.push('Name:  ' + p.customerName);
  if (p.customerPhone) lines.push('Phone: ' + p.customerPhone);
  if (p.customerEmail) lines.push('Email: ' + p.customerEmail);
  lines.push('');
  if (p.orderName) lines.push('Order ' + p.orderName + (p.total ? '  ·  $' + p.total : ''));

  var url = adminOrderUrl_(p);
  if (url) lines.push(url);

  lines.push('');
  lines.push('— added automatically when the booking was paid for');
  return lines.join('\n');
}

function adminOrderUrl_(p) {
  if (p.orderUrl) return p.orderUrl;
  if (!STORE_HANDLE || !p.orderId) return '';
  return 'https://admin.shopify.com/store/' + STORE_HANDLE + '/orders/' + p.orderId;
}

// ─── CALENDAR PLUMBING ──────────────────────────────────────────────────────

/** Finds the parties calendar, creating it the first time. Id is cached. */
function getCalendar_() {
  var props = PropertiesService.getScriptProperties();
  var cached = props.getProperty('calendarId');
  if (cached) {
    var hit = CalendarApp.getCalendarById(cached);
    if (hit) return hit;
  }

  var found = CalendarApp.getCalendarsByName(CALENDAR_NAME);
  var cal = (found && found.length)
    ? found[0]
    : CalendarApp.createCalendar(CALENDAR_NAME, {
        summary: 'Private buyouts booked on thelittletownplayhouse.com',
        timeZone: scriptTz_(),
        color: CalendarApp.Color.PINK
      });

  props.setProperty('calendarId', cal.getId());
  return cal;
}

/**
 * Scans a wide window rather than just the party's own day — a rescheduled
 * booking has already moved, so searching the new date would miss it and we'd
 * create a duplicate instead of moving the original.
 */
function findEventByOrderId_(cal, orderId) {
  if (!orderId) return null;
  var key = String(orderId);
  var now = new Date();
  var events = cal.getEvents(
    new Date(now.getFullYear() - 1, 0, 1),
    new Date(now.getFullYear() + 2, 0, 1)
  );
  for (var i = 0; i < events.length; i++) {
    if (events[i].getTag('ltOrderId') === key) return events[i];
  }
  return null;
}

function scriptTz_() {
  return Session.getScriptTimeZone() || 'America/Chicago';
}

// ─── SAFETY NET ─────────────────────────────────────────────────────────────

function secretOk_(given) {
  var a = String(given || '');
  var b = String(SHARED_SECRET || '');
  if (!b || b === 'PASTE_A_LONG_RANDOM_STRING_HERE') {
    throw new Error('SHARED_SECRET has not been set in Code.gs.');
  }
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Emails the owner when a booking fails to land, throttled so it can't spam. */
function alertOwner_(err, payload) {
  try {
    var msg = String((err && err.message) || err);
    var props = PropertiesService.getScriptProperties();
    var stamp = 'lastAlert:' + msg.slice(0, 60);
    var last = Number(props.getProperty(stamp) || 0);
    if (Date.now() - last < 30 * 60 * 1000) return; // same error within 30 min
    props.setProperty(stamp, String(Date.now()));

    notify_(
      '⚠️ A party did NOT reach the calendar',
      'A booking came through but could not be added to the "' + CALENDAR_NAME + '" calendar.\n\n' +
      'Add it by hand, then tell whoever set this up.\n\n' +
      'What went wrong:\n' + msg + '\n\n' +
      'What Shopify sent:\n' + JSON.stringify(payload || {}, null, 2)
    );
  } catch (ignored) {
    // Never let the alarm bell itself throw.
  }
}

function notify_(subject, body) {
  MailApp.sendEmail(OWNER_EMAIL, 'Little Town — ' + subject, body);
}

function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── RUN THESE BY HAND (Apps Script editor → pick function → Run) ───────────

/**
 * Proves the whole thing works WITHOUT placing a real Shopify order.
 * Creates a fake party two weeks out, checks it can be found again, then
 * deletes it. Watch the Execution log for the result.
 *
 * Worth having because Shopify's own "Send test" button sends a sample order
 * with no line-item properties, so it can never exercise this path.
 */
function runSelfTest() {
  var d = new Date();
  d.setDate(d.getDate() + 14);
  var dateStr = Utilities.formatDate(d, scriptTz_(), 'yyyy-MM-dd');

  var fake = {
    secret: SHARED_SECRET,
    action: 'upsert',
    orderId: 'SELFTEST-' + dateStr,
    orderName: '#SELFTEST',
    partyDate: dateStr,
    partyTime: '4:00–6:00 PM',
    partyWhen: 'Self test · 4:00–6:00 PM',
    customerName: 'Test Booking (safe to ignore)',
    customerPhone: '555-0100',
    customerEmail: 'test@example.com',
    package: 'Little Town',
    total: '185.00'
  };

  var made = upsertEvent_(fake);
  Logger.log('created: ' + JSON.stringify(made));

  var again = upsertEvent_(fake);
  Logger.log('second send (should say "updated", NOT "created"): ' + JSON.stringify(again));

  var gone = cancelEvent_({ orderId: fake.orderId, orderName: fake.orderName });
  Logger.log('cleanup: ' + JSON.stringify(gone));

  Logger.log(
    made.action === 'created' && again.action === 'updated'
      ? '✅ PASS — create, update-in-place and delete all work.'
      : '❌ FAIL — check the log above.'
  );
}

/**
 * One-time: puts parties that were booked BEFORE this existed onto the calendar.
 * Just run it — RAW below was read off the live site on 2026-08-09 and every
 * entry was checked against SLOTS_BY_DOW for its day of the week.
 *
 * Safe to run twice: the ids are derived from the date + time, so a second run
 * updates the same events rather than duplicating them.
 *
 * If bookings have come in since, refresh RAW from the live site first (no admin
 * login needed) and paste the result in:
 *
 *   (Invoke-WebRequest 'https://thelittletownplayhouse.com/pages/parties' -UseBasicParsing).Content |
 *     Select-String 'LT_BOOKED_RAW\s*=\s*"([^"]*)"' | ForEach-Object { $_.Matches[0].Groups[1].Value }
 *
 * NB the list is in order-placed sequence, not date order. Don't read it as a
 * schedule — the calendar is the schedule now.
 */
function backfillExistingBookings() {
  // Sun 8/23 1–3 · Sun 9/13 1–3 · Sun 9/20 1–3 · Sun 9/27 4–6 · Sat 10/10 4:30–6:30 · Sun 10/11 1–3
  var RAW = '2026-10-11|1:00–3:00 PM;2026-10-10|4:30–6:30 PM;2026-09-27|4:00–6:00 PM;' +
            '2026-09-20|1:00–3:00 PM;2026-09-13|1:00–3:00 PM;2026-08-23|1:00–3:00 PM';

  if (!RAW) {
    Logger.log('Paste the LT_BOOKED_RAW value into RAW first — see the comment above.');
    return;
  }

  var entries = RAW.split(';');
  var done = 0;

  for (var i = 0; i < entries.length; i++) {
    var bits = entries[i].split('|');
    if (bits.length !== 2 || !bits[0]) continue;

    var date = bits[0].trim();
    var time = bits[1].trim();

    upsertEvent_({
      // Deterministic id → re-running this updates rather than duplicates.
      orderId: 'backfill-' + date + '-' + time.replace(/[^0-9]/g, ''),
      orderName: '(booked before calendar sync)',
      partyDate: date,
      partyTime: time,
      partyWhen: date + ' · ' + time,
      customerName: '',
      package: 'see Shopify order'
    });
    done++;
    Logger.log('added ' + date + ' ' + time);
  }

  Logger.log('✅ Backfilled ' + done + ' booking(s). Check the "' + CALENDAR_NAME + '" calendar.');
}
