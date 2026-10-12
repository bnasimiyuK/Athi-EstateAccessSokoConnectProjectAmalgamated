/* ============================================================
   access.js — page-level access guard
   Runs BEFORE any other script. Reads <body data-requires="...">.

   Tokens (space-separated; ALL must pass):
     auth      — must be signed in
     ahe       — resident / vendor / admin / super-admin
     ahewa     — user.ahewa OR admin/super-admin
     vendor    — vendor / provider / admin / super-admin
     security  — security / admin / super-admin
     admin     — admin / super-admin
     super     — super-admin only
   ============================================================ */
(function accessGuard() {
  "use strict";
  try {
    var raw  = localStorage.getItem("asc_user");
    var user = raw ? JSON.parse(raw) : null;
    var role = String((user && user.role) || "")
      .toLowerCase().replace(/[_\s]+/g, "-");

    var isAdmin      = role === "admin"      || role === "super-admin";
    var isSuperAdmin = role === "super-admin";
    var isVendor     = role === "vendor"     || role === "provider";
    var isResident   = role === "resident";
    var isSecurity   = role === "security";
    var hasAHEWA     = !!(user && (user.ahewa === true || user.ahewa === 1));

    var body = document.body;
    if (!body) {
      document.addEventListener("DOMContentLoaded", function () { accessGuard(); });
      return;
    }

    var requires = (body.getAttribute("data-requires") || "")
      .split(/\s+/).filter(Boolean);
    if (!requires.length) return;

    function passes(token) {
      switch (token) {
        case "auth":     return !!user;
        case "ahe":      return isAdmin || isResident || isVendor;
        case "ahewa":    return isAdmin || hasAHEWA;
        case "vendor":   return isAdmin || isVendor;
        case "security": return isAdmin || isSecurity;
        case "admin":    return isAdmin;
        case "super":    return isSuperAdmin;
        default:         return false;
      }
    }

    if (requires.every(passes)) return;
    if (/\/login\.html$/i.test(location.pathname)) return;

    var next = encodeURIComponent(location.pathname + location.search);
    location.replace("login.html?next=" + next + "&denied=1");
  } catch (e) { /* never break the page */ }
})();