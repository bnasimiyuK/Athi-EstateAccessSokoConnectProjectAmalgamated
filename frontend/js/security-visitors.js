/* ============================================================
   security-visitors.js — security dashboard
   Tabs: approvals (bulk) | today (per-visitor) | onsite | check-in/out
   - Paginated pending list with checkboxes + bulk actions
   - Approve ALL with typed confirmation
   - Email batching feedback on bulk approve
   - Stat tiles navigate to filtered views
   - Date-range filter on "Today's visitors" tab
     (Today / Last 7 days / Last 30 days / This month / Custom)
   ============================================================ */

const SV_PER_PAGE = 50;
const SV_MAX_BULK = 200;

const svState = {
  page:        1,
  limit:       SV_PER_PAGE,
  total:       0,
  totalPages:  1,
  selected:    new Set(),
  rows:        [],
  tileFilter:  null,   // "checked_in" | "checked_out" | null
};

/* ============================================================
   HELPERS
   ============================================================ */
function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function fmtDate(s) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" });
}

function statusBadge(s) {
  const map = {
    pending_admin:    `<span class="badge" style="background:#c8862a;color:#fff;">Pending admin</span>`,
    pending_security: `<span class="badge" style="background:#4a7ba7;color:#fff;">Pending security</span>`,
    approved:         `<span class="badge badge--verified">Approved</span>`,
    denied:           `<span class="badge" style="background:#b0472e;color:#fff;">Denied</span>`,
    cancelled:        `<span class="badge" style="background:#666;color:#fff;">Cancelled</span>`,
    pending:          `<span class="badge" style="background:#c8862a;color:#fff;">Pending</span>`,
    checked_in:       `<span class="badge" style="background:#2f6f5e;color:#fff;">Checked in</span>`,
    checked_out:      `<span class="badge" style="background:#4a7ba7;color:#fff;">Checked out</span>`,
    completed:        `<span class="badge" style="background:#2f6f5e;color:#fff;">Completed</span>`,
    expired:          `<span class="badge" style="background:#b0472e;color:#fff;">Expired</span>`,
  };
  return map[s] || escapeHtml(s);
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  const runners = Array.from({ length: Math.min(limit, items.length) }, run);
  await Promise.all(runners);
  return results;
}

/* ------------------------------------------------------------
   Date-range resolver for the "Today's visitors" tab.
   Returns { from, to, label } or null if custom range is
   incomplete. Also formats the human-readable label.
   ------------------------------------------------------------ */
function getTodayRange() {
  const rangeEl = document.getElementById("today-range");
  const fromEl  = document.getElementById("today-from");
  const toEl    = document.getElementById("today-to");
  const mode    = rangeEl ? rangeEl.value : "30d";

  const today  = new Date();
  const isoDay = (d) => d.toISOString().slice(0, 10);
  const humanD = (iso) => {
    if (!iso) return "";
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" });
  };

  if (mode === "custom") {
    const from = fromEl?.value || "";
    const to   = toEl?.value   || "";
    if (!from || !to) return null;
    return { from, to, label: `${humanD(from)} → ${humanD(to)}` };
  }

  if (mode === "today") {
    const d = isoDay(today);
    return { from: d, to: d, label: humanD(d) };
  }

  if (mode === "7d") {
    const from = new Date(today);
    from.setDate(from.getDate() - 6);
    return { from: isoDay(from), to: isoDay(today),
             label: `${humanD(isoDay(from))} → ${humanD(isoDay(today))}` };
  }

  if (mode === "30d") {
    const from = new Date(today);
    from.setDate(from.getDate() - 29);
    return { from: isoDay(from), to: isoDay(today),
             label: `${humanD(isoDay(from))} → ${humanD(isoDay(today))}` };
  }

  if (mode === "month") {
    const from = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from: isoDay(from), to: isoDay(today),
             label: `${humanD(isoDay(from))} → ${humanD(isoDay(today))}` };
  }

  // Default = last 30 days
  const from = new Date(today);
  from.setDate(from.getDate() - 29);
  return { from: isoDay(from), to: isoDay(today),
           label: `${humanD(isoDay(from))} → ${humanD(isoDay(today))}` };
}

/* ============================================================
   TAB + TILE WIRING
   Runs as soon as this file parses. Uses readyState guard so it
   works whether the script loaded before or after DOMContentLoaded.
   ============================================================ */
(function wireEverythingImmediately() {
  function wire() {
    console.log("[security-visitors] wiring NOW");

    /* --- Tabs (single source of truth) --- */
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      if (btn.dataset.wired === "1") return;
      btn.dataset.wired = "1";
      btn.addEventListener("click", () => {
        const tab = btn.dataset.tab;
        switchToTab(tab);
        if (tab === "onsite") loadOnSite();
        if (tab === "today")  loadToday();
      });
    });

    /* --- Simple click bindings --- */
    const bindings = [
      ["btn-ci-search",       () => searchCheckin()],
      ["btn-refresh-today",   () => loadToday()],
      ["btn-print-register",  () => printRegister()],
      ["bulk-approve-btn",    () => bulkApproveSelected()],
      ["bulk-deny-btn",       () => bulkDenySelected()],
      ["bulk-clear-btn",      () => {
        svState.selected.clear();
        document.querySelectorAll(".chk-row").forEach((c) => (c.checked = false));
        updateBulkBar();
      }],
      ["btn-approve-all",     () => openConfirmAllModal()],
      ["confirm-all-cancel",  () => closeConfirmAllModal()],
      ["confirm-all-go",      () => approveAllPending()],
      ["btn-refresh-onsite",  () => loadOnSite()],
    ];

    bindings.forEach(([id, fn]) => {
      const el = document.getElementById(id);
      if (!el) { console.warn(`[security-visitors] #${id} not found`); return; }
      if (el.dataset.wired === "1") return;
      el.dataset.wired = "1";
      el.addEventListener("click", (e) => { e.preventDefault(); fn(); });
    });

    /* --- Enter key in check-in search --- */
    const ciSearch = document.getElementById("ci-search");
    if (ciSearch && ciSearch.dataset.wired !== "1") {
      ciSearch.dataset.wired = "1";
      ciSearch.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); searchCheckin(); }
      });
    }

    /* --- Date range dropdown --- */
    const rangeEl  = document.getElementById("today-range");
    const customRow = document.getElementById("today-custom-range");
    if (rangeEl && rangeEl.dataset.wired !== "1") {
      rangeEl.dataset.wired = "1";
      rangeEl.addEventListener("change", () => {
        const isCustom = rangeEl.value === "custom";
        if (customRow) customRow.style.display = isCustom ? "flex" : "none";
        // Auto-reload for non-custom ranges
        if (!isCustom) loadToday();
      });
    }

    /* --- Custom date inputs trigger reload --- */
    ["today-from", "today-to"].forEach((id) => {
      const el = document.getElementById(id);
      if (el && el.dataset.wired !== "1") {
        el.dataset.wired = "1";
        el.addEventListener("change", () => {
          if (rangeEl && rangeEl.value === "custom") loadToday();
        });
      }
    });

    /* --- Stat tiles --- */
    setupTileNavigation();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();

/* ------------------------------------------------------------
   Tab switching helper
   ------------------------------------------------------------ */
function switchToTab(tabName) {
  document.querySelectorAll(".tab-btn").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.tab === tabName);
  });
  document.querySelectorAll(".tab-panel").forEach((p) => {
    p.classList.toggle("is-active", p.id === `tab-${tabName}`);
  });
}

/* ------------------------------------------------------------
   Stat tile navigation — clicking a tile switches tab + filter
   ------------------------------------------------------------ */
function setupTileNavigation() {
  const map = {
    "tile-link-pending":   { tab: "approvals" },
    "tile-link-today":     { tab: "today",     filter: null },
    "tile-link-checkedin": { tab: "onsite",    filter: "checked_in" },
    "tile-link-completed": { tab: "today",     filter: "checked_out" },
  };

  Object.entries(map).forEach(([id, cfg]) => {
    const el = document.getElementById(id);
    if (!el || el.dataset.tileWired === "1") return;
    el.dataset.tileWired = "1";

    el.addEventListener("click", () => {
      console.log(`[security-visitors] tile clicked: ${id}`);
      switchToTab(cfg.tab);
      svState.tileFilter = cfg.filter || null;

      if (cfg.tab === "onsite") {
        loadOnSite();
      } else if (cfg.tab === "today") {
        // Ensure the range control has a sensible default
        const rangeEl = document.getElementById("today-range");
        if (rangeEl && !rangeEl.value) rangeEl.value = "30d";
        loadToday();
      } else if (cfg.tab === "approvals") {
        svState.page = 1;
        loadApprovals();
      }
    });
  });
}

/* ------------------------------------------------------------
   Tiles
   ------------------------------------------------------------ */
async function loadTiles() {
  try {
    const s = await Api.getVisitorLiveStats();
    const el = (id) => document.getElementById(id);
    if (el("tile-pending"))    el("tile-pending").textContent    = s.pending_security;
    if (el("tile-today"))      el("tile-today").textContent      = s.expected_today;
    if (el("tile-checked-in")) el("tile-checked-in").textContent = s.currently_on_site;
    if (el("tile-completed"))  el("tile-completed").textContent  = s.completed_today;
  } catch (err) {
    console.error("[security-visitors] tiles failed:", err);
  }
}

/* ------------------------------------------------------------
   Bulk bar
   ------------------------------------------------------------ */
function updateBulkBar() {
  const bar = document.getElementById("bulk-bar");
  const countEl = document.getElementById("bulk-count");
  if (!bar) return;
  const n = svState.selected.size;

  bar.style.display = n === 0 ? "none" : "flex";
  if (n > 0 && countEl) countEl.textContent = n;

  const allChk = document.getElementById("chk-select-all");
  if (allChk) {
    const pageIds = svState.rows.map((r) => r.id);
    const selectedOnPage = pageIds.filter((id) => svState.selected.has(id)).length;
    allChk.checked = pageIds.length > 0 && selectedOnPage === pageIds.length;
    allChk.indeterminate = selectedOnPage > 0 && selectedOnPage < pageIds.length;
  }
}

/* ------------------------------------------------------------
   Pending approvals — paginated
   ------------------------------------------------------------ */
async function loadApprovals(page) {
  if (typeof page === "number") svState.page = page;
  const el = document.getElementById("approvals-list");
  if (!el) return;
  el.innerHTML = `<div class="empty-state">Loading…</div>`;

  let result;
  try {
    result = await Api.getVisitorPendingSecurity({
      page:  svState.page,
      limit: svState.limit,
    });
  } catch (err) {
    el.innerHTML = `<div class="empty-state" style="color:var(--clay)">Could not load: ${escapeHtml(err.message)}</div>`;
    return;
  }

  const list = Array.isArray(result) ? result : (result?.data || []);
  svState.rows       = list;
  svState.total      = result?.total || 0;
  svState.page       = result?.page || 1;
  svState.totalPages = result?.totalPages || 1;

  const countEl = document.getElementById("count-approvals");
  if (countEl) countEl.textContent = svState.total ? `(${svState.total})` : "";

  const approveAllBtn = document.getElementById("btn-approve-all");
  if (approveAllBtn) {
    approveAllBtn.style.display = svState.total > 0 ? "inline-flex" : "none";
  }

  if (!svState.rows.length) {
    el.innerHTML = `<div class="empty-state">No pre-registrations waiting for security approval.</div>`;
    updateBulkBar();
    renderApprovalsPagination();
    return;
  }

  el.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th style="width:36px;">
              <input type="checkbox" id="chk-select-all" title="Select all on this page" />
            </th>
            <th>Visit date</th><th>Time</th><th>House</th><th>Host</th>
            <th>Visitors</th><th>Purpose</th><th>Admin approved</th><th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${svState.rows.map((g) => `
            <tr data-id="${g.id}">
              <td>
                <input type="checkbox" class="chk-row" data-id="${g.id}"
                       ${svState.selected.has(g.id) ? "checked" : ""} />
              </td>
              <td><b>${escapeHtml(fmtDate(g.visit_date))}</b></td>
              <td>${escapeHtml(g.expected_time_hhmm || "—")}</td>
              <td>${escapeHtml(g.house_number)}</td>
              <td>${escapeHtml(g.resident_name)}<br><small>${escapeHtml(g.resident_phone)}</small></td>
              <td>${g.headcount}</td>
              <td>${escapeHtml(g.purpose || "—")}</td>
              <td>${escapeHtml(fmtDate(g.admin_approved_at))}</td>
              <td class="row-actions">
                <button class="btn btn--accent btn--small" data-approve="${g.id}">Approve</button>
                <button class="btn btn--danger btn--small" data-deny="${g.id}">Deny</button>
                <button class="btn btn--ghost btn--small" data-view="${g.id}">View</button>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;

  el.querySelectorAll(".chk-row").forEach((chk) => {
    chk.addEventListener("change", () => {
      const id = parseInt(chk.dataset.id, 10);
      if (chk.checked) svState.selected.add(id);
      else             svState.selected.delete(id);
      updateBulkBar();
    });
  });

  const allChk = document.getElementById("chk-select-all");
  if (allChk) {
    allChk.addEventListener("change", () => {
      const pageIds = svState.rows.map((r) => r.id);
      if (allChk.checked) pageIds.forEach((id) => svState.selected.add(id));
      else                pageIds.forEach((id) => svState.selected.delete(id));
      el.querySelectorAll(".chk-row").forEach((chk) => {
        chk.checked = svState.selected.has(parseInt(chk.dataset.id, 10));
      });
      updateBulkBar();
    });
  }

  el.querySelectorAll("[data-approve]").forEach((b) =>
    b.addEventListener("click", () => approveOne(b.dataset.approve, b))
  );
  el.querySelectorAll("[data-deny]").forEach((b) =>
    b.addEventListener("click", () => denyOne(b.dataset.deny))
  );
  el.querySelectorAll("[data-view]").forEach((b) =>
    b.addEventListener("click", () => viewDetails(b.dataset.view))
  );

  updateBulkBar();
  renderApprovalsPagination();
}

/* ------------------------------------------------------------
   Approvals pagination
   ------------------------------------------------------------ */
function renderApprovalsPagination() {
  const el = document.getElementById("approvals-pagination");
  if (!el) return;
  const { page, limit, total, totalPages } = svState;
  if (!total || totalPages <= 1) { el.innerHTML = ""; return; }

  const startRow = (page - 1) * limit + 1;
  const endRow   = Math.min(page * limit, total);

  el.innerHTML = `
    <div class="pagination" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-top:18px;padding:12px 4px;border-top:1px solid var(--line);">
      <div style="font-size:0.9rem;color:var(--ink-70);">
        Showing <b>${startRow}–${endRow}</b> of <b>${total}</b>
        ${svState.selected.size ? `<span style="margin-left:12px;color:var(--ochre);font-weight:600;">
          · ${svState.selected.size} selected
        </span>` : ""}
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button class="btn btn--ghost btn--small" data-spg="prev" ${page <= 1 ? "disabled" : ""}>« Prev</button>
        <span style="font-size:0.9rem;color:var(--ink-70);padding:0 4px;">Page <b>${page}</b> of <b>${totalPages}</b></span>
        <button class="btn btn--ghost btn--small" data-spg="next" ${page >= totalPages ? "disabled" : ""}>Next »</button>
      </div>
    </div>
  `;

  el.querySelectorAll("[data-spg]").forEach((b) => {
    b.addEventListener("click", () => {
      if (b.dataset.spg === "prev" && svState.page > 1) loadApprovals(svState.page - 1);
      if (b.dataset.spg === "next" && svState.page < svState.totalPages) loadApprovals(svState.page + 1);
    });
  });
}

/* ------------------------------------------------------------
   Single-item approve / deny
   ------------------------------------------------------------ */
async function approveOne(id, btn) {
  if (!confirm("Approve this visit?\n\nThe 6-digit access code will be generated and emailed to the visitor and host.")) return;
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = "Approving…";
  try {
    const r = await Api.approveVisitorSecurity(id);
    toast(`✅ Approved. Code: ${r.code}`);
    svState.selected.delete(parseInt(id, 10));
    await loadTiles();
    await loadApprovals();
  } catch (err) {
    toast(err.message || "Could not approve.");
  } finally {
    btn.disabled = false; btn.textContent = old;
  }
}

async function denyOne(id) {
  const reason = prompt("Reason for denial:");
  if (reason === null) return;
  try {
    await Api.denyVisitor(id, reason);
    toast("Denied.");
    svState.selected.delete(parseInt(id, 10));
    await loadTiles();
    await loadApprovals();
  } catch (err) {
    toast(err.message || "Could not deny.");
  }
}

/* ------------------------------------------------------------
   Bulk approve selected
   ------------------------------------------------------------ */
async function bulkApproveSelected() {
  const ids = [...svState.selected];
  if (!ids.length) { toast("Select at least one pre-registration."); return; }
  if (ids.length > SV_MAX_BULK) {
    toast(`Cannot approve more than ${SV_MAX_BULK} at once. You have ${ids.length} selected.`);
    return;
  }
  if (!confirm(`Approve ${ids.length} pre-registration${ids.length === 1 ? "" : "s"}?\n\nEach will generate an access code and email the visitor + host. Emails are batched (25 per batch).`)) return;

  const btn = document.getElementById("bulk-approve-btn");
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = "Approving & sending emails…";
  try {
    const r = await Api.bulkApproveSecurity(ids);
    const emailsMsg = r.emailsSent !== undefined
      ? ` · Emails: ${r.emailsSent} sent${r.emailsFailed ? ` · ${r.emailsFailed} failed` : ""}`
      : "";
    toast(`✅ Approved: ${r.ok}${r.failed ? ` · Failed: ${r.failed}` : ""}${emailsMsg}`);
    if (r.failed > 0) console.warn("[bulk-approve-security] failures:", r.failures);
    if (r.emailFailures && r.emailFailures.length) console.warn("[bulk-approve-security] email failures:", r.emailFailures);

    svState.selected.clear();
    await loadTiles();
    await loadApprovals();
  } catch (err) {
    toast(err.message || "Bulk approval failed.");
  } finally {
    btn.disabled = false; btn.textContent = old;
  }
}

/* ------------------------------------------------------------
   Bulk deny selected
   ------------------------------------------------------------ */
async function bulkDenySelected() {
  const ids = [...svState.selected];
  if (!ids.length) { toast("Select at least one pre-registration."); return; }
  if (ids.length > SV_MAX_BULK) {
    toast(`Cannot deny more than ${SV_MAX_BULK} at once. You have ${ids.length} selected.`);
    return;
  }
  const reason = prompt(`Reason for denying ${ids.length} pre-registration${ids.length === 1 ? "" : "s"}:`);
  if (reason === null) return;

  const btn = document.getElementById("bulk-deny-btn");
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = "Denying…";
  try {
    const r = await Api.bulkDenyVisitors(ids, reason);
    toast(`❌ Denied: ${r.ok}${r.failed ? ` · Failed: ${r.failed}` : ""}`);
    if (r.failed > 0) console.warn("[bulk-deny] failures:", r.failures);

    svState.selected.clear();
    await loadTiles();
    await loadApprovals();
  } catch (err) {
    toast(err.message || "Bulk denial failed.");
  } finally {
    btn.disabled = false; btn.textContent = old;
  }
}

/* ------------------------------------------------------------
   Approve ALL pending (typed confirmation)
   ------------------------------------------------------------ */
function openConfirmAllModal() {
  const total = svState.total || 0;
  const willDo = Math.min(SV_MAX_BULK, total);

  const textEl = document.getElementById("confirm-all-text");
  if (textEl) {
    textEl.innerHTML = `
      This will approve <b>${willDo}</b> pending pre-registration${willDo === 1 ? "" : "s"}
      (out of ${total} total${total > SV_MAX_BULK ? `, capped at ${SV_MAX_BULK} per click` : ""}).
      Each will generate a 6-digit code and email the visitor and host.
    `;
  }

  const input = document.getElementById("confirm-all-input");
  const goBtn = document.getElementById("confirm-all-go");
  if (input) {
    input.value = "";
    input.oninput = () => { if (goBtn) goBtn.disabled = input.value.trim() !== "APPROVE ALL"; };
  }
  if (goBtn) goBtn.disabled = true;

  const modal = document.getElementById("confirm-all-modal");
  if (modal) modal.style.display = "flex";
  if (input) setTimeout(() => input.focus(), 50);
}

function closeConfirmAllModal() {
  const modal = document.getElementById("confirm-all-modal");
  if (modal) modal.style.display = "none";
}

async function approveAllPending() {
  const btn = document.getElementById("confirm-all-go");
  const old = btn ? btn.textContent : "Approve all";
  if (btn) { btn.disabled = true; btn.textContent = "Approving…"; }

  try {
    const r = await Api.bulkApproveAllSecurity("APPROVE ALL", SV_MAX_BULK);
    const emailsMsg = r.emailsSent !== undefined
      ? ` · Emails: ${r.emailsSent} sent${r.emailsFailed ? ` · ${r.emailsFailed} failed` : ""}`
      : "";
    toast(`✅ Approved ${r.ok}${r.failed ? ` · Failed ${r.failed}` : ""}${emailsMsg} · ${r.remaining} remaining`);
    if (r.failed > 0) console.warn("[approve-all-security] failures:", r.failures);
    if (r.emailFailures && r.emailFailures.length) console.warn("[approve-all-security] email failures:", r.emailFailures);

    closeConfirmAllModal();
    svState.selected.clear();
    await loadTiles();
    await loadApprovals();
  } catch (err) {
    toast(err.message || "Bulk approval failed.");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = old; }
  }
}

/* ------------------------------------------------------------
   Currently on-site tab
   ------------------------------------------------------------ */
async function loadOnSite() {
  const el      = document.getElementById("onsite-list");
  const summary = document.getElementById("onsite-summary");
  const countEl = document.getElementById("count-onsite");
  if (!el) return;

  el.innerHTML = `<div class="empty-state">Loading…</div>`;

  let result;
  try {
    // No date filter — we want every group with at least one visitor
    // currently checked in, regardless of their pre-registered visit_date.
    result = await Api.getVisitorGroups({ limit: 200 });
  } catch (err) {
    el.innerHTML = `<div class="empty-state" style="color:var(--clay)">Could not load: ${escapeHtml(err.message)}</div>`;
    return;
  }

  const list   = Array.isArray(result) ? result : (result?.data || []);
  const groups = list.filter((g) => Number(g.inside_count) > 0);

  if (countEl) {
    countEl.textContent = groups.length
      ? `(${groups.reduce((s, g) => s + Number(g.inside_count || 0), 0)})`
      : "";
  }

  if (!groups.length) {
    el.innerHTML = `<div class="empty-state">No visitors currently on-site.</div>`;
    if (summary) summary.textContent = "";
    return;
  }

  const detailed = await mapWithConcurrency(groups, 6, async (g) => {
    try {
      const r      = await Api.getVisitorGroup(g.id);
      const grp    = r.data || r;
      const inside = (grp.visitors || []).filter((v) => v.status === "checked_in");
      return { g: grp, inside };
    } catch {
      return { g, inside: [] };
    }
  });

  const totalInside = detailed.reduce((s, d) => s + d.inside.length, 0);
  if (summary) {
    summary.textContent = `${totalInside} visitor${totalInside === 1 ? "" : "s"} currently on-site across ${detailed.length} visit${detailed.length === 1 ? "" : "s"}.`;
  }

  el.innerHTML = detailed.map(({ g, inside }) => `
    <div class="card" style="margin-bottom:14px;padding:16px;border:1px solid var(--line);border-radius:8px;">
      <div style="display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;">
        <div>
          <b>House ${escapeHtml(g.house_number)}</b>
          · ${escapeHtml(g.resident_name)}<br>
          <small style="color:var(--ink-70);">
            Code: <b style="font-family:monospace;">${escapeHtml(g.access_code || "—")}</b>
            · ${escapeHtml(fmtDate(g.visit_date))}
          </small>
        </div>
        <div>
          <button class="btn btn--small" data-checkout-group="${g.id}">
            Check out all (${inside.length})
          </button>
        </div>
      </div>
      <ul style="margin:12px 0 0 18px;padding:0;">
        ${inside.length ? inside.map((v) => `
          <li style="margin-bottom:6px;">
            <b>${escapeHtml(v.name)}</b>
            ${v.phone ? `<span style="color:var(--ink-70);">· ${escapeHtml(v.phone)}</span>` : ""}
            ${v.plate ? `<span style="color:var(--ink-70);">· ${escapeHtml(v.plate)}</span>` : ""}
            <button class="btn btn--ghost btn--small" style="margin-left:8px;"
                    data-checkout-visitor="${v.id}" data-group="${g.id}">
              Check out
            </button>
          </li>
        `).join("") : `<li style="color:var(--ink-70);">No individual visitors marked checked-in.</li>`}
      </ul>
    </div>
  `).join("");

  el.querySelectorAll("[data-checkout-visitor]").forEach((b) =>
    b.addEventListener("click", () => checkoutOneVisitor(b.dataset.group, b.dataset.checkoutVisitor, b))
  );
  el.querySelectorAll("[data-checkout-group]").forEach((b) =>
    b.addEventListener("click", () => checkoutWholeGroup(b.dataset.checkoutGroup, b))
  );
}

async function checkoutOneVisitor(groupId, visitorId, btn) {
  if (!confirm("Check this visitor out?")) return;
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = "…";
  try {
    await Api.checkoutVisitor({ groupId: Number(groupId), visitorId: Number(visitorId) });
    toast("✅ Checked out.");
    await Promise.all([loadTiles(), loadOnSite()]);
  } catch (err) {
    toast(err.message || "Check-out failed.");
    btn.disabled = false; btn.textContent = old;
  }
}

async function checkoutWholeGroup(groupId, btn) {
  if (!confirm("Check out every visitor in this visit?")) return;
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = "…";
  try {
    await Api.checkoutVisitor({ groupId: Number(groupId) });
    toast("✅ Group checked out.");
    await Promise.all([loadTiles(), loadOnSite()]);
  } catch (err) {
    toast(err.message || "Check-out failed.");
    btn.disabled = false; btn.textContent = old;
  }
}

/* ------------------------------------------------------------
   Today's list — per-visitor rows, date-range aware
   Includes a request token so rapid dropdown changes can't
   race and overwrite each other's DOM.
   ------------------------------------------------------------ */
let _todayReqId = 0;

async function loadToday() {
  const el  = document.getElementById("today-list");
  const qEl = document.getElementById("today-q");
  if (!el) return;

  const range = getTodayRange();
  if (!range) {
    el.innerHTML = `<div class="empty-state">Pick a start and end date.</div>`;
    return;
  }

  // Token: each invocation gets a unique ID. If a newer call starts
  // before this one finishes, we discard the result.
  const myId = ++_todayReqId;

  const q = qEl ? qEl.value.trim() : "";
  el.innerHTML = `<div class="empty-state">Loading…</div>`;

  let result;
  try {
    result = await Api.getVisitorGroups({
      from:  range.from,
      to:    range.to,
      q,
      limit: 500,
    });
  } catch (err) {
    if (myId !== _todayReqId) return;   // stale — a newer call is running
    el.innerHTML = `<div class="empty-state" style="color:var(--clay)">Could not load: ${escapeHtml(err.message)}</div>`;
    return;
  }

  // Discard stale responses
  if (myId !== _todayReqId) return;

  const rawList = Array.isArray(result) ? result : (result?.data || []);
  if (!rawList.length) {
    el.innerHTML = `<div class="empty-state">No visitors found for ${escapeHtml(range.label)}.</div>`;
    return;
  }

  const groupsWithVisitors = await mapWithConcurrency(rawList, 6, async (g) => {
    try {
      const detail = await Api.getVisitorGroup(g.id);
      const grp = detail.data || detail;
      return { group: g, visitors: grp.visitors || [] };
    } catch {
      return { group: g, visitors: [] };
    }
  });

  // Discard stale responses after the detail fetches too
  if (myId !== _todayReqId) return;

  const filter = svState.tileFilter;
  let display = groupsWithVisitors;
  if (filter === "checked_in" || filter === "checked_out") {
    display = groupsWithVisitors
      .map((row) => ({
        group: row.group,
        visitors: row.visitors.filter((v) => v.status === filter),
      }))
      .filter((row) => row.visitors.length > 0);
  }

  const filterNote = filter
    ? `<div style="margin-bottom:12px;font-size:0.85rem;color:var(--ink-70);">
         Filtered to <b>${filter === "checked_in" ? "currently on-site" : "completed (checked out)"}</b> visitors.
         <button type="button" id="tile-clear-filter" class="btn btn--ghost btn--small" style="margin-left:8px;">Clear filter</button>
       </div>`
    : "";

  if (!display.length) {
    el.innerHTML = filterNote + `<div class="empty-state">No ${filter === "checked_in" ? "on-site" : "completed"} visitors for ${escapeHtml(range.label)}.</div>`;
    const clearBtn = document.getElementById("tile-clear-filter");
    if (clearBtn) clearBtn.addEventListener("click", () => {
      svState.tileFilter = null;
      loadToday();
    });
    return;
  }

  el.innerHTML = filterNote + `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Date</th><th>Time</th><th>House</th><th>Visitor</th><th>Vehicle</th>
            <th>Code</th><th>Status</th><th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${display.map(({ group: g, visitors }) => {
            const onSiteCount = visitors.filter((v) => v.status === "checked_in").length;
            const groupHeader = visitors.length > 1 ? `
              <tr style="background:var(--paper-dim);">
                <td colspan="8" style="font-size:0.85rem;color:var(--ink-70);padding:8px 16px;">
                  <b>Group #${g.id}</b> · ${escapeHtml(fmtDate(g.visit_date))} · ${visitors.length} visitors · ${onSiteCount} on-site
                  ${onSiteCount > 0
                    ? `<button class="btn btn--ghost btn--small" data-out-all="${g.id}" style="margin-left:8px;">Check out all remaining</button>`
                    : ""}
                  <button class="btn btn--ghost btn--small" data-view="${g.id}" style="margin-left:4px;">View group</button>
                </td>
              </tr>
            ` : "";

            const visitorRows = visitors.map((v) => {
              const vehicles = (v.vehicles || []).map((veh) =>
                `${escapeHtml(veh.plate)}${veh.driver ? " (" + escapeHtml(veh.driver) + ")" : ""}`
              ).join(", ") || "—";

              let actionButtons = "";
              if (v.status === "pending" || v.status === "approved") {
                actionButtons = `<button class="btn btn--accent btn--small" data-in="${g.id}" data-visitor="${v.id}">Check in</button>`;
              } else if (v.status === "checked_in") {
                actionButtons = `<button class="btn btn--accent btn--small" data-out="${g.id}" data-visitor="${v.id}">Check out</button>`;
              }
              if (visitors.length === 1) {
                actionButtons += ` <button class="btn btn--ghost btn--small" data-view="${g.id}">View</button>`;
              }

              return `
                <tr>
                  <td>${escapeHtml(fmtDate(g.visit_date))}</td>
                  <td>${escapeHtml(g.expected_time_hhmm || "—")}</td>
                  <td>${escapeHtml(g.house_number)}</td>
                  <td>${escapeHtml(v.name)}</td>
                  <td>${vehicles}</td>
                  <td><b style="font-family:monospace;">${escapeHtml(g.access_code || "—")}</b></td>
                  <td>${statusBadge(v.status)}</td>
                  <td>${actionButtons}</td>
                </tr>
              `;
            }).join("");

            return groupHeader + visitorRows;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;

  el.querySelectorAll("[data-in]").forEach((b) =>
    b.addEventListener("click", () => checkinOne(b.dataset.in, b.dataset.visitor))
  );
  el.querySelectorAll("[data-out]").forEach((b) =>
    b.addEventListener("click", () => checkoutOne(b.dataset.out, b.dataset.visitor))
  );
  el.querySelectorAll("[data-out-all]").forEach((b) =>
    b.addEventListener("click", () => checkoutGroup(b.dataset.outAll))
  );
  el.querySelectorAll("[data-view]").forEach((b) =>
    b.addEventListener("click", () => viewDetails(b.dataset.view))
  );

  const clearBtn = document.getElementById("tile-clear-filter");
  if (clearBtn) clearBtn.addEventListener("click", () => {
    svState.tileFilter = null;
    loadToday();
  });
}


/* ------------------------------------------------------------
   Per-visitor check-in / check-out
   ------------------------------------------------------------ */
async function checkinOne(groupId, visitorId) {
  if (!confirm("Check in this visitor?")) return;
  try {
    const r = await Api.checkinVisitor({ groupId, visitorId });
    toast(r.remainingInside > 0
      ? `Checked in. ${r.remainingInside} visitor${r.remainingInside === 1 ? "" : "s"} on-site.`
      : "Checked in.");
    await loadTiles();
    await loadToday();
  } catch (err) { toast(err.message || "Could not check in."); }
}

async function checkoutOne(groupId, visitorId) {
  if (!confirm("Check out this visitor?")) return;
  try {
    const r = await Api.checkoutVisitor({ groupId, visitorId });
    toast(r.remainingInside > 0
      ? `Checked out. ${r.remainingInside} visitor${r.remainingInside === 1 ? "" : "s"} still on-site.`
      : "Checked out. Group completed.");
    await loadTiles();
    await loadToday();
  } catch (err) { toast(err.message || "Could not check out."); }
}

async function checkoutGroup(groupId) {
  if (!confirm("Check out all visitors still on-site in this group?")) return;
  try {
    await Api.checkoutVisitor({ groupId });
    toast("All remaining visitors checked out.");
    await loadTiles();
    await loadToday();
  } catch (err) { toast(err.message || "Could not check out group."); }
}

async function checkin(id) {
  if (!confirm("Check in all visitors in this group?")) return;
  try {
    await Api.checkinVisitor({ groupId: id });
    toast("Checked in.");
    await loadTiles();
    await loadToday();
  } catch (err) { toast(err.message || "Could not check in."); }
}

async function checkout(id) {
  if (!confirm("Check out all visitors still on-site in this group?")) return;
  try {
    await Api.checkoutVisitor({ groupId: id });
    toast("Checked out.");
    await loadTiles();
    await loadToday();
  } catch (err) { toast(err.message || "Could not check out."); }
}

/* ------------------------------------------------------------
   Check-in search
   ------------------------------------------------------------ */
async function searchCheckin() {
  const inputEl = document.getElementById("ci-search");
  const el = document.getElementById("ci-result");
  if (!inputEl || !el) return;

  const q = inputEl.value.trim();
  if (!q) { el.innerHTML = ""; return; }

  el.innerHTML = `<div class="empty-state">Searching…</div>`;

  try {
    const r = await Api.getVisitorGroups({ q, limit: 20 });
    const list = Array.isArray(r) ? r : (r?.data || []);

    if (!list.length) {
      el.innerHTML = `<div class="empty-state">No matching visit found.</div>`;
      return;
    }

    const g = list[0];
    el.innerHTML = `
      <div class="alert-card" style="max-width:640px;">
        <div class="alert-card__head">Match: Visit #${g.id}</div>
        <div class="alert-card__body">
          <p><b>House:</b> ${escapeHtml(g.house_number)} · <b>Host:</b> ${escapeHtml(g.resident_name)}</p>
          <p><b>Date:</b> ${escapeHtml(fmtDate(g.visit_date))}</p>
          <p><b>Code:</b> <span style="font-family:monospace;font-size:1.4rem;">${escapeHtml(g.access_code || "—")}</span></p>
          <p><b>Status:</b> ${statusBadge(g.status)}</p>
          <div style="display:flex;gap:10px;margin-top:14px;">
            ${g.status === "approved"   ? `<button class="btn btn--accent" data-do="in">Check in</button>` : ""}
            ${g.status === "checked_in" ? `<button class="btn btn--accent" data-do="out">Check out</button>` : ""}
            <button class="btn btn--ghost" data-do="view">Full details</button>
          </div>
        </div>
      </div>
    `;

    el.querySelectorAll("[data-do]").forEach((b) => b.addEventListener("click", () => {
      const action = b.dataset.do;
      if (action === "in")   checkin(g.id);
      if (action === "out")  checkout(g.id);
      if (action === "view") viewDetails(g.id);
    }));
  } catch (err) {
    console.error("[security-visitors] searchCheckin error:", err);
    el.innerHTML = `<div class="empty-state" style="color:var(--clay)">${escapeHtml(err.message || "Search failed")}</div>`;
  }
}

/* ------------------------------------------------------------
   Details modal
   ------------------------------------------------------------ */
async function viewDetails(id) {
  try {
    const r = await Api.getVisitorGroup(id);
    const g = r.data || r;

    const html = `
      <h2>Visit #${g.id}</h2>
      <p><b>Date:</b> ${escapeHtml(fmtDate(g.visit_date))} ${g.expected_time_hhmm ? "at " + escapeHtml(g.expected_time_hhmm) : ""}</p>
      <p><b>House:</b> ${escapeHtml(g.house_number)} · <b>Host:</b> ${escapeHtml(g.resident_name)} (${escapeHtml(g.resident_phone)})</p>
      <p><b>Purpose:</b> ${escapeHtml(g.purpose || "—")}</p>
      <p><b>Status:</b> ${statusBadge(g.status)}</p>
      ${g.access_code ? `<p><b>Code:</b> <span style="font-family:monospace;font-size:1.4rem;">${escapeHtml(g.access_code)}</span></p>` : ""}
      <h3>Visitors</h3>
      <ul style="padding-left:20px;">
        ${(g.visitors || []).map((v) => `
          <li style="margin-bottom:6px;">
            <b>${escapeHtml(v.name)}</b>
            ${v.phone ? " · " + escapeHtml(v.phone) : ""}
            ${v.email ? " · " + escapeHtml(v.email) : ""}
            ${v.vehicles && v.vehicles.length
              ? "<br><small>" + v.vehicles.map((veh) =>
                  `${escapeHtml(veh.type)}: ${escapeHtml(veh.plate)}`).join(" · ") + "</small>"
              : ""}
          </li>
        `).join("")}
      </ul>
    `;

    const w = window.open("", "_blank", "width=520,height=600");
    w.document.write(`
      <html><head><title>Visit #${g.id}</title>
      <link rel="stylesheet" href="/css/styles.css">
      </head><body style="padding:24px;">${html}</body></html>
    `);
    w.document.close();
  } catch (err) { toast(err.message || "Could not load."); }
}

/* ------------------------------------------------------------
   Print register — uses the current date range
   ------------------------------------------------------------ */
async function printRegister() {
  const range = getTodayRange();
  if (!range) { toast("Pick a start and end date."); return; }

  try {
    const rows = await Api.getVisitorGroups({
      from: range.from, to: range.to, limit: 500,
    });
    const list = Array.isArray(rows) ? rows : (rows?.data || []);
    if (!list.length) { toast("No visitors in the selected range."); return; }

    // Fetch each group's detail (visitor names)
    const detailed = await mapWithConcurrency(list, 6, async (g) => {
      try {
        const d = await Api.getVisitorGroup(g.id);
        const grp = d.data || d;
        return { group: grp, visitors: grp.visitors || [] };
      } catch {
        return { group: g, visitors: [] };
      }
    });

    const w = window.open("", "_blank");
    w.document.write(`
      <html><head><title>Visitor Register — ${range.label}</title>
      <style>
        body { font-family: -apple-system, sans-serif; padding: 24px; color:#111; }
        h1 { margin-bottom: 4px; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { text-align: left; padding: 8px; border-bottom: 1px solid #ccc; font-size: 13px; }
        th { background: #f3f3f3; }
        .code { font-family: monospace; font-weight: bold; font-size: 14px; }
      </style>
      </head><body>
        <h1>Visitor Register</h1>
        <p><b>Range:</b> ${range.label} · Athi Estate Access · Generated ${new Date().toLocaleString("en-KE")}</p>
        <table>
          <thead>
            <tr><th>Date</th><th>Time</th><th>House</th><th>Host</th><th>Visitor</th><th>Phone</th><th>Vehicle</th><th>Code</th><th>In</th><th>Out</th></tr>
          </thead>
          <tbody>
            ${detailed.flatMap(({ group: g, visitors }) =>
              (visitors || []).map((v) => `
                <tr>
                  <td>${escapeHtml(fmtDate(g.visit_date))}</td>
                  <td>${escapeHtml(g.expected_time_hhmm || "—")}</td>
                  <td>${escapeHtml(g.house_number)}</td>
                  <td>${escapeHtml(g.resident_name)}</td>
                  <td>${escapeHtml(v.name)}</td>
                  <td>${escapeHtml(v.phone || "—")}</td>
                  <td>${v.vehicles && v.vehicles.length ? v.vehicles.map((veh) => escapeHtml(veh.plate)).join(", ") : "—"}</td>
                  <td class="code">${escapeHtml(g.access_code || "—")}</td>
                  <td>${v.checked_in_at ? new Date(v.checked_in_at).toLocaleTimeString("en-KE", {hour:"2-digit",minute:"2-digit"}) : ""}</td>
                  <td>${v.checked_out_at ? new Date(v.checked_out_at).toLocaleTimeString("en-KE", {hour:"2-digit",minute:"2-digit"}) : ""}</td>
                </tr>
              `)
            ).join("")}
          </tbody>
        </table>
        <script>window.print();<\/script>
      </body></html>
    `);
    w.document.close();
  } catch (err) { toast(err.message || "Could not load register."); }
}

/* ------------------------------------------------------------
   Init — wire UI (already done in IIFE) then load data
   ------------------------------------------------------------ */
document.addEventListener("DOMContentLoaded", async () => {
  if (typeof Api === "undefined") {
    console.error("[security-visitors] Api not loaded — check js/api.js");
    if (typeof toast === "function") toast("Backend API not loaded. Refresh the page.");
    return;
  }

  try {
    const ping = await Api.getVisitorLiveStats();
    if (!ping) throw new Error("Empty response from live-stats");
  } catch (err) {
    console.error("[security-visitors] backend unreachable:", err);
    if (typeof toast === "function") toast("Backend not reachable. Buttons will fail until it's back up.");
  }

  const user = (typeof getUser === "function" && getUser()) || null;
  const role = user ? String(user.role || "").toLowerCase().replace(/[_\s]/g, "-") : "";
  if (!role) { console.warn("[security-visitors] no user session — data will not load."); return; }
  if (!["security", "admin", "super-admin"].includes(role)) {
    console.warn(`[security-visitors] role "${role}" not allowed — data will not load.`);
    return;
  }

  // Ensure range control has a default before loading
  const rangeEl = document.getElementById("today-range");
  if (rangeEl && !rangeEl.value) rangeEl.value = "30d";

  await loadTiles();
  await loadApprovals();
  await loadToday();   // range defaults to last 30 days
});