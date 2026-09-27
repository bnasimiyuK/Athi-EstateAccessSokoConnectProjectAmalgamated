/* ============================================================
   admin.js — verification queue + report review for estate admin
   + live dashboard stats (via /api/admin/stats)
   ============================================================ */

/* ------------------------------------------------------------
   Tab switching
   ------------------------------------------------------------ */
function setupTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("is-active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("is-active"));
      btn.classList.add("is-active");
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add("is-active");
    });
  });
}

/* ------------------------------------------------------------
   Programmatically switch tabs (used by stat tiles)
   ------------------------------------------------------------ */
function switchTab(tabName) {
  const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
  if (btn) {
    btn.click();
    document.querySelector(".tab-row")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

/* ------------------------------------------------------------
   Dashboard stats — fills all tiles + alerts + charts
   ------------------------------------------------------------ */
async function loadDashboardStats() {
  try {
    const s = await Api.getAdminStats();
    console.log("[admin] stats loaded:", s);

    const set = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value ?? "—";
    };

    /* ----- Users ----- */
    set("tile-pending-residents",  s.headline.pendingResidents);
    set("tile-approved-residents", s.headline.approvedResidents);
    set("tile-pending-vendors",    s.headline.pendingVendors);
    set("tile-approved-vendors",   s.headline.approvedVendors);
    set("tile-residents-joined",   s.headline.residentsJoinedThisMonth);
    set("tile-vendors-joined",     s.headline.vendorsJoinedThisMonth);

    /* ----- Bookings ----- */
    set("tile-bookings-open",      s.bookings.open);
    set("tile-bookings-confirmed", s.bookings.confirmed);
    set("tile-bookings-completed", s.bookings.completed);
    set("tile-bookings-cancelled", s.bookings.cancelled);
    set("tile-bookings-total",     s.bookings.total);
    set("tile-bookings-month",     s.bookings.thisMonth);
    set("tile-completed-month",    s.bookings.completedThisMonth);
    set("tile-cancelled-month",    s.bookings.cancelledThisMonth);
    set("tile-bookings-7d",        s.bookings.last7d);
    set("tile-bookings-30d",       s.bookings.last30d);

    /* ----- Deltas ----- */
    renderDelta("delta-bookings-month",
      s.bookings.thisMonth, s.bookings.lastMonth, false);
    renderDelta("delta-completed-month",
      s.bookings.completedThisMonth, s.bookings.completedLastMonth, false);
    renderDelta("delta-cancelled-month",
      s.bookings.cancelledThisMonth, s.bookings.cancelledLastMonth, true);

    /* ----- Quality ----- */
    set("tile-reviews-total", s.quality.reviewsTotal);
    set("tile-avg-rating",    Number(s.quality.avgRating).toFixed(2));
    set("tile-reviews-5star", s.quality.reviews5Star);
    set("tile-reviews-low",   s.quality.reviewsLow);

    /* ----- Provider health ----- */
    set("tile-vendors-active", s.providers.active30d);
    set("tile-vendors-dead",   s.providers.withNoBookings);
    set("tile-cats-empty",     s.providers.categoriesWithoutVendor);
    set("tile-courts-total",   s.courts.total);

    /* ----- Engagement ----- */
    set("tile-distinct-bookers", s.residents.distinctBookers);
    set("tile-repeat-bookers",   s.residents.repeatBookers);

    /* ----- Alerts ----- */
    renderAlertList("alert-empty-categories-body",
      s.emptyCategories, (c) => c.label,
      "Every category has an approved vendor.");
    renderAlertList("alert-dead-vendors-body",
      s.deadVendors, (v) => `${v.name} — ${v.phone || "no phone"}`,
      "Every approved vendor has at least one booking.");
    renderAlertList("alert-top-vendors-body",
      s.topVendors, (v) => `${v.name} — ⭐ ${Number(v.rating).toFixed(1)} (${v.reviews})`,
      "No reviews yet.");
    renderWeekday("alert-weekday-body", s.byWeekday);

    /* ----- Charts ----- */
    renderAllCharts(s);

  } catch (err) {
    console.error("[admin] failed to load stats:", err);
  }
}

/* ------------------------------------------------------------
   Delta badge renderer
   ------------------------------------------------------------ */
function renderDelta(elId, current, previous, lowerIsBetter = false) {
  const el = document.getElementById(elId);
  if (!el) return;

  const diff = (current || 0) - (previous || 0);
  if (diff === 0) {
    el.textContent = "no change vs last month";
    el.className = "stat-tile__delta";
    return;
  }
  const isGood = lowerIsBetter ? diff < 0 : diff > 0;
  el.textContent = `${diff > 0 ? "+" : ""}${diff} vs last month`;
  el.className = "stat-tile__delta " + (isGood ? "is-good" : "is-bad");
}

/* ------------------------------------------------------------
   Alert list renderer
   ------------------------------------------------------------ */
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

/* ------------------------------------------------------------
   Weekday bar list
   ------------------------------------------------------------ */
function renderWeekday(elId, rows) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!rows || !rows.length) {
    el.innerHTML = `<div class="alert-empty">No bookings yet.</div>`;
    return;
  }
  const max = Math.max(...rows.map((r) => r.total));
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
   Chart.js rendering
   ============================================================ */
const CHART_COLORS = {
  ink:   "#16233f",
  ochre: "#c8862a",
  teal:  "#2f6f5e",
  clay:  "#b0472e",
  blue:  "#4a7ba7",
};

const chartInstances = {};

function destroyChart(id) {
  if (chartInstances[id]) {
    chartInstances[id].destroy();
    delete chartInstances[id];
  }
}

function renderTrendChart(trend) {
  const ctx = document.getElementById("chart-trend");
  if (!ctx) return;
  destroyChart("chart-trend");

  chartInstances["chart-trend"] = new Chart(ctx, {
    type: "line",
    data: {
      labels: trend.map((r) => r.month),
      datasets: [
        { label: "Total",     data: trend.map((r) => r.total),
          borderColor: CHART_COLORS.ink,  backgroundColor: "rgba(22, 35, 63, 0.08)",
          tension: 0.3, fill: true },
        { label: "Completed", data: trend.map((r) => r.completed),
          borderColor: CHART_COLORS.teal, backgroundColor: "rgba(47, 111, 94, 0.08)",
          tension: 0.3, fill: true },
        { label: "Cancelled", data: trend.map((r) => r.cancelled),
          borderColor: CHART_COLORS.clay, backgroundColor: "rgba(176, 71, 46, 0.08)",
          tension: 0.3, fill: true },
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

  chartInstances["chart-status"] = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Requested", "Confirmed", "Completed", "Cancelled"],
      datasets: [{
        data: [b.open, b.confirmed, b.completed, b.cancelled],
        backgroundColor: [
          CHART_COLORS.ochre, CHART_COLORS.blue,
          CHART_COLORS.teal,  CHART_COLORS.clay,
        ],
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      cutout: "62%",
      plugins: { legend: { position: "bottom" } },
    },
  });
}

function renderCategoryChart(categories) {
  const ctx = document.getElementById("chart-category");
  if (!ctx) return;
  destroyChart("chart-category");

  chartInstances["chart-category"] = new Chart(ctx, {
    type: "bar",
    data: {
      labels: categories.map((c) => c.label),
      datasets: [
        { label: "Approved", data: categories.map((c) => c.approved),
          backgroundColor: CHART_COLORS.teal },
        { label: "Pending",  data: categories.map((c) => c.pending),
          backgroundColor: CHART_COLORS.ochre },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: "bottom" } },
      scales: { x: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
}

function renderWeekdayChart(byWeekday) {
  const ctx = document.getElementById("chart-weekday");
  if (!ctx) return;
  destroyChart("chart-weekday");

  const order = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
  const map = Object.fromEntries(byWeekday.map((r) => [r.day, r.total]));
  const labels = order.filter((d) => map[d] !== undefined);
  const values = labels.map((d) => map[d]);

  chartInstances["chart-weekday"] = new Chart(ctx, {
    type: "bar",
    data: {
      labels: labels.map((d) => d.slice(0, 3)),
      datasets: [{
        label: "Bookings",
        data: values,
        backgroundColor: CHART_COLORS.ink,
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
}

function renderAllCharts(s) {
  renderTrendChart(s.trend || []);
  renderStatusChart(s.bookings || {});
  renderCategoryChart(s.categories || []);
  renderWeekdayChart(s.byWeekday || []);
}

/* ------------------------------------------------------------
   Verification queue (pending providers)
   ------------------------------------------------------------ */
async function renderVerifyQueue(allProviders) {
  const pending = allProviders.filter((p) => !p.verified);
  document.getElementById("count-verify").textContent = pending.length ? `(${pending.length})` : "";
  const el = document.getElementById("tab-verify");

  if (!pending.length) {
    el.innerHTML = `<div class="empty-state">No listings waiting for review.</div>`;
    return;
  }

  el.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Name</th><th>Category</th><th>Zone</th><th>Phone</th><th>Action</th></tr></thead>
        <tbody>
          ${pending.map((p) => `
            <tr>
              <td>${p.name}</td>
              <td>${categoryLabel(p.category)}</td>
              <td>${p.zone}</td>
              <td>${p.phone}</td>
              <td class="row-actions">
                <button class="btn btn--accent btn--small" data-approve="${p.id}">Approve</button>
                <button class="btn btn--danger btn--small" data-reject="${p.id}">Reject</button>
              </td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;

  el.querySelectorAll("[data-approve]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      await Api.updateProvider(btn.dataset.approve, { verified: true });
      toast("Provider approved and now visible to residents.");
      await renderAll();
    })
  );
  el.querySelectorAll("[data-reject]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      await Api.removeProvider(btn.dataset.reject);
      toast("Listing rejected and removed.");
      await renderAll();
    })
  );
}

/* ------------------------------------------------------------
   Reports
   ------------------------------------------------------------ */
async function renderReports() {
  const reports = (await Api.getReports()).slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const open = reports.filter((r) => r.status === "open");
  document.getElementById("count-reports").textContent = open.length ? `(${open.length})` : "";
  const el = document.getElementById("tab-reports");

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
              <td>${r.providerName}</td>
              <td>${r.reason}</td>
              <td style="max-width:260px;">${r.details}</td>
              <td>${statusBadge(r.status === "open" ? "requested" : "completed")}</td>
              <td>${r.status === "open"
                ? `<button class="btn btn--ghost btn--small" data-resolve="${r.id}">Mark reviewed</button>`
                : `<span class="meta">Reviewed</span>`}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;

  el.querySelectorAll("[data-resolve]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      await Api.updateReport(btn.dataset.resolve, { status: "reviewed" });
      toast("Report marked as reviewed.");
      await renderAll();
    })
  );
}

/* ------------------------------------------------------------
   All providers table
   ------------------------------------------------------------ */
function renderAllProviders(providers) {
  const el = document.getElementById("tab-providers");
  el.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Name</th><th>Category</th><th>Status</th><th>Rating</th><th>Action</th></tr></thead>
        <tbody>
          ${providers.map((p) => `
            <tr>
              <td>${p.name}</td>
              <td>${categoryLabel(p.category)}</td>
              <td>${verifiedBadge(p.verified)}</td>
              <td>${p.rating ? p.rating.toFixed(1) : "—"}</td>
              <td><button class="btn btn--danger btn--small" data-remove="${p.id}">Remove</button></td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;

  el.querySelectorAll("[data-remove]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (confirm("Remove this provider from the platform?")) {
        await Api.removeProvider(btn.dataset.remove);
        toast("Provider removed.");
        await renderAll();
      }
    })
  );
}

/* ------------------------------------------------------------
   Full refresh — providers + reports + stats
   ------------------------------------------------------------ */
async function renderAll() {
  const providers = await Api.getProviders();
  await renderVerifyQueue(providers);
  await renderReports();
  renderAllProviders(providers);

  await loadDashboardStats();
}

/* ------------------------------------------------------------
   Export buttons — Excel and PDF downloads
   ------------------------------------------------------------ */
async function downloadAdminReport(kind /* "xlsx" | "pdf" */) {
  const btnId = kind === "xlsx" ? "btn-excel" : "btn-pdf";
  const btn = document.getElementById(btnId);
  if (!btn) return;

  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "⏳ Preparing…";

  try {
    const token = typeof getToken === "function" ? getToken() : null;
    if (!token) throw new Error("Not logged in — no token found.");

    const res = await fetch(`http://localhost:4050/api/admin/export.${kind}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 401 || res.status === 403) {
      // CHANGED: alert → toast (+ redirect)
      toast("Please log in as admin.");
      window.location.href = "login.html?next=%2Fadmin.html";
      return;
    }
    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${msg}`);
    }

    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `athi-soko-report-${new Date().toISOString().slice(0, 10)}.${kind}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    toast(`Report downloaded (${kind.toUpperCase()}).`);
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

/* ------------------------------------------------------------
   Init
   ------------------------------------------------------------ */
document.addEventListener("DOMContentLoaded", async () => {
  if (typeof requireRole === "function" && !requireRole("admin")) return;

  setupExportButtons();

  await loadCategoryCache();
  setupTabs();

  await renderAll();
});