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

  /* ---- Booking-widget mockup: purely cosmetic selection ---- */
  document.querySelectorAll(".cal .day.avail").forEach(function (day) {
    day.addEventListener("click", function () {
      var cal = day.closest(".cal");
      if (!cal) return;
      cal.querySelectorAll(".day.selected").forEach(function (d) { d.classList.remove("selected"); });
      day.classList.add("selected");
    });
  });
  document.querySelectorAll(".slots .slot").forEach(function (slot) {
    slot.addEventListener("click", function () {
      var wrap = slot.closest(".slots");
      if (!wrap) return;
      wrap.querySelectorAll(".slot.active").forEach(function (s) { s.classList.remove("active"); });
      slot.classList.add("active");
    });
  });

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
  var ANIMATED = ["hero-town", "kids-play", "map-light"];
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

  /* ---------- 1. Persistent bottom Action Bar ----------
     Two thumb-reach actions pinned to the bottom of every page on phones:
     a real tap-to-call, plus a context-aware "convert" button that adapts
     to the page you are on (and never links to the page you are already on). */
  (function buildActionBar() {
    if (!document.body || document.querySelector(".m-actionbar")) return;

    var page = currentPageKey();
    var membersHref = findHref("membership");
    var visitHref = findHref("visit");
    var partiesHref = findHref("parties");
    var fusionHref = findHref("fusion");
    var playHref = findHref("play-pricing");

    // Decide the primary "convert" action by page so it always points forward.
    var primary;
    switch (page) {
      case "memberships":
        primary = { label: "Plan a Visit", href: visitHref, icon: ICON_PIN, key: "visit" };
        break;
      case "parties":
        primary = { label: "Become a Member", href: membersHref, icon: ICON_HEART, key: "member" };
        break;
      case "fusion":
        primary = { label: "Plan a Visit", href: visitHref, icon: ICON_PIN, key: "visit" };
        break;
      case "visit-us":
        primary = { label: "Become a Member", href: membersHref, icon: ICON_HEART, key: "member" };
        break;
      case "photo-gallery":
        primary = { label: "Become a Member", href: membersHref, icon: ICON_HEART, key: "member" };
        break;
      case "play-pricing":
        primary = { label: "Become a Member", href: membersHref, icon: ICON_HEART, key: "member" };
        break;
      default: // home
        primary = { label: "Become a Member", href: membersHref, icon: ICON_HEART, key: "member" };
    }
    // Safety: if the chosen target couldn't be resolved, fall back sensibly.
    if (!primary.href) primary = { label: "Plan a Visit", href: visitHref || "#", icon: ICON_PIN, key: "visit" };

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
      // Move focus to the first menu link for keyboard users.
      var first = menu.querySelector("a");
      if (first) { try { first.focus({ preventScroll: true }); } catch (e) { first.focus(); } }
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

    // Tap/click outside the header closes the menu.
    document.addEventListener("click", function (e) {
      if (!header.classList.contains("nav-open")) return;
      if (!header.contains(e.target)) close(false);
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
