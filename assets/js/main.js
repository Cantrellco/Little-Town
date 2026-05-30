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

  /* ---- Mobile nav toggle ---- */
  var toggle = document.querySelector(".nav-toggle");
  if (toggle && header) {
    toggle.addEventListener("click", function () {
      var open = header.classList.toggle("nav-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    // Close menu when a link is tapped
    document.querySelectorAll(".mobile-menu a").forEach(function (a) {
      a.addEventListener("click", function () {
        header.classList.remove("nav-open");
        toggle.setAttribute("aria-expanded", "false");
      });
    });
  }

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
