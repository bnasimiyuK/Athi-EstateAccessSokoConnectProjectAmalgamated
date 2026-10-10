/* ============================================================
   admin.js — verification queue + report review for estate admin
   + live dashboard stats (via /api/admin/stats)
   ============================================================ */

/* ------------------------------------------------------------
   Verification queue pagination state
   ------------------------------------------------------------ */
const VERIFY_QUEUE_PER_PAGE = 20;

const verifyQueueState = {
  page:       1,
  limit:      VERIFY_QUEUE_PER_PAGE,
  total:      0,
  totalPages: 1,
};

/* ------------------------------------------------------------
   Reports pagination state
   ------------------------------------------------------------ */
const REPORTS_PER_PAGE = 20;

const reportsState = {
  page:       1,
  limit:      REPORTS_PER_PAGE,
  total:      0,
  totalPages: 1,
};

/* ------------------------------------------------------------
   Providers pagination state
   ------------------------------------------------------------ */
const PROVIDERS_PER_PAGE = 20;

const providersState = {
  page:       1,
  limit:      PROVIDERS_PER_PAGE,
  total:      0,
  totalPages: 1,
};

/* ------------------------------------------------------------
   Tab switching
   ------------------------------------------------------------ */
function setupTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("is-active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("is-active"));
      btn.classList.add("is-active");
      const panel = document.getElementById(`tab-${btn.dataset.tab}`);
      if (panel) panel.classList.add("is-active");
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
   Verification queue (PAGINATED — pending providers only)
   ------------------------------------------------------------ */
async function renderVerifyQueue() {
  const el = document.getElementById("tab-verify");
  if (!el) {
    console.warn("[admin] #tab-verify not found — skipping verify queue render.");
    return;
  }

  el.innerHTML = `<div class="empty-state">Loading providers…</div>`;

  let result;
  try {
    result = await Api.getProviders({
      verified: "false",
      page:     verifyQueueState.page,
      limit:    verifyQueueState.limit,
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
  if (countEl) {
    countEl.textContent = verifyQueueState.total ? `(${verifyQueueState.total})` : "";
  }

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
              <td>${p.zone || "—"}</td>
              <td>${p.phone}</td>
              <td class="row-actions">
                <button class="btn btn--accent btn--small" data-approve="${p.id}">Approve</button>
                <button class="btn btn--danger btn--small" data-reject="${p.id}">Reject</button>
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
      await Api.updateProvider(btn.dataset.approve, { verified: true });
      toast("Provider approved and now visible to residents.");

      const currentRows = el.querySelectorAll("tbody tr").length;
      if (currentRows === 1 && verifyQueueState.page > 1) {
        verifyQueueState.page--;
      }

      await renderVerifyQueue();
      await loadDashboardStats();
    })
  );

  el.querySelectorAll("[data-reject]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (!confirm("Reject and remove this listing?")) return;

      await Api.removeProvider(btn.dataset.reject);
      toast("Listing rejected and removed.");

      const currentRows = el.querySelectorAll("tbody tr").length;
      if (currentRows === 1 && verifyQueueState.page > 1) {
        verifyQueueState.page--;
      }

      await renderVerifyQueue();
      await loadDashboardStats();
    })
  );
}

/* ------------------------------------------------------------
   Verify queue pagination controls
   ------------------------------------------------------------ */
function verifyQueuePaginationHtml() {
  const { page, limit, total, totalPages } = verifyQueueState;

  const startRow = total === 0 ? 0 : ((page - 1) * limit) + 1;
  const endRow   = Math.min(page * limit, total);

  const prevDisabled = page <= 1 ? "disabled" : "";
  const nextDisabled = page >= totalPages ? "disabled" : "";

  return `
    <div class="pagination"
         style="display:flex;justify-content:space-between;align-items:center;
                gap:12px;flex-wrap:wrap;margin-top:18px;padding:12px 4px;
                border-top:1px solid var(--line);">
      <div style="font-size:0.9rem;color:var(--ink-70);">
        Showing <b>${startRow}–${endRow}</b> of <b>${total}</b>
        pending listing${total === 1 ? "" : "s"}
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button class="btn btn--ghost btn--small" data-verify-page="prev" ${prevDisabled}>
          « Prev
        </button>
        <span style="font-size:0.9rem;color:var(--ink-70);padding:0 4px;">
          Page <b>${page}</b> of <b>${totalPages}</b>
        </span>
        <button class="btn btn--ghost btn--small" data-verify-page="next" ${nextDisabled}>
          Next »
        </button>
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

      if (dir === "prev" && verifyQueueState.page > 1) {
        verifyQueueState.page--;
      } else if (dir === "next" && verifyQueueState.page < verifyQueueState.totalPages) {
        verifyQueueState.page++;
      } else {
        return;
      }

      await renderVerifyQueue();
      document.querySelector(".tab-row")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

/* ------------------------------------------------------------
   Reports (PAGINATED)
   ------------------------------------------------------------ */
async function renderReports() {
  const el = document.getElementById("tab-reports");
  if (!el) {
    console.warn("[admin] #tab-reports not found — skipping reports render.");
    return;
  }

  el.innerHTML = `<div class="empty-state">Loading reports…</div>`;

  let result;
  try {
    result = await Api.getReports({
      page:  reportsState.page,
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
  if (countEl) {
    countEl.textContent = openCount ? `(${openCount})` : "";
  }

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
    </div>
    ${reportsPaginationHtml()}
  `;

  wireReportsPagination();

  el.querySelectorAll("[data-resolve]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      await Api.updateReport(btn.dataset.resolve, { status: "reviewed" });
      toast("Report marked as reviewed.");
      await renderReports();
      await loadDashboardStats();
    })
  );
}

/* ------------------------------------------------------------
   Reports pagination controls
   ------------------------------------------------------------ */
function reportsPaginationHtml() {
  const { page, limit, total, totalPages } = reportsState;

  const startRow = total === 0 ? 0 : ((page - 1) * limit) + 1;
  const endRow   = Math.min(page * limit, total);

  const prevDisabled = page <= 1 ? "disabled" : "";
  const nextDisabled = page >= totalPages ? "disabled" : "";

  return `
    <div class="pagination"
         style="display:flex;justify-content:space-between;align-items:center;
                gap:12px;flex-wrap:wrap;margin-top:18px;padding:12px 4px;
                border-top:1px solid var(--line);">
      <div style="font-size:0.9rem;color:var(--ink-70);">
        Showing <b>${startRow}–${endRow}</b> of <b>${total}</b>
        report${total === 1 ? "" : "s"}
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button class="btn btn--ghost btn--small" data-reports-page="prev" ${prevDisabled}>
          « Prev
        </button>
        <span style="font-size:0.9rem;color:var(--ink-70);padding:0 4px;">
          Page <b>${page}</b> of <b>${totalPages}</b>
        </span>
        <button class="btn btn--ghost btn--small" data-reports-page="next" ${nextDisabled}>
          Next »
        </button>
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

      if (dir === "prev" && reportsState.page > 1) {
        reportsState.page--;
      } else if (dir === "next" && reportsState.page < reportsState.totalPages) {
        reportsState.page++;
      } else {
        return;
      }

      await renderReports();
      document.querySelector(".tab-row")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

/* ------------------------------------------------------------
   All providers table (PAGINATED)
   ------------------------------------------------------------ */
async function renderAllProvidersPaginated() {
  const el = document.getElementById("tab-providers");
  if (!el) {
    console.warn("[admin] #tab-providers not found — skipping providers render.");
    return;
  }

  el.innerHTML = `<div class="empty-state">Loading providers…</div>`;

  let result;
  try {
    result = await Api.getProviders({
      page:  providersState.page,
      limit: providersState.limit,
    });
  } catch (err) {
    console.error("[admin] providers load failed:", err);
    el.innerHTML = `<div class="empty-state" style="color:var(--clay)">Could not load providers: ${err.message}</div>`;
    return;
  }

  const providers = Array.isArray(result) ? result : (result.data || []);
  providersState.total      = result.total      ?? providers.length;
  providersState.page       = result.page       ?? 1;
  providersState.limit      = result.limit      ?? PROVIDERS_PER_PAGE;
  providersState.totalPages = result.totalPages ?? 1;

  if (!providers.length) {
    el.innerHTML = `<div class="empty-state">No providers on the platform.</div>`;
    return;
  }

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
    </div>
    ${providersPaginationHtml()}
  `;

  wireProvidersPagination();

  el.querySelectorAll("[data-remove]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (confirm("Remove this provider from the platform?")) {
        await Api.removeProvider(btn.dataset.remove);
        toast("Provider removed.");

        const currentRows = el.querySelectorAll("tbody tr").length;
        if (currentRows === 1 && providersState.page > 1) {
          providersState.page--;
        }

        await renderAll();
      }
    })
  );
}

/* ------------------------------------------------------------
   Providers pagination controls
   ------------------------------------------------------------ */
function providersPaginationHtml() {
  const { page, limit, total, totalPages } = providersState;

  const startRow = total === 0 ? 0 : ((page - 1) * limit) + 1;
  const endRow   = Math.min(page * limit, total);

  const prevDisabled = page <= 1 ? "disabled" : "";
  const nextDisabled = page >= totalPages ? "disabled" : "";

  return `
    <div class="pagination"
         style="display:flex;justify-content:space-between;align-items:center;
                gap:12px;flex-wrap:wrap;margin-top:18px;padding:12px 4px;
                border-top:1px solid var(--line);">
      <div style="font-size:0.9rem;color:var(--ink-70);">
        Showing <b>${startRow}–${endRow}</b> of <b>${total}</b>
        provider${total === 1 ? "" : "s"}
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button class="btn btn--ghost btn--small" data-providers-page="prev" ${prevDisabled}>
          « Prev
        </button>
        <span style="font-size:0.9rem;color:var(--ink-70);padding:0 4px;">
          Page <b>${page}</b> of <b>${totalPages}</b>
        </span>
        <button class="btn btn--ghost btn--small" data-providers-page="next" ${nextDisabled}>
          Next »
        </button>
      </div>
    </div>
  `;
}

function wireProvidersPagination() {
  const el = document.getElementById("tab-providers");
  if (!el) return;

  el.querySelectorAll("[data-providers-page]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const dir = btn.dataset.providersPage;

      if (dir === "prev" && providersState.page > 1) {
        providersState.page--;
      } else if (dir === "next" && providersState.page < providersState.totalPages) {
        providersState.page++;
      } else {
        return;
      }

      await renderAllProvidersPaginated();
      document.querySelector(".tab-row")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

/* ------------------------------------------------------------
   Full refresh — all three tabs + stats
   ------------------------------------------------------------ */
async function renderAll() {
  try {
    await renderVerifyQueue();
    // Providers now live on admin-providers.html — no inline render here.
    await renderReports();
    await loadDashboardStats();
  } catch (err) {
    console.error("[admin] renderAll failed:", err);
  }
}

/* ------------------------------------------------------------
   Export buttons — Excel and PDF downloads
   XLSX: POST chart PNGs to the backend so they can be embedded.
   PDF : plain GET — server renders the report.
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

    let res;

    if (kind === "xlsx") {
      /* ---------- Collect chart PNGs from the page ---------- */
      const images = {};
      ["chart-trend", "chart-status", "chart-category", "chart-weekday"]
        .forEach((id) => {
          const canvas = document.getElementById(id);
          if (canvas && canvas.width > 0) {
            images[id] = canvas.toDataURL("image/png");
          }
        });

      console.log("[admin] sending", Object.keys(images).length, "chart image(s) to backend");

      res = await fetch("http://localhost:4050/api/admin/export.xlsx", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ images }),
      });
    } else {
      /* ---------- PDF stays a GET ---------- */
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
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
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

/* ------------------------------------------------------------
   Init
   ------------------------------------------------------------ */
document.addEventListener("DOMContentLoaded", async () => {
  if (typeof requireRole === "function" &&
    !requireRole("admin", "super-admin")) return;

  setupExportButtons();

  await loadCategoryCache();
  setupTabs();

  await renderAll();
});