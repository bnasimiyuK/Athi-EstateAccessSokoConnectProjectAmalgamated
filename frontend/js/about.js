/* ============================================================
   js/about.js — About AHE page interactions
   - Autoplay the hero background video
   - Full-name validation on the contact form (letters only)
   - Live feedback while typing
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

    /* ---------- 1. Autoplay the hero video ---------- */
    document.querySelectorAll("video.vp-hero_bg").forEach(function (v) {
      v.play().catch(function () {
        /* Some browsers block autoplay; poster will show instead */
      });
    });

    /* ---------- 2. Contact form validation ---------- */
    const form      = document.getElementById("contact-form");
    const nameInput = document.getElementById("contact-name");
    const nameError = document.getElementById("contact-name-error");

    if (!form || !nameInput) return;

    // Letters, spaces, apostrophes, hyphens only. Must start with a letter.
    const NAME_REGEX = /^[A-Za-z][A-Za-z '\-]*$/;

    function showError(msg) {
      if (!nameError) return;
      nameError.textContent = msg;
      nameError.hidden = false;
      nameInput.classList.add("is-invalid");
    }

    function clearError() {
      if (!nameError) return;
      nameError.hidden = true;
      nameError.textContent = "";
      nameInput.classList.remove("is-invalid");
    }

    // Live validation as the user types
    nameInput.addEventListener("input", function () {
      const v = nameInput.value;

      if (!v) { clearError(); return; }

      if (v.length < 2) {
        showError("Name must be at least 2 characters.");
      } else if (!NAME_REGEX.test(v)) {
        showError("Name can only contain letters, spaces, apostrophes and hyphens.");
      } else {
        clearError();
      }
    });

    // Block invalid characters from being typed at all
    nameInput.addEventListener("keypress", function (e) {
      const ch = e.key;
      if (ch.length === 1 && !/[A-Za-z '\-]/.test(ch)) {
        e.preventDefault();
      }
    });

    // Validate on form submit
    form.addEventListener("submit", function (e) {
      e.preventDefault();

      const v = nameInput.value.trim();

      if (!v) {
        showError("Please enter your full name.");
        nameInput.focus();
        return;
      }
      if (v.length < 2) {
        showError("Name must be at least 2 characters.");
        nameInput.focus();
        return;
      }
      if (!NAME_REGEX.test(v)) {
        showError("Name can only contain letters, spaces, apostrophes and hyphens.");
        nameInput.focus();
        return;
      }

      // ✅ Valid
      clearError();
      alert("Thanks " + v + "! Your message has been noted. In a live deploy, this would email AHE.");
      form.reset();
    });
  });
})();