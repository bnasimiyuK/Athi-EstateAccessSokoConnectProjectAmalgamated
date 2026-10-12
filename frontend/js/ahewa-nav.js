/* ============================================================
   ahewa-nav.js
   Unhides sidebar links marked data-ahewa-only for users who
   have the AHEWA flag (or are admin / super-admin).
   Runs on every page. Safe to include on public pages too.
   ============================================================ */
(function showAhewaNav() {
  "use strict";
  try {
    var raw  = localStorage.getItem("asc_user");
    var user = raw ? JSON.parse(raw) : null;
    var role = String((user && user.role) || "")
      .toLowerCase().replace(/[_\s]+/g, "-");

    var isAdmin = role === "admin" || role === "super-admin";
    var hasAhewa = !!(user && (user.ahewa === true || user.ahewa === 1));

    if (!isAdmin && !hasAhewa) return;

    // Unhide any sidebar link tagged data-ahewa-only
    var nodes = document.querySelectorAll("[data-ahewa-only]");
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].hidden = false;
    }
  } catch (e) {
    /* never break a page because of this */
  }
})();