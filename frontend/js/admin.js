/* ============================================================
   admin.js — Estate admin dashboard
   Tabs: verification queue · all vendors · all residents · reports
   Shell: sidebar (side-rail). Auth chip rendered into #side-rail-auth.
   ============================================================ */

/* ------------------------------------------------------------
   Pagination state
   ------------------------------------------------------------ */
const VERIFY_QUEUE_PER_PAGE = 20;
const verifyQueueState = { page: 1, limit: VERIFY_QUEUE_PER_PAGE, total: 0, totalPages: 1 };

const REPORTS_PER_PAGE = 20;
const reportsState = { page: 1, limit: REPORTS_PER_PAGE, total: 0, totalPages: 1 };

const VENDORS_PER_PAGE = 20;
const vendorsTabState = { page: 1, limit: VENDORS_PER_PAGE, total: 0, totalPages: 1 };

const RESIDENTS_PER_PAGE = 20;
const residentsTabState = { page: 1, limit: RESIDENTS_PER_PAGE, total: 0, totalPages: 1 };

/* ============================================================
   Page detection — do we have the dashboard's chart canvases?
   Only admin.html has them. Sub-pages (reviews, house-numbers,
   providers, residents, etc.) should skip stats + charts.
   ============================================================ */
function isDashboardPage() {
  return !!document.getElementById("chart-trend")
      || !!document.getElementById("hero-pending");
}

/* ============================================================
   ROLE HELPERS — JWT fallback (fixes super admin detection)
   ============================================================ */
function getRoleFromToken() {
  try {
    const token = typeof getToken === "function" ? getToken() : null;
    if (!token) return null;
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload && payload.role ? payload.role : null;
  } catch {
    return null;
  }
}

function getCurrentRole() {
  try {
    const u = typeof getCurrentUser === "function" ? getCurrentUser() : null;
    if (u && u.role) return u.role;
  } catch { /* ignore */ }
  return getRoleFromToken();
}

function isSuperAdmin() {
  return getCurrentRole() === "super-admin";
}

function isAdmin() {
  const r = getCurrentRole();
  return r === "admin" || r === "super";
}

/* ------------------------------------------------------------
   Small helpers
   ------------------------------------------------------------ */
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

/* ------------------------------------------------------------
   Sidebar auth chip
   Renders "Hi, Name [ADMIN] / Logout" into #side-rail-auth
   ------------------------------------------------------------ */
function renderHeaderChip() {
  const role = getCurrentRole() || "admin";
  const user = (typeof getCurrentUser === "function" ? getCurrentUser() : null) || {};

  const authSlot = document.getElementById("side-rail-auth");
  if (authSlot) {
    const name = user.fullName || user.name || "Admin";
    const roleLabel = role === "super" ? "SUPER" : "ADMIN";
    const roleColor = role === "super" ? "var(--ink)" : "var(--ochre)";

    authSlot.innerHTML = `
      <span style="font-size:0.85rem; color:var(--ink-70); display:inline-flex; align-items:center; gap:6px; flex-wrap:wrap;">
        Hi, ${escapeHtml(name)}
        <span style="background:${roleColor}; color:#fff; font-size:0.62rem;
                     padding:2px 8px; border-radius:999px; font-weight:600;
                     letter-spacing:0.4px; text-transform:uppercase;">
          ${roleLabel}
        </span>
      </span>
      <a href="#" id="logoutBtn" style="font-size:0.82rem; color:var(--ink-70);">Logout</a>
    `;

    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", (e) => {
        e.preventDefault();
        if (typeof logout === "function") logout();
        else window.location.href = "login.html";
      });
    }
  }

  document.documentElement.setAttribute("data-role", role);
}

/* ------------------------------------------------------------
   Sidebar group toggle (Admin ▾) + super-only visibility
   ------------------------------------------------------------ */
function setupHeaderDropdown() {
  document.addEventListener("click", (e) => {
    const toggle = e.target.closest(".side-rail__group-toggle");
    if (toggle) {
      e.preventDefault();
      e.stopPropagation();
      const group = toggle.closest(".side-rail__group");
      if (group) {
        group.classList.toggle("is-open");
        toggle.setAttribute(
          "aria-expanded",
          group.classList.contains("is-open") ? "true" : "false"
        );
      }
      return;
    }

    // legacy fallback for any remaining .nav-dropdown
    const legacy = e.target.closest(".nav-dropdown > a:not(.side-rail__group-toggle)");
    if (legacy) {
      e.preventDefault();
      e.stopPropagation();
      const menu = legacy.nextElementSibling;
      if (menu && menu.classList.contains("dropdown-menu")) {
        menu.classList.toggle("show");
      }
      return;
    }

    document.querySelectorAll(".dropdown-menu.show")
      .forEach((m) => m.classList.remove("show"));
  });

  const isSuper = isSuperAdmin();
  document.querySelectorAll("[data-super-only]").forEach((el) => {
    el.style.display = isSuper ? "" : "none";
  });
}

/* ------------------------------------------------------------
   Tab switching
   ------------------------------------------------------------ */
function setupTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (btn.tagName === "A") return;
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("is-active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("is-active"));
      btn.classList.add("is-active");

      const tab = btn.dataset.tab;
      const panel = document.getElementById(`tab-${tab}`);
      if (!panel) return;
      panel.classList.add("is-active");

      if (tab === "vendors"   && !panel.dataset.loaded) { panel.dataset.loaded = "1"; await renderVendorsTab(); }
      if (tab === "residents" && !panel.dataset.loaded) { panel.dataset.loaded = "1"; await renderResidentsTab(); }
    });
  });

  document.querySelectorAll("[data-goto-tab]").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const btn = document.querySelector(`.tab-btn[data-tab="${a.dataset.gotoTab}"]`);
      if (btn) {
        btn.click();
        document.querySelector(".tab-row")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });
}

function switchTab(tabName) {
  const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
  if (btn) {
    btn.click();
    document.querySelector(".tab-row")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

/* ============================================================
   DASHBOARD STATS
   ============================================================ */
async function loadDashboardStats() {
  try {
    const s = await Api.getAdminStats();
    console.log("[admin] stats loaded:", s);

    // Expose stats globally so other scripts (like admin-tools.js) can trigger re-renders
    window.__adminStats = s;

    const set = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value ?? "-";
    };

    /* HERO */
    set("hero-pending",  s.headline?.pendingResidents);
    set("hero-vendors",  s.headline?.pendingVendors);
    set("hero-bookings", s.bookings?.thisMonth);

    /* Users */
    set("tile-pending-residents",  s.headline?.pendingResidents);
    set("tile-approved-residents", s.headline?.approvedResidents);
    set("tile-pending-vendors",    s.headline?.pendingVendors);
    set("tile-approved-vendors",   s.headline?.approvedVendors);
    set("tile-residents-joined",   s.headline?.residentsJoinedThisMonth);
    set("tile-vendors-joined",     s.headline?.vendorsJoinedThisMonth);

    /* Bookings */
    set("tile-bookings-open",      s.bookings?.open);
    set("tile-bookings-confirmed", s.bookings?.confirmed);
    set("tile-bookings-completed", s.bookings?.completed);
    set("tile-bookings-cancelled", s.bookings?.cancelled);
    set("tile-bookings-total",     s.bookings?.total);
    set("tile-bookings-month",     s.bookings?.thisMonth);
    set("tile-completed-month",    s.bookings?.completedThisMonth);
    set("tile-cancelled-month",    s.bookings?.cancelledThisMonth);
    set("tile-bookings-7d",        s.bookings?.last7d);
    set("tile-bookings-30d",       s.bookings?.last30d);

    /* Deltas */
    renderDelta("delta-bookings-month",  s.bookings?.thisMonth,          s.bookings?.lastMonth,          false);
    renderDelta("delta-completed-month", s.bookings?.completedThisMonth, s.bookings?.completedLastMonth, false);
    renderDelta("delta-cancelled-month", s.bookings?.cancelledThisMonth, s.bookings?.cancelledLastMonth, true);

    /* Quality */
    set("tile-reviews-total", s.quality?.reviewsTotal);
    set("tile-avg-rating",    Number(s.quality?.avgRating ?? 0).toFixed(2));
    set("tile-reviews-5star", s.quality?.reviews5Star);
    set("tile-reviews-low",   s.quality?.reviewsLow);

    /* Provider health */
    set("tile-vendors-active", s.providers?.active30d);
    set("tile-vendors-dead",   s.providers?.withNoBookings);
    set("tile-cats-empty",     s.providers?.categoriesWithoutVendor);
    set("tile-courts-total",   s.courts?.total);

    /* Engagement */
    set("tile-distinct-bookers", s.residents?.distinctBookers);
    set("tile-repeat-bookers",   s.residents?.repeatBookers);

    /* Alerts */
    renderAlertList("alert-empty-categories-body",
      s.emptyCategories, (c) => c.label,
      "Every category has an approved vendor.");
    renderAlertList("alert-dead-vendors-body",
      s.deadVendors, (v) => `${v.name} - ${v.phone || "no phone"}`,
      "Every approved vendor has at least one booking.");
    renderAlertList("alert-top-vendors-body",
      s.topVendors, (v) => `${v.name} - ⭐ ${Number(v.rating).toFixed(1)} (${v.reviews})`,
      "No reviews yet.");
    renderWeekday("alert-weekday-body", s.byWeekday || []);

    return s; // hand back the payload for chart rendering
  } catch (err) {
    console.error("[admin] failed to load stats:", err);
    return null;
  }
}

function renderDelta(elId, current, previous, lowerIsBetter = false) {
  const el = document.getElementById(elId);
  if (!el) return;
  const diff = (current || 0) - (previous || 0);
  if (diff === 0) {
    el.textContent = "no change vs last month";
    el.className = "stat-tile_delta";
    return;
  }
  const isGood = lowerIsBetter ? diff < 0 : diff > 0;
  el.textContent = `${diff > 0 ? "+" : ""}${diff} vs last month`;
  el.className = "stat-tile_delta " + (isGood ? "is-good" : "is-bad");
}

function renderAlertList(elId, items, mapFn, emptyMsg) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!items || !items.length) {
    el.innerHTML = `<div class="alert-empty">${emptyMsg}</div>`;
    return;
  }
  el.innerHTML = `<ul class="alert-list">${
    items.map((it) => `<li>${mapFn(it)}</li>`).join("")
  }</ul>`;
}

function renderWeekday(elId, rows) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!rows.length) {
    el.innerHTML = `<div class="alert-empty">No bookings yet.</div>`;
    return;
  }
  const max = Math.max(...rows.map((r) => r.total), 1);
  el.innerHTML = `<ul class="weekday-list">${
    rows.map((r) => `
      <li>
        <span class="weekday-label">${r.day}</span>
        <span class="weekday-bar"><span style="width:${(r.total / max) * 100}%"></span></span>
        <span class="weekday-count">${r.total}</span>
      </li>
    `).join("")
  }</ul>`;
}

/* ============================================================
   Chart.js
   ============================================================ */
const CHART_COLORS = {
  ink: "#16233f", ochre: "#c8862a", teal: "#2f6f5e", clay: "#b0472e", blue: "#4a7ba7",
};
const chartInstances = {};

function destroyChart(id) {
  if (chartInstances[id]) {
    try { chartInstances[id].destroy(); } catch { /* ignore */ }
    delete chartInstances[id];
  }
}

function renderTrendChart(trend) {
  const ctx = document.getElementById("chart-trend");
  if (!ctx) return; // silently skip — canvas lives in a modal now
  destroyChart("chart-trend");
  chartInstances["chart-trend"] = new Chart(ctx, {
    type: "line",
    data: {
      labels: (trend || []).map((r) => r.month),
      datasets: [
        { label: "Total",     data: (trend || []).map((r) => r.total),
          borderColor: CHART_COLORS.ink,  backgroundColor: "rgba(22, 35, 63, 0.08)", tension: 0.3, fill: true },
        { label: "Completed", data: (trend || []).map((r) => r.completed),
          borderColor: CHART_COLORS.teal, backgroundColor: "rgba(47, 111, 94, 0.08)", tension: 0.3, fill: true },
        { label: "Cancelled", data: (trend || []).map((r) => r.cancelled),
          borderColor: CHART_COLORS.clay, backgroundColor: "rgba(176, 71, 46, 0.08)", tension: 0.3, fill: true },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: "bottom" } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
}

function renderStatusChart(b) {
  const ctx = document.getElementById("chart-status");
  if (!ctx) return;
  destroyChart("chart-status");
  const safe = b || {};
  chartInstances["chart-status"] = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Requested", "Confirmed", "Completed", "Cancelled"],
      datasets: [{
        data: [safe.open || 0, safe.confirmed || 0, safe.completed || 0, safe.cancelled || 0],
        backgroundColor: [CHART_COLORS.ochre, CHART_COLORS.blue, CHART_COLORS.teal, CHART_COLORS.clay],
        borderWidth: 0,
      }],
    },
    options: { responsive: true, maintainAspectRatio: false, cutout: "62%", plugins: { legend: { position: "bottom" } } },
  });
}

function renderCategoryChart(categories) {
  const ctx = document.getElementById("chart-category");
  if (!ctx) return;
  destroyChart("chart-category");
  const list = categories || [];
  chartInstances["chart-category"] = new Chart(ctx, {
    type: "bar",
    data: {
      labels: list.map((c) => c.label),
      datasets: [
        { label: "Approved", data: list.map((c) => c.approved), backgroundColor: CHART_COLORS.teal },
        { label: "Pending",  data: list.map((c) => c.pending),  backgroundColor: CHART_COLORS.ochre },
      ],
    },
    options: {
      indexAxis: "y", responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: "bottom" } },
      scales: { x: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
}

function renderWeekdayChart(byWeekday) {
  const ctx = document.getElementById("chart-weekday");
  if (!ctx) return;
  destroyChart("chart-weekday");
  const rows = byWeekday || [];
  const order = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
  const map = Object.fromEntries(rows.map((r) => [r.day, r.total]));
  const labels = order.filter((d) => map[d] !== undefined);
  const values = labels.map((d) => map[d]);
  chartInstances["chart-weekday"] = new Chart(ctx, {
    type: "bar",
    data: {
      labels: labels.map((d) => d.slice(0, 3)),
      datasets: [{ label: "Bookings", data: values, backgroundColor: CHART_COLORS.ink, borderRadius: 4 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
}

function renderAllCharts(s) {
  if (!s) return; // silently skip if no stats yet
  console.log("[admin] renderAllCharts input:", {
    trend:      (s.trend || []).length,
    bookings:   s.bookings,
    categories: (s.categories || []).length,
    byWeekday:  (s.byWeekday || []).length,
  });
  renderTrendChart(s.trend || []);
  renderStatusChart(s.bookings || { open: 0, confirmed: 0, completed: 0, cancelled: 0 });
  renderCategoryChart(s.categories || []);
  renderWeekdayChart(s.byWeekday || []);
}

// Expose globally so admin-tools.js can trigger a re-render
window.renderAllCharts = renderAllCharts;

/* ============================================================
   Verification queue (pending providers)
   ============================================================ */
async function renderVerifyQueue() {
  const el = document.getElementById("tab-verify");
  if (!el) return;
  el.innerHTML = `<div class="empty-state">Loading providers…</div>`;

  let result;
  try {
    result = await Api.getProviders({
      verified: "false",
      page: verifyQueueState.page,
      limit: verifyQueueState.limit,
    });
  } catch (err) {
    console.error("[admin] verify queue load failed:", err);
    el.innerHTML = `<div class="empty-state" style="color:var(--clay)">Could not load providers: ${err.message}</div>`;
    return;
  }

  const pending = Array.isArray(result) ? result : (result.data || []);
  verifyQueueState.total      = result.total      ?? pending.length;
  verifyQueueState.page       = result.page       ?? 1;
  verifyQueueState.limit      = result.limit      ?? VERIFY_QUEUE_PER_PAGE;
  verifyQueueState.totalPages = result.totalPages ?? 1;

  const countEl = document.getElementById("count-verify");
  if (countEl) countEl.textContent = verifyQueueState.total ? `(${verifyQueueState.total})` : "";

  if (!pending.length) {
    el.innerHTML = `<div class="empty-state">No listings waiting for review.</div>`;
    return;
  }

  const canDelete = isSuperAdmin();

  el.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Name</th><th>Category</th><th>Phone</th><th>Actions</th></tr></thead>
        <tbody>
          ${pending.map((p) => `
            <tr>
              <td>${escapeHtml(p.name)}</td>
              <td>${categoryLabel(p.category)}</td>
              <td>${escapeHtml(p.phone || "-")}</td>
              <td class="row-actions">
                <button class="btn btn--accent btn--small" data-approve="${p.id}">Approve</button>
                ${canDelete
                  ? `<button class="btn btn--danger btn--small"
                             data-reject="${p.id}"
                             data-name="${escapeAttr(p.name)}">Reject</button>`
                  : `<button class="btn btn--danger btn--small" disabled
                             title="Only super admins can permanently delete"
                             style="opacity:0.5;cursor:not-allowed;">Reject</button>`}
              </td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>
    ${verifyQueuePaginationHtml()}
  `;

  wireVerifyQueuePagination();

  el.querySelectorAll("[data-approve]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await Api.updateProvider(btn.dataset.approve, { verified: true });
        toast("Provider approved and now visible to residents.");
        if (el.querySelectorAll("tbody tr").length === 1 && verifyQueueState.page > 1) {
          verifyQueueState.page--;
        }
        await renderVerifyQueue();
        await refreshDashboard();
      } catch (e) {
        toast(e.message || "Could not approve.");
        btn.disabled = false;
      }
    })
  );

  el.querySelectorAll("[data-reject]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const name = btn.dataset.name;
      if (!confirm(
        `Permanently delete pending vendor "${name}"?\n\n` +
        `This also removes their reviews, reports and bookings.\n` +
        `This cannot be undone.`
      )) return;

      btn.disabled = true;
      btn.textContent = "Deleting…";
      try {
        await Api.removeProvider(btn.dataset.reject);
        toast("Listing rejected and removed.");
        if (el.querySelectorAll("tbody tr").length === 1 && verifyQueueState.page > 1) {
          verifyQueueState.page--;
        }
        await renderVerifyQueue();
        await refreshDashboard();
      } catch (e) {
        console.error("[admin] reject failed:", e);
        toast(e.message || "Could not reject.");
        btn.disabled = false;
        btn.textContent = "Reject";
      }
    })
  );
}

function verifyQueuePaginationHtml() {
  const { page, limit, total, totalPages } = verifyQueueState;
  const startRow = total === 0 ? 0 : ((page - 1) * limit) + 1;
  const endRow = Math.min(page * limit, total);
  const prevDisabled = page <= 1 ? "disabled" : "";
  const nextDisabled = page >= totalPages ? "disabled" : "";

  return `
    <div class="pagination"
         style="display:flex;justify-content:space-between;align-items:center;
                gap:12px;flex-wrap:wrap;margin-top:18px;padding:12px 4px;
                border-top:1px solid var(--line);">
      <div style="font-size:0.9rem;color:var(--ink-70);">
        Showing <b>${startRow}-${endRow}</b> of <b>${total}</b>
        pending listing${total === 1 ? "" : "s"}
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button class="btn btn--ghost btn--small" data-verify-page="prev" ${prevDisabled}>« Prev</button>
        <span style="font-size:0.9rem;color:var(--ink-70);padding:0 4px;">
          Page <b>${page}</b> of <b>${totalPages}</b>
        </span>
        <button class="btn btn--ghost btn--small" data-verify-page="next" ${nextDisabled}>Next »</button>
      </div>
    </div>
  `;
}

function wireVerifyQueuePagination() {
  const el = document.getElementById("tab-verify");
  if (!el) return;
  el.querySelectorAll("[data-verify-page]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const dir = btn.dataset.verifyPage;
      if (dir === "prev" && verifyQueueState.page > 1) verifyQueueState.page--;
      else if (dir === "next" && verifyQueueState.page < verifyQueueState.totalPages) verifyQueueState.page++;
      else return;
      await renderVerifyQueue();
      document.querySelector(".tab-row")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

/* ============================================================
   All vendors tab
   ============================================================ */
async function renderVendorsTab() {
  const el = document.getElementById("tab-vendors");
  if (!el) return;
  el.innerHTML = `<div class="empty-state">Loading vendors…</div>`;

  let result;
  try {
    result = await Api.getProviders({
      page:  vendorsTabState.page,
      limit: vendorsTabState.limit,
    });
  } catch (err) {
    console.error("[admin] vendors tab load failed:", err);
    el.innerHTML = `<div class="empty-state" style="color:var(--clay)">Could not load vendors: ${err.message}</div>`;
    return;
  }

  const rows = Array.isArray(result) ? result : (result.data || []);
  vendorsTabState.total      = result.total      ?? rows.length;
  vendorsTabState.page       = result.page       ?? 1;
  vendorsTabState.totalPages = result.totalPages ?? 1;

  const countEl = document.getElementById("count-vendors");
  if (countEl) countEl.textContent = vendorsTabState.total ? `(${vendorsTabState.total})` : "";

  if (!rows.length) {
    el.innerHTML = `<div class="empty-state">No vendors on the platform.</div>`;
    return;
  }

  const canDelete = isSuperAdmin();

  el.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Name</th><th>Category</th><th>Phone</th><th>Status</th><th>Rating</th><th>Actions</th></tr>
        </thead>
        <tbody>
          ${rows.map((p) => vendorRow(p, canDelete)).join("")}
        </tbody>
      </table>
    </div>
    ${vendorsTabPaginationHtml()}
  `;

  wireVendorsTab();
}

function vendorRow(p, canDelete) {
  const catLabel = categoryLabel(p.category);
  const statusBadge = p.verified
    ? `<span class="badge badge--verified">Approved</span>`
    : `<span class="badge badge--pending">Pending</span>`;

  const approve = !p.verified
    ? `<button class="btn btn--accent btn--small" data-vendor-approve="${p.id}">Approve</button>`
    : `<button class="btn btn--ghost btn--small" data-vendor-unverify="${p.id}">Unverify</button>`;

  const del = canDelete
    ? `<button class="btn btn--danger btn--small"
               data-vendor-delete="${p.id}"
               data-name="${escapeAttr(p.name)}">Delete</button>`
    : `<button class="btn btn--danger btn--small" disabled
               title="Only super admins can permanently delete"
               style="opacity:0.5;cursor:not-allowed;">Delete</button>`;

  return `
    <tr>
      <td><a href="/provider.html?id=${p.id}" style="font-weight:600;">${escapeHtml(p.name)}</a></td>
      <td>${escapeHtml(catLabel)}</td>
      <td>${escapeHtml(p.phone || "-")}</td>
      <td>${statusBadge}</td>
      <td>${p.rating ? Number(p.rating).toFixed(1) + " ★" : "—"}</td>
      <td class="row-actions">${approve}${del}</td>
    </tr>
  `;
}

function vendorsTabPaginationHtml() {
  const { page, limit, total, totalPages } = vendorsTabState;
  const startRow = total === 0 ? 0 : ((page - 1) * limit) + 1;
  const endRow = Math.min(page * limit, total);
  const prevDisabled = page <= 1 ? "disabled" : "";
  const nextDisabled = page >= totalPages ? "disabled" : "";

  return `
    <div class="pagination"
         style="display:flex;justify-content:space-between;align-items:center;
                gap:12px;flex-wrap:wrap;margin-top:18px;padding:12px 4px;
                border-top:1px solid var(--line);">
      <div style="font-size:0.9rem;color:var(--ink-70);">
        Showing <b>${startRow}-${endRow}</b> of <b>${total}</b>
        vendor${total === 1 ? "" : "s"}
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button class="btn btn--ghost btn--small" data-vendors-page="prev" ${prevDisabled}>« Prev</button>
        <span style="font-size:0.9rem;color:var(--ink-70);padding:0 4px;">
          Page <b>${page}</b> of <b>${totalPages}</b>
        </span>
        <button class="btn btn--ghost btn--small" data-vendors-page="next" ${nextDisabled}>Next »</button>
      </div>
    </div>
  `;
}

function wireVendorsTab() {
  const el = document.getElementById("tab-vendors");
  if (!el) return;

  el.querySelectorAll("[data-vendor-approve]").forEach((b) =>
    b.addEventListener("click", async () => {
      b.disabled = true;
      try {
        await Api.updateProvider(b.dataset.vendorApprove, { verified: true });
        toast("Vendor approved.");
        await renderVendorsTab();
        await refreshDashboard();
      } catch (e) { toast(e.message || "Could not approve."); b.disabled = false; }
    })
  );

  el.querySelectorAll("[data-vendor-unverify]").forEach((b) =>
    b.addEventListener("click", async () => {
      b.disabled = true;
      try {
        await Api.updateProvider(b.dataset.vendorUnverify, { verified: false });
        toast("Vendor unverified — hidden from residents.");
        await renderVendorsTab();
        await refreshDashboard();
      } catch (e) { toast(e.message || "Could not unverify."); b.disabled = false; }
    })
  );

  el.querySelectorAll("[data-vendor-delete]").forEach((b) =>
    b.addEventListener("click", async () => {
      const id = b.dataset.vendorDelete;
      const name = b.dataset.name;
      if (!confirm(
        `Permanently delete vendor "${name}"?\n\n` +
        `This also deletes their reviews, reports and bookings.\n` +
        `This cannot be undone.`
      )) return;
      b.disabled = true;
      b.textContent = "Deleting…";
      try {
        await Api.removeProvider(id);
        toast(`Vendor "${name}" deleted.`);
        await renderVendorsTab();
        await refreshDashboard();
      } catch (e) {
        console.error("[admin] delete vendor failed:", e);
        toast(e.message || "Could not delete vendor.");
        b.disabled = false;
        b.textContent = "Delete";
      }
    })
  );

  el.querySelectorAll("[data-vendors-page]").forEach((b) => {
    b.addEventListener("click", async () => {
      const dir = b.dataset.vendorsPage;
      if (dir === "prev" && vendorsTabState.page > 1) vendorsTabState.page--;
      if (dir === "next" && vendorsTabState.page < vendorsTabState.totalPages) vendorsTabState.page++;
      await renderVendorsTab();
    });
  });
}

/* ============================================================
   All residents tab
   ============================================================ */
async function renderResidentsTab() {
  const el = document.getElementById("tab-residents");
  if (!el) return;
  el.innerHTML = `<div class="empty-state">Loading residents…</div>`;

  let result;
  try {
    result = await Api.getResidents({
      page:  residentsTabState.page,
      limit: residentsTabState.limit,
    });
  } catch (err) {
    console.error("[admin] residents tab load failed:", err);
    el.innerHTML = `<div class="empty-state" style="color:var(--clay)">Could not load residents: ${err.message}</div>`;
    return;
  }

  const rows = Array.isArray(result) ? result : (result.data || []);
  residentsTabState.total      = result.total      ?? rows.length;
  residentsTabState.page       = result.page       ?? 1;
  residentsTabState.totalPages = result.totalPages ?? 1;

  const countEl = document.getElementById("count-residents");
  if (countEl) countEl.textContent = residentsTabState.total ? `(${residentsTabState.total})` : "";

  if (!rows.length) {
    el.innerHTML = `<div class="empty-state">No residents yet.</div>`;
    return;
  }

  const canDelete = isSuperAdmin();

  el.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Name</th><th>Phone</th><th>Court</th>
            <th>Phase</th><th>House</th><th>Status</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r) => residentRow(r, canDelete)).join("")}
        </tbody>
      </table>
    </div>
    ${residentsTabPaginationHtml()}
  `;

  wireResidentsTab();
}

function residentRow(r, canDelete) {
  const statusBadge = r.verified
    ? `<span class="badge badge--verified">Verified</span>`
    : `<span class="badge badge--pending">Pending</span>`;

  const approve = !r.verified
    ? `<button class="btn btn--accent btn--small" data-res-approve="${r.id}">Approve</button>`
    : `<button class="btn btn--ghost btn--small" data-res-unverify="${r.id}">Unverify</button>`;

  const del = canDelete
    ? `<button class="btn btn--danger btn--small"
               data-res-delete="${r.id}"
               data-name="${escapeAttr(r.fullName)}">Delete</button>`
    : `<button class="btn btn--danger btn--small" disabled
               title="Only super admins can permanently delete"
               style="opacity:0.5;cursor:not-allowed;">Delete</button>`;

  return `
    <tr>
      <td style="font-weight:600;">${escapeHtml(r.fullName)}</td>
      <td>${escapeHtml(r.phone || "-")}</td>
      <td>${escapeHtml(r.courtName || "-")}</td>
      <td>${r.phase != null ? "Phase " + r.phase : "—"}</td>
      <td>${escapeHtml(r.houseNumber || "—")}</td>
      <td>${statusBadge}</td>
      <td class="row-actions">${approve}${del}</td>
    </tr>
  `;
}

function residentsTabPaginationHtml() {
  const { page, limit, total, totalPages } = residentsTabState;
  const startRow = total === 0 ? 0 : ((page - 1) * limit) + 1;
  const endRow = Math.min(page * limit, total);
  const prevDisabled = page <= 1 ? "disabled" : "";
  const nextDisabled = page >= totalPages ? "disabled" : "";

  return `
    <div class="pagination"
         style="display:flex;justify-content:space-between;align-items:center;
                gap:12px;flex-wrap:wrap;margin-top:18px;padding:12px 4px;
                border-top:1px solid var(--line);">
      <div style="font-size:0.9rem;color:var(--ink-70);">
        Showing <b>${startRow}-${endRow}</b> of <b>${total}</b>
        resident${total === 1 ? "" : "s"}
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button class="btn btn--ghost btn--small" data-residents-page="prev" ${prevDisabled}>« Prev</button>
        <span style="font-size:0.9rem;color:var(--ink-70);padding:0 4px;">
          Page <b>${page}</b> of <b>${totalPages}</b>
        </span>
        <button class="btn btn--ghost btn--small" data-residents-page="next" ${nextDisabled}>Next »</button>
      </div>
    </div>
  `;
}

function wireResidentsTab() {
  const el = document.getElementById("tab-residents");
  if (!el) return;

  el.querySelectorAll("[data-res-approve]").forEach((b) =>
    b.addEventListener("click", async () => {
      b.disabled = true;
      try {
        await Api.updateResident(b.dataset.resApprove, { verified: true });
        toast("Resident verified.");
        await renderResidentsTab();
        await refreshDashboard();
      } catch (e) { toast(e.message || "Could not verify."); b.disabled = false; }
    })
  );

  el.querySelectorAll("[data-res-unverify]").forEach((b) =>
    b.addEventListener("click", async () => {
      b.disabled = true;
      try {
        await Api.updateResident(b.dataset.resUnverify, { verified: false });
        toast("Resident unverified.");
        await renderResidentsTab();
        await refreshDashboard();
      } catch (e) { toast(e.message || "Could not unverify."); b.disabled = false; }
    })
  );

  el.querySelectorAll("[data-res-delete]").forEach((b) =>
    b.addEventListener("click", async () => {
      const id = b.dataset.resDelete;
      const name = b.dataset.name;
      if (!confirm(
        `Permanently delete resident "${name}"?\n\n` +
        `If they have a vendor profile, it will be deleted along with ` +
        `their reviews, reports and bookings.\n` +
        `This cannot be undone.`
      )) return;
      b.disabled = true;
      b.textContent = "Deleting…";
      try {
        await Api.removeResident(id);
        toast(`Resident "${name}" deleted.`);
        await renderResidentsTab();
        await refreshDashboard();
      } catch (e) {
        console.error("[admin] delete resident failed:", e);
        toast(e.message || "Could not delete resident.");
        b.disabled = false;
        b.textContent = "Delete";
      }
    })
  );

  el.querySelectorAll("[data-residents-page]").forEach((b) => {
    b.addEventListener("click", async () => {
      const dir = b.dataset.residentsPage;
      if (dir === "prev" && residentsTabState.page > 1) residentsTabState.page--;
      if (dir === "next" && residentsTabState.page < residentsTabState.totalPages) residentsTabState.page++;
      await renderResidentsTab();
    });
  });
}

/* ============================================================
   Reports tab
   ============================================================ */
async function renderReports() {
  const el = document.getElementById("tab-reports");
  if (!el) return;
  el.innerHTML = `<div class="empty-state">Loading reports…</div>`;

  let result;
  try {
    result = await Api.getReports({
      page: reportsState.page,
      limit: reportsState.limit,
    });
  } catch (err) {
    console.error("[admin] reports load failed:", err);
    el.innerHTML = `<div class="empty-state" style="color:var(--clay)">Could not load reports: ${err.message}</div>`;
    return;
  }

  const reports = Array.isArray(result) ? result : (result.data || []);
  reportsState.total      = result.total      ?? reports.length;
  reportsState.page       = result.page       ?? 1;
  reportsState.limit      = result.limit      ?? REPORTS_PER_PAGE;
  reportsState.totalPages = result.totalPages ?? 1;

  const openCount = result.openCount ?? reports.filter((r) => r.status === "open").length;
  const countEl = document.getElementById("count-reports");
  if (countEl) countEl.textContent = openCount ? `(${openCount})` : "";

  if (!reports.length) {
    el.innerHTML = `<div class="empty-state">No reports have been filed.</div>`;
    return;
  }

  el.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Provider</th><th>Reason</th><th>Details</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>
          ${reports.map((r) => `
            <tr>
              <td>${escapeHtml(r.providerName)}</td>
              <td>${escapeHtml(r.reason)}</td>
              <td style="max-width:260px;">${escapeHtml(r.details)}</td>
              <td>${statusBadge(r.status === "open" ? "requested" : "completed")}</td>
              <td>${r.status === "open"
                ? `<button class="btn btn--ghost btn--small" data-resolve="${r.id}">Mark reviewed</button>`
                : `<span class="meta">Reviewed</span>`}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>
    ${reportsPaginationHtml()}
  `;

  wireReportsPagination();

  el.querySelectorAll("[data-resolve]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      await Api.updateReport(btn.dataset.resolve, { status: "reviewed" });
      toast("Report marked as reviewed.");
      await renderReports();
      await refreshDashboard();
    })
  );
}

function reportsPaginationHtml() {
  const { page, limit, total, totalPages } = reportsState;
  const startRow = total === 0 ? 0 : ((page - 1) * limit) + 1;
  const endRow = Math.min(page * limit, total);
  const prevDisabled = page <= 1 ? "disabled" : "";
  const nextDisabled = page >= totalPages ? "disabled" : "";

  return `
    <div class="pagination"
         style="display:flex;justify-content:space-between;align-items:center;
                gap:12px;flex-wrap:wrap;margin-top:18px;padding:12px 4px;
                border-top:1px solid var(--line);">
      <div style="font-size:0.9rem;color:var(--ink-70);">
        Showing <b>${startRow}-${endRow}</b> of <b>${total}</b>
        report${total === 1 ? "" : "s"}
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button class="btn btn--ghost btn--small" data-reports-page="prev" ${prevDisabled}>« Prev</button>
        <span style="font-size:0.9rem;color:var(--ink-70);padding:0 4px;">
          Page <b>${page}</b> of <b>${totalPages}</b>
        </span>
        <button class="btn btn--ghost btn--small" data-reports-page="next" ${nextDisabled}>Next »</button>
      </div>
    </div>
  `;
}

function wireReportsPagination() {
  const el = document.getElementById("tab-reports");
  if (!el) return;
  el.querySelectorAll("[data-reports-page]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const dir = btn.dataset.reportsPage;
      if (dir === "prev" && reportsState.page > 1) reportsState.page--;
      else if (dir === "next" && reportsState.page < reportsState.totalPages) reportsState.page++;
      else return;
      await renderReports();
      document.querySelector(".tab-row")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

/* ============================================================
   Refresh just the dashboard stats + charts
   ============================================================ */
async function refreshDashboard() {
  const stats = await loadDashboardStats();
  // Only draw charts if their canvases exist on this page (admin.html)
  if (stats && document.getElementById("chart-trend")) {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    renderAllCharts(stats);
  }
}

/* ============================================================
   Full refresh
   ============================================================ */
async function renderAll() {
  try {
    await renderVerifyQueue();
    await renderReports();
    await renderVendorsTab();
    await renderResidentsTab();

    const stats = await loadDashboardStats();

    // Only draw charts if their canvases exist on this page (admin.html)
    if (stats && document.getElementById("chart-trend")) {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      renderAllCharts(stats);
    }
  } catch (err) {
    console.error("[admin] renderAll failed:", err);
  }
}

/* ============================================================
   Export buttons
   ============================================================ */
async function downloadAdminReport(kind) {
  const btnId = kind === "xlsx" ? "btn-excel" : "btn-pdf";
  const btn = document.getElementById(btnId);
  if (!btn) return;
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "⏳ Preparing…";

  try {
    const token = typeof getToken === "function" ? getToken() : null;
    if (!token) throw new Error("Not logged in - no token found.");

    let res;
    if (kind === "xlsx") {
      const images = {};
      ["chart-trend", "chart-status", "chart-category", "chart-weekday"].forEach((id) => {
        const canvas = document.getElementById(id);
        if (canvas && canvas.width > 0) images[id] = canvas.toDataURL("image/png");
      });
      res = await fetch("http://localhost:4050/api/admin/export.xlsx", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ images }),
      });
    } else {
      res = await fetch("http://localhost:4050/api/admin/export.pdf", {
        headers: { Authorization: `Bearer ${token}` },
      });
    }

    if (res.status === 401 || res.status === 403) {
      toast("Please log in as admin.");
      window.location.href = "login.html?next=%2Fadmin.html";
      return;
    }
    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${msg}`);
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `athi-soko-report-${new Date().toISOString().slice(0, 10)}.${kind}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    toast(kind === "xlsx"
      ? "Report downloaded (XLSX with charts)."
      : "Report downloaded (PDF).");
  } catch (err) {
    console.error(`[admin] ${kind} export failed:`, err);
    toast(err.message.includes("Not logged in")
      ? `Could not download ${kind.toUpperCase()}. Please log in as admin.`
      : `Could not download ${kind.toUpperCase()}.`);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

function setupExportButtons() {
  const btnExcel = document.getElementById("btn-excel");
  const btnPdf   = document.getElementById("btn-pdf");
  if (btnExcel) btnExcel.addEventListener("click", () => downloadAdminReport("xlsx"));
  if (btnPdf)   btnPdf.addEventListener("click",   () => downloadAdminReport("pdf"));
}

/* ============================================================
   Init
   ============================================================ */
document.addEventListener("DOMContentLoaded", async () => {
  await window.__apiReady;
  if (typeof requireRole === "function" &&
    !requireRole("admin", "super-admin")) return;

  // --- Always run: sidebar chrome, chips, export buttons ---
  renderHeaderChip();
  setupHeaderDropdown();
  setupExportButtons();

  // Auto-open the Admin group on the sidebar (we're on an admin page)
  const adminGroup = document.querySelector(".side-rail__group");
  if (adminGroup) {
    adminGroup.classList.add("is-open");
    const trigger = adminGroup.querySelector(".side-rail__group-toggle");
    if (trigger) {
      trigger.classList.add("is-active");
      trigger.setAttribute("aria-expanded", "true");
    }
    const dashLink = adminGroup.querySelector('[data-nav="admin.html"]');
    if (dashLink) dashLink.classList.add("is-active");
  }

  if (typeof loadCategoryCache === "function") await loadCategoryCache();

  // --- Only run: dashboard stats, tabs, charts ---
  // These elements only exist on admin.html. Skipping them on
  // sub-pages silences "canvas missing" warnings.
  if (isDashboardPage()) {
    setupTabs();
    await renderAll();
  }

  console.log("[admin] role resolved as:", getCurrentRole(), "| isSuperAdmin:", isSuperAdmin());
});

/* ============================================================
   Re-render charts when the Trends modal opens
   (admin-tools.js dispatches this event after the modal's
   canvas elements have been inserted into the DOM)
   ============================================================ */
document.addEventListener("trends:render", function () {
  if (typeof renderAllCharts === "function" && window.__adminStats) {
    renderAllCharts(window.__adminStats);
  } else {
    console.warn("[admin] trends:render fired but no stats cached yet");
  }
});