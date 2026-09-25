/* ============================================================
   main.js — shared helpers loaded on every page
   + dynamic nav (login state)
   ============================================================ */

let CATEGORY_CACHE = [];

/* ---------------- API CACHE ---------------- */
async function loadCategoryCache() {
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
    declined: "badge--declined",
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

/* ---------------- NAV: highlight active link ---------------- */
function markActiveNav() {
  const path = window.location.pathname.split("/").pop() || "index.html";

  document.querySelectorAll("[data-nav]").forEach((link) => {
    link.classList.remove("is-active");
    if (link.getAttribute("data-nav") === path) {
      link.classList.add("is-active");
    }
  });

  // Highlight Admin dropdown when inside its subpages
  if (path === "admin.html" || path === "pending.html") {
    const adminTrigger = document.querySelector(".nav-dropdown > a");
    if (adminTrigger) adminTrigger.classList.add("is-active");
  }
}

/* ---------------- NAV: login/logout slot ---------------- */
function renderAuthNav() {
  const nav = document.querySelector("nav.main-nav");
  if (!nav) return;

  const existing = nav.querySelector(".auth-slot");
  if (existing) existing.remove();

  const slot = document.createElement("span");
  slot.className = "auth-slot";
  slot.style.display = "inline-flex";
  slot.style.alignItems = "center";
  slot.style.gap = "14px";

  if (typeof isLoggedIn === "function" && isLoggedIn()) {
    const user = getUser();
    slot.innerHTML = `
      <span style="font-size:0.9rem; color:var(--ink-70);">
        Hi, ${user?.name || "there"}
      </span>
      <a href="#" id="logoutLink" style="font-size:0.9rem;">Logout</a>
    `;
    nav.appendChild(slot);

    document.getElementById("logoutLink").addEventListener("click", (e) => {
      e.preventDefault();
      logout();
    });
  } else {
    slot.innerHTML = `<a href="login.html" data-nav="login.html">Log in</a>`;
    nav.appendChild(slot);
  }
}

/* ---------------- DROPDOWN ---------------- */
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
function toast(message) {
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
  toast._t = setTimeout(() => el.classList.remove("toast--visible"), 3200);
}

/* ---------------- INIT ---------------- */
document.addEventListener("DOMContentLoaded", () => {
  markActiveNav();
  renderAuthNav();
  setupDropdown();
});