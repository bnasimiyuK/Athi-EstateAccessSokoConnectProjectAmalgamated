/* ============================================================
   Athi Soko Connect — Admin Dashboard
   Reads the /api/admin/dashboard payload that this backend
   actually returns (headline / thisMonth / active / byCategory /
   trend), and maps it into the shape the HTML/Chart.js expects.
   ============================================================ */

(function () {
  "use strict";

  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const fmtNum    = (n) => (n == null || isNaN(n)) ? "—" : Number(n).toLocaleString("en-KE");
  const fmtRating = (n) => (n == null || isNaN(n)) ? "—" : Number(n).toFixed(2);
  const num       = (v) => (typeof v === "number" && isFinite(v)) ? v : (Number(v) || 0);

  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const setDelta = (id, v, up) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (v == null || v === "") { el.textContent = ""; el.className = "kpi_delta"; return; }
    el.textContent = v;
    el.className = "kpi_delta " + (up === true ? "is-good" : up === false ? "is-bad" : "");
  };
  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  /* ---------- Chart.js defaults ---------- */
  if (window.Chart) {
    Chart.defaults.font.family = "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
    Chart.defaults.font.size = 11;
    Chart.defaults.color = "#4a5670";
    Chart.defaults.plugins.legend.labels.boxWidth = 10;
    Chart.defaults.plugins.legend.labels.boxHeight = 10;
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.tooltip.backgroundColor = "#16233f";
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.plugins.tooltip.cornerRadius = 8;
    Chart.defaults.maintainAspectRatio = false;
  }

  const C = {
    ink:   "#16233f",
    ochre: "#c8862a",
    teal:  "#2f6f5e",
    clay:  "#b0472e",
    info:  "#4a5670",
    grid:  "#eef0f4",
  };

  /* ------------------------------------------------------------
     Fetch — always goes through the resolved API base
     ------------------------------------------------------------ */
  async function fetchJSON(path) {
    const base  = await (window.discoverApiBase ? window.discoverApiBase() : Promise.resolve(""));
    const token = (typeof getToken === "function") ? getToken() : null;

    const res = await fetch(base + path, {
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
    });
    if (!res.ok) throw new Error(res.status + " " + res.statusText);
    return res.json();
  }

  async function postJSON(path, body) {
    const base  = await (window.discoverApiBase ? window.discoverApiBase() : Promise.resolve(""));
    const token = (typeof getToken === "function") ? getToken() : null;

    const res = await fetch(base + path, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      body: JSON.stringify(body || {}),
    });
    if (!res.ok) throw new Error(res.status + " " + res.statusText);
    return res.json();
  }

  /* ============================================================
     ADAPTER — maps the backend payload to what the page needs.
     Backend gives us:  { headline, thisMonth, active, byCategory, trend }
     ============================================================ */
  function adaptPayload(d) {
    const h = d.headline  || {};
    const m = d.thisMonth || {};
    const a = d.active    || {};

    /* ---- Tiles ---- */
    const tiles = {
      // Users — derive "pending residents" from total − verified
      pendingResidents:  Math.max(0, num(h.residents_total) - num(h.residents_verified)),
      pendingVendors:    num(h.vendors_pending),
      approvedResidents: num(h.residents_verified),
      approvedVendors:   num(h.vendors_approved),
      newResidentsMonth: num(m.residents_joined_this_month),
      newVendorsMonth:   num(m.vendors_joined_this_month),

      // Bookings
      bookingsOpen:      num(h.bookings_requested),
      bookingsConfirmed: num(h.bookings_confirmed),
      bookingsCompleted: num(h.bookings_completed),
      bookingsCancelled: num(h.bookings_cancelled),
      bookingsTotal:     num(h.bookings_total),
      bookingsMonth:     num(m.bookings_this_month),
      completedMonth:    num(m.completed_this_month),
      cancelledMonth:    num(m.cancelled_this_month),
      bookings7d:        0,          // not in this payload
      bookings30d:       0,

      // Quality
      reviewsTotal: num(h.reviews_total),
      avgRating:    num(h.avg_rating),
      reviews5Star: 0,
      reviewsLow:   0,

      // Provider health
      vendorsActive30d:  num(a.vendors_active_30d),
      vendorsNoBookings: 0,
      categoriesEmpty:   0,
      courtsTotal:       0,

      // Engagement
      distinctBookers: 0,
      repeatBookers:   0,
    };

    /* ---- Trend: array of { month, total, completed, cancelled } ---- */
    const trendArr = Array.isArray(d.trend) ? d.trend : [];
    const trend = {
      labels: trendArr.map(r => r.month),
      values: trendArr.map(r => num(r.total)),
    };

    /* ---- Status breakdown (for doughnut) ---- */
    const statusBreakdown = {
      open:      tiles.bookingsOpen,
      confirmed: tiles.bookingsConfirmed,
      completed: tiles.bookingsCompleted,
      cancelled: tiles.bookingsCancelled,
    };

    /* ---- Categories: array of { category, approved_vendors, pending_vendors } ---- */
    const cats = Array.isArray(d.byCategory) ? d.byCategory : [];
    const categories = {
      labels:   cats.map(c => c.category),
      approved: cats.map(c => num(c.approved_vendors)),
      pending:  cats.map(c => num(c.pending_vendors)),
    };

    /* ---- Weekday: not in this payload, fill zeros so chart renders ---- */
    const dayOrder = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const weekday = {
      labels: dayOrder,
      values: dayOrder.map(() => 0),
    };

    /* ---- Insights ---- */
    const insights = {
      emptyCategories: [],   // not in this payload
      deadVendors:     [],
      topVendors:      [],
      weekday:         [],
    };

    return { tiles, trend, statusBreakdown, categories, weekday, insights };
  }

  /* ---------- Tiles ---------- */
  function populateTiles(t) {
    // Hero stat cards
    setText("tile-pending-residents",   fmtNum(t.pendingResidents));
    setText("tile-pending-vendors",     fmtNum(t.pendingVendors));
    setText("tile-reviews-low",         fmtNum(t.reviewsLow));

    // Column 1 — Users + Quality (mirrors of the hero, plus the rest)
    setText("tile-pending-residents-2", fmtNum(t.pendingResidents));
    setText("tile-pending-vendors-2",   fmtNum(t.pendingVendors));
    setText("tile-reviews-low-2",       fmtNum(t.reviewsLow));
    setText("tile-approved-residents",  fmtNum(t.approvedResidents));
    setText("tile-approved-vendors",    fmtNum(t.approvedVendors));
    setText("tile-residents-joined",    fmtNum(t.newResidentsMonth));
    setText("tile-vendors-joined",      fmtNum(t.newVendorsMonth));
    setText("tile-reviews-total",       fmtNum(t.reviewsTotal));
    setText("tile-avg-rating",          fmtRating(t.avgRating));
    setText("tile-reviews-5star",       fmtNum(t.reviews5Star));

    // Column 2 — Bookings + Provider health
    setText("tile-bookings-open",      fmtNum(t.bookingsOpen));
    setText("tile-bookings-confirmed", fmtNum(t.bookingsConfirmed));
    setText("tile-bookings-completed", fmtNum(t.bookingsCompleted));
    setText("tile-bookings-cancelled", fmtNum(t.bookingsCancelled));
    setText("tile-bookings-total",     fmtNum(t.bookingsTotal));
    setText("tile-bookings-month",     fmtNum(t.bookingsMonth));
    setText("tile-completed-month",    fmtNum(t.completedMonth));
    setText("tile-cancelled-month",    fmtNum(t.cancelledMonth));
    setText("tile-bookings-7d",        fmtNum(t.bookings7d));
    setText("tile-bookings-30d",       fmtNum(t.bookings30d));
    setDelta("delta-bookings-month",   null, null);
    setDelta("delta-completed-month",  null, null);
    setDelta("delta-cancelled-month",  null, null);
    setText("tile-vendors-active",     fmtNum(t.vendorsActive30d));
    setText("tile-vendors-dead",       fmtNum(t.vendorsNoBookings));
    setText("tile-cats-empty",         fmtNum(t.categoriesEmpty));
    setText("tile-courts-total",       fmtNum(t.courtsTotal));

    // Column 4 — Engagement
    setText("tile-distinct-bookers",   fmtNum(t.distinctBookers));
    setText("tile-repeat-bookers",     fmtNum(t.repeatBookers));
  }

  /* ---------- Charts ---------- */
  function makeTrend(id, series) {
    const el = document.getElementById(id);
    if (!el || !window.Chart) return;
    new Chart(el, {
      type: "line",
      data: {
        labels: series.labels || [],
        datasets: [{
          label: "Bookings",
          data: series.values || [],
          borderColor: C.ink,
          backgroundColor: "rgba(22, 35, 63, 0.08)",
          borderWidth: 2,
          fill: true,
          tension: 0.35,
          pointRadius: 3,
          pointHoverRadius: 5,
          pointBackgroundColor: "#fff",
          pointBorderColor: C.ink,
          pointBorderWidth: 2,
        }],
      },
      options: {
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, border: { display: false } },
          y: { beginAtZero: true, grid: { color: C.grid }, border: { display: false }, ticks: { precision: 0 } },
        },
      },
    });
  }

  function makeStatus(id, s) {
    const el = document.getElementById(id);
    if (!el || !window.Chart) return;
    new Chart(el, {
      type: "doughnut",
      data: {
        labels: ["Open", "Confirmed", "Completed", "Cancelled"],
        datasets: [{
          data: [s.open || 0, s.confirmed || 0, s.completed || 0, s.cancelled || 0],
          backgroundColor: [C.ochre, C.info, C.teal, C.clay],
          borderWidth: 0,
          hoverOffset: 6,
        }],
      },
      options: { cutout: "68%", plugins: { legend: { position: "bottom" } } },
    });
  }

  function makeCategory(id, c) {
    const el = document.getElementById(id);
    if (!el || !window.Chart) return;
    new Chart(el, {
      type: "bar",
      data: {
        labels: c.labels || [],
        datasets: [
          { label: "Approved", data: c.approved || [], backgroundColor: C.ink,   borderRadius: 4, barThickness: 10 },
          { label: "Pending",  data: c.pending  || [], backgroundColor: C.ochre, borderRadius: 4, barThickness: 10 },
        ],
      },
      options: {
        indexAxis: "y",
        plugins: { legend: { position: "bottom" } },
        scales: {
          x: { stacked: true, beginAtZero: true, grid: { color: C.grid }, border: { display: false }, ticks: { precision: 0 } },
          y: { stacked: true, grid: { display: false }, border: { display: false }, ticks: { autoSkip: true, font: { size: 9 } } },
        },
      },
    });
  }

  function makeWeekday(id, w) {
    const el = document.getElementById(id);
    if (!el || !window.Chart) return;
    new Chart(el, {
      type: "bar",
      data: {
        labels: w.labels || ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"],
        datasets: [{
          label: "Bookings",
          data: w.values || [],
          backgroundColor: C.ochre,
          borderRadius: 6,
          barThickness: 22,
        }],
      },
      options: {
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, border: { display: false } },
          y: { beginAtZero: true, grid: { color: C.grid }, border: { display: false }, ticks: { precision: 0 } },
        },
      },
    });
  }

  function renderCharts(data) {
    if (!window.Chart) return;
    makeTrend("chart-trend",       data.trend);
    makeStatus("chart-status",     data.statusBreakdown);
    makeCategory("chart-category", data.categories);
    makeWeekday("chart-weekday",   data.weekday);
  }

  /* ---------- Insights ---------- */
  function renderInsights(data) {
    const ins = data.insights || {};

    renderList("alert-empty-categories-body", ins.emptyCategories,
      (i) => `<li>${esc(i.name)}</li>`,
      "All categories have at least one vendor.");

    renderList("alert-dead-vendors-body", ins.deadVendors,
      (i) => `<li>${esc(i.name)}</li>`,
      "Every vendor has at least one booking.");

    renderList("alert-top-vendors-body", ins.topVendors,
      (i) => `<li>${esc(i.name)} <b>★ ${fmtRating(i.rating)}</b></li>`,
      "No ratings yet.");

    renderList("alert-weekday-body", ins.weekday,
      (i) => `<li>${esc(i.label)} <b>${fmtNum(i.value)}</b></li>`,
      "No bookings recorded.");
  }

  function renderList(id, items, tpl, empty) {
    const el = document.getElementById(id);
    if (!el) return;
    if (!Array.isArray(items) || items.length === 0) {
      el.innerHTML = `<div class="alert-empty">${esc(empty)}</div>`;
      return;
    }
    el.innerHTML = `<ul class="alert-list">${items.map(tpl).join("")}</ul>`;
  }

  /* ---------- Tabs ---------- */
  let verifyLoaded = false;
  let reportsLoaded = false;

  function initTabs() {
    const tabs   = $$(".admin-tab-row .tab-btn[data-tab]");
    const panels = $$(".tab-panel");
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        const target = tab.getAttribute("data-tab");
        tabs.forEach((t) => {
          const active = t === tab;
          t.classList.toggle("is-active", active);
          t.setAttribute("aria-selected", active ? "true" : "false");
        });
        panels.forEach((p) => p.classList.toggle("is-active", p.id === "tab-" + target));
        if (target === "verify")  loadVerifyPanel();
        if (target === "reports") loadReportsPanel();
      });
    });
  }

  async function loadVerifyPanel() {
    if (verifyLoaded) return;
    const panel = document.getElementById("tab-verify");
    if (!panel) return;
    panel.innerHTML = `<div class="empty-state">Loading verification queue…</div>`;

    try {
      const data  = await fetchJSON("/admin/verification-queue");
      const items = Array.isArray(data) ? data : (data.items || []);
      setText("count-verify", items.length);

      if (!items.length) {
        panel.innerHTML = `<div class="empty-state">No listings awaiting verification.</div>`;
      } else {
        panel.innerHTML = verifyTable(items);
        wireVerifyActions(panel);
      }
      verifyLoaded = true;
    } catch (err) {
      panel.innerHTML = `<div class="empty-state">Could not load queue. ${esc(err.message)}</div>`;
    }
  }

  function verifyTable(items) {
    const rows = items.map((it) => `
      <tr data-id="${esc(it.id)}">
        <td><b>${esc(it.name)}</b></td>
        <td>${esc(it.category || "—")}</td>
        <td>${esc(it.phone || "—")}</td>
        <td>
          <div class="row-actions">
            <button class="btn btn--accent btn--small btn-approve" data-id="${esc(it.id)}" type="button">Approve</button>
            <button class="btn btn--ghost btn--small btn-reject" data-id="${esc(it.id)}" type="button">Reject</button>
          </div>
        </td>
      </tr>
    `).join("");

    return `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Category</th><th>Phone</th><th style="text-align:right;">Actions</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  function wireVerifyActions(panel) {
    panel.querySelectorAll(".btn-approve").forEach((btn) =>
      btn.addEventListener("click", () => actOnListing(btn.dataset.id, "approve", btn)));
    panel.querySelectorAll(".btn-reject").forEach((btn) =>
      btn.addEventListener("click", () => actOnListing(btn.dataset.id, "reject", btn)));
  }

  async function actOnListing(id, action, btn) {
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = action === "approve" ? "Approving…" : "Rejecting…";
    try {
      await postJSON(`/admin/listings/${encodeURIComponent(id)}/${action}`, {});
      btn.closest("tr").remove();
      verifyLoaded = false;
      loadVerifyPanel();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = original;
      alert("Action failed: " + err.message);
    }
  }

  async function loadReportsPanel() {
    if (reportsLoaded) return;
    const panel = document.getElementById("tab-reports");
    if (!panel) return;
    panel.innerHTML = `<div class="empty-state">Loading reports…</div>`;

    try {
      const data  = await fetchJSON("/admin/reports");
      const items = Array.isArray(data) ? data : (data.items || []);
      setText("count-reports", items.length);

      if (!items.length) {
        panel.innerHTML = `<div class="empty-state">No open reports.</div>`;
      } else {
        panel.innerHTML = reportsTable(items);
      }
      reportsLoaded = true;
    } catch (err) {
      panel.innerHTML = `<div class="empty-state">Could not load reports. ${esc(err.message)}</div>`;
    }
  }

  function reportsTable(items) {
    const rows = items.map((it) => `
      <tr>
        <td><b>${esc(it.subject || "Report")}</b></td>
        <td>${esc(it.reportedBy || "—")}</td>
        <td>${esc(it.against || "—")}</td>
        <td><span class="badge badge--requested">${esc(it.status || "open")}</span></td>
      </tr>
    `).join("");

    return `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Subject</th><th>Reported by</th><th>Against</th><th>Status</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  /* ---------- Exports ---------- */
  function initExports() {
    const btnExcel = document.getElementById("btn-excel");
    const btnPdf   = document.getElementById("btn-pdf");
    if (btnExcel) btnExcel.addEventListener("click", () => { window.location.href = "/api/admin/export.xlsx"; });
    if (btnPdf)   btnPdf.addEventListener("click",   () => { window.location.href = "/api/admin/export.pdf";  });
  }

  /* ---------- Bootstrap ---------- */
  document.addEventListener("DOMContentLoaded", async () => {
    initTabs();
    initExports();

    try {
      const raw  = await fetchJSON("/admin/dashboard");
      const data = adaptPayload(raw);

      populateTiles(data.tiles);
      renderCharts(data);
      renderInsights(data);
      loadVerifyPanel();

    } catch (err) {
      console.error("Admin dashboard failed to load:", err);
      ["alert-empty-categories-body", "alert-dead-vendors-body",
       "alert-top-vendors-body", "alert-weekday-body"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = `<div class="alert-empty">Could not load dashboard data.</div>`;
      });
    }
  });
})();