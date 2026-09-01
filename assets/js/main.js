/* ============================================================
   Little Town Playhouse — interactions
   Visual prototype only. No booking/payment logic anywhere.
   ============================================================ */
(function () {
  "use strict";

  /* ---- Sticky header shadow on scroll ---- */
  var header = document.querySelector(".site-header");
  if (header) {
    var onScroll = function () {
      header.classList.toggle("is-stuck", window.scrollY > 8);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* ---- Mobile nav toggle ----
     The full open/close logic (scroll-lock, Esc / outside-tap / resize close,
     focus management + inert a11y) lives in the v13 "Hardened mobile menu"
     module near the bottom of this file. Kept there so all the menu state is
     owned in one place rather than split across two handlers. */

  /* ---- Scroll reveal via IntersectionObserver ---- */
  var revealEls = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && revealEls.length) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add("is-visible"); });
  }

  /* ---- FAQ accordion ---- */
  document.querySelectorAll(".acc-trigger").forEach(function (btn, i) {
    var item = btn.closest(".acc-item");
    var panel = item && item.querySelector(".acc-panel");
    if (panel) {
      if (!panel.id) panel.id = "acc-panel-" + (i + 1);
      btn.setAttribute("aria-controls", panel.id);
    }
    btn.addEventListener("click", function () {
      if (!item) return;
      var expanded = item.getAttribute("aria-expanded") === "true";
      item.setAttribute("aria-expanded", expanded ? "false" : "true");
      btn.setAttribute("aria-expanded", expanded ? "false" : "true");
    });
  });

  /* ---- Visit Us: highlight today's row in the hours card
     (ported from a page inline script so it also runs in the Shopify theme) ---- */
  var todayRows = document.querySelectorAll(".hours-row[data-days]");
  if (todayRows.length) {
    var todayDow = new Date().getDay(); // 0=Sun … 6=Sat
    todayRows.forEach(function (row) {
      var days = (row.getAttribute("data-days") || "").split(",").map(Number);
      if (days.indexOf(todayDow) !== -1) row.classList.add("is-today");
    });
  }

  /* ---- Play & Pricing: stagger the storefront cards' pop-in
     (ported from a page inline script; self-guards to that page) ---- */
  var sfCards = document.querySelectorAll(".storefront-card");
  if (sfCards.length && !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches)) {
    sfCards.forEach(function (card, i) { card.style.transitionDelay = (i * 0.07) + "s"; });
  }

  /* ---- Fresh cart on every buy ----
     Buy buttons go straight to Shopify checkout, where there is no built-in
     "remove item" control — and cart permalinks ADD to the cart rather than
     replace it, so a stray item from an earlier click would ride along to
     checkout with no way to drop it. Before any buy we empty the cart via the
     Shopify AJAX API, so the customer always lands on checkout with exactly the
     one thing they just chose. Fails OPEN: if the request errors, stalls, or JS
     is off, the buy still goes through (the old add-and-go behaviour) — a hiccup
     must never block a sale. Shared by the buy links, the party booking forms,
     and the product-page fallback below. */
  function clearCartThenGo(go) {
    var done = false;
    function once() { if (done) return; done = true; go(); }
    setTimeout(once, 1200);            // don't hang the buy if the request stalls
    try {
      fetch("/cart/clear.js", { method: "POST", headers: { "Content-Type": "application/json" } })
        .then(once, once);
    } catch (e) { once(); }
  }

  /* ============================================================
     Purchase agreement gate
     ------------------------------------------------------------
     Nothing can be bought until the customer ticks the legal agreement.
     EVERY buy path is gated — the one-tap membership and day-pass permalinks,
     the two party booking forms, the product-page fallback (all via gatedBuy),
     and the cart page's own Checkout button (which gates without clearing; see
     there). Clicking any of them opens a small modal: a short summary, a link
     to the full agreement, and a required checkbox. Only "Agree & continue"
     proceeds to Shopify checkout.

     Unlike clearCartThenGo this fails CLOSED — no tick, no purchase. Only the
     *stamping* below fails open, so a flaky network can never block a sale the
     customer already agreed to.

     The acceptance is then recorded ON THE ORDER, which is the part that makes
     the tick worth anything later:
       - forms  -> a hidden properties[Agreement] line-item property
       - always -> an "Agreement" cart attribute via /cart/update.js
     Both carry AGREEMENT_VERSION + an ISO timestamp, and show up in the Shopify
     admin on the order. Bump AGREEMENT_VERSION whenever the wording changes so
     acceptances of the old text stay distinguishable from the new.

     Acceptance is deliberately NOT remembered between purchases: it's a
     per-order acceptance, so it's asked every time. One tap, and the record on
     each order stands on its own.
     ============================================================ */

  var AGREEMENT_VERSION = "1.0";

  /* >>> EDIT THE WORDING HERE <<<
     This is the summary shown in the box at the moment of purchase. The FULL
     agreement lives on terms.html (Shopify: /pages/terms) — edit both, then
     bump AGREEMENT_VERSION above. Keep the summary short; the full text is one
     tap away and is what the checkbox actually binds the customer to. */
  var AGREEMENT = {
    title: "Before you check out",
    intro: "Please read and accept our Participant Agreement. It affects important legal rights.",
    points: [
      "A responsible adult must stay in the building and <strong>actively supervise their own children</strong> the whole visit. We're not a drop-off facility.",
      "Play carries real risks — including falls, collisions, choking, serious injury and death. You accept those risks for yourself and the children in your care.",
      "You <strong>release Little Town Playhouse from liability</strong> for ordinary negligence, and agree to indemnify us for harm caused by your party, to the extent Illinois law allows.",
      "You authorize emergency medical care if it's ever needed, and accept responsibility for the cost."
    ],
    linkText: "Read the full agreement",
    checkbox: "I have read and accept the Participant Agreement, Acknowledgment of Risk, Release, Indemnification and Medical Authorization.",
    cta: "Accept &amp; continue",
    cancel: "Cancel"
  };

  /* The full-agreement URL. Read off the footer link so the same JS works on
     the static preview (terms.html) and on Shopify (/pages/terms). */
  function agreementHref() {
    var link = document.querySelector("[data-terms-link]");
    return (link && link.getAttribute("href")) || "/pages/terms";
  }

  var agreeEl = null;        // the modal, built once on first use
  var agreeAccept = null;    // what to run once they tick + confirm
  var agreeLastFocus = null; // the buy button, so focus can go back on cancel

  function buildAgreeModal() {
    var el = document.createElement("div");
    el.className = "lt-agree";
    el.hidden = true;
    el.innerHTML =
      '<div class="lt-agree__backdrop" data-agree-cancel></div>' +
      '<div class="lt-agree__box" role="dialog" aria-modal="true" aria-labelledby="lt-agree-title" tabindex="-1">' +
        '<button type="button" class="lt-agree__x" data-agree-cancel aria-label="Close">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
        "</button>" +
        '<h2 class="lt-agree__title" id="lt-agree-title">' + AGREEMENT.title + "</h2>" +
        '<p class="lt-agree__intro">' + AGREEMENT.intro + "</p>" +
        '<ul class="lt-agree__points">' +
          AGREEMENT.points.map(function (p) {
            // The text is wrapped in its own span on purpose: the <li> is a flex
            // row, so a bare <strong> in the copy would become a second flex
            // item and get squeezed into its own column.
            return '<li><span class="lt-agree__tick" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span><span>' + p + "</span></li>";
          }).join("") +
        "</ul>" +
        '<a class="lt-agree__link" href="' + agreementHref() + '" target="_blank" rel="noopener">' + AGREEMENT.linkText +
          // The arrow icon signals "new tab" visually; say it out loud too, so
          // screen-reader users aren't surprised by the context switch.
          '<span class="lt-agree__sr"> (opens in a new tab)</span>' +
          ' <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/></svg>' +
        "</a>" +
        '<label class="lt-agree__check">' +
          '<input type="checkbox" data-agree-box>' +
          '<span class="lt-agree__box-ui" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>' +
          "<span>" + AGREEMENT.checkbox + "</span>" +
        "</label>" +
        '<div class="lt-agree__actions">' +
          '<button type="button" class="btn btn--block btn--coral btn--pop lt-agree__go" data-agree-go disabled>' + AGREEMENT.cta + "</button>" +
          '<button type="button" class="lt-agree__cancel" data-agree-cancel>' + AGREEMENT.cancel + "</button>" +
        "</div>" +
      "</div>";
    document.body.appendChild(el);

    var box = el.querySelector("[data-agree-box]");
    var go = el.querySelector("[data-agree-go]");

    // The CTA only unlocks once the box is ticked — that IS the gate.
    box.addEventListener("change", function () {
      go.disabled = !box.checked;
      el.classList.toggle("is-ready", box.checked);
    });

    el.querySelectorAll("[data-agree-cancel]").forEach(function (b) {
      b.addEventListener("click", function () { closeAgree(true); });
    });

    go.addEventListener("click", function () {
      if (!box.checked) return;          // belt-and-braces: never proceed unticked
      var run = agreeAccept;
      closeAgree(false);
      if (run) run();
    });

    // Esc cancels; Tab is trapped inside the dialog while it's open.
    el.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); closeAgree(true); return; }
      if (e.key !== "Tab") return;
      var f = el.querySelectorAll('a[href], button:not([disabled]), input:not([disabled])');
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      var at = document.activeElement;
      // Opening focuses the dialog box itself, which is tabindex="-1" and so
      // isn't in the list above. Shift+Tab from there would walk out of the
      // dialog — and since this listener lives on the dialog, Esc would stop
      // working too. Treat "focus is on the box, not on a control" as being at
      // the start: Tab goes to the first control, Shift+Tab wraps to the last.
      var onAControl = Array.prototype.indexOf.call(f, at) !== -1;
      if (!onAControl) { e.preventDefault(); (e.shiftKey ? last : first).focus(); return; }
      if (e.shiftKey && at === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
    });

    return el;
  }

  /* Take the rest of the page out of the tab order + the a11y tree while the
     dialog is open, so a screen reader can't wander behind it. Each sibling's
     previous state is stashed and restored — the mobile drawer manages its own
     aria-hidden/inert, and we must not stomp on it. `modalEl` defaults to the
     agreement dialog; the socks upsell (a second, separate dialog) passes
     itself so it isn't the one hidden from itself. */
  function setBackgroundInert(on, modalEl) {
    var skip = modalEl || agreeEl;
    Array.prototype.forEach.call(document.body.children, function (child) {
      if (child === skip) return;
      if (on) {
        child.__agreeAria = child.getAttribute("aria-hidden");
        child.__agreeInert = !!child.inert;
        child.setAttribute("aria-hidden", "true");
        try { child.inert = true; } catch (e) {}
      } else {
        if (child.__agreeAria == null) child.removeAttribute("aria-hidden");
        else child.setAttribute("aria-hidden", child.__agreeAria);
        try { child.inert = !!child.__agreeInert; } catch (e) {}
        delete child.__agreeAria;
        delete child.__agreeInert;
      }
    });
  }

  function openAgree(onAccept) {
    if (!agreeEl) agreeEl = buildAgreeModal();
    agreeAccept = onAccept;
    agreeLastFocus = document.activeElement;

    // Always reopen unticked — every purchase gets its own acceptance.
    var box = agreeEl.querySelector("[data-agree-box]");
    var go = agreeEl.querySelector("[data-agree-go]");
    box.checked = false;
    go.disabled = true;
    agreeEl.classList.remove("is-ready");
    // The href is resolved lazily: on Shopify the footer link is the source of truth.
    agreeEl.querySelector(".lt-agree__link").setAttribute("href", agreementHref());

    agreeEl.hidden = false;
    setBackgroundInert(true);
    // Next frame, so the open transition actually runs.
    requestAnimationFrame(function () { agreeEl.classList.add("is-open"); });
    // Hiding the page's scrollbar would reflow everything a few px wider on
    // desktop; pad the gap back so nothing visibly jumps.
    var gap = window.innerWidth - document.documentElement.clientWidth;
    if (gap > 0) document.documentElement.style.paddingRight = gap + "px";
    document.documentElement.classList.add("agree-open");
    var dialog = agreeEl.querySelector(".lt-agree__box");
    try { dialog.focus({ preventScroll: true }); } catch (e) { dialog.focus(); }
  }

  function closeAgree(returnFocus) {
    if (!agreeEl || agreeEl.hidden) return;
    agreeAccept = null;
    agreeEl.classList.remove("is-open");
    document.documentElement.classList.remove("agree-open");
    document.documentElement.style.paddingRight = "";
    agreeEl.hidden = true;
    setBackgroundInert(false);
    if (returnFocus && agreeLastFocus && agreeLastFocus.focus) {
      try { agreeLastFocus.focus({ preventScroll: true }); } catch (e) { agreeLastFocus.focus(); }
    }
    agreeLastFocus = null;
  }

  /* ============================================================
     "Don't forget socks!" upsell
     ------------------------------------------------------------
     Fires once, right after the agreement is accepted, for Day Pass and
     membership buys only (data-daypass-buy / data-membership-buy — set by
     gateEveryBuy below). A separate dialog from the agreement box, reusing its
     .lt-agree* styling so it doesn't need its own CSS, but its own element:
     the two can't be the same instance since one leads straight into the
     other on the same click.

     Skipping (Esc, backdrop, "No thanks") and adding both resolve with a
     quantity — 0 for skip — so the caller always gets a definite answer and
     never hangs waiting on a dialog the customer walked away from.

     If the socks product isn't published yet (LT_SOCKS_VARIANT_ID is null,
     set in layout/theme.liquid), the upsell is skipped entirely rather than
     offering something that can't reach checkout. ============================================================ */

  var upsellEl = null;
  var upsellAccept = null;   // function(qty) — run once, on skip or add
  var upsellLastFocus = null;

  function buildUpsellModal() {
    var base = parseFloat(window.LT_SOCKS_PRICE) || 4.00;
    var opts = [1, 2, 3, 4].map(function (n) {
      var price = (base * n).toFixed(2);
      return '<option value="' + n + '"' + (n === 1 ? " selected" : "") + ">" +
        n + (n === 1 ? " pair" : " pairs") + " — $" + price + "</option>";
    }).join("");

    var el = document.createElement("div");
    el.className = "lt-agree lt-upsell";
    el.hidden = true;
    el.innerHTML =
      '<div class="lt-agree__backdrop" data-upsell-skip></div>' +
      '<div class="lt-agree__box" role="dialog" aria-modal="true" aria-labelledby="lt-upsell-title" tabindex="-1">' +
        '<button type="button" class="lt-agree__x" data-upsell-skip aria-label="Close">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
        "</button>" +
        '<h2 class="lt-agree__title" id="lt-upsell-title">Don’t forget socks!</h2>' +
        '<p class="lt-agree__intro">Socks only on the play floor, no shoes allowed. Add a pair or two now and skip the trip back out to the car.</p>' +
        '<div class="cp-tier" style="margin:0 0 1.1rem">' +
          '<label class="cp-tier-label" for="upsell-qty">How many pairs?</label>' +
          '<select class="cp-tier-select" id="upsell-qty" data-upsell-qty>' + opts + "</select>" +
        "</div>" +
        '<div class="lt-agree__actions">' +
          '<button type="button" class="btn btn--block btn--coral btn--pop" data-upsell-add>Add socks &amp; continue</button>' +
          '<button type="button" class="lt-agree__cancel" data-upsell-skip>No thanks, just checkout</button>' +
        "</div>" +
      "</div>";
    document.body.appendChild(el);

    el.querySelectorAll("[data-upsell-skip]").forEach(function (b) {
      b.addEventListener("click", function () { closeUpsell(0, true); });
    });
    el.querySelector("[data-upsell-add]").addEventListener("click", function () {
      var qty = parseInt(el.querySelector("[data-upsell-qty]").value, 10) || 0;
      closeUpsell(qty, false);
    });

    // Esc cancels (= skip); Tab is trapped inside the dialog while it's open —
    // same pattern as the agreement box above.
    el.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); closeUpsell(0, true); return; }
      if (e.key !== "Tab") return;
      var f = el.querySelectorAll('a[href], button:not([disabled]), select, input:not([disabled])');
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      var at = document.activeElement;
      var onAControl = Array.prototype.indexOf.call(f, at) !== -1;
      if (!onAControl) { e.preventDefault(); (e.shiftKey ? last : first).focus(); return; }
      if (e.shiftKey && at === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
    });

    return el;
  }

  function openUpsell(onDone, force) {
    if (!force && !window.LT_SOCKS_VARIANT_ID) { onDone(0); return; }
    if (!upsellEl) upsellEl = buildUpsellModal();
    upsellAccept = onDone;
    upsellLastFocus = document.activeElement;
    upsellEl.querySelector("[data-upsell-qty]").value = "1";

    upsellEl.hidden = false;
    setBackgroundInert(true, upsellEl);
    requestAnimationFrame(function () { upsellEl.classList.add("is-open"); });
    var gap = window.innerWidth - document.documentElement.clientWidth;
    if (gap > 0) document.documentElement.style.paddingRight = gap + "px";
    document.documentElement.classList.add("agree-open");
    var dialog = upsellEl.querySelector(".lt-agree__box");
    try { dialog.focus({ preventScroll: true }); } catch (e) { dialog.focus(); }
  }

  function closeUpsell(qty, returnFocus) {
    if (!upsellEl || upsellEl.hidden) return;
    var run = upsellAccept;
    upsellAccept = null;
    upsellEl.classList.remove("is-open");
    document.documentElement.classList.remove("agree-open");
    document.documentElement.style.paddingRight = "";
    upsellEl.hidden = true;
    setBackgroundInert(false, upsellEl);
    if (returnFocus && upsellLastFocus && upsellLastFocus.focus) {
      try { upsellLastFocus.focus({ preventScroll: true }); } catch (e) { upsellLastFocus.focus(); }
    }
    upsellLastFocus = null;
    if (run) run(qty);
  }

  /* Add `qty` pairs of socks to the cart (already-cleared by this point), then
     continue. Runs AFTER clearCartThenGo and BEFORE the day-pass/membership
     item is added, so both land in the same cart — permalinks and /cart/add
     merge into whatever's already there rather than replacing it (see
     clearCartThenGo above). qty 0 (skipped, or socks unavailable) is a no-op.
     Fails open on its own deadline, same as the other cart writes here: a
     stalled upsell add must never block the sale the customer already agreed to. */
  function addSocksThenGo(qty, cb) {
    if (!qty || !window.LT_SOCKS_VARIANT_ID) { cb(); return; }
    var done = false;
    function once() { if (done) return; done = true; cb(); }
    setTimeout(once, 1200);
    try {
      fetch("/cart/add.js", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: window.LT_SOCKS_VARIANT_ID, quantity: qty })
      }).then(once, once);
    } catch (e) { once(); }
  }

  /* Write the acceptance onto the order, then continue. The line-item property
     (forms only) is set synchronously and rides along with the POST; the cart
     attribute is a separate AJAX write that covers the permalink buys too.
     Fails OPEN on its own deadline — a stalled write must not eat the sale. */
  function stampAgreementThenGo(form, go) {
    var stamp = "Accepted " + new Date().toISOString() + " (v" + AGREEMENT_VERSION + ")";
    if (form) {
      var input = form.querySelector('input[name="properties[Agreement]"]');
      if (!input) {
        input = document.createElement("input");
        input.type = "hidden";
        input.name = "properties[Agreement]";
        form.appendChild(input);
      }
      input.value = stamp;
    }
    var done = false;
    function once() { if (done) return; done = true; go(); }
    setTimeout(once, 900);
    try {
      fetch("/cart/update.js", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attributes: { Agreement: stamp } })
      }).then(once, once);
    } catch (e) { once(); }
  }

  /* The one entry point every buy path uses: agree -> empty the cart -> stamp
     the acceptance -> go. `form` is the form being submitted, or null for the
     one-tap permalink links. */
  /* Single-flight latch. Between the tap and the browser actually leaving for
     Shopify there is a real gap — clearCartThenGo alone waits up to 1200ms, and
     stampAgreementThenGo another 900ms — during which nothing on screen changes.
     On a slow phone that reads as "it didn't work", so people tap again. Each tap
     used to run its own POST /cart/add, the line merged to quantity 2, and
     checkout showed $370 for one party. Latch on first accept, and stay latched:
     the page is on its way out, so there is no state to release. */
  var buyInFlight = false;

  /* Grey out every buy control once a purchase is committed, so the pending tap
     is visible and the other package button can't be started alongside it.
     Deliberately does NOT touch button[name="checkout"] on the cart page: that
     path re-submits via requestSubmit(btn), which needs the button enabled to
     carry its own name. Safe for the forms here — they submit programmatically,
     which never serialises the submitter, and each carries its variant in a
     hidden name="id" input. */
  function lockBuyControls() {
    document.querySelectorAll("[data-bk-form] button[type=submit], #pdp-form button[type=submit]").forEach(function (b) {
      b.disabled = true;
    });
    document.querySelectorAll("[data-bk-form], #pdp-form, a[data-buy-href]").forEach(function (el) {
      el.classList.add("is-buying");
    });
  }

  /* The one entry point every buy path uses: agree -> (Day Pass/membership
     only: offer socks) -> empty the cart -> add any socks -> stamp the
     acceptance -> go. `form` is the form being submitted, or null for the
     one-tap permalink links. `offerSocks` gates the upsell dialog — only the
     Day Pass and membership buy paths pass it true (see gateEveryBuy below);
     everything else (parties, socks' own buy button, the safety-net permalink
     handler) proceeds straight through as before. */
  function gatedBuy(form, go, offerSocks) {
    if (buyInFlight) return;
    openAgree(function () {
      if (buyInFlight) return;   // double-tap landed while the agreement was open
      function proceed(sockQty) {
        if (buyInFlight) return;   // could also land while the upsell was open
        buyInFlight = true;
        lockBuyControls();
        clearCartThenGo(function () {
          addSocksThenGo(sockQty, function () { stampAgreementThenGo(form, go); });
        });
      }
      if (offerSocks) openUpsell(proceed); else proceed(0);
    });
  }

  /* ---- Party booking: a real calendar -> pick a weekend date -> pick a time
     -> pick a package -> Shopify checkout. Weekdays + past days are muted and
     non-selectable; weekends are tappable; fully-booked dates are greyed. The
     chosen date + time are written into every package form's hidden
     "properties[Party date and time]" input (so it lands on the order) and the
     buy buttons unlock. Forms POST to /cart/add with return_to=/checkout.

     BLOCKING SEAM: BOOKED maps "YYYY-MM-DD" -> array of taken slot strings.
     The backend populates window.LT_BOOKED (see SHOPIFY-MIGRATION.md §C); a
     date greys out only when ALL its slots are taken, and the time step hides
     individual taken slots. Empty = everything open.

     Wrapped in its own IIFE so the early return can't skip the [data-noop]
     handler below; no-ops cleanly if the calendar is absent (other pages). */
  (function partyBooking() {
    var cal = document.querySelector("[data-bk-cal]");
    if (!cal) return;

    var daysEl = cal.querySelector("[data-bk-days]");
    var titleEl = cal.querySelector("[data-bk-title]");
    var prevBtn = cal.querySelector("[data-bk-prev]");
    var nextBtn = cal.querySelector("[data-bk-next]");
    var timesWrap = document.querySelector("[data-bk-times]");
    var timesGrid = document.querySelector("[data-bk-times-grid]");
    var timesLabel = document.querySelector("[data-bk-times-label]");
    var packages = document.querySelector("[data-bk-packages]");
    var summary = document.querySelector("[data-bk-summary]");
    var summaryText = document.querySelector("[data-bk-summary-text]");
    var slotInputs = document.querySelectorAll("[data-bk-slot-input]");
    var dateInputs = document.querySelectorAll("[data-bk-date-input]");
    var timeInputs = document.querySelectorAll("[data-bk-time-input]");

    var MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    var SLOTS_BY_DOW = { 6: ["4:30–6:30 PM"], 0: ["1:00–3:00 PM", "4:00–6:00 PM"] }; // 6=Sat, 0=Sun
    var CHECK = '<span class="bk-slot-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>';
    // Availability comes from a shop metafield, injected by the build script as
    //   window.LT_BOOKED_RAW = "YYYY-MM-DD|slot;YYYY-MM-DD|slot;..."
    // (Shopify Flow writes the metafield on each order — see SHOPIFY-MIGRATION.md §C).
    // Also accepts a window.LT_BOOKED map; defaults to {} = everything open.
    var BOOKED = (function () {
      if (window.LT_BOOKED && typeof window.LT_BOOKED === "object") return window.LT_BOOKED;
      var map = {}, raw = window.LT_BOOKED_RAW;
      if (typeof raw === "string" && raw) {
        raw.split(/[;\n]+/).forEach(function (entry) {
          var p = entry.split("|"), d = (p[0] || "").trim(), s = (p[1] || "").trim();
          if (d) { (map[d] = map[d] || []).push(s); }
        });
      }
      return map;
    })();

    // Fusion next door sells the SAME café from its own site
    // (fusioncoffeeshop.com/party), so the "+ Fusion" package needs the room to
    // still be free over there. That availability arrives as a second shop
    // metafield, injected by the build script as:
    //   window.LT_FUSION_TAKEN = "YYYY-MM-DD|slot;YYYY-MM-DD|slot|lt;..."
    // Written by Fusion's checkout, and by our own Flow (whose entries carry a
    // third "|lt" field so Fusion can tell them apart). We ignore the third
    // field entirely: from this side, either source means the café is taken.
    //
    // DAY granularity, deliberately. Fusion's windows and ours don't line up
    // (their Saturday 3–5 overlaps our 4:30–6:30 by half an hour), so matching
    // on the exact slot string would leave the combo on sale for a room that is
    // already committed. Blocking the whole date over-blocks by design.
    //
    // This ONLY ever disables the "+ Fusion" card. The Little Town-only buyout
    // does not need the café and stays on sale — the date is never greyed out.
    var FUSION_TAKEN = (function () {
      var set = {}, raw = window.LT_FUSION_TAKEN;
      if (typeof raw === "string" && raw) {
        raw.split(/[;\n]+/).forEach(function (entry) {
          var d = (entry.split("|")[0] || "").trim();
          if (d) set[d] = true;
        });
      }
      return set;
    })();

    var today = new Date(); today.setHours(0, 0, 0, 0);
    var minDate = new Date(today); minDate.setDate(minDate.getDate() + 1); // earliest bookable = tomorrow
    // Cap forward paging to a sensible booking window so the next-month chevron
    // can't be mashed into empty far-future months. ~6 months out.
    var maxView = new Date(today.getFullYear(), today.getMonth() + 6, 1);
    var maxViewY = maxView.getFullYear(), maxViewM = maxView.getMonth();
    var viewY = today.getFullYear(), viewM = today.getMonth();

    var selKey = "", selLabel = "", selDow = -1, chosenTime = "";

    function pad(n) { return (n < 10 ? "0" : "") + n; }
    function keyOf(y, m, d) { return y + "-" + pad(m + 1) + "-" + pad(d); }
    function freeSlots(dow, k) {
      var all = SLOTS_BY_DOW[dow] || [], taken = BOOKED[k] || [];
      // Single-slot days (Saturday) are fully booked the instant anything is
      // stored for that date — match on the date, not the exact time wording,
      // so changing the slot time can't silently un-book an existing order.
      if (all.length === 1) return taken.length ? [] : all;
      return all.filter(function (s) { return taken.indexOf(s) === -1; });
    }
    // Enable or disable the "+ Fusion" card for the chosen date. Runs on every
    // commit so paging to a different date can put it back on sale.
    function applyFusionAvailability() {
      var taken = Boolean(selKey && FUSION_TAKEN[selKey]);
      document.querySelectorAll("[data-bk-form]").forEach(function (form) {
        if (!form.querySelector('[data-bk-variant="fusion"]')) return; // LT-only card
        form.classList.toggle("bk-pkg--unavailable", taken);
        var btn = form.querySelector(".bk-pkg-btn");
        if (btn) {
          btn.disabled = taken;
          // Keep the original label so re-enabling doesn't have to guess it.
          if (!btn.dataset.label) btn.dataset.label = btn.textContent;
          btn.textContent = taken ? "Fusion is booked that day" : btn.dataset.label;
        }
        var note = form.querySelector("[data-bk-fusion-note]");
        if (note) note.hidden = !taken;
      });
    }

    function lockPackages() {
      if (packages) packages.classList.add("is-locked");
      if (summary) summary.hidden = true;
      slotInputs.forEach(function (i) { i.value = ""; });
      dateInputs.forEach(function (i) { i.value = ""; });
      timeInputs.forEach(function (i) { i.value = ""; });
    }
    function commit() {
      if (selLabel && chosenTime) {
        var value = selLabel + " · " + chosenTime;
        slotInputs.forEach(function (i) { i.value = value; });   // human-readable, for the order/email
        dateInputs.forEach(function (i) { i.value = selKey; });  // "YYYY-MM-DD", for Flow
        timeInputs.forEach(function (i) { i.value = chosenTime; }); // slot, for Flow
        if (packages) packages.classList.remove("is-locked");
        applyFusionAvailability();
        if (summary && summaryText) { summaryText.textContent = value; summary.hidden = false; }
      } else { lockPackages(); }
    }

    function renderTimes() {
      chosenTime = "";
      if (!timesGrid || !timesWrap) return;
      timesGrid.innerHTML = "";
      var slots = selDow < 0 ? [] : freeSlots(selDow, selKey);
      if (!slots.length) { timesWrap.hidden = true; return; }
      timesWrap.hidden = false;
      if (timesLabel) timesLabel.textContent = "Available times · " + selLabel;
      slots.forEach(function (s) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "bk-slot bk-time";
        b.setAttribute("aria-pressed", "false");
        b.innerHTML = '<span class="bk-slot-when"><span class="bk-slot-day">' + s +
          '</span><span class="bk-slot-time">2-hour private party</span></span>' + CHECK;
        b.addEventListener("click", function () {
          timesGrid.querySelectorAll(".bk-time").forEach(function (x) {
            x.classList.remove("is-selected"); x.setAttribute("aria-pressed", "false");
          });
          b.classList.add("is-selected"); b.setAttribute("aria-pressed", "true");
          chosenTime = s; commit();
          // Picking a time unlocks the packages -> carry them down to choose
          // Little Town or + Fusion (don't make them hunt for the next step).
          var step2 = packages && packages.closest(".bk-step");
          if (step2) step2.scrollIntoView({ behavior: "smooth", block: "start" });
        });
        timesGrid.appendChild(b);
      });
      lockPackages(); // a time still needs choosing
    }

    function selectDate(y, m, d, dow) {
      selKey = keyOf(y, m, d);
      selDow = dow;
      selLabel = new Date(y, m, d).toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
      render();
      renderTimes();
      if (timesWrap && !timesWrap.hidden) timesWrap.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    function render() {
      if (titleEl) titleEl.textContent = MONTHS[viewM] + " " + viewY;
      if (prevBtn) prevBtn.disabled = (viewY === today.getFullYear() && viewM === today.getMonth());
      if (nextBtn) nextBtn.disabled = (viewY === maxViewY && viewM === maxViewM);
      daysEl.innerHTML = "";
      var startDow = (new Date(viewY, viewM, 1).getDay() + 6) % 7; // 0 = Monday
      var n = new Date(viewY, viewM + 1, 0).getDate();
      for (var i = 0; i < startDow; i++) {
        var blank = document.createElement("span");
        blank.className = "bk-cal-day bk-cal-day--blank";
        blank.setAttribute("aria-hidden", "true");
        daysEl.appendChild(blank);
      }
      for (var d = 1; d <= n; d++) {
        var dt = new Date(viewY, viewM, d); dt.setHours(0, 0, 0, 0);
        var dow = dt.getDay();
        var k = keyOf(viewY, viewM, d);
        var weekend = dow === 0 || dow === 6;
        var slots = weekend && dt >= minDate ? freeSlots(dow, k) : [];
        var avail = weekend && dt >= minDate && slots.length > 0;
        var booked = weekend && dt >= minDate && slots.length === 0;
        var cell = document.createElement(avail ? "button" : "span");
        cell.className = "bk-cal-day";
        cell.textContent = d;
        if (dt.getTime() === today.getTime()) cell.classList.add("bk-cal-day--today");
        if (avail) {
          cell.classList.add("bk-cal-day--avail");
          cell.type = "button";
          cell.setAttribute("aria-label", new Date(viewY, viewM, d).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }) + " — available");
          if (k === selKey) { cell.classList.add("bk-cal-day--selected"); cell.setAttribute("aria-pressed", "true"); }
          (function (yy, mm, dd, dw) { cell.addEventListener("click", function () { selectDate(yy, mm, dd, dw); }); })(viewY, viewM, d, dow);
        } else if (booked) {
          cell.classList.add("bk-cal-day--booked");
          cell.setAttribute("aria-label", d + " — fully booked");
        } else {
          cell.classList.add("bk-cal-day--muted");
        }
        daysEl.appendChild(cell);
      }
    }

    if (prevBtn) prevBtn.addEventListener("click", function () { if (prevBtn.disabled) return; if (--viewM < 0) { viewM = 11; viewY--; } render(); });
    if (nextBtn) nextBtn.addEventListener("click", function () { if (nextBtn.disabled) return; if (++viewM > 11) { viewM = 0; viewY++; } render(); });
    render();

    document.querySelectorAll("[data-bk-form]").forEach(function (form) {
      form.addEventListener("submit", function (e) {
        var variant = form.querySelector("[data-bk-variant]");
        var slotInput = form.querySelector("[data-bk-slot-input]");
        // No date/time chosen yet -> guide them up to step 1 instead of checking out.
        if (!slotInput || !slotInput.value) {
          e.preventDefault();
          if (!selKey) {
            cal.scrollIntoView({ behavior: "smooth", block: "center" });
          } else if (timesGrid) {
            timesGrid.classList.remove("bk-nudge");
            void timesGrid.offsetWidth; // reflow so the shake can replay
            timesGrid.classList.add("bk-nudge");
            if (timesWrap) timesWrap.scrollIntoView({ behavior: "smooth", block: "center" });
          }
          return;
        }
        // The café next door is already taken that day, so the "+ Fusion"
        // package cannot be honoured. The button is disabled and the card is
        // dimmed, but a stale FUSION_TAKEN (page open while someone books over
        // there) or a keyboard submit can still reach here — so it is checked
        // again at the last moment rather than trusted to the disabled state.
        if (form.querySelector('[data-bk-variant="fusion"]') && selKey && FUSION_TAKEN[selKey]) {
          e.preventDefault();
          applyFusionAvailability();
          return;
        }
        // Product not wired (static prototype, or product unpublished) ->
        // don't fire a broken POST; tell them to email instead.
        if (!variant || !variant.value) {
          e.preventDefault();
          var step = form.closest(".bk-step");
          var note = step && step.querySelector(".bk-finenote");
          if (note) note.textContent = "Online booking is switching on — please email littletownplayhousellc@gmail.com to reserve this slot.";
          return;
        }
        // Date + time + variant present -> take the legal agreement, empty any
        // stray cart items so the order is just this buyout, then POST it.
        // (form.submit() doesn't re-fire this handler, so there's no loop.)
        e.preventDefault();
        gatedBuy(form, function () { form.submit(); });
      });
    });
  })();

  /* ---- Wire every "buy" entry point through the agreement gate + fresh cart ----
     (1) one-tap buy links  /cart/{variantId}:{qty}  (memberships, day-pass
     tiers); (2) the product-page fallback form; (3) the cart page's Checkout
     button. The party booking forms go through gatedBuy in their own submit
     handler above. The cart page's *other* controls are left alone — managing
     items there is the point, and its remove links (/cart/change?...) and
     quantity "Update" aren't purchases. */
  (function gateEveryBuy() {
    /* One-tap buys carry their checkout permalink in data-buy-href, never in
       href (the build puts the product page there instead — see memberCta in
       scripts/build-shopify-theme.js). That is what makes this gate hold:
       ctrl/cmd-click, middle-click and right-click → "Open in new tab" all act
       on href, and no amount of JS can gate them, so href must not be a
       checkout URL. They land on the product page, whose add-to-cart form is
       gated below. An empty data-buy-href means the variant didn't resolve —
       let the product-page href through untouched. */
    document.querySelectorAll("a[data-buy-href]").forEach(function (a) {
      a.addEventListener("click", function (e) {
        if (e.defaultPrevented) return;
        var href = a.getAttribute("data-buy-href");
        if (!href) return;
        e.preventDefault();
        // Day Pass and membership buys offer the socks upsell right after the
        // agreement; socks' own buy button obviously doesn't upsell itself.
        var offerSocks = a.hasAttribute("data-daypass-buy") || a.hasAttribute("data-membership-buy");
        gatedBuy(null, function () { window.location.href = href; }, offerSocks);
      });
    });

    /* Safety net for any hand-written anchor that still points straight at a
       cart permalink. Nothing the build emits does anymore, but if one ever
       reappears it gets gated rather than silently skipping the agreement.
       Modified clicks are deliberately NOT excused here — letting them through
       would be exactly the bypass this guards against. */
    var PERMALINK = /\/cart\/\d+(?::\d+)/;  // /cart/{variantId}:{qty}[...]
    document.querySelectorAll('a[href*="/cart/"]:not([data-buy-href])').forEach(function (a) {
      if (!PERMALINK.test(a.getAttribute("href") || "")) return;
      a.addEventListener("click", function (e) {
        if (e.defaultPrevented) return;
        e.preventDefault();
        var href = a.href;
        gatedBuy(null, function () { window.location.href = href; });
      });
    });

    var pdp = document.getElementById("pdp-form");
    if (pdp) {
      pdp.addEventListener("submit", function (e) {
        e.preventDefault();
        // data-pdp-offer-socks is only rendered for the day-pass/membership
        // products (see product.liquid) — not socks' own PDP or the buyout.
        var offerSocks = !!pdp.querySelector("[data-pdp-offer-socks]");
        gatedBuy(pdp, function () { pdp.submit(); }, offerSocks);
      });
    }

    /* Cart page: only the Checkout submit is a purchase.
       This one gates WITHOUT clearing, so it can't use gatedBuy. Everywhere
       else the item is added *after* the clear; here the line items already in
       the cart ARE the purchase, so emptying it first would submit checkout
       against an empty cart and Shopify would bounce straight back to /cart.
       Stamp only. The form is passed as null because a bare properties[...]
       field means nothing to a POST /cart update — for this path the
       /cart/update.js attribute is the acceptance record.
       form.submit() would also drop the button's own name, turning a checkout
       into a quantity update, so re-submit through the button itself
       (requestSubmit) and fall back to a hidden "checkout" field without it. */
    document.querySelectorAll('button[name="checkout"]').forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        var form = btn.form || btn.closest("form");
        if (!form) return;
        if (buyInFlight) return;
        e.preventDefault();
        openAgree(function () {
          if (buyInFlight) return;
          buyInFlight = true;   // latch only; the button must stay enabled for requestSubmit
          stampAgreementThenGo(null, function () {
            if (form.requestSubmit) { form.requestSubmit(btn); return; }
            var flag = document.createElement("input");
            flag.type = "hidden";
            flag.name = "checkout";
            flag.value = btn.value || "";
            form.appendChild(flag);
            form.submit();
          });
        });
      });
    });

    /* Static preview only: the buy buttons here are inert placeholders
       (data-noop) because there's no Shopify behind them. Still open the gate
       so the agreement box can be reviewed exactly as customers will see it.
       Agreeing just closes the box — on the real site that's the moment the
       browser leaves for Shopify checkout. openAgree (not gatedBuy) on purpose:
       there's no cart to clear or stamp here. */
    document.querySelectorAll("[data-noop][data-socks-buy]").forEach(function (btn) {
      btn.addEventListener("click", function () { openAgree(function () {}); });
    });

    /* Day Pass and membership demo buttons also preview the socks upsell that
       follows the agreement on the real site — force:true skips the
       LT_SOCKS_VARIANT_ID check (unset here; there's no Shopify behind the
       static preview) so the popup is reviewable without a live product. */
    document.querySelectorAll("[data-noop][data-daypass-buy], [data-noop][data-tier]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        openAgree(function () { openUpsell(function () {}, true); });
      });
    });
  })();

  /* ---- Price pickers (Day Pass tiers, socks quantity): the dropdown drives the
     visible price + unit and, on Shopify, the buy button's checkout permalink
     (the build injects each option's data-href for its variant/quantity). Scoped
     per card so the home + Play & Pricing cards each work independently. On the
     static preview there's no data-href, so the button stays inert (data-noop)
     and only the price preview moves. The permalink is written to data-buy-href —
     never href, which stays on the product page so an open-in-new-tab can't skip
     the agreement gate. gateEveryBuy binds the anchor once and reads
     data-buy-href live at click, so swapping it here still routes to the choice.
     ---- */
  (function pricePickers() {
    ["daypass", "socks"].forEach(function (kind) {
      document.querySelectorAll("[data-" + kind + "-select]").forEach(function (sel) {
        var card = sel.closest(".cp-card") || document;
        var priceEl = card.querySelector("[data-" + kind + "-price]");
        var unitEl = card.querySelector("[data-" + kind + "-unit]");
        var buyEl = card.querySelector("[data-" + kind + "-buy]");
        function sync() {
          var opt = sel.options[sel.selectedIndex];
          if (!opt) return;
          if (priceEl && opt.dataset.price) priceEl.textContent = opt.dataset.price;
          if (unitEl && opt.dataset.unit) unitEl.textContent = opt.dataset.unit;
          if (buyEl && opt.dataset.href) buyEl.setAttribute("data-buy-href", opt.dataset.href);
        }
        sel.addEventListener("change", sync);
        sync();
      });
    });
  })();

  /* ---- Newsletter (static prototype only): the Shopify build swaps this form
     for a real {% form 'customer' %} POST. On the static preview there's no
     backend, so just confirm the signup instead of leaving a dead button. The
     real Shopify form's email input has name="contact[email]"; the prototype's
     has none — so we only enhance when there's no name, never the live form. ---- */
  (function newsletterDemo() {
    document.querySelectorAll("form.newsletter-form").forEach(function (form) {
      var email = form.querySelector('input[type="email"]');
      if (!email || email.name) return;  // real Shopify form → let it post natively
      function confirm() {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value || "")) { email.focus(); return; }
        form.innerHTML = '<p style="color:#fff;font-weight:600;margin:0">Thanks — you\'re on the list! 🎉</p>';
      }
      form.addEventListener("submit", function (e) { e.preventDefault(); confirm(); });
      var btn = form.querySelector("button");
      if (btn) btn.addEventListener("click", confirm);
    });
  })();

  /* ---- Non-functional buttons: prevent any accidental navigation ---- */
  document.querySelectorAll('[data-noop]').forEach(function (el) {
    el.addEventListener("click", function (e) { e.preventDefault(); });
  });
})();

/* ============================================================
   Inline the animated illustrations.
   iOS Safari does not animate SVGs referenced via <img>, so we
   fetch the SVG and replace the <img> with a live inline <svg>
   (inline SVG animates on every browser). If the fetch fails, the
   original <img> stays in place as a static fallback.
   ============================================================ */
(function () {
  "use strict";
  var ANIMATED = ["hero-town", "kids-play"];
  function isAnimated(src) {
    src = (src || "").split("?")[0];
    return ANIMATED.some(function (n) { return src.indexOf(n + ".svg") !== -1; });
  }
  if (!("fetch" in window) || !("DOMParser" in window)) return;

  document.querySelectorAll('img[src*="assets/img/"]').forEach(function (img) {
    if (!isAnimated(img.getAttribute("src"))) return;
    fetch(img.src)
      .then(function (r) { return r.ok ? r.text() : Promise.reject(); })
      .then(function (txt) {
        var doc = new DOMParser().parseFromString(txt, "image/svg+xml");
        var svg = doc.querySelector("svg");
        if (!svg || doc.querySelector("parsererror")) return;
        var w = img.getAttribute("width"), h = img.getAttribute("height"), st = img.getAttribute("style"),
            cls = img.getAttribute("class"), alt = img.getAttribute("alt");
        if (w) svg.setAttribute("width", w);
        if (h) svg.setAttribute("height", h);
        if (cls) svg.setAttribute("class", cls);
        if (st) svg.setAttribute("style", st);
        if (alt) { svg.setAttribute("role", "img"); svg.setAttribute("aria-label", alt); }
        if (img.parentNode) {
          img.replaceWith(svg);
          // WebKit/iOS sometimes won't start SMIL on a freshly inserted SVG —
          // nudging the timeline kicks the animations into life.
          try { if (svg.setCurrentTime) svg.setCurrentTime(0); } catch (e) {}
        }
      })
      .catch(function () { /* keep the static <img> fallback */ });
  });
})();

/* ============================================================
   v11 — Boutique polish motion
   Layers a few premium interaction primitives on top of the
   existing CSS-driven motion: 3D mouse tilt for cards, magnetic
   pull for CTAs, auto-injected sparkle dust, and number count-up
   for stat displays. Every primitive bails out for reduced-motion
   and touch-only devices.
   ============================================================ */
(function () {
  "use strict";

  var prefersReducedMotion =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var hasFinePointer =
    window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  /* ---- Auto-inject sparkle dust into .has-sparkles wrappers ---- */
  document.querySelectorAll(".has-sparkles").forEach(function (host) {
    if (host.querySelector(".sparkle-field")) return;
    var field = document.createElement("span");
    field.className = "sparkle-field";
    field.setAttribute("aria-hidden", "true");
    for (var i = 0; i < 12; i++) field.appendChild(document.createElement("i"));
    host.appendChild(field);
  });

  if (prefersReducedMotion) return;

  /* ---- 3D mouse tilt: subtle parallax that follows the cursor ----
     A real "expensive site" cue. Capped at small angles so it reads
     refined, not gimmicky. Only enabled on fine-pointer devices. */
  if (hasFinePointer) {
    var MAX_TILT = 8;          // degrees — matches the boutique product-card feel
    var HOVER_SCALE = 1.025;   // subtle lift; keep gentle against the pastel palette
    document.querySelectorAll(".tilt-3d").forEach(function (el) {
      var rafId = null;
      var targetRX = 0, targetRY = 0, targetS = 1;
      var currentRX = 0, currentRY = 0, currentS = 1;
      var rect = null;
      function update() {
        currentRX += (targetRX - currentRX) * 0.18;
        currentRY += (targetRY - currentRY) * 0.18;
        currentS  += (targetS  - currentS)  * 0.18;
        el.style.transform =
          "perspective(900px) rotateX(" + currentRX.toFixed(2) + "deg) " +
          "rotateY(" + currentRY.toFixed(2) + "deg) " +
          "scale3d(" + currentS.toFixed(3) + "," + currentS.toFixed(3) + ",1)";
        if (Math.abs(targetRX - currentRX) > 0.05 ||
            Math.abs(targetRY - currentRY) > 0.05 ||
            Math.abs(targetS  - currentS)  > 0.001) {
          rafId = requestAnimationFrame(update);
        } else { rafId = null; }
      }
      el.addEventListener("mouseenter", function () {
        rect = el.getBoundingClientRect();
        targetS = HOVER_SCALE;
        if (rafId === null) rafId = requestAnimationFrame(update);
      });
      el.addEventListener("mousemove", function (e) {
        if (!rect) rect = el.getBoundingClientRect();
        var px = (e.clientX - rect.left) / rect.width;   // 0..1
        var py = (e.clientY - rect.top)  / rect.height;  // 0..1
        targetRY = (px - 0.5) *  MAX_TILT * 2;
        targetRX = (py - 0.5) * -MAX_TILT * 2;
        if (rafId === null) rafId = requestAnimationFrame(update);
      });
      el.addEventListener("mouseleave", function () {
        targetRX = 0; targetRY = 0; targetS = 1; rect = null;
        if (rafId === null) rafId = requestAnimationFrame(update);
      });
    });

    /* ---- Magnetic CTA: the button pulls slightly toward the cursor ----
       Subtle range so it reads as polish, not novelty. */
    var MAG_RANGE = 10;  // pixels
    document.querySelectorAll(".magnetic").forEach(function (el) {
      var rect = null;
      el.addEventListener("mouseenter", function () { rect = el.getBoundingClientRect(); });
      el.addEventListener("mousemove", function (e) {
        if (!rect) rect = el.getBoundingClientRect();
        var dx = (e.clientX - (rect.left + rect.width / 2))  / (rect.width / 2);
        var dy = (e.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
        el.style.transform = "translate(" + (dx * MAG_RANGE).toFixed(1) + "px," + (dy * MAG_RANGE).toFixed(1) + "px)";
      });
      el.addEventListener("mouseleave", function () {
        rect = null;
        el.style.transform = "";
      });
    });
  }

  /* ---- Number count-up: stats animate to their final value as they enter ----
     Reads `data-count="42"` and an optional `data-suffix="+"`. Falls back to
     the existing static number if IntersectionObserver isn't available. */
  if ("IntersectionObserver" in window) {
    var nums = document.querySelectorAll("[data-count]");
    if (nums.length) {
      var numIO = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var el = entry.target;
          numIO.unobserve(el);
          var target = parseFloat(el.getAttribute("data-count")) || 0;
          var suffix = el.getAttribute("data-suffix") || "";
          var prefix = el.getAttribute("data-prefix") || "";
          var duration = 1200; // ms
          var start = null;
          el.classList.add("is-counting");
          function step(ts) {
            if (start === null) start = ts;
            var p = Math.min(1, (ts - start) / duration);
            // Ease-out cubic
            var eased = 1 - Math.pow(1 - p, 3);
            var current = target * eased;
            // Integer stats stay integers; fractional stats keep one decimal
            var display = (target % 1 === 0) ? Math.round(current) : current.toFixed(1);
            el.firstChild && el.firstChild.nodeType === 3
              ? (el.firstChild.nodeValue = prefix + display + suffix)
              : (el.textContent = prefix + display + suffix);
            if (p < 1) requestAnimationFrame(step);
            else { el.classList.remove("is-counting"); el.classList.add("is-counted"); }
          }
          requestAnimationFrame(step);
        });
      }, { threshold: 0.3 });
      nums.forEach(function (n) { numIO.observe(n); });
    }
  }
})();

/* ============================================================
   v13 — Mobile experience layer
   Everything here is phone-first and self-injecting, so it works
   identically on the static site and the built Shopify theme with
   no per-page markup. Two parts:
     1. hardened mobile-menu behaviour (Esc / outside-tap / resize
        close, focus + inert a11y, body scroll-lock),
     2. small touch-feel niceties.
   All of it bails out cleanly on desktop and respects the user's
   reduced-motion / reduced-data preferences.
   ============================================================ */
(function () {
  "use strict";

  var header = document.querySelector(".site-header");

  /* ---------- shared helpers ---------- */
  // No public phone number — contact is email only. Resolve the real mailto from
  // the footer so the mobile drawer never advertises a fake number.
  function contactHref() {
    var m = document.querySelector('a[href^="mailto:"]');
    return (m && m.getAttribute("href")) || "mailto:littletownplayhousellc@gmail.com";
  }

  var ICON_MAIL =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>';
  var ICON_X =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  /* ---------- 1. Hardened mobile menu ---------- */
  (function hardenMenu() {
    if (!header) return;
    var toggle = header.querySelector(".nav-toggle");
    var menu = header.querySelector(".mobile-menu");
    if (!toggle || !menu) return;

    function isMobile() { return window.innerWidth < 960; }

    // The drawer is a right-side slide-in panel. Move it out of the header so
    // position:fixed is relative to the viewport — the header's backdrop-filter
    // would otherwise trap it inside the (short) header box. Then enrich the
    // panel with a sticky top bar (title + close) and a footer CTA.
    if (menu.parentNode !== document.body) document.body.appendChild(menu);
    var panel = menu.querySelector("div");
    if (panel && !panel.querySelector(".m-drawer-top")) {
      var top = document.createElement("div");
      top.className = "m-drawer-top";
      top.innerHTML =
        '<span class="m-drawer-title">Menu</span>' +
        '<button type="button" class="m-drawer-close" aria-label="Close menu">' + ICON_X + "</button>";
      panel.insertBefore(top, panel.firstChild);
      top.querySelector(".m-drawer-close").addEventListener("click", function () { close(true); });

      var foot = document.createElement("div");
      foot.className = "m-drawer-foot";
      // Just an email link — gives an open-menu visitor a clear next step.
      // No "convert" CTA here on purpose; the membership button was removed
      // from the drawer.
      foot.innerHTML =
        '<a class="m-drawer-call" href="' + contactHref() + '">' + ICON_MAIL + "<span>Email us</span></a>";
      panel.appendChild(foot);
    }

    function setInert(on) {
      // Keep collapsed menu links out of the tab order + a11y tree.
      if (on) {
        menu.setAttribute("aria-hidden", "true");
        try { menu.inert = true; } catch (e) {}
      } else {
        menu.removeAttribute("aria-hidden");
        try { menu.inert = false; } catch (e) {}
      }
    }

    function open() {
      header.classList.add("nav-open");
      // The class on <html> drives the CSS scroll-lock (overflow:hidden). Using
      // overflow rather than position:fixed keeps the sticky header in place.
      document.documentElement.classList.add("nav-open");
      toggle.setAttribute("aria-expanded", "true");
      toggle.setAttribute("aria-label", "Close menu");
      setInert(false);
      // Move focus into the drawer itself (the panel, not a link) so keyboard
      // users land inside the dialog and Tab/Esc work — without dropping the
      // black :focus-visible ring on the active "Home" link, which otherwise
      // looked like a border stuck around it after tapping another page.
      if (panel) {
        panel.setAttribute("tabindex", "-1");
        try { panel.focus({ preventScroll: true }); } catch (e) { panel.focus(); }
      }
    }

    function close(returnFocus) {
      if (!header.classList.contains("nav-open")) return;
      header.classList.remove("nav-open");
      document.documentElement.classList.remove("nav-open");
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Open menu");
      setInert(true);
      if (returnFocus) { try { toggle.focus({ preventScroll: true }); } catch (e) { toggle.focus(); } }
    }

    // Initial state: collapsed + inert on mobile, fully interactive on desktop.
    function syncInitial() {
      if (isMobile()) {
        if (!header.classList.contains("nav-open")) setInert(true);
      } else {
        setInert(false);
        close(false);
      }
    }
    syncInitial();

    toggle.addEventListener("click", function () {
      if (header.classList.contains("nav-open")) close(true);
      else open();
    });

    // Tapping any menu link navigates → close immediately.
    menu.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () { close(false); });
    });

    // Esc closes and returns focus to the toggle.
    document.addEventListener("keydown", function (e) {
      if ((e.key === "Escape" || e.key === "Esc") && header.classList.contains("nav-open")) close(true);
    });

    // Tapping the dimmed scrim (the .mobile-menu area outside the panel) closes
    // the drawer. The panel itself and the toggle are excluded.
    menu.addEventListener("click", function (e) {
      if (e.target === menu) close(false);
    });

    // Resizing up to desktop must always leave a clean, unlocked state.
    var rT;
    window.addEventListener("resize", function () {
      clearTimeout(rT);
      rT = setTimeout(function () {
        if (!isMobile()) close(false);
        syncInitial();
      }, 150);
    });
  })();
})();

/* ============================================================
   Interactive location map — a real, themed street map.
   MapLibre GL + free OpenFreeMap vector tiles (no API key). The
   palette is tuned to the brand, panning is bounded to our block,
   and zoom is capped (16–18) so it stays a friendly little map.
   MapLibre loads from CDN only on the page that has #ltp-map; if
   anything fails to load, the static poster image stays put.
   ============================================================ */
(function () {
  "use strict";
  var c = document.getElementById("ltp-map");
  if (!c || !("Promise" in window) || !("fetch" in window)) return;
  var LAT = parseFloat(c.getAttribute("data-lat")) || 38.3796818;
  var LNG = parseFloat(c.getAttribute("data-lng")) || -88.3586826;
  var CDN = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl";

  var link = document.createElement("link");
  link.rel = "stylesheet"; link.href = CDN + ".css";
  document.head.appendChild(link);
  var s = document.createElement("script");
  s.src = CDN + ".js"; s.defer = true;
  s.onload = init;
  s.onerror = function () { /* poster image remains as the fallback */ };
  document.head.appendChild(s);

  function init() {
    if (!window.maplibregl) return;
    var ofm = { type: "vector", url: "https://tiles.openfreemap.org/planet" };
    var style = {
      version: 8, name: "Little Town",
      glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
      sources: { ofm: ofm },
      layers: [
        { id: "bg", type: "background", paint: { "background-color": "#f4efe3" } },
        { id: "residential", type: "fill", source: "ofm", "source-layer": "landuse", filter: ["==", "class", "residential"], paint: { "fill-color": "#efe8d6", "fill-opacity": 0.5 } },
        { id: "grass", type: "fill", source: "ofm", "source-layer": "landcover", filter: ["in", "class", "grass", "wood", "scrub", "farmland"], paint: { "fill-color": "#d4e4b0", "fill-opacity": 0.55 } },
        { id: "park", type: "fill", source: "ofm", "source-layer": "park", paint: { "fill-color": "#cbe3a8", "fill-opacity": 0.8 } },
        { id: "water", type: "fill", source: "ofm", "source-layer": "water", paint: { "fill-color": "#bfe0e6" } },
        { id: "building", type: "fill", source: "ofm", "source-layer": "building", minzoom: 14, paint: { "fill-color": ["interpolate", ["linear"], ["zoom"], 14, "#ead9bf", 17, "#e6d0b1"], "fill-outline-color": "#d4ba93", "fill-opacity": 0.92 } },
        { id: "road-minor-case", type: "line", source: "ofm", "source-layer": "transportation", filter: ["in", "class", "minor", "service", "track"], minzoom: 14, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#e6dac1", "line-width": ["interpolate", ["linear"], ["zoom"], 14, 2.5, 18, 12] } },
        { id: "road-main-case", type: "line", source: "ofm", "source-layer": "transportation", filter: ["in", "class", "primary", "secondary", "tertiary", "trunk"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#e7c891", "line-width": ["interpolate", ["linear"], ["zoom"], 12, 3, 16, 10, 18, 20] } },
        { id: "road-minor", type: "line", source: "ofm", "source-layer": "transportation", filter: ["in", "class", "minor", "service", "track"], minzoom: 14, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#fffdf8", "line-width": ["interpolate", ["linear"], ["zoom"], 14, 1.2, 18, 9] } },
        { id: "road-main", type: "line", source: "ofm", "source-layer": "transportation", filter: ["in", "class", "primary", "secondary", "tertiary", "trunk"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#fdf2d6", "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1.5, 16, 7, 18, 14] } },
        { id: "road-label", type: "symbol", source: "ofm", "source-layer": "transportation_name", minzoom: 14, layout: { "symbol-placement": "line", "text-field": ["get", "name"], "text-font": ["Noto Sans Bold"], "text-size": ["interpolate", ["linear"], ["zoom"], 14, 10, 18, 14] }, paint: { "text-color": "#a08c69", "text-halo-color": "#f7f2e7", "text-halo-width": 1.6 } },
        { id: "place-label", type: "symbol", source: "ofm", "source-layer": "place", filter: ["in", "class", "suburb", "neighbourhood", "quarter", "town", "village"], layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Bold"], "text-size": 13, "text-transform": "uppercase", "text-letter-spacing": 0.12 }, paint: { "text-color": "#bda37a", "text-halo-color": "#f7f2e7", "text-halo-width": 1.6 } }
      ]
    };
    var map = new maplibregl.Map({
      container: c, style: style,
      center: [LNG, LAT], zoom: 16, minZoom: 16, maxZoom: 18,
      maxBounds: [[LNG - 0.011, LAT - 0.007], [LNG + 0.011, LAT + 0.007]],
      attributionControl: false, dragRotate: false, pitchWithRotate: false,
      cooperativeGestures: true, refreshExpiredTiles: false
    });
    try { map.touchZoomRotate.disableRotation(); } catch (e) {}
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    var el = document.createElement("div");
    el.className = "ltp-mk";
    el.innerHTML =
      '<div class="ltp-card"><span class="ltp-ic"><svg viewBox="0 0 24 24" fill="none" stroke="#d9774e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10.5V20h14v-9.5"/><path d="M10 20v-5h4v5"/></svg></span><span class="ltp-tx"><span class="ltp-nm">Little Town Playhouse</span><span class="ltp-ad">205 E Main St · next to Fusion Coffee</span></span></div>' +
      '<div class="ltp-pin"><svg viewBox="0 0 38 50" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="ltpg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ef9264"/><stop offset="1" stop-color="#d2603b"/></linearGradient></defs><path d="M19 49 C6 33 3 26 3 18 A16 16 0 1 1 35 18 C35 26 32 33 19 49 Z" fill="url(#ltpg)" stroke="#a8472b" stroke-width="1.4"/><line x1="19" y1="9" x2="19" y2="4.5" stroke="#3f7268" stroke-width="1.3" stroke-linecap="round"/><path d="M19 4.5 l5 1.5 l-5 1.5 Z" fill="#5fa394"/><path d="M8 19.5 L19 9 L30 19.5 Z" fill="#fffdf9"/><rect x="10.5" y="18.5" width="17" height="11" rx="1.8" fill="#fffdf9"/><circle cx="19" cy="22" r="2" fill="#f4c66a"/><path d="M16.4 29.5 v-3.4 a2.6 2.6 0 0 1 5.2 0 v3.4 Z" fill="#d9774e"/></svg></div>';
    new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([LNG, LAT]).addTo(map);

    map.on("load", function () { c.classList.add("is-live"); });
  }

})();

/* ============================================================
   Photo strip — own IIFE so it runs on every page that has one.

   The markup ships as a plain scrollable row of photos. This upgrades it
   into one continuous flow: the list is cloned once and the track slides
   exactly one copy's width, so the seam never shows and it never has to
   stop, rewind or page.

   Duration is derived from the measured width rather than hardcoded, so
   the photos travel at the same speed whatever the screen size, and the
   loop stays seamless when the row height changes at a breakpoint.
   ============================================================ */
(function () {
  "use strict";

  var PX_PER_SECOND = 42;   /* readable strolling pace, not a conveyor belt */

  var strips = document.querySelectorAll("[data-lt-flow]");
  Array.prototype.forEach.call(strips, function (root) {
    var track = root.querySelector(".lt-flow-track");
    if (!track) return;
    var originals = Array.prototype.slice.call(track.children);
    if (!originals.length) return;

    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    var dragEndedAt = 0;

    /* ---- click a photo to see it big ---- */
    var lb = null, lastFocus = null, hideTimer = 0;

    function buildLightbox() {
      lb = document.createElement("div");
      lb.className = "lt-lb";
      lb.setAttribute("role", "dialog");
      lb.setAttribute("aria-modal", "true");
      lb.setAttribute("aria-label", "Photo viewer");
      lb.hidden = true;
      lb.innerHTML =
        '<div class="lt-lb-backdrop" data-lb-close></div>' +
        '<div class="lt-lb-inner">' +
          '<div class="lt-lb-media"></div>' +
          '<button type="button" class="lt-lb-close" data-lb-close aria-label="Close photo">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
            '<path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>' +
            '</svg>' +
          '</button>' +
        '</div>';
      document.body.appendChild(lb);
      lb.addEventListener("click", function (e) {
        if (e.target.closest("[data-lb-close]")) closeLb();
      });
    }

    function openLb(fig) {
      if (!lb) buildLightbox();
      window.clearTimeout(hideTimer);
      var media = lb.querySelector(".lt-lb-media");
      media.innerHTML = "";

      /* The strip only ever needs a row-height source. Build the viewer its
         own picture from the full width ladder, carried on the figure as
         data attributes: the Shopify build rewrites each real filename to an
         asset_url and cannot rewrite a path assembled at runtime. */
      var avif = fig.getAttribute("data-lb-avif");
      var webp = fig.getAttribute("data-lb-webp");
      var full = fig.getAttribute("data-lb-src");
      var srcImg = fig.querySelector("img");
      var alt = srcImg ? srcImg.getAttribute("alt") : "";

      if (full) {
        var pic = document.createElement("picture");
        [["image/avif", avif], ["image/webp", webp]].forEach(function (pair) {
          if (!pair[1]) return;
          var sc = document.createElement("source");
          sc.type = pair[0];
          sc.srcset = pair[1];
          sc.sizes = "100vw";
          pic.appendChild(sc);
        });
        var im = document.createElement("img");
        im.src = full;
        im.alt = alt;
        im.decoding = "async";
        im.draggable = false;
        pic.appendChild(im);
        media.appendChild(pic);
      }

      lastFocus = document.activeElement;
      lb.hidden = false;
      document.documentElement.classList.add("lt-lb-open");
      window.requestAnimationFrame(function () { lb.classList.add("is-open"); });
      lb.querySelector(".lt-lb-close").focus();
    }

    function closeLb() {
      if (!lb || lb.hidden) return;
      lb.classList.remove("is-open");
      document.documentElement.classList.remove("lt-lb-open");
      hideTimer = window.setTimeout(function () { lb.hidden = true; }, 240);
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }

    document.addEventListener("keydown", function (e) {
      if (!lb || lb.hidden) return;
      if (e.key === "Escape") { e.preventDefault(); closeLb(); }
      else if (e.key === "Tab") {
        /* Only one control inside, so keep focus parked on it. */
        e.preventDefault();
        lb.querySelector(".lt-lb-close").focus();
      }
    });

    /* Give every original photo a real button, so it is clickable and
       tabbable. Clones are decorative and deliberately get neither. */
    originals.forEach(function (li) {
      var fig = li.querySelector(".lt-flow-fig");
      if (!fig) return;
      /* The photos carry no visible caption any more, so the button's
         accessible name comes from the image's alt text. */
      var im = fig.querySelector("img");
      var label = im ? (im.getAttribute("alt") || "").trim() : "";
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "lt-flow-open";
      btn.setAttribute("aria-label", label ? "See larger: " + label : "See this photo larger");
      fig.appendChild(btn);
      btn.addEventListener("click", function (e) {
        /* Swallow the click that ends a drag, so dragging past a photo does
           not open it. */
        if (dragEndedAt && Date.now() - dragEndedAt < 350) { e.preventDefault(); return; }
        openLb(fig);
      });
    });

    if (reduce) return;   /* leave it as a row the visitor scrolls themselves */

    /* ---- the continuous flow ----
       The strip is a real scroll container and the flow is this loop nudging
       scrollLeft. A CSS transform animation cannot share an element with
       native scrolling, and being able to grab, swipe or wheel through the
       photos is worth more than putting the movement on the compositor.

       Three copies of the list, parked on the middle one: that leaves a whole
       copy of runway in each direction, so scrolling either way wraps instead
       of hitting a wall. */
    var COPIES = 3;
    var span = 0;          /* width of one copy, the wrap distance */
    var running = false;
    var idleUntil = 0;     /* pause auto-flow until this timestamp */
    var selfSet = -1;      /* the scrollLeft we last wrote, to spot user scrolls */
    var raf = 0, last = 0;

    function measure() {
      var w = 0;
      for (var i = 0; i < originals.length; i++) w += originals[i].getBoundingClientRect().width;
      var st = window.getComputedStyle(track);
      var gap = parseFloat(st.columnGap || st.gap || "0") || 0;
      return w + gap * originals.length;
    }

    function setScroll(x) {
      root.scrollLeft = x;
      selfSet = root.scrollLeft;
    }

    /* Keep the viewport inside the middle copy so there is always a full copy
       of content on either side. The jump is exactly one copy, and the copies
       are identical, so it is invisible. */
    function wrap() {
      if (!span) return;
      if (root.scrollLeft >= span * 2) setScroll(root.scrollLeft - span);
      else if (root.scrollLeft < span) setScroll(root.scrollLeft + span);
    }

    function frame(now) {
      raf = window.requestAnimationFrame(frame);
      var dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
      last = now;
      if (!running || !span) return;
      if (now < idleUntil) return;
      setScroll(root.scrollLeft + PX_PER_SECOND * dt);
      wrap();
    }

    function start() {
      if (raf) return;
      last = 0;
      raf = window.requestAnimationFrame(frame);
    }
    function stop() {
      if (!raf) return;
      window.cancelAnimationFrame(raf);
      raf = 0;
    }

    /* Hold the flow while someone is looking, then let it drift on again. */
    function hold(ms) { idleUntil = Math.max(idleUntil, performance.now() + (ms || 1400)); }

    root.addEventListener("pointerenter", function () { hold(1e9); });
    root.addEventListener("pointerleave", function () { idleUntil = 0; });
    root.addEventListener("focusin", function () { hold(1e9); });
    root.addEventListener("focusout", function () { idleUntil = 0; });

    /* Any scroll the visitor caused pauses the drift briefly, so it never
       fights a swipe or a wheel. */
    root.addEventListener("scroll", function () {
      if (Math.abs(root.scrollLeft - selfSet) > 2) { hold(); wrap(); }
    }, { passive: true });
    root.addEventListener("wheel", function () { hold(); }, { passive: true });
    root.addEventListener("touchstart", function () { hold(); }, { passive: true });
    root.addEventListener("touchend", function () { hold(); }, { passive: true });

    /* Grab and drag with a mouse — there is no visible scrollbar, so without
       this a desktop visitor has no way to move it by hand. */
    var drag = null;
    root.addEventListener("pointerdown", function (e) {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      drag = { id: e.pointerId, x: e.clientX, left: root.scrollLeft, moved: 0 };
      hold(1e9);
    });
    root.addEventListener("pointermove", function (e) {
      if (!drag || drag.id !== e.pointerId) return;
      var dx = e.clientX - drag.x;
      drag.moved = Math.max(drag.moved, Math.abs(dx));
      if (drag.moved > 4 && !root.classList.contains("is-dragging")) {
        root.classList.add("is-dragging");
        try { root.setPointerCapture(e.pointerId); } catch (err) {}
      }
      if (!root.classList.contains("is-dragging")) return;
      setScroll(drag.left - dx);
      wrap();
    });
    function endDrag(e) {
      if (!drag || (e && e.pointerId != null && drag.id !== e.pointerId)) return;
      var wasDrag = root.classList.contains("is-dragging");
      if (wasDrag) { try { root.releasePointerCapture(drag.id); } catch (err) {} }
      drag = null;
      root.classList.remove("is-dragging");
      /* A real drag must not also count as a click on the photo underneath. */
      if (wasDrag) { dragEndedAt = Date.now(); hold(); }
    }
    root.addEventListener("pointerup", endDrag);
    root.addEventListener("pointercancel", endDrag);

    /* Nothing to animate while the tab is in the background. */
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stop(); else start();
    });

    function apply() {
      var s = measure();
      if (!s) return;
      span = s;
      wrap();
    }

    function build() {
      if (!running) {
        var frag = document.createDocumentFragment();
        for (var c = 1; c < COPIES; c++) {
          originals.forEach(function (li) {
            var cl = li.cloneNode(true);
            cl.setAttribute("aria-hidden", "true");
            /* A clone must never be reachable by keyboard or read aloud —
               otherwise the gallery announces every photo three times. */
            var b = cl.querySelector(".lt-flow-open");
            if (b) b.parentNode.removeChild(b);
            Array.prototype.forEach.call(cl.querySelectorAll("img"), function (im) {
              im.setAttribute("aria-hidden", "true");
              im.setAttribute("alt", "");
            });
            frag.appendChild(cl);
          });
        }
        track.appendChild(frag);
        running = true;
      }
      root.classList.add("is-live");
      span = measure();
      /* Park on the middle copy so there is runway in both directions. */
      setScroll(span);
      start();
    }

    /* Wait for the leading images, or the copy width is measured wrong and the
       wrap lands in the wrong place. */
    var leading = Array.prototype.slice.call(track.querySelectorAll("img")).slice(0, 4);
    var pending = leading.filter(function (im) { return !im.complete; });
    if (!pending.length) build();
    else {
      var left = pending.length;
      var done = function () { if (--left <= 0) build(); };
      pending.forEach(function (im) {
        im.addEventListener("load", done, { once: true });
        im.addEventListener("error", done, { once: true });
      });
      /* Never let a stuck image keep the strip from ever starting. */
      window.setTimeout(function () { if (!running) build(); }, 2500);
    }

    var rt;
    window.addEventListener("resize", function () {
      window.clearTimeout(rt);
      rt = window.setTimeout(apply, 150);
    }, { passive: true });
  });
})();
