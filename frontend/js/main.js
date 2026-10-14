/* ============================================================
   main.js — shared helpers loaded on every page
   + side-rail auth chip (login / profile / logout)
   ============================================================ */

/* Kick off API discovery immediately, before the DOM is ready.
   Expose a promise so any later DOMContentLoaded handler can
   `await window.__apiReady` to guarantee the API base is set. */
window.__apiReady = (async () => {
  if (typeof window.discoverApiBase === "function") {
    return await window.discoverApiBase();
  }
})();

/* ============================================================
   DOM HELPERS — safe wrappers that no-op on missing elements.
   Use these instead of getElementById(...).addEventListener(...)
   to prevent "Cannot read properties of null" crashes.
   ============================================================ */

/** Get element by id, or null (never throws). */
function $id(id) {
  return document.getElementById(id);
}

/** Query selector, or null. */
function $(sel, root = document) {
  return root.querySelector(sel);
}

/** Query selector all, returns a real Array. */
function $$(sel, root = document) {
  return Array.from(root.querySelectorAll(sel));
}

/**
 * Safe addEventListener. Does nothing if the element doesn't exist.
 *   on("my-button", "click", () => { ... });
 */
function on(id, event, handler, opts) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(event, handler, opts);
  return el;
}

/**
 * Safe addEventListener on every matching element.
 *   onAll(".tab-btn", "click", (e) => { ... });
 */
function onAll(selector, event, handler, opts) {
  const els = document.querySelectorAll(selector);
  els.forEach((el) => el.addEventListener(event, handler, opts));
  return els;
}

/**
 * Safe addEventListener on the element itself (not by id).
 *   onEl(someElement, "click", () => { ... });
 */
function onEl(el, event, handler, opts) {
  if (el) el.addEventListener(event, handler, opts);
  return el;
}

let CATEGORY_CACHE = [];

/* ---------------- API CACHE ---------------- */
async function loadCategoryCache() {
  await window.__apiReady;              /* never race discovery */
  if (!CATEGORY_CACHE.length) {
    CATEGORY_CACHE = await Api.getCategories();
  }
  return CATEGORY_CACHE;
}

/* ---------------- HELPERS ---------------- */
function categoryLabel(id) {
  const cat = CATEGORY_CACHE.find((c) => c.id === id);
  return cat ? cat.label : id;
}

function starString(rating) {
  if (!rating) return "No ratings yet";
  const full = Math.round(rating);
  return "★".repeat(full) + "☆".repeat(5 - full) + `  ${rating.toFixed(1)}`;
}

function verifiedBadge(isVerified) {
  return isVerified
    ? `<span class="badge badge--verified">Verified</span>`
    : `<span class="badge badge--pending">Pending review</span>`;
}

function statusBadge(status) {
  const map = {
    requested: "badge--requested",
    confirmed: "badge--confirmed",
    completed: "badge--completed",
    declined:  "badge--declined",
  };
  return `<span class="badge ${map[status] || ""}">${status}</span>`;
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-KE", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function qs(param) {
  return new URLSearchParams(window.location.search).get(param);
}

/* ============================================================
   NAV: highlight the active link
   ============================================================ */
function markActiveNav() {
  const path = window.location.pathname.split("/").pop() || "index.html";

  // Works for both side-rail and legacy main-nav
  document.querySelectorAll("[data-nav]").forEach((link) => {
    link.classList.remove("is-active");
    if (link.getAttribute("data-nav") === path) {
      link.classList.add("is-active");
    }
  });

  // Highlight Admin when inside its subpages
  if (["admin.html", "pending.html"].includes(path)) {
    const adminTrigger = document.querySelector(".nav-dropdown > a");
    if (adminTrigger) adminTrigger.classList.add("is-active");
  }
}

/* ============================================================
   AUTH CHIP — logged-in user badge in the topbar
   Renders into #topbar-user inside the side-rail layout.
   Falls back to the legacy .auth-slot if it ever exists.
   ============================================================ */
function getInitials(name) {
  return String(name || "?")
    .split(/\s+/).filter(Boolean).map((n) => n[0]).slice(0, 2).join("").toUpperCase();
}

function renderAuthNav() {
  // Prefer the side-rail slot; fall back to legacy .auth-slot
  const slot = document.getElementById("topbar-user")
            || document.querySelector(".side-rail__topbar-user")
            || document.querySelector(".auth-slot");

  if (!slot) return;

  // Clear any previous render
  slot.innerHTML = "";

  const loggedIn =
    (typeof isLoggedIn === "function" && isLoggedIn()) ||
    (typeof Auth !== "undefined" &&
     typeof Auth.isLoggedIn === "function" &&
     Auth.isLoggedIn());

  if (loggedIn) {
    const user =
      (typeof getUser === "function" && getUser()) ||
      (typeof Auth !== "undefined" &&
       typeof Auth.currentUser === "function" &&
       Auth.currentUser()) ||
      null;

    const name = user?.name || user?.fullName || "Resident";

    // Normalize the role string (backend may send "super-admin",
    // "super_admin", "SuperAdmin", etc.)
    const role = String(user?.role || "resident")
      .toLowerCase()
      .replace(/[_\s]/g, "-");

    // Role colors — includes super-admin (purple)
    const roleColor = {
      "super-admin": "#6f0bea",   // purple
      "admin":       "#b0472e",   // clay
      "resident":    "#2f6f5e",   // teal
      "vendor":      "#c8862a",   // ochre
      "provider":    "#c8862a",   // ochre
    }[role] || "#4a5670";

    // Pretty label per role
    const roleLabelMap = {
      "super-admin": "Super Admin",
      "admin":       "Admin",
      "resident":    "Resident",
      "vendor":      "Vendor",
      "provider":    "Provider",
    };
    const roleLabel = roleLabelMap[role]
      || role.charAt(0).toUpperCase() + role.slice(1);

    // Avatar — use photo if available, otherwise initials
    const photo    = user?.avatarUrl || user?.photo || "";
    const initials = getInitials(name);

    const avatarHTML = photo
      ? `<span class="auth-chip__avatar" title="Change photo">
           <img class="auth-chip__avatar-img" src="${photo}" alt="">
           <span class="auth-chip__avatar-overlay"><i class="fas fa-camera"></i></span>
         </span>`
      : `<span class="auth-chip__avatar" title="Change photo">
           ${initials}
           <span class="auth-chip__avatar-overlay"><i class="fas fa-camera"></i></span>
         </span>`;

    const chip = document.createElement("div");
    chip.className = "auth-chip";
    chip.innerHTML = `
      ${avatarHTML}
      <span class="auth-chip__greet">Signed in as</span>
      <span class="auth-chip__name">${name}</span>
      <span class="auth-chip__role" data-role="${role}" style="background:${roleColor};">${roleLabel}</span>
      <a href="#" class="auth-chip__logout" id="logoutLink">
        <i class="fas fa-sign-out-alt"></i> Logout
      </a>
    `;

    slot.appendChild(chip);

    // ---- Logout wiring ----
    const logoutEl = chip.querySelector("#logoutLink");
    if (logoutEl) {
      logoutEl.addEventListener("click", (e) => {
        e.preventDefault();
        if (typeof logout === "function") {
          logout();
        } else {
          try {
            localStorage.removeItem("athi_user");
            sessionStorage.removeItem("athi_user");
          } catch {}
          window.location.href = "/login.html";
        }
      });
    }

    // ---- Avatar upload wiring ----
    const avatarEl = chip.querySelector(".auth-chip__avatar");
    if (avatarEl) {
      avatarEl.addEventListener("click", () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.addEventListener("change", async () => {
          const file = input.files?.[0];
          if (!file) return;
          const fd = new FormData();
          fd.append("avatar", file);
          try {
            if (typeof Api !== "undefined" && typeof Api.uploadAvatar === "function") {
              await Api.uploadAvatar(fd);
            } else {
              // Fallback if Api.uploadAvatar isn't defined
              const token = typeof getToken === "function" ? getToken() : null;
              const headers = token ? { Authorization: "Bearer " + token } : {};
              const res = await fetch("/api/me/avatar", {
                method: "POST",
                headers,
                body: fd,
              });
              if (!res.ok) throw new Error("Upload failed");
            }
            toast("Profile photo updated.");
            setTimeout(() => location.reload(), 600);
          } catch (err) {
            console.error("[avatar] upload failed:", err);
            toast("Could not upload photo.");
          }
        });
        input.click();
      });
    }

  } else {
    // Not signed in → show a Log in link
    const chip = document.createElement("div");
    chip.className = "auth-chip";
    chip.innerHTML = `
      <a href="/login.html?next=${encodeURIComponent(location.pathname)}"
         class="auth-chip__link">
        <i class="fas fa-sign-in-alt"></i> Log in
      </a>
    `;
    slot.appendChild(chip);
  }
}

/* ---------------- DROPDOWN (legacy) ---------------- */
function setupDropdown() {
  document.addEventListener("click", (e) => {
    const trigger = e.target.closest(".nav-dropdown > a");
    if (trigger) {
      e.preventDefault();
      e.stopPropagation();
      const menu = trigger.nextElementSibling;
      if (menu && menu.classList.contains("dropdown-menu")) {
        menu.classList.toggle("show");
      }
      return;
    }
    document.querySelectorAll(".dropdown-menu.show").forEach((m) => m.classList.remove("show"));
  });
}

/* ---------------- TOAST ---------------- */
function toast(message, duration = 3200) {
  let el = document.getElementById("asc-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "asc-toast";
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add("toast--visible");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("toast--visible"), duration);
}

/* ---- Mobile sidebar toggle (replaces js/sidebar.js) ---- */
function setupSideRailToggle() {
  const rail     = document.getElementById("side-rail");
  const toggle   = document.getElementById("side-rail-toggle");
  const backdrop = document.getElementById("side-rail-backdrop");
  if (!rail || !toggle) return;

  const open = () => {
    rail.classList.add("is-open");
    if (backdrop) backdrop.classList.add("is-visible");
  };
  const close = () => {
    rail.classList.remove("is-open");
    if (backdrop) backdrop.classList.remove("is-visible");
  };

  toggle.addEventListener("click", () => {
    rail.classList.contains("is-open") ? close() : open();
  });
  if (backdrop) backdrop.addEventListener("click", close);

  // Close the drawer when a nav link is clicked (mobile)
  rail.querySelectorAll(".side-rail__nav a").forEach((a) =>
    a.addEventListener("click", close)
  );
}

/* __SIDEBAR_VISIBILITY_V1__ */
/* ============================================================
   SIDEBAR VISIBILITY
   - data-roles="role1,role2" → element shown only if user's role is in list
   - Super-admin sees everything
   - Legacy data-*-only attributes still respected
   ============================================================ */
(function applySidebarVisibility() {
  try {
    const user = (typeof getUser === "function" && getUser()) || null;
    const role = user
      ? String(user.role || "").toLowerCase().replace(/[_\s]/g, "-")
      : "";

    const isSuperAdmin = role === "super-admin";

    function apply(el, allowed) {
      el.hidden = isSuperAdmin ? false : !allowed.includes(role);
    }

    document.querySelectorAll("[data-roles]").forEach((el) => {
      const allowed = (el.getAttribute("data-roles") || "")
        .split(",").map((s) => s.trim()).filter(Boolean);
      apply(el, allowed);
    });

    document.querySelectorAll("[data-admin-only]").forEach((el) =>
      apply(el, ["admin", "super-admin"]));
    document.querySelectorAll("[data-super-admin-only]").forEach((el) =>
      apply(el, ["super-admin"]));
    document.querySelectorAll("[data-resident-only]").forEach((el) =>
      apply(el, ["resident"]));
    document.querySelectorAll("[data-security-only]").forEach((el) =>
      apply(el, ["security", "admin", "super-admin"]));
    document.querySelectorAll("[data-vendor-only]").forEach((el) =>
      apply(el, ["vendor", "provider"]));
  } catch (err) {
    console.error("[sidebar-visibility] failed:", err);
  }
})();

/* ---------------- INIT ----------------
   Wait for API discovery before running anything. On the phone,
   this probes LAN_IP_CANDIDATES and picks the first responding IP;
   on the web, it uses the current hostname. Without this await,
   Api.* calls race discovery and throw "API base not resolved yet".
   -------------------------------------- */
document.addEventListener("DOMContentLoaded", async () => {
  await window.__apiReady;

  markActiveNav();
  renderAuthNav();
  setupDropdown();
  setupSideRailToggle();
});