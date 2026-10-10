/* ============================================================
   admin-visitors.js — admin stage-1 approval + bulk actions
   - Paginated pending list
   - Checkbox selection across pages
   - Bulk approve / bulk deny (max 200)
   - Approve-all with typed confirmation
   ============================================================ */

const AV_PER_PAGE = 50;
const AV_MAX_BULK = 200;

const avState = {
  page:    1,
  limit:   AV_PER_PAGE,
  total:   0,
  totalPages: 1,
  selected: new Set(),
  rows:    [],
  /* All-visits tab state */
  allTab: { page: 1, limit: AV_PER_PAGE, total: 0, totalPages: 1, status: "", q: "" },
};

/* ------------------------------------------------------------
   Helpers
   ------------------------------------------------------------ */
function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function fmtDate(s) { return s ? new Date(s).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "—"; }

function statusBadge(s) {
  const map = {
    pending_admin:    `<span class="badge" style="background:#c8862a;color:#fff;">Pending admin</span>`,
    pending_security: `<span class="badge" style="background:#4a7ba7;color:#fff;">Pending security</span>`,
    approved:         `<span class="badge badge--verified">Approved</span>`,
    denied:           `<span class="badge" style="background:#b0472e;color:#fff;">Denied</span>`,
    cancelled:        `<span class="badge" style="background:#666;color:#fff;">Cancelled</span>`,
    checked_in:       `<span class="badge" style="background:#2f6f5e;color:#fff;">Checked in</span>`,
    completed:        `<span class="badge" style="background:#2f6f5e;color:#fff;">Completed</span>`,
    expired:          `<span class="badge" style="background:#b0472e;color:#fff;">Expired</span>`,
  };
  return map[s] || escapeHtml(s);
}

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
   Tiles
   ------------------------------------------------------------ */
async function loadTiles() {
  try {
    const [counts, all30] = await Promise.all([
      Api.getVisitorPendingCounts(),
      Api.getVisitorGroups({
        from: new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10),
        limit: 500,
      }),
    ]);
    document.getElementById("tile-pending").textContent     = counts.pending_admin;
    document.getElementById("tile-pending-sec").textContent = counts.pending_security;

    const rows = all30.data || [];
    document.getElementById("tile-approved").textContent =
      rows.filter((g) => ["approved","checked_in","completed"].includes(g.status)).length;
    document.getElementById("tile-denied").textContent =
      rows.filter((g) => g.status === "denied").length;
  } catch (err) {
    console.error("[admin-visitors] tiles failed:", err);
  }
}

/* ------------------------------------------------------------
   Bulk bar
   ------------------------------------------------------------ */
function updateBulkBar() {
  const bar = document.getElementById("bulk-bar");
  const countEl = document.getElementById("bulk-count");
  if (!bar) return;
  const n = avState.selected.size;

  bar.style.display = n === 0 ? "none" : "flex";
  if (n > 0) countEl.textContent = n;

  const allChk = document.getElementById("chk-select-all");
  if (allChk) {
    const pageIds = avState.rows.map((r) => r.id);
    const selectedOnPage = pageIds.filter((id) => avState.selected.has(id)).length;
    allChk.checked = pageIds.length > 0 && selectedOnPage === pageIds.length;
    allChk.indeterminate = selectedOnPage > 0 && selectedOnPage < pageIds.length;
  }
}

/* ------------------------------------------------------------
   Pending list (paginated)
   ------------------------------------------------------------ */
async function loadPending(page) {
  if (typeof page === "number") avState.page = page;
  const el = document.getElementById("pending-list");
  el.innerHTML = `<div class="empty-state">Loading…</div>`;

  let result;
  try {
    result = await Api.getVisitorPendingAdmin({
      page:  avState.page,
      limit: avState.limit,
    });
  } catch (err) {
    el.innerHTML = `<div class="empty-state" style="color:var(--clay)">Could not load: ${escapeHtml(err.message)}</div>`;
    return;
  }

  avState.rows       = result.data || [];
  avState.total      = result.total || 0;
  avState.page       = result.page || 1;
  avState.totalPages = result.totalPages || 1;

  document.getElementById("count-pending").textContent =
    avState.total ? `(${avState.total})` : "";

  const approveAllBtn = document.getElementById("btn-approve-all");
  if (approveAllBtn) {
    approveAllBtn.style.display = avState.total > 0 ? "inline-flex" : "none";
  }

  if (!avState.rows.length) {
    el.innerHTML = `<div class="empty-state">No pre-registrations waiting for admin approval.</div>`;
    updateBulkBar();
    renderPendingPagination();
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
            <th>Submitted</th><th>Visit date</th><th>House</th><th>Host</th>
            <th>Visitors</th><th>Purpose</th><th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${avState.rows.map((g) => `
            <tr data-id="${g.id}">
              <td>
                <input type="checkbox" class="chk-row" data-id="${g.id}"
                       ${avState.selected.has(g.id) ? "checked" : ""} />
              </td>
              <td>${escapeHtml(fmtDate(g.created_at))}</td>
              <td><b>${escapeHtml(fmtDate(g.visit_date))}</b>${g.expected_time_hhmm ? " " + escapeHtml(g.expected_time_hhmm) : ""}</td>
              <td>${escapeHtml(g.house_number)}</td>
              <td>${escapeHtml(g.resident_name)}<br><small>${escapeHtml(g.resident_phone)}</small></td>
              <td>${g.headcount}</td>
              <td>${escapeHtml(g.purpose || "—")}</td>
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
      if (chk.checked) avState.selected.add(id);
      else avState.selected.delete(id);
      updateBulkBar();
    });
  });

  const allChk = document.getElementById("chk-select-all");
  if (allChk) {
    allChk.addEventListener("change", () => {
      const pageIds = avState.rows.map((r) => r.id);
      if (allChk.checked) pageIds.forEach((id) => avState.selected.add(id));
      else                pageIds.forEach((id) => avState.selected.delete(id));
      el.querySelectorAll(".chk-row").forEach((chk) => {
        chk.checked = avState.selected.has(parseInt(chk.dataset.id, 10));
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
  renderPendingPagination();
}

/* ------------------------------------------------------------
   Pagination (pending tab)
   ------------------------------------------------------------ */
function renderPendingPagination() {
  const el = document.getElementById("pending-pagination");
  const { page, limit, total, totalPages } = avState;
  if (!total || totalPages <= 1) { el.innerHTML = ""; return; }

  const startRow = (page - 1) * limit + 1;
  const endRow   = Math.min(page * limit, total);

  el.innerHTML = `
    <div class="pagination" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-top:18px;padding:12px 4px;border-top:1px solid var(--line);">
      <div style="font-size:0.9rem;color:var(--ink-70);">
        Showing <b>${startRow}–${endRow}</b> of <b>${total}</b>
        ${avState.selected.size ? `<span style="margin-left:12px;color:var(--ochre);font-weight:600;">
          · ${avState.selected.size} selected
        </span>` : ""}
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button class="btn btn--ghost btn--small" data-pg="prev" ${page <= 1 ? "disabled" : ""}>« Prev</button>
        <span style="font-size:0.9rem;color:var(--ink-70);padding:0 4px;">Page <b>${page}</b> of <b>${totalPages}</b></span>
        <button class="btn btn--ghost btn--small" data-pg="next" ${page >= totalPages ? "disabled" : ""}>Next »</button>
      </div>
    </div>
  `;

  el.querySelectorAll("[data-pg]").forEach((b) => {
    b.addEventListener("click", () => {
      if (b.dataset.pg === "prev" && avState.page > 1) loadPending(avState.page - 1);
      if (b.dataset.pg === "next" && avState.page < avState.totalPages) loadPending(avState.page + 1);
    });
  });
}

/* ------------------------------------------------------------
   Single-item actions
   ------------------------------------------------------------ */
async function approveOne(id, btn) {
  if (!confirm("Approve this visit at stage 1?\n\nSecurity will still need to approve at stage 2.")) return;
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = "Approving…";
  try {
    await Api.approveVisitorAdmin(id);
    toast("✅ Stage-1 approved. Waiting for security.");
    avState.selected.delete(parseInt(id, 10));
    await loadTiles();
    await loadPending();
    await loadAll();
  } catch (err) {
    toast(err.message || "Could not approve.");
  } finally {
    btn.disabled = false; btn.textContent = old;
  }
}

async function denyOne(id) {
  const reason = prompt("Reason for denial (will be sent to resident):");
  if (reason === null) return;
  try {
    await Api.denyVisitor(id, reason);
    toast("Denied. Resident notified.");
    avState.selected.delete(parseInt(id, 10));
    await loadTiles();
    await loadPending();
    await loadAll();
  } catch (err) {
    toast(err.message || "Could not deny.");
  }
}

/* ------------------------------------------------------------
   Bulk approve selected
   ------------------------------------------------------------ */
async function bulkApproveSelected() {
  const ids = [...avState.selected];
  if (!ids.length) { toast("Select at least one pre-registration."); return; }
  if (ids.length > AV_MAX_BULK) {
    toast(`Cannot approve more than ${AV_MAX_BULK} at once. You have ${ids.length} selected.`);
    return;
  }

  if (!confirm(`Approve ${ids.length} pre-registration${ids.length === 1 ? "" : "s"}?\n\nEach one will move to security review.`)) return;

  const btn = document.getElementById("bulk-approve-btn");
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = "Approving…";

  try {
    const r = await Api.bulkApproveAdmin(ids);
    toast(`✅ Approved: ${r.ok} · Failed: ${r.failed}`);
    if (r.failed > 0) console.warn("[bulk-approve] failures:", r.failures);

    avState.selected.clear();
    await loadTiles();
    await loadPending();
    await loadAll();
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
  const ids = [...avState.selected];
  if (!ids.length) { toast("Select at least one pre-registration."); return; }
  if (ids.length > AV_MAX_BULK) {
    toast(`Cannot deny more than ${AV_MAX_BULK} at once. You have ${ids.length} selected.`);
    return;
  }

  const reason = prompt(`Reason for denying ${ids.length} pre-registration${ids.length === 1 ? "" : "s"} (will be sent to residents):`);
  if (reason === null) return;

  const btn = document.getElementById("bulk-deny-btn");
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = "Denying…";

  try {
    const r = await Api.bulkDenyVisitors(ids, reason);
    toast(`❌ Denied: ${r.ok} · Failed: ${r.failed}`);
    if (r.failed > 0) console.warn("[bulk-deny] failures:", r.failures);

    avState.selected.clear();
    await loadTiles();
    await loadPending();
    await loadAll();
  } catch (err) {
    toast(err.message || "Bulk denial failed.");
  } finally {
    btn.disabled = false; btn.textContent = old;
  }
}

/* ------------------------------------------------------------
   Approve all pending (typed confirmation)
   ------------------------------------------------------------ */
function openConfirmAllModal() {
  const total = avState.total || 0;
  const willDo = Math.min(AV_MAX_BULK, total);

  document.getElementById("confirm-all-text").innerHTML = `
    This will approve <b>${willDo}</b> pending pre-registration${willDo === 1 ? "" : "s"}
    (out of ${total} total${total > AV_MAX_BULK ? `, capped at ${AV_MAX_BULK} per click` : ""}).
    They will all move to security review.
  `;

  const input = document.getElementById("confirm-all-input");
  input.value = "";
  document.getElementById("confirm-all-go").disabled = true;

  input.oninput = () => {
    document.getElementById("confirm-all-go").disabled = input.value.trim() !== "APPROVE ALL";
  };

  document.getElementById("confirm-all-modal").style.display = "flex";
  setTimeout(() => input.focus(), 50);
}

function closeConfirmAllModal() {
  document.getElementById("confirm-all-modal").style.display = "none";
}

async function approveAllPending() {
  const btn = document.getElementById("confirm-all-go");
  btn.disabled = true; btn.textContent = "Approving…";

  try {
    const r = await Api.bulkApproveAllAdmin("APPROVE ALL", AV_MAX_BULK);
    toast(`✅ Approved ${r.ok} · Failed ${r.failed} · ${r.remaining} remaining`);
    if (r.failed > 0) console.warn("[approve-all] failures:", r.failures);

    closeConfirmAllModal();
    avState.selected.clear();
    await loadTiles();
    await loadPending();
    await loadAll();
  } catch (err) {
    toast(err.message || "Bulk approval failed.");
  } finally {
    btn.disabled = false; btn.textContent = "Approve all";
  }
}

/* ------------------------------------------------------------
   All visits tab
   ------------------------------------------------------------ */
async function loadAll() {
  const el = document.getElementById("all-list");
  el.innerHTML = `<div class="empty-state">Loading…</div>`;

  let result;
  try {
    result = await Api.getVisitorGroups({
      status: avState.allTab.status,
      q:      avState.allTab.q,
      page:   avState.allTab.page,
      limit:  avState.allTab.limit,
    });
  } catch (err) {
    el.innerHTML = `<div class="empty-state" style="color:var(--clay)">Could not load: ${escapeHtml(err.message)}</div>`;
    return;
  }

  avState.allTab.total      = result.total;
  avState.allTab.page       = result.page;
  avState.allTab.totalPages = result.totalPages;

  if (!result.data.length) {
    el.innerHTML = `<div class="empty-state">No visits match your filter.</div>`;
    renderAllPagination();
    return;
  }

  el.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Visit date</th><th>House</th><th>Host</th><th>Visitors</th>
            <th>Code</th><th>Status</th><th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${result.data.map((g) => `
            <tr>
              <td>${escapeHtml(fmtDate(g.visit_date))}</td>
              <td>${escapeHtml(g.house_number)}</td>
              <td>${escapeHtml(g.resident_name)}</td>
              <td>${g.headcount}</td>
              <td><b style="font-family:monospace;">${escapeHtml(g.access_code || "—")}</b></td>
              <td>${statusBadge(g.status)}</td>
              <td>
                <button class="btn btn--ghost btn--small" data-view="${g.id}">View</button>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
  el.querySelectorAll("[data-view]").forEach((b) =>
    b.addEventListener("click", () => viewDetails(b.dataset.view))
  );
  renderAllPagination();
}

function renderAllPagination() {
  const el = document.getElementById("all-pagination");
  const { page, limit, total, totalPages } = avState.allTab;
  if (!total || totalPages <= 1) { el.innerHTML = ""; return; }
  const startRow = (page - 1) * limit + 1;
  const endRow   = Math.min(page * limit, total);

  el.innerHTML = `
    <div class="pagination" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-top:18px;padding:12px 4px;border-top:1px solid var(--line);">
      <div style="font-size:0.9rem;color:var(--ink-70);">
        Showing <b>${startRow}–${endRow}</b> of <b>${total}</b>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button class="btn btn--ghost btn--small" data-apg="prev" ${page <= 1 ? "disabled" : ""}>« Prev</button>
        <span style="font-size:0.9rem;color:var(--ink-70);padding:0 4px;">Page <b>${page}</b> of <b>${totalPages}</b></span>
        <button class="btn btn--ghost btn--small" data-apg="next" ${page >= totalPages ? "disabled" : ""}>Next »</button>
      </div>
    </div>
  `;

  el.querySelectorAll("[data-apg]").forEach((b) => {
    b.addEventListener("click", () => {
      if (b.dataset.apg === "prev" && avState.allTab.page > 1) avState.allTab.page--;
      if (b.dataset.apg === "next" && avState.allTab.page < avState.allTab.totalPages) avState.allTab.page++;
      loadAll();
    });
  });
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
      <p><b>Date:</b> ${escapeHtml(fmtDate(g.visit_date))}</p>
      <p><b>House:</b> ${escapeHtml(g.house_number)} · <b>Host:</b> ${escapeHtml(g.resident_name)}</p>
      <p><b>Status:</b> ${statusBadge(g.status)}</p>
      ${g.access_code ? `<p><b>Code:</b> <span style="font-family:monospace;font-size:1.4rem;">${escapeHtml(g.access_code)}</span></p>` : ""}
      <h3>Visitors</h3>
      <ul style="padding-left:20px;">
        ${(g.visitors || []).map((v) => `<li>${escapeHtml(v.name)}${v.phone ? " · " + escapeHtml(v.phone) : ""}</li>`).join("")}
      </ul>
    `;
    const w = window.open("", "_blank", "width=520,height=600");
    w.document.write(`<html><head><title>Visit #${g.id}</title><link rel="stylesheet" href="/css/styles.css"></head><body style="padding:24px;">${html}</body></html>`);
    w.document.close();
  } catch (err) {
    toast(err.message || "Could not load.");
  }
}

/* ------------------------------------------------------------
   Init
   ------------------------------------------------------------ */
document.addEventListener("DOMContentLoaded", async () => {
  if (typeof requireRole === "function" &&
    !requireRole("admin", "super-admin")) return;

  setupTabs();

  /* Bulk bar buttons */
  const bulkApproveBtn = document.getElementById("bulk-approve-btn");
  const bulkDenyBtn    = document.getElementById("bulk-deny-btn");
  const bulkClearBtn   = document.getElementById("bulk-clear-btn");
  const approveAllBtn  = document.getElementById("btn-approve-all");

  if (bulkApproveBtn) bulkApproveBtn.addEventListener("click", bulkApproveSelected);
  if (bulkDenyBtn)    bulkDenyBtn.addEventListener("click", bulkDenySelected);
  if (bulkClearBtn)   bulkClearBtn.addEventListener("click", () => {
    avState.selected.clear();
    document.querySelectorAll(".chk-row").forEach((chk) => (chk.checked = false));
    updateBulkBar();
  });
  if (approveAllBtn)  approveAllBtn.addEventListener("click", openConfirmAllModal);

  /* Confirm-all modal */
  document.getElementById("confirm-all-cancel").addEventListener("click", closeConfirmAllModal);
  document.getElementById("confirm-all-go").addEventListener("click", approveAllPending);

  /* All-visits filter */
  document.getElementById("all-filter").addEventListener("submit", (e) => {
    e.preventDefault();
    avState.allTab.status = document.getElementById("filter-status").value;
    avState.allTab.q      = document.getElementById("filter-q").value.trim();
    avState.allTab.page   = 1;
    loadAll();
  });

  document.getElementById("filter-clear").addEventListener("click", () => {
    document.getElementById("filter-status").value = "";
    document.getElementById("filter-q").value = "";
    avState.allTab.status = ""; avState.allTab.q = ""; avState.allTab.page = 1;
    loadAll();
  });

  await loadTiles();
  await loadPending();
  await loadAll();
});