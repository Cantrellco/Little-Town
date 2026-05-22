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
