/* ============================================================
   super-admin.js — logic for super admin pages
   Loaded only on super-admin-*.html
   ============================================================ */
(function () {
  "use strict";

  /* ------------------------------------------------------------
     Resolve API base the same way api.js does
     ------------------------------------------------------------ */
  const API_SUPER_BASE = (function () {
    const proto = window.location.protocol;
    const host  = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1") {
      return "http://localhost:4050/api/super-admin";
    }
    return "http://" + host + ":4050/api/super-admin";
  })();

  /* ------------------------------------------------------------
     Auth guard (belt-and-braces)
     ------------------------------------------------------------ */
  function currentUser() {
    // Prefer the app's auth helper
    if (typeof getUser === "function") {
      const u = getUser();
      if (u) return u;
    }
    // Fallback: read the raw key directly
    try {
      const raw = localStorage.getItem("asc_user");
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function requireSuperAdmin() {
    const user = currentUser();
    if (!user || user.role !== "super-admin") {
      window.location.href = "login.html?next=" +
        encodeURIComponent(window.location.pathname);
      return false;
    }
    return true;
  }

  /* ------------------------------------------------------------
     Fetch helper for the super-admin API
     ------------------------------------------------------------ */
  async function apiFetch(path, opts = {}) {
    const token = (typeof getToken === "function" ? getToken() : null)
                || localStorage.getItem("asc_token");
    const headers = Object.assign(
      { "Content-Type": "application/json" },
      opts.headers || {}
    );
    if (token) headers.Authorization = "Bearer " + token;

    const res = await fetch(API_SUPER_BASE + path, { ...opts, headers });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const err  = new Error(`HTTP ${res.status}: ${body}`);
      err.status = res.status;
      err.body   = body;
      throw err;
    }
    if (res.status === 204) return null;
    return res.json();
  }

  /* ------------------------------------------------------------
     Small render helpers
     ------------------------------------------------------------ */
  function esc(v) {
    return String(v == null ? "—" : v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function fmtDate(v) {
    if (!v) return "—";
    const d = new Date(v);
    return isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
  }
  function yesNo(v) {
    return v ? "Yes" : "No";
  }
  function emptyState(msg) {
    return `<div class="empty-state">${esc(msg)}</div>`;
  }

  /* ============================================================
     ADMINS
     ============================================================ */
  async function loadAdminsPage() {
    const el = document.getElementById("admins-list");
    if (!el) return;
    el.innerHTML = emptyState("Loading admins…");

    let admins = [];
    try {
      const res = await apiFetch("/admins");
      admins = Array.isArray(res && res.data) ? res.data : [];
    } catch (err) {
      console.error("[super-admin] admins load failed:", err);
      el.innerHTML = emptyState("Could not load admins.");
      return;
    }

    if (!admins.length) {
      el.innerHTML = emptyState("No admins yet.");
      return;
    }

    el.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>ID</th><th>Name</th><th>Email</th><th>Created</th><th>Actions</th></tr>
          </thead>
          <tbody>
            ${admins.map((a) => `
              <tr>
                <td>${esc(a.id)}</td>
                <td>${esc(a.full_name || a.name)}</td>
                <td>${esc(a.email)}</td>
                <td>${esc(fmtDate(a.created_at))}</td>
                <td class="row-actions">
                  <button class="btn btn--small btn--danger" data-del="${esc(a.id)}">Remove</button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;

    el.querySelectorAll("[data-del]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        if (!confirm("Remove this admin? They will lose access immediately.")) return;
        try {
          await apiFetch("/admins/" + btn.dataset.del, { method: "DELETE" });
          if (typeof toast === "function") toast("Admin removed.");
          loadAdminsPage();
        } catch (err) {
          console.error("[super-admin] remove admin failed:", err);
          if (typeof toast === "function") toast("Could not remove admin.");
        }
      })
    );
  }

  function wireNewAdminButton() {
    const btn = document.getElementById("btn-new-admin");
    if (!btn) return;

    btn.addEventListener("click", async () => {
      const name     = prompt("Full name:");
      if (!name) return;
      const email    = prompt("Email address:");
      if (!email) return;
      const password = prompt("Temporary password (min 8 chars):");
      if (!password) return;

      try {
        await apiFetch("/admins", {
          method: "POST",
          body: JSON.stringify({ name, email, password }),
        });
        if (typeof toast === "function") toast("Admin created.");
        loadAdminsPage();
      } catch (err) {
        console.error("[super-admin] create admin failed:", err);
        if (typeof toast === "function") toast("Could not create admin.");
      }
    });
  }

  /* ============================================================
     CATEGORIES
     ============================================================ */
  async function loadCategoriesPage() {
    const el = document.getElementById("categories-list");
    if (!el) return;
    el.innerHTML = emptyState("Loading categories…");

    let cats = [];
    try {
      const res = await apiFetch("/categories");
      cats = Array.isArray(res && res.data) ? res.data : [];
    } catch (err) {
      console.error("[super-admin] categories load failed:", err);
      el.innerHTML = emptyState("Could not load categories.");
      return;
    }

    if (!cats.length) {
      el.innerHTML = emptyState("No categories yet.");
      return;
    }

    el.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead><tr><th>ID</th><th>Label</th><th>Actions</th></tr></thead>
          <tbody>
            ${cats.map((c) => `
              <tr>
                <td>${esc(c.id)}</td>
                <td>${esc(c.label)}</td>
                <td class="row-actions">
                  <button class="btn btn--small btn--danger" data-del="${esc(c.id)}">Delete</button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;

    el.querySelectorAll("[data-del]").forEach((b) =>
      b.addEventListener("click", async () => {
        if (!confirm("Delete this category?")) return;
        try {
          await apiFetch("/categories/" + b.dataset.del, { method: "DELETE" });
          if (typeof toast === "function") toast("Category deleted.");
          loadCategoriesPage();
        } catch (err) {
          console.error("[super-admin] delete category failed:", err);
          if (typeof toast === "function") {
            toast(err.status === 409
              ? "Cannot delete — providers still use this category."
              : "Could not delete category.");
          }
        }
      })
    );
  }

  /* ============================================================
     PROVIDERS
     ============================================================ */
  async function loadProvidersPage() {
    const el = document.getElementById("providers-list");
    if (!el) return;
    el.innerHTML = emptyState("Loading providers…");

    let providers = [];
    try {
      const res = await apiFetch("/providers");
      providers = Array.isArray(res && res.data) ? res.data : [];
    } catch (err) {
      console.error("[super-admin] providers load failed:", err);
      el.innerHTML = emptyState("Could not load providers.");
      return;
    }

    if (!providers.length) {
      el.innerHTML = emptyState("No providers.");
      return;
    }

    el.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>ID</th><th>Name</th><th>Category</th><th>Phone</th><th>Verified</th><th>Actions</th></tr>
          </thead>
          <tbody>
            ${providers.map((p) => `
              <tr>
                <td>${esc(p.id)}</td>
                <td>${esc(p.name)}</td>
                <td>${esc(p.category_id)}</td>
                <td>${esc(p.phone)}</td>
                <td>${esc(yesNo(p.verified))}</td>
                <td class="row-actions">
                  <button class="btn btn--small btn--danger" data-del="${esc(p.id)}">Remove</button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;

    el.querySelectorAll("[data-del]").forEach((b) =>
      b.addEventListener("click", async () => {
        if (!confirm("Remove this provider?")) return;
        try {
          await apiFetch("/providers/" + b.dataset.del, { method: "DELETE" });
          if (typeof toast === "function") toast("Provider removed.");
          loadProvidersPage();
        } catch (err) {
          console.error("[super-admin] remove provider failed:", err);
          if (typeof toast === "function") toast("Could not remove provider.");
        }
      })
    );
  }

  /* ============================================================
     RESIDENTS
     ============================================================ */
  async function loadResidentsPage() {
    const el = document.getElementById("residents-list");
    if (!el) return;
    el.innerHTML = emptyState("Loading residents…");

    let residents = [];
    try {
      const res = await apiFetch("/residents");
      residents = Array.isArray(res && res.data) ? res.data : [];
    } catch (err) {
      console.error("[super-admin] residents load failed:", err);
      el.innerHTML = emptyState("Could not load residents.");
      return;
    }

    if (!residents.length) {
      el.innerHTML = emptyState("No residents.");
      return;
    }

    el.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>ID</th><th>Name</th><th>Phone</th><th>Email</th><th>House #</th><th>Verified</th><th>Actions</th></tr>
          </thead>
          <tbody>
            ${residents.map((r) => `
              <tr>
                <td>${esc(r.id)}</td>
                <td>${esc(r.full_name || r.name)}</td>
                <td>${esc(r.phone)}</td>
                <td>${esc(r.email)}</td>
                <td>${esc(r.house_number)}</td>
                <td>${esc(yesNo(r.verified))}</td>
                <td class="row-actions">
                  <button class="btn btn--small btn--danger" data-del="${esc(r.id)}">Remove</button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;

    el.querySelectorAll("[data-del]").forEach((b) =>
      b.addEventListener("click", async () => {
        if (!confirm("Remove this resident?")) return;
        try {
          await apiFetch("/residents/" + b.dataset.del, { method: "DELETE" });
          if (typeof toast === "function") toast("Resident removed.");
          loadResidentsPage();
        } catch (err) {
          console.error("[super-admin] remove resident failed:", err);
          if (typeof toast === "function") toast("Could not remove resident.");
        }
      })
    );
  }

  /* ============================================================
     Init
     ============================================================ */
  document.addEventListener("DOMContentLoaded", () => {
    if (!requireSuperAdmin()) return;

    if (document.getElementById("admins-list"))      { loadAdminsPage(); wireNewAdminButton(); }
    if (document.getElementById("categories-list"))  loadCategoriesPage();
    if (document.getElementById("providers-list"))   loadProvidersPage();
    if (document.getElementById("residents-list"))   loadResidentsPage();
  });
})();