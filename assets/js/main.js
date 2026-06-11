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
  document.querySelectorAll(".acc-trigger").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var item = btn.closest(".acc-item");
      if (!item) return;
      var expanded = item.getAttribute("aria-expanded") === "true";
      item.setAttribute("aria-expanded", expanded ? "false" : "true");
      btn.setAttribute("aria-expanded", expanded ? "false" : "true");
    });
  });

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
        // Product not wired (static prototype, or product unpublished) ->
        // don't fire a broken POST; tell them to call instead.
        if (!variant || !variant.value) {
          e.preventDefault();
          var step = form.closest(".bk-step");
          var note = step && step.querySelector(".bk-finenote");
          if (note) note.textContent = "Online booking is switching on — please call us to reserve this slot.";
          return;
        }
        // Date + time + variant present -> empty any stray cart items first so
        // the order is just this buyout, then POST it. (form.submit() doesn't
        // re-fire this handler, so there's no loop.)
        e.preventDefault();
        clearCartThenGo(function () { form.submit(); });
      });
    });
  })();

  /* ---- Wire every "buy" entry point through the fresh-cart clear ----
     (1) one-tap buy links  /cart/{variantId}:{qty}  (memberships, day pass,
     household family pass); (2) the product-page fallback form. The party
     booking forms clear inside their own submit handler above. We deliberately
     leave the cart page's own form alone — managing items there is the point,
     and its remove links (/cart/change?...) aren't buy permalinks anyway. */
  (function freshCartOnBuy() {
    var PERMALINK = /\/cart\/\d+(?::\d+)/;  // /cart/{variantId}:{qty}[...]
    document.querySelectorAll('a[href*="/cart/"]').forEach(function (a) {
      if (!PERMALINK.test(a.getAttribute("href") || "")) return;
      a.addEventListener("click", function (e) {
        // Leave modified clicks (open-in-new-tab, middle-click) to the browser.
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        var href = a.href;
        clearCartThenGo(function () { window.location.href = href; });
      });
    });

    var pdp = document.getElementById("pdp-form");
    if (pdp) {
      pdp.addEventListener("submit", function (e) {
        e.preventDefault();
        clearCartThenGo(function () { pdp.submit(); });
      });
    }
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
   no per-page markup. Three parts:
     1. a persistent bottom Action Bar (tap-to-call + convert),
     2. hardened mobile-menu behaviour (Esc / outside-tap / resize
        close, focus + inert a11y, body scroll-lock),
     3. small touch-feel niceties.
   All of it bails out cleanly on desktop and respects the user's
   reduced-motion / reduced-data preferences.
   ============================================================ */
(function () {
  "use strict";

  var MOBILE_BP = 760; // must match the CSS action-bar / menu breakpoint
  var header = document.querySelector(".site-header");

  /* ---------- shared helpers ---------- */
  // Find an existing in-page link whose href contains a keyword. Reusing the
  // real nav/footer hrefs means the Action Bar resolves correctly on BOTH the
  // static site (memberships.html) and Shopify (/pages/memberships) without
  // knowing which platform it is running on.
  function findHref(keyword) {
    var links = document.querySelectorAll(
      ".site-header a[href], .site-footer a[href]"
    );
    for (var i = 0; i < links.length; i++) {
      var h = links[i].getAttribute("href") || "";
      if (h && h !== "#" && h.toLowerCase().indexOf(keyword) !== -1) return h;
    }
    return null;
  }
  function telHref() {
    var t = document.querySelector('a[href^="tel:"]');
    return (t && t.getAttribute("href")) || "tel:+15550142025";
  }
  // Which marketing page are we on? Read the active nav link, fall back to the
  // URL. Returns a short key like "memberships" / "visit-us" / "home".
  function currentPageKey() {
    var active = document.querySelector(
      ".site-header .nav a.active, .site-header .mobile-menu a.active"
    );
    var ref = (active && active.getAttribute("href")) || location.pathname || "";
    ref = ref.toLowerCase();
    var keys = ["play-pricing", "memberships", "parties", "fusion", "photo-gallery", "visit-us"];
    for (var i = 0; i < keys.length; i++) {
      if (ref.indexOf(keys[i]) !== -1) return keys[i];
    }
    return "home";
  }

  var ICON_PHONE =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2A19.86 19.86 0 0 1 3.08 4.18 2 2 0 0 1 5.06 2h3a2 2 0 0 1 2 1.72c.13 1 .37 1.96.72 2.87a2 2 0 0 1-.45 2.11L9.09 9.91a16 16 0 0 0 6 6l1.21-1.21a2 2 0 0 1 2.11-.45c.91.35 1.87.59 2.87.72A2 2 0 0 1 22 16.92z"/></svg>';
  var ICON_HEART =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 1 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>';
  var ICON_PIN =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';
  var ICON_CALENDAR =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>';
  var ICON_CUP =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8h1a3 3 0 0 1 0 6h-1"/><path d="M3 8h15v6a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5z"/><path d="M7 1v2M11 1v2M15 1v2"/></svg>';
  var ICON_X =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  /* ---------- shared: the page's forward "convert" action ----------
     Used by BOTH the bottom Action Bar and the drawer footer so the two never
     disagree. Always points the visitor forward and never to the page they are
     already on. On the memberships page (whose whole job IS converting) it
     points at the in-page plans — mirroring that page's hero + closing-band
     "Choose your plan" → #tiers — rather than pulling the visitor off to
     Visit Us, which the persistent thumb CTA used to do. */
  function computePrimary() {
    var page = currentPageKey();
    var membersHref = findHref("membership");
    var visitHref = findHref("visit");
    var primary;
    switch (page) {
      case "memberships":
        primary = { label: "Choose your plan", href: "#tiers", icon: ICON_HEART, key: "member" };
        break;
      case "parties":
        // The parties page's own goal is the booking flow, so jump straight to
        // the slot picker.
        primary = { label: "Book a party", href: "#booking", icon: ICON_CALENDAR, key: "book" };
        break;
      case "fusion":
        primary = { label: "Plan a Visit", href: visitHref, icon: ICON_PIN, key: "visit" };
        break;
      case "visit-us":
      case "photo-gallery":
      case "play-pricing":
        primary = { label: "Become a Member", href: membersHref, icon: ICON_HEART, key: "member" };
        break;
      default: // home
        primary = { label: "Become a Member", href: membersHref, icon: ICON_HEART, key: "member" };
    }
    // Safety: if a target couldn't be resolved from the DOM, fall back sensibly.
    if (!primary.href) primary = { label: "Plan a Visit", href: visitHref || "#", icon: ICON_PIN, key: "visit" };
    return primary;
  }

  /* ---------- 1. Persistent bottom Action Bar ----------
     Two thumb-reach actions pinned to the bottom of every page on phones:
     a real tap-to-call, plus a context-aware "convert" button that adapts
     to the page you are on (and never links to the page you are already on). */
  (function buildActionBar() {
    if (!document.body || document.querySelector(".m-actionbar")) return;

    var primary = computePrimary();

    var bar = document.createElement("nav");
    bar.className = "m-actionbar";
    bar.setAttribute("aria-label", "Quick actions");
    bar.innerHTML =
      '<a class="m-action m-action--call" href="' + telHref() + '">' +
        '<span class="m-action-ic">' + ICON_PHONE + "</span>" +
        "<span class=\"m-action-tx\">Call</span>" +
      "</a>" +
      '<a class="m-action m-action--primary" href="' + primary.href + '">' +
        '<span class="m-action-ic">' + primary.icon + "</span>" +
        '<span class="m-action-tx">' + primary.label + "</span>" +
      "</a>";
    document.body.appendChild(bar);
    // Lets the stylesheet reserve bottom space for the fixed bar (more widely
    // supported than a :has() selector).
    document.body.classList.add("has-actionbar");

    // Keep the bar tucked away at the very top of the page so it never covers
    // the hero or the section header sitting just beneath it (the hero already
    // carries its own CTAs there); slide it up the moment the visitor scrolls
    // into the content. Set the initial state synchronously so there's no flash.
    var SHOW_AFTER = 150; // px scrolled before the bar reveals
    function syncBarReveal() { bar.classList.toggle("is-attop", window.scrollY <= SHOW_AFTER); }
    syncBarReveal();
    window.addEventListener("scroll", syncBarReveal, { passive: true });

    // Hide the bar while the mobile menu is open (the menu already offers the
    // same destinations), and reveal it again on close. Driven by a class the
    // menu logic below toggles on <html>.
  })();

  /* ---------- 2. Hardened mobile menu ---------- */
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
      // Just a tap-to-call link — gives an open-menu visitor a clear next step
      // (the bottom Action Bar is hidden while the menu is open). No "convert"
      // CTA here on purpose; the membership button was removed from the drawer.
      foot.innerHTML =
        '<a class="m-drawer-call" href="' + telHref() + '">' + ICON_PHONE + "<span>Call (555) 014-2025</span></a>";
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
