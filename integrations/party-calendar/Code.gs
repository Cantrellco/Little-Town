/**
 * Little Town Playhouse — party bookings → Google Calendar
 * ---------------------------------------------------------------------------
 * Lives inside a Google Sheet in the littletown account. One menu click runs
 * setup(), which is also the moment Google asks to Allow — so installing and
 * authorising are a single action. No code editor, nothing to deploy.
 *
 * How a booking gets here:
 *   Shopify emails the staff "new order" notification on every sale. That
 *   template carries one machine-readable line starting "LTPCAL1|". This script
 *   wakes up every 15 minutes, finds those lines in Gmail, and makes a calendar
 *   event from each. It can only read the mailbox of the account it runs in,
 *   which is why it must live where the order emails land.
 *
 *   Fusion's own bookings never touch Shopify, so they can't arrive that way.
 *   They are pulled from fusioncoffeeshop.com in the same 15-minute run and
 *   land on this same calendar in a third colour. See syncFusionBookings_().
 *
 * Why polling and not a webhook: receiving a webhook needs a deployed web app,
 * and deploying is the step that forces someone into the script editor. Polling
 * is also self-healing — a failed run gets retried 15 minutes later, whereas a
 * missed webhook is gone for good.
 *
 * Cancellations are handled off the storefront's own availability list, which
 * Shopify Flow maintains. See pruneCancelled_().
 */

// ─── SETTINGS ───────────────────────────────────────────────────────────────

/**
 * Renaming this is safe. getCalendar_ renames the existing calendar in place
 * rather than matching on the new name and finding nothing — which would create
 * a second, empty calendar and orphan the one holding every event, every
 * reminder and every share.
 */
var CALENDAR_NAME = 'Little Town and Fusion Parties';
var OWNER_EMAIL = 'littletownplayhousellc@gmail.com';
var VENUE_ADDRESS = '205 East Main Street, Fairfield, IL 62837';
var PARTIES_URL = 'https://thelittletownplayhouse.com/pages/parties';

/** How often to check for new bookings, in minutes. 15 is the practical floor. */
var CHECK_EVERY_MINUTES = 15;

/**
 * Event colours, so the packages are tellable apart in the month view
 * without opening anything.
 *
 * Plain strings rather than CalendarApp.EventColor.X on purpose: these are
 * evaluated when the script loads, including for onOpen, which runs BEFORE
 * authorization. Touching the Calendar service up here could stop the menu
 * appearing at all on a fresh sheet.
 *
 * Google's palette: 1 Lavender · 2 Sage · 3 Grape · 4 Flamingo · 5 Banana
 * 6 Tangerine · 7 Peacock · 8 Graphite · 9 Blueberry · 10 Basil · 11 Tomato
 */
var COLOR_LITTLE_TOWN = '4';  // Flamingo — pink, the ordinary buyout
var COLOR_WITH_FUSION = '9';  // Blueberry — blue, Fusion opens and needs a barista
var COLOR_FUSION_ONLY = '8';  // Graphite — near-black, the café only, playhouse free
var COLOR_UNKNOWN     = '11'; // Tomato — red, package not known, check Shopify

// Graphite was COLOR_UNKNOWN until Fusion-only claimed it: Google's palette has
// no black and Graphite is the closest thing to it. Unknown moved to Tomato
// rather than sharing — two meanings on one colour defeats the point of
// colouring them, and red suits "something needs looking at" better than the
// grey it had, which read as "nothing much".

/** Popup reminders, in minutes before the party. 7200 = 5 days, 1440 = 1 day. */
var POPUP_REMINDERS_MIN = [7200, 1440, 120];

/** Also send one email reminder this far ahead. 0 turns it off. */
var EMAIL_REMINDER_MIN = 7200;

/**
 * Fusion's private booking feed — parties sold on fusioncoffeeshop.com, which
 * take the café but not the playhouse.
 *
 * ⚠️ The secret is a CREDENTIAL: the feed returns customer names and phone
 * numbers. It is deliberately NOT in this file, because this file lives in a
 * public repo and gets pasted between machines. It is read at run time from
 * Script Properties instead — see fusionSecret_() for the one-time setup.
 *
 * With no secret set, the Fusion half quietly does nothing and everything
 * Little Town does carries on untouched.
 */
var FUSION_FEED_URL = 'https://www.fusioncoffeeshop.com/api/party-bookings';

/**
 * Everything is calculated in this timezone explicitly, so it does not matter
 * what timezone the script or the sheet happens to be set to.
 */
var TIMEZONE = 'America/Chicago';

/** How far back in Gmail to look. Parties are booked months ahead. */
var MAIL_LOOKBACK = '1y';

/**
 * `in:anywhere` matters: GmailApp.search skips Spam and Trash by default, and
 * an automated shop notification is exactly the sort of mail a provider decides
 * is spam. Without it a booking can be sitting in the mailbox, findable by hand,
 * and still invisible to this script — which looks identical to it never having
 * arrived, and is the worse failure because everything appears healthy.
 */
var MAIL_QUERY_ = 'in:anywhere "LTPCAL1" newer_than:' + MAIL_LOOKBACK;

/** Told about bookings that need the café open. Blank to switch off. */
var NOTIFY_FUSION_EMAIL = 'fusioncoffeellc@gmail.com';

/**
 * Other Google accounts that should also SEE this calendar. Granted access
 * during setup, so nobody has to work out Google's calendar-sharing screens.
 *
 * The account that RUNS this script owns the calendar and doesn't need listing.
 *
 * ⚠️ Granting access is NOT the same as it appearing for them. Google stopped
 * auto-adding shared calendars to the recipient's list: they get an email and
 * must click through it once to add it. One click, one time — but it does have
 * to happen, or they'll wonder where the calendar is.
 *
 * Read-only, and dates only. Reminders will NOT follow: Google keeps reminders
 * private to the account that owns the calendar and they can't be set on
 * someone else's behalf.
 */
var SHARE_CALENDAR_WITH = ['fusioncoffeellc@gmail.com'];

/**
 * Bump this whenever the SEED list at the bottom changes.
 *
 * The 15-minute sync compares it against what it last applied and re-seeds if
 * they differ — so edits to those older bookings reach the calendar on their
 * own, without anyone being asked to click "Set up" again. Editing the script
 * is enough.
 */
var SEED_VERSION = '2026-08-16a';

var VERSION = '2.5.0';

// ─── THE MENU (this is his entire interface) ────────────────────────────────

/**
 * Runs automatically whenever he opens the sheet. Simple triggers like this one
 * are allowed to run before authorization, which is what lets the menu appear
 * on a fresh sheet — the Allow prompt comes later, when he uses it.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🎉 Little Town')
    .addItem('Set up my party calendar', 'setup')
    .addSeparator()
    .addItem('Check for new bookings now', 'syncNow')
    .addItem('Is it working?', 'showStatus')
    .addSeparator()
    .addItem('Show me what it can see', 'diagnose')
    .addToUi();
}

/**
 * The one thing he clicks. Creates the calendar, shares it across, schedules
 * the automatic checks, and pulls in every booking it can already see.
 */
function setup() {
  var ui = SpreadsheetApp.getUi();
  try {
    var cal = getCalendar_();
    var sharedWith = shareCalendarWith_(cal);

    // Clear ours out first so running setup twice doesn't stack up triggers.
    var existing = ScriptApp.getProjectTriggers();
    for (var i = 0; i < existing.length; i++) {
      if (existing[i].getHandlerFunction() === 'syncNow') ScriptApp.deleteTrigger(existing[i]);
    }
    ScriptApp.newTrigger('syncNow').timeBased().everyMinutes(CHECK_EVERY_MINUTES).create();

    // Parties booked before the order email carried a LTPCAL1 line can never be
    // found in Gmail, so they're seeded here.
    var seeded = backfillExistingBookings();
    PropertiesService.getUserProperties().setProperty('seedVersion', SEED_VERSION);

    var result = syncNow_();

    ui.alert(
      '✅ All set',
      'Your "' + CALENDAR_NAME + '" calendar is ready, and it will check for new ' +
      'bookings by itself every ' + CHECK_EVERY_MINUTES + ' minutes.\n\n' +
      'Parties found just now: ' + (result.added + seeded) + '\n\n' +
      (sharedWith.length
        ? 'It has also been shared with ' + sharedWith.join(', ') + ' — look for "' +
          CALENDAR_NAME + '" under "Other calendars" there.\n\n'
        : '') +
      'Open Google Calendar on your phone and you\'ll see them. You can close ' +
      'this sheet — you never need to open it again.',
      ui.ButtonSet.OK
    );
  } catch (err) {
    ui.alert('Something went wrong', String((err && err.message) || err), ui.ButtonSet.OK);
    throw err;
  }
}

/** Menu version of the sync — same job, but tells him what it did. */
function syncNow() {
  var ui = SpreadsheetApp.getUi();
  var r = syncNow_();
  ui.alert(
    'Checked for bookings',
    'New parties added: ' + r.added + '\n' +
    'Already on the calendar: ' + r.unchanged + '\n' +
    'Cancelled and removed: ' + r.removed +
    (r.problems ? '\n\nCouldn\'t read: ' + r.problems + ' (you were emailed about it)' : ''),
    ui.ButtonSet.OK
  );
}

/** A plain-English "is this thing on?" for when he wonders. */
function showStatus() {
  var props = PropertiesService.getUserProperties();
  var last = props.getProperty('lastRun');
  var running = false;
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'syncNow') running = true;
  }

  // findOwnedCalendar_ rather than a name lookup: it won't pick up a shared
  // copy of someone else's, and it won't create one just because you asked
  // whether things are working.
  var cal = findOwnedCalendar_();
  var upcoming = 0;
  if (cal) {
    var now = new Date();
    upcoming = cal.getEvents(now, new Date(now.getFullYear() + 2, 0, 1)).length;
  }

  SpreadsheetApp.getUi().alert(
    running ? '✅ Yes, it\'s working' : '⚠️ Not switched on',
    (running
      ? 'Checking for new bookings every ' + CHECK_EVERY_MINUTES + ' minutes.'
      : 'The automatic check isn\'t running. Click "Set up my party calendar" to start it.') +
    '\n\nLast checked: ' + (last || 'never') +
    '\nParties on the calendar: ' + upcoming,
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

/**
 * Lays out exactly what this account can and can't see, so "it isn't working"
 * stops being a guess.
 *
 * The failure this is really for: the sync can only read the mailbox of the
 * account running it, and a Shopify recipient added today receives nothing sent
 * yesterday. An account can therefore be perfectly healthy and still show zero
 * new bookings forever. Printing every booking email it can find, with dates,
 * separates that from a real fault in one look.
 */
function diagnose() {
  var lines = [];
  lines.push('Signed in as: ' + Session.getEffectiveUser().getEmail());

  var cal = findOwnedCalendar_();
  lines.push('Calendar owned by this account: ' + (cal ? '"' + cal.getName() + '"' : 'NONE — run Set up first'));
  if (cal) {
    var now = new Date();
    lines.push('Events on it from today: ' + cal.getEvents(now, new Date(now.getFullYear() + 2, 0, 1)).length);
  }

  var running = false;
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'syncNow') running = true;
  }
  lines.push('Automatic 15-minute check: ' + (running ? 'ON' : 'OFF'));
  lines.push('');

  var threads = GmailApp.search(MAIL_QUERY_, 0, 200);
  lines.push('Booking emails in THIS mailbox: ' + threads.length);
  lines.push('(searched: ' + MAIL_QUERY_ + ')');
  lines.push('');

  if (!threads.length) {
    lines.push('None found. That is not necessarily a fault — this mailbox only');
    lines.push('receives orders placed AFTER it was added as a Shopify recipient.');
    lines.push('Forward an older order email here and it will be picked up.');
  } else {
    for (var t = 0; t < threads.length; t++) {
      var msgs = threads[t].getMessages();
      for (var m = 0; m < msgs.length; m++) {
        var b = null;
        try { b = readBookingFromMessage_(msgs[m]); } catch (err) {
          lines.push('✗ UNREADABLE — ' + ((err && err.message) || err));
          continue;
        }
        if (!b) continue;
        lines.push('✓ ' + b.partyDate + '  ' + b.partyTime + '  ' +
                   (b.customerName || '(no name)') + '  [' + (b.package || 'no package') + ']');
      }
    }
  }

  lines.push('');
  lines.push('Fusion feed secret set: ' + (fusionSecret_() ? 'yes' : 'no'));

  Logger.log(lines.join('\n'));
  try {
    SpreadsheetApp.getUi().alert('What this account can see', lines.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (noUi) {
    // Run from the editor rather than the menu — the log above is the output.
  }
}

// ─── THE SYNC ───────────────────────────────────────────────────────────────

/** Runs on the timer. Never shows a dialog — nobody is watching. */
function syncNow_() {
  var out = { added: 0, unchanged: 0, removed: 0, problems: 0 };
  var props = PropertiesService.getUserProperties();

  // Re-seed the older bookings whenever the SEED list has been edited since
  // this account last applied it. Without this, a correction to those six only
  // lands if someone clicks "Set up" again — and the person editing the script
  // usually isn't the person whose calendar needs it.
  if (props.getProperty('seedVersion') !== SEED_VERSION) {
    Logger.log('Seed list changed (' + SEED_VERSION + ') — re-applying.');
    backfillExistingBookings();
    props.setProperty('seedVersion', SEED_VERSION);
  }

  var threads = GmailApp.search(MAIL_QUERY_, 0, 200);
  Logger.log('Order emails found: ' + threads.length);

  for (var t = 0; t < threads.length; t++) {
    var messages = threads[t].getMessages();
    for (var m = 0; m < messages.length; m++) {
      var booking;
      try {
        booking = readBookingFromMessage_(messages[m]);
      } catch (err) {
        out.problems++;
        Logger.log('✗ could not read "' + messages[m].getSubject() + '" — ' + ((err && err.message) || err));
        alertOwner_(err, messages[m].getSubject());
        continue;
      }
      if (!booking) continue;

      try {
        var r = upsertEvent_(booking);
        if (r.action === 'created') out.added++; else out.unchanged++;
      } catch (err2) {
        out.problems++;
        Logger.log('✗ ' + booking.partyDate + ' ' + booking.partyTime + ' — ' + ((err2 && err2.message) || err2));
        alertOwner_(err2, booking.orderName);
      }
    }
  }

  // Fusion's own bookings, pulled rather than emailed. Kept after the Gmail
  // loop and inside its own try so a Fusion outage can never stop Little Town's
  // bookings reaching the calendar.
  try {
    var fusion = syncFusionBookings_();
    out.added += fusion.added;
    out.unchanged += fusion.unchanged;
    out.problems += fusion.problems;
  } catch (errF) {
    Logger.log('✗ Fusion feed — ' + ((errF && errF.message) || errF));
  }

  out.removed = pruneCancelled_();

  props.setProperty('lastRun', Utilities.formatDate(new Date(), TIMEZONE, 'EEE d MMM, h:mm a'));
  Logger.log('Sync: ' + out.added + ' added, ' + out.unchanged + ' already there, ' +
             out.removed + ' removed, ' + out.problems + ' problems.');
  return out;
}

/**
 * The Fusion feed secret, read at run time rather than written into this file.
 *
 * It's a real credential — the feed hands back customer names and phone
 * numbers — and this file lives in a PUBLIC repo and gets pasted between
 * machines, so anything hardcoded here is one careless copy away from being
 * searchable. Script Properties stay inside the Apps Script project.
 *
 * One-time setup: Apps Script editor → ⚙️ Project Settings → Script Properties
 * → Add script property → name it exactly FUSION_FEED_SECRET, paste the value
 * from Cloudflare Pages → fusion-coffee → Settings → Environment variables
 * (PARTY_FEED_SECRET) → Save.
 *
 * Lazily read, never at load time: this file's globals are evaluated for
 * onOpen too, which runs BEFORE authorization, and touching a service up there
 * can stop the menu appearing at all.
 */
function fusionSecret_() {
  return PropertiesService.getScriptProperties().getProperty('FUSION_FEED_SECRET') || '';
}

/**
 * Pulls parties booked on fusioncoffeeshop.com and puts them on this calendar.
 *
 * These take the CAFÉ, not the playhouse — the two venues are next door and
 * share the café between them. A Fusion booking blocks Little Town's "+ Fusion"
 * package for that window, but the plain playhouse buyout stays on sale, which
 * is why they earn a colour of their own rather than looking like a buyout.
 *
 * Pulled rather than pushed because this script already runs as the shop's own
 * Google user. Having Fusion's server write the calendar instead would mean a
 * Google service-account key living in Cloudflare and an OAuth dance, to do
 * something CalendarApp already does for free right here.
 */
function syncFusionBookings_() {
  var out = { added: 0, unchanged: 0, problems: 0 };
  var secret = fusionSecret_();

  if (!secret) {
    Logger.log('Fusion feed secret not set — skipping Fusion bookings.');
    return out;
  }

  var res = UrlFetchApp.fetch(FUSION_FEED_URL, {
    headers: { Authorization: 'Bearer ' + secret },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    Logger.log('Fusion feed returned ' + res.getResponseCode() + ' — skipping this run.');
    return out;
  }

  var bookings;
  try {
    bookings = JSON.parse(res.getContentText()).bookings || [];
  } catch (err) {
    Logger.log('Fusion feed did not return JSON — skipping this run.');
    return out;
  }
  Logger.log('Fusion bookings in feed: ' + bookings.length);

  for (var i = 0; i < bookings.length; i++) {
    var b = bookings[i];
    if (!b || !b.date || !b.slot) continue;

    // Fall back to date+slot when the feed omits an id. Without this every
    // such booking becomes "fusion-undefined", they all collide onto ONE
    // event, and each new one overwrites the last — which looks exactly like
    // a booking silently going missing.
    var fusionId = b.orderId ? String(b.orderId) : (b.date + '-' + b.slot);

    try {
      var r = upsertEvent_({
        // Prefixed so it can never collide with a Shopify order id or one of
        // the backfill- ids.
        orderId: 'fusion-' + fusionId,
        orderName: 'Fusion booking',
        partyDate: b.date,
        partyTime: b.slot,
        customerName: b.name || '',
        customerPhone: b.phone || '',
        package: 'Fusion café',
        total: b.totalCents ? (b.totalCents / 100).toFixed(2) : '',
        // The flag everything else branches on. See upsertEvent_.
        venue: 'fusion'
      });
      if (r.action === 'created') out.added++; else out.unchanged++;
    } catch (err2) {
      out.problems++;
      Logger.log('✗ Fusion ' + b.date + ' ' + b.slot + ' — ' + ((err2 && err2.message) || err2));
      alertOwner_(err2, 'Fusion booking ' + b.date + ' ' + b.slot);
    }
  }
  return out;
}

/**
 * Reads the booking out of one email, trying the HTML body and the plain-text
 * body and keeping whichever came through complete.
 *
 * Both are checked because Gmail hard-wraps long lines when it generates the
 * plain-text version, and the booking line is longer than its wrap width — so
 * the plain-text copy can arrive chopped in half, losing the trailing fields.
 * The HTML body keeps it on one line.
 */
function readBookingFromMessage_(msg) {
  var best = null;
  var bestCount = 0;
  var sources = [msg.getBody(), msg.getPlainBody()];

  for (var i = 0; i < sources.length; i++) {
    var m = String(sources[i] || '').match(/LTPCAL1\|([^\n\r<]+)/);
    if (!m) continue;
    var count = m[1].split('|').length;
    if (count > bestCount) { bestCount = count; best = m[1]; }
  }

  return best === null ? null : readBookingLine_(best);
}

/**
 * Pulls the booking out of a "LTPCAL1|" line. Returns null for anything that
 * isn't a party order.
 *
 * Reading a purpose-built line rather than scraping the pretty HTML means a
 * redesign of that email can't quietly break the calendar.
 */
function readBookingLine_(line) {
  var f = String(line || '').split('|');
  if (f.length < 5) throw new Error('Booking line is too short to use: "' + line + '"');

  var booking = {
    orderId: (f[0] || '').trim(),
    orderName: (f[1] || '').trim(),
    partyDate: (f[2] || '').trim(),
    partyTime: (f[3] || '').trim(),
    customerName: (f[4] || '').trim(),
    customerPhone: (f[5] || '').trim(),
    customerEmail: (f[6] || '').trim(),
    package: (f[7] || '').trim(),
    total: (f[8] || '').trim()
  };
  if (!booking.partyDate) return null; // not a party order
  return booking;
}

/**
 * Removes events for parties that were cancelled.
 *
 * The storefront publishes the live list of booked slots, and Shopify Flow
 * takes an entry out of that list when an order is cancelled. So: anything on
 * our calendar in the FUTURE whose slot is no longer on that list was cancelled.
 *
 * Deliberately cautious — only ever touches future events, and if the page
 * can't be read or comes back empty it does nothing at all. A false deletion
 * would silently lose a real party, far worse than a stale event.
 *
 * ⚠️ FUSION BOOKINGS ARE NOT ON THAT LIST. They live in a separate metafield
 * (lt_booking.fusion_taken) because they take the café rather than the
 * playhouse — so a Fusion event carrying an ltSlot tag would look exactly like
 * a cancelled buyout and be deleted here, quietly, within 15 minutes. That is
 * why upsertEvent_ withholds the tag for them and why the guard below is the
 * thing keeping them alive. Fusion is all-sales-final, so nothing of theirs
 * ever needs pruning anyway. If refunds are ever added, extend this to read
 * LT_FUSION_TAKEN from the same page rather than tagging Fusion events.
 */
function pruneCancelled_() {
  var live;
  try {
    var html = UrlFetchApp.fetch(PARTIES_URL, { muteHttpExceptions: true }).getContentText();
    var m = html.match(/LT_BOOKED_RAW\s*=\s*"([^"]*)"/);
    if (!m) return 0;
    live = m[1];
  } catch (err) {
    return 0; // site down or blocked — try again next run
  }
  if (!live) return 0;

  var stillBooked = {};
  var entries = live.split(';');
  for (var i = 0; i < entries.length; i++) {
    if (entries[i]) stillBooked[entries[i].trim()] = true;
  }

  var cal = getCalendar_();
  var now = new Date();
  var events = cal.getEvents(now, new Date(now.getFullYear() + 2, 0, 1));
  var removed = 0;

  for (var e = 0; e < events.length; e++) {
    if (events[e].getTag('ltVenue') === 'fusion') continue; // belt and braces
    var slot = events[e].getTag('ltSlot');
    if (!slot) continue;             // not one of ours — includes every Fusion event
    if (stillBooked[slot]) continue; // still a live booking

    var when = Utilities.formatDate(events[e].getStartTime(), TIMEZONE, "EEEE, MMMM d 'at' h:mm a");
    events[e].deleteEvent();
    removed++;
    notify_(
      'Party cancelled — ' + when,
      'That booking is no longer on the website\'s list, so it has been removed ' +
      'from your "' + CALENDAR_NAME + '" calendar.\n\nThe slot was: ' + when +
      '\n\nThat date should be bookable again now.'
    );
  }
  return removed;
}

// ─── CREATING THE EVENT ─────────────────────────────────────────────────────

function upsertEvent_(p) {
  var cal = getCalendar_();
  var slot = parseSlot_(p.partyDate, p.partyTime);
  var existing = findEventByOrderId_(cal, p.orderId);
  var title = buildTitle_(p);
  var description = buildDescription_(p);
  var created;

  if (existing) {
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
    created = true;
  }

  // ltOrderId keeps re-runs from duplicating; ltSlot is what pruneCancelled_
  // matches against the storefront's list.
  existing.setTag('ltOrderId', String(p.orderId || ''));

  // Fusion bookings deliberately get NO ltSlot. They are not on the playhouse's
  // availability list, so tagging them would make pruneCancelled_ delete every
  // one of them on its next run. See the warning on that function. The blank
  // clears the tag on any Fusion event that predates this rule.
  if (p.venue === 'fusion') {
    existing.setTag('ltVenue', 'fusion');
    existing.setTag('ltSlot', '');
  } else {
    existing.setTag('ltSlot', p.partyDate + '|' + p.partyTime);
  }

  // Set on updates too, not just creates, so re-seeding recolours the parties
  // that were already on the calendar.
  existing.setColor(colorFor_(p));

  if (created) {
    applyReminders_(existing);
    // Only on create, and only for bookings that need the café. An update
    // would re-send on every correction, and a plain Little Town buyout
    // doesn't involve Fusion at all.
    if (!p.silent) notifyFusionIfTheirs_(p);
  }

  return { action: created ? 'created' : 'unchanged', order: p.orderName || '' };
}

function applyReminders_(ev) {
  ev.removeAllReminders();
  for (var i = 0; i < POPUP_REMINDERS_MIN.length; i++) ev.addPopupReminder(POPUP_REMINDERS_MIN[i]);
  if (EMAIL_REMINDER_MIN > 0) ev.addEmailReminder(EMAIL_REMINDER_MIN);
}

/** True when the booking includes Fusion — i.e. the café opens and needs staff. */
function isFusion_(p) {
  return /fusion/i.test(String(p.package || ''));
}

/**
 * Which colour this party gets. A booking with no package recorded goes red
 * rather than being guessed at as plain Little Town — red means "look this one
 * up in Shopify".
 */
function colorFor_(p) {
  // Checked first: a Fusion-only booking's package also contains the word
  // "Fusion", so isFusion_ would otherwise claim it as the combo.
  if (p.venue === 'fusion') return COLOR_FUSION_ONLY;

  var pkg = String(p.package || '');
  if (isFusion_(p)) return COLOR_WITH_FUSION;
  if (!pkg || /see shopify/i.test(pkg)) return COLOR_UNKNOWN;
  return COLOR_LITTLE_TOWN;
}

function buildTitle_(p) {
  var who = (p.customerName || '').trim();
  if (p.venue === 'fusion') return '☕ Fusion' + (who ? ' — ' + who : '');
  var pkg = isFusion_(p) ? ' +Fusion' : '';
  return '🎉 Party' + pkg + (who ? ' — ' + who : '');
}

function buildDescription_(p) {
  var lines = [];

  // Spelled out because Google shows every event in the VIEWER's timezone, not
  // the venue's. An account left on Eastern displays a 1pm party as 2pm with no
  // hint anything is off — and someone turns up an hour late to a building
  // that's been booked out. Writing the real local time onto the event means
  // the truth survives a wrong timezone setting.
  if (p.partyTime) lines.push('⏰ ' + p.partyTime + ' Central (venue local time)');

  if (p.venue === 'fusion') {
    lines.push('Fusion café buyout — the playhouse is NOT booked.');
  }
  if (p.package) lines.push('Package: ' + p.package);
  lines.push('');
  if (p.customerName) lines.push('Name:  ' + p.customerName);
  if (p.customerPhone) lines.push('Phone: ' + p.customerPhone);
  if (p.customerEmail) lines.push('Email: ' + p.customerEmail);
  lines.push('');
  if (p.orderName) lines.push('Order ' + p.orderName + (p.total ? '  ·  $' + p.total : ''));
  lines.push('');
  lines.push(p.venue === 'fusion'
    ? '— added automatically from fusioncoffeeshop.com'
    : '— added automatically from your Shopify order email');
  return lines.join('\n');
}

// ─── READING THE SLOT ───────────────────────────────────────────────────────

/**
 * "2026-06-13" + "4:30–6:30 PM"  →  { start: Date, end: Date }
 *
 * The slot strings come from SLOTS_BY_DOW in the theme's main.js and use an EN
 * DASH, with AM/PM only on the second half. Plain hyphens and em dashes are
 * handled too, in case a paste ever mangles them.
 *
 * Fusion sends the identical strings — the two venues were deliberately aligned
 * onto the same three windows — so this needs nothing extra for them.
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

  var start = ctDate_(+d[1], +d[2], +d[3], to24_(a.h, a.mer), a.m);
  var end = ctDate_(+d[1], +d[2], +d[3], to24_(b.h, b.mer), b.m);

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

/**
 * The exact instant that is <h:mi> WALL-CLOCK TIME in Fairfield on that day,
 * whatever timezone this script is set to.
 *
 * `new Date(y, m, d, h, mi)` would silently use the project's timezone, so a
 * sheet on someone else's default would put every party on at the wrong hour.
 * A hardcoded -5/-6 would be wrong half the year. So: ask what offset Central
 * actually had on that date and correct for it.
 */
function ctDate_(y, mo, d, h, mi) {
  var wall = Date.UTC(y, mo - 1, d, h, mi, 0);
  var ms = wall;
  for (var i = 0; i < 2; i++) ms = wall - tzOffsetMs_(new Date(ms));
  return new Date(ms);
}

function tzOffsetMs_(dt) {
  var z = Utilities.formatDate(dt, TIMEZONE, 'Z'); // "-0500" (CDT) / "-0600" (CST)
  var sign = z.charAt(0) === '-' ? -1 : 1;
  return sign * ((parseInt(z.substr(1, 2), 10) * 60 + parseInt(z.substr(3, 2), 10)) * 60000);
}

// ─── CALENDAR PLUMBING ──────────────────────────────────────────────────────

/**
 * The calendar this account WRITES to.
 *
 * ⚠️ Ownership is checked, not just the name. Once littletown's calendar has
 * been shared into another account, that account's getCalendarsByName() and
 * getCalendarById() both return it happily — read-only. The script would then
 * spend every run failing to write to a calendar it doesn't own, and the errors
 * wouldn't point anywhere near the real cause. isOwnedByMe() is the difference
 * between "I can see this" and "I can write to this".
 *
 * So an account with the shared calendar visible still creates its own when it
 * runs setup, which is the correct outcome: reminders only ever fire for the
 * owner, so a second account wanting reminders needs a calendar of its own.
 */
/**
 * The one this account owns, or null. Never creates anything, so it's safe for
 * read-only callers like showStatus.
 *
 * Checks the remembered id first, then falls back to matching by name — under
 * BOTH the current name and any it used to have, so a rename doesn't lose an
 * account that hasn't run since.
 */
function findOwnedCalendar_() {
  var props = PropertiesService.getUserProperties();
  var cached = props.getProperty('calendarId');
  if (cached) {
    var hit = CalendarApp.getCalendarById(cached);
    if (hit && hit.isOwnedByMe()) return hit;
    // Falls through when the id belongs to another account, or resolves to one
    // merely shared with us — exactly what happens once this calendar has been
    // shared around, or if properties ride along with a copied sheet.
  }

  for (var n = 0; n < CALENDAR_NAMES_.length; n++) {
    var found = CalendarApp.getCalendarsByName(CALENDAR_NAMES_[n]) || [];
    for (var i = 0; i < found.length; i++) {
      if (found[i].isOwnedByMe()) return found[i];
    }
  }
  return null;
}

/**
 * Every name this calendar has ever had, newest first. Old names stay listed
 * so a rename finds and renames the existing calendar instead of matching
 * nothing and creating a second, empty one beside it.
 */
var CALENDAR_NAMES_ = [CALENDAR_NAME, 'Little Town Parties'];

/** The calendar this account WRITES to, creating or renaming it as needed. */
function getCalendar_() {
  var cal = findOwnedCalendar_();

  if (!cal) {
    cal = CalendarApp.createCalendar(CALENDAR_NAME, {
      summary: 'Parties booked on thelittletownplayhouse.com and fusioncoffeeshop.com',
      timeZone: TIMEZONE,
      color: CalendarApp.Color.PINK
    });
  } else if (cal.getName() !== CALENDAR_NAME) {
    // Rename in place: keeps every event, reminder and share intact. Creating a
    // new one under the new name would silently strand all of it.
    Logger.log('Renaming "' + cal.getName() + '" → "' + CALENDAR_NAME + '"');
    cal.setName(CALENDAR_NAME);
  }

  PropertiesService.getUserProperties().setProperty('calendarId', cal.getId());
  return cal;
}

/**
 * Scans a wide window rather than just the party's own day — a rescheduled
 * booking has already moved, so looking only at the new date would miss it and
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

// ─── SAFETY NET ─────────────────────────────────────────────────────────────

/**
 * Emails the shop when a booking can't be read, throttled so a recurring
 * problem can't flood the inbox every 15 minutes. Without this the sync could
 * fail quietly forever, the worst outcome for a booking system.
 */
function alertOwner_(err, context) {
  try {
    var msg = String((err && err.message) || err);
    var props = PropertiesService.getUserProperties();
    var key = 'lastAlert:' + msg.slice(0, 60);
    if (Date.now() - Number(props.getProperty(key) || 0) < 6 * 60 * 60 * 1000) return;
    props.setProperty(key, String(Date.now()));

    notify_(
      '⚠️ A party did NOT reach the calendar',
      'A booking came through but could not be added to your "' + CALENDAR_NAME + '" ' +
      'calendar. Please add it by hand, then forward this to whoever set this up.\n\n' +
      'Order/email: ' + (context || 'unknown') + '\n' +
      'Problem: ' + msg
    );
  } catch (ignored) {
    // The alarm bell must never be the thing that throws.
  }
}

function notify_(subject, body) {
  MailApp.sendEmail(OWNER_EMAIL, 'Little Town — ' + subject, body);
}

/**
 * Emails Fusion about a new booking that needs the café — the "+ Fusion"
 * buyouts and Fusion's own bookings. A plain Little Town party never involves
 * them, so they never hear about it.
 *
 * This exists because Google refuses to do it: reminders are private to the
 * account that owns a calendar and cannot be set for anyone else, so a shared
 * calendar shows Fusion the dates but will never alert them. Sending mail from
 * here is the only way they find out without configuring anything themselves.
 *
 * Never allowed to break a booking — a failed email is worth a log line, not a
 * missing calendar event.
 */
function notifyFusionIfTheirs_(p) {
  if (!NOTIFY_FUSION_EMAIL) return;
  var theirs = (p.venue === 'fusion') || isFusion_(p);
  if (!theirs) return;

  try {
    var when = Utilities.formatDate(parseSlot_(p.partyDate, p.partyTime).start,
                                    TIMEZONE, 'EEEE, MMMM d');
    var isCafeOnly = p.venue === 'fusion';

    MailApp.sendEmail(
      NOTIFY_FUSION_EMAIL,
      (isCafeOnly ? '☕ Fusion booked — ' : '☕ Barista needed — ') + when,
      (isCafeOnly
        ? 'A Fusion café booking has come in. The playhouse is NOT booked.\n\n'
        : 'A Little Town party has booked the + Fusion package, so the café ' +
          'opens too and will need someone on.\n\n') +
      when + '\n' +
      p.partyTime + ' Central\n\n' +
      (p.customerName ? 'Name:  ' + p.customerName + '\n' : '') +
      (p.customerPhone ? 'Phone: ' + p.customerPhone + '\n' : '') +
      (p.orderName ? '\nOrder ' + p.orderName + (p.total ? '  ·  $' + p.total : '') + '\n' : '') +
      '\nIt is already on the "' + CALENDAR_NAME + '" calendar.'
    );
    Logger.log('Told Fusion about ' + p.partyDate + ' ' + p.partyTime);
  } catch (err) {
    Logger.log('Could not email Fusion: ' + ((err && err.message) || err));
  }
}

/**
 * Gives other Google accounts read access to the calendar, so the parties show
 * up in the diary he actually looks at.
 *
 * Done with a direct Calendar API call rather than CalendarApp, which has no
 * sharing methods at all, and rather than the advanced Calendar service, which
 * would need an extra manifest step during setup. The OAuth token from the
 * calendar permission he already grants covers this.
 *
 * Never allowed to break setup — a failed share is worth a log line, not a
 * dead calendar. Re-running is harmless; the API just overwrites the rule.
 */
function shareCalendarWith_(cal) {
  var shared = [];
  var list = SHARE_CALENDAR_WITH || [];

  for (var i = 0; i < list.length; i++) {
    var who = String(list[i] || '').trim();
    if (!who) continue;
    try {
      var res = UrlFetchApp.fetch(
        'https://www.googleapis.com/calendar/v3/calendars/' +
          encodeURIComponent(cal.getId()) + '/acl',
        {
          method: 'post',
          contentType: 'application/json',
          headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
          payload: JSON.stringify({
            role: 'reader',
            scope: { type: 'user', value: who }
          }),
          muteHttpExceptions: true
        }
      );
      var code = res.getResponseCode();
      if (code >= 200 && code < 300) {
        Logger.log('Calendar shared with ' + who);
        shared.push(who);
      } else {
        Logger.log('Could not share with ' + who + ' (' + code + '): ' + res.getContentText());
      }
    } catch (err) {
      Logger.log('Could not share with ' + who + ': ' + ((err && err.message) || err));
    }
  }
  return shared;
}

// ─── RUN BY HAND IF EVER NEEDED ─────────────────────────────────────────────

/**
 * Seeds parties booked BEFORE the order email carried a LTPCAL1 line. Those
 * emails have no data line, so the Gmail sync can never find them — this is the
 * only way they reach the calendar.
 *
 * Called by setup(), and by the sync whenever SEED_VERSION has changed. Safe to
 * run repeatedly: the ids come from date + time, so a second run updates the
 * same events rather than duplicating.
 */
function backfillExistingBookings() {
  // Slots read off the live availability list, everything else off the Shopify
  // orders screen, both on 2026-08-10. Package is derived from what was paid:
  // $185 = Little Town, $295 = Little Town + Fusion.
  var SEED = [
    { date: '2026-08-23', time: '1:00–3:00 PM', name: '#1008', who: 'Ruth Kissner',      pkg: 'Little Town',          total: '185.00' },
    { date: '2026-09-13', time: '1:00–3:00 PM', name: '#1007', who: 'Megan Lentz',       pkg: 'Little Town',          total: '185.00' },
    { date: '2026-09-20', time: '1:00–3:00 PM', name: '#1005', who: 'Michaela Harrison', pkg: 'Little Town + Fusion', total: '295.00' },
    { date: '2026-09-27', time: '4:00–6:00 PM', name: '#1004', who: 'Chloe Wells',       pkg: 'Little Town',          total: '185.00' },
    { date: '2026-10-10', time: '4:30–6:30 PM', name: '#1003', who: 'Sheila Kinney',     pkg: 'Little Town + Fusion', total: '295.00' },
    { date: '2026-10-11', time: '1:00–3:00 PM', name: '#1002', who: 'Jasmine Downen',    pkg: 'Little Town',          total: '185.00' }
  ];

  var today = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
  var done = 0;

  for (var i = 0; i < SEED.length; i++) {
    var s = SEED[i];

    // These dates are fixed in the file, so once they're in the past this would
    // keep re-creating dead events every time it runs. Skip them.
    if (s.date < today) continue;

    try {
      upsertEvent_({
        // Deliberately NOT the real Shopify order id. An earlier run already
        // created these events tagged this way, and changing the id would make
        // the next run add duplicates instead of updating them in place.
        orderId: 'backfill-' + s.date + '-' + s.time.replace(/[^0-9]/g, ''),
        orderName: s.name,
        partyDate: s.date,
        partyTime: s.time,
        customerName: s.who,
        package: s.pkg,
        total: s.total,
        // These are historical. Without this, a fresh account running setup
        // would email Fusion about parties they already know about.
        silent: true
      });
      done++;
      Logger.log('✓ ' + s.date + '  ' + s.time + '  ' + s.who + '  (' + s.pkg + ')');
    } catch (err) {
      // Logged as well as emailed: when this is run by hand from the editor the
      // alert goes to the SHOP's inbox, not the person sitting there running it.
      Logger.log('✗ ' + s.date + '  ' + s.time + '  — ' + ((err && err.message) || err));
      alertOwner_(err, 'backfill ' + s.date + ' ' + s.time);
    }
  }
  Logger.log('Backfilled ' + done + ' of ' + SEED.length + ' booking(s) onto "' + CALENDAR_NAME + '".');
  return done;
}

/**
 * Proves the date maths and the calendar work, without needing a real order.
 * Creates a fake party two weeks out, re-sends it to check it updates rather
 * than duplicates, then deletes it.
 */
function runSelfTest() {
  var d = new Date();
  d.setDate(d.getDate() + 14);
  var dateStr = Utilities.formatDate(d, TIMEZONE, 'yyyy-MM-dd');

  var fake = {
    orderId: 'SELFTEST-' + dateStr,
    orderName: '#SELFTEST',
    partyDate: dateStr,
    partyTime: '4:00–6:00 PM',
    customerName: 'Test Booking (safe to ignore)',
    customerPhone: '555-0100',
    customerEmail: 'test@example.com',
    package: 'Little Town',
    total: '185.00'
  };

  var a = upsertEvent_(fake);
  var b = upsertEvent_(fake);
  Logger.log('first: ' + a.action + ' / second: ' + b.action);

  var cal = getCalendar_();
  var ev = findEventByOrderId_(cal, fake.orderId);
  if (ev) ev.deleteEvent();

  Logger.log(
    a.action === 'created' && b.action === 'unchanged'
      ? '✅ PASS — create, update-in-place and delete all work.'
      : '❌ FAIL — check the log above.'
  );
}

/**
 * Same idea for the Fusion half: proves the feed is reachable, the secret is
 * right, and a Fusion booking becomes a correctly-coloured event that does NOT
 * carry an ltSlot tag — the thing that would get it deleted by pruneCancelled_.
 */
function runFusionSelfTest() {
  var secret = fusionSecret_();
  if (!secret) {
    Logger.log('❌ FUSION_FEED_SECRET is not set. Project Settings → Script Properties → add it.');
    return;
  }

  var res = UrlFetchApp.fetch(FUSION_FEED_URL, {
    headers: { Authorization: 'Bearer ' + secret },
    muteHttpExceptions: true
  });
  Logger.log('Feed responded ' + res.getResponseCode());
  if (res.getResponseCode() !== 200) {
    Logger.log('❌ Check the secret matches PARTY_FEED_SECRET in Cloudflare.');
    return;
  }
  Logger.log('Bookings in feed: ' + ((JSON.parse(res.getContentText()).bookings || []).length));

  var d = new Date();
  d.setDate(d.getDate() + 14);
  var dateStr = Utilities.formatDate(d, TIMEZONE, 'yyyy-MM-dd');

  var fake = {
    orderId: 'FUSIONTEST-' + dateStr,
    orderName: 'Fusion booking',
    partyDate: dateStr,
    partyTime: '1:00–3:00 PM',
    customerName: 'Fusion Test (safe to ignore)',
    customerPhone: '555-0100',
    package: 'Fusion café',
    total: '175.00',
    venue: 'fusion'
  };

  upsertEvent_(fake);
  var ev = findEventByOrderId_(getCalendar_(), fake.orderId);
  var colourOk = ev && ev.getColor() === COLOR_FUSION_ONLY;
  var noSlotTag = ev && !ev.getTag('ltSlot');
  if (ev) ev.deleteEvent();

  Logger.log(
    colourOk && noSlotTag
      ? '✅ PASS — feed reachable, event black, and no ltSlot tag so prune will leave it alone.'
      : '❌ FAIL — colour ok: ' + colourOk + ', ltSlot withheld: ' + noSlotTag
  );
}
