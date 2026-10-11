/* ============================================================
   js/about.js — About AHE page interactions
   - Smooth scroll to section anchors
   - Scroll-spy: highlight the section currently in view
   - Deep-link handling: scroll to hash on page load
   ============================================================ */

(function () {
  "use strict";

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn);
    } else {
      fn();
    }
  }

  ready(function () {
    const links    = document.querySelectorAll(".about-nav-link");
    const sections = Array.from(document.querySelectorAll(".about-section"));

    if (!links.length || !sections.length) return;

    /* ---------- Smooth scroll on nav click ---------- */
    links.forEach(function (link) {
      link.addEventListener("click", function (e) {
        const href = link.getAttribute("href") || "";
        if (!href.startsWith("#")) return;

        const id     = href.slice(1);
        const target = document.getElementById(id);
        if (!target) return;

        e.preventDefault();

        // Offset for the sticky sub-nav
        const offset = 72;
        const top    = target.getBoundingClientRect().top + window.scrollY - offset;

        window.scrollTo({ top: top, behavior: "smooth" });

        // Update the URL hash without jumping
        if (history.replaceState) {
          history.replaceState(null, "", "#" + id);
        } else {
          window.location.hash = id;
        }
      });
    });

    /* ---------- Scroll-spy: highlight active section ---------- */
    let ticking = false;

    function updateActive() {
      const fromTop = window.scrollY + 90;
      let currentId = sections[0] ? sections[0].id : null;

      for (let i = 0; i < sections.length; i++) {
        const s = sections[i];
        if (s.offsetTop <= fromTop) {
          currentId = s.id;
        } else {
          break;
        }
      }

      links.forEach(function (l) {
        const matches = l.getAttribute("href") === "#" + currentId;
        l.classList.toggle("is-active", matches);
      });
    }

    window.addEventListener("scroll", function () {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(function () {
        updateActive();
        ticking = false;
      });
    }, { passive: true });

    /* ---------- Deep link on page load ---------- */
    if (window.location.hash) {
      const id     = window.location.hash.slice(1);
      const target = document.getElementById(id);
      if (target) {
        // Delay slightly so fonts / layout settle
        setTimeout(function () {
          const offset = 72;
          const top    = target.getBoundingClientRect().top + window.scrollY - offset;
          window.scrollTo({ top: top, behavior: "auto" });
        }, 100);
      }
    }

    // Initial highlight
    updateActive();
  });
})();