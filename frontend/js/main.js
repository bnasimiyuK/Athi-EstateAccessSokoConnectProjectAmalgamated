/* ============================================================
   main.js — shared helpers loaded on every page
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
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function qs(param) {
  return new URLSearchParams(window.location.search).get(param);
}

/* ---------------- NAV FIX ---------------- */
function markActiveNav() {
  const path = window.location.pathname.split("/").pop() || "index.html";

  // 1. Clear all active states
  document.querySelectorAll("[data-nav]").forEach((link) => {
    link.classList.remove("is-active");
  });
  document.querySelectorAll(".nav-dropdown > a").forEach((link) => {
    link.classList.remove("is-active");
  });

  // 2. Highlight the matching top-level link
  document.querySelectorAll("[data-nav]").forEach((link) => {
    if (link.getAttribute("data-nav") === path) {
      link.classList.add("is-active");
    }
  });

  // 3. Highlight Admin dropdown if we are on its subpages
  if (path === "admin.html" || path === "residents.html") {
    const adminTrigger = document.querySelector(".nav-dropdown > a");
    if (adminTrigger) adminTrigger.classList.add("is-active");
  }
}

/* ---------------- DROPDOWN FIX ---------------- */
function setupDropdown() {
  const dropdown = document.querySelector(".nav-dropdown");
  if (!dropdown) return;

  const trigger = dropdown.querySelector("a");
  const menu = dropdown.querySelector(".dropdown-menu");

  trigger.addEventListener("click", (e) => {
    e.preventDefault();
    menu.classList.toggle("show");
  });

  // Close when clicking outside
  document.addEventListener("click", (e) => {
    if (!dropdown.contains(e.target)) {
      menu.classList.remove("show");
    }
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
  toast._t = setTimeout(() => {
    el.classList.remove("toast--visible");
  }, 3200);
}

/* ---------------- INIT ---------------- */
document.addEventListener("DOMContentLoaded", () => {
  markActiveNav();
  setupDropdown();
});