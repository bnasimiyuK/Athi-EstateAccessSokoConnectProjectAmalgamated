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
  page:       1,
  limit:      AV_PER_PAGE,
  total:      0,
  totalPages: 1,
  selected:   new Set(),
  rows:       [],
  /* All-visits tab state */
  allTab: {
    page: 1, limit: AV_PER_PAGE, total: 0, totalPages: 1,
    status: "", q: "",
    details: new Map(),   // id -> { visitors, inside, done }
  },
};

/* Request tokens to guard against race conditions on rapid pagination */
let _pendingReqId = 0;
let _allReqId     = 0;

/* ------------------------------------------------------------
   Helpers
   ------------------------------------------------------------ */
function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function fmtDate(s) {
  return s
    ? new Date(s).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" })
    : "—";
}

function statusBadge(s) {
  const map = {
    pending_admin:    `<span class="badge badge--pending-admin">Pending admin</span>`,
    pending_security: `<span class="badge badge--pending-sec">Pending security</span>`,
    approved:         `<span class="badge badge--verified">Approved</span>`,
    denied:           `<span class="badge badge--danger">Denied</span>`,
    cancelled:        `<span class="badge badge--muted">Cancelled</span>`,
    checked_in:       `<span class="badge badge--success">Checked in</span>`,
    completed:        `<span class="badge badge--success">Completed</span>`,
    expired:          `<span class="badge badge--danger">Expired</span>`,
  };
  return map[s] || `<span class="badge">${escapeHtml(s)}</span>`;
}

function $(id) { return document.getElementById(id); }

function safeToast(msg) {
  if (typeof toast === "function") toast(msg);
  else console.warn("[admin-visitors]", msg);
}

function setupTabs(onActivate) {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("is-active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("is-active"));
      btn.classList.add("is-active");
      const panel = $(`tab-${btn.dataset.tab}`);
      if (panel) panel.classList.add("is-active");
      if (typeof onActivate === "function") onActivate(btn.dataset.tab);
    });
  });
}

/* ------------------------------------------------------------
   Tiles
   ------------------------------------------------------------ */
async function loadTiles() {
  try {
    const counts = await Api.getVisitorPendingCounts();
    const t1 = $("tile-pending");     if (t1) t1.textContent = counts.pending_admin    ?? "0";
    const t2 = $("tile-pending-sec"); if (t2) t2.textContent = counts.pending_security ?? "0";

    // Prefer server-side counts if the API provides them.
    if (typeof counts.approved_30d === "number") {
      const t3 = $("tile-approved"); if (t3) t3.textContent = counts.approved_30d;
    }
    if (typeof counts.denied_30d === "number") {
      const t4 = $("tile-denied"); if (t4) t4.textContent = counts.denied_30d;
    }
  } catch (err) {
    console.error("[admin-visitors] tiles failed:", err);
    safeToast("Could not load summary tiles.");
  }
}

/* ------------------------------------------------------------
   Bulk bar
   ------------------------------------------------------------ */
function updateBulkBar() {
  const bar     = $("bulk-bar");
  const countEl = $("bulk-count");
  if (!bar) return;

  const n = avState.selected.size;
  bar.style.display = n === 0 ? "none" : "flex";
  if (n > 0 && countEl) countEl.textContent = n;

  const allChk = $("chk-select-all");
  if (allChk) {
    const pageIds        = avState.rows.map((r) => r.id);
    const selectedOnPage = pageIds.filter((id) => avState.selected.has(id)).length;
    allChk.checked       = pageIds.length > 0 && selectedOnPage === pageIds.length;
    allChk.indeterminate = selectedOnPage > 0 && selectedOnPage < pageIds.length;
  }
}

/* ------------------------------------------------------------
   Pending list (paginated)
   ------------------------------------------------------------ */
async function loadPending(page) {
  if (typeof page === "number") avState.page = page;

  const el = $("pending-list");
  if (!el) return;
  el.innerHTML = `<div class="empty-state">Loading…</div>`;

  const myId = ++_pendingReqId;

  let result;
  try {
    result = await Api.getVisitorPendingAdmin({
      page:  avState.page,
      limit: avState.limit,
    });
  } catch (err) {
    if (myId !== _pendingReqId) return;
    el.innerHTML = `<div class="empty-state" style="color:var(--clay)">
      Could not load: ${escapeHtml(err.message)}
    </div>`;
    return;
  }

  if (myId !== _pendingReqId) return; // stale response — a newer request is in-flight

  avState.rows       = result.data || [];
  avState.total      = result.total || 0;
  avState.page       = result.page || 1;
  avState.totalPages = result.totalPages || 1;

  const countEl = $("count-pending");
  if (countEl) countEl.textContent = avState.total ? `(${avState.total})` : "";

  const approveAllBtn = $("btn-approve-all");
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
      const id = String(chk.dataset.id);
      if (chk.checked) avState.selected.add(id);
      else             avState.selected.delete(id);
      updateBulkBar();
    });
  });

  const allChk = $("chk-select-all");
  if (allChk) {
    allChk.addEventListener("change", () => {
      const pageIds = avState.rows.map((r) => r.id);
      if (allChk.checked) pageIds.forEach((id) => avState.selected.add(id));
      else                pageIds.forEach((id) => avState.selected.delete(id));
      el.querySelectorAll(".chk-row").forEach((chk) => {
        chk.checked = avState.selected.has(String(chk.dataset.id));
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
  const el = $("pending-pagination");
  if (!el) return;

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
    safeToast("✅ Stage-1 approved. Waiting for security.");
    avState.selected.delete(String(id));
    avState.allTab.details.delete(Number(id));
    await refreshAll();
  } catch (err) {
    safeToast(err.message || "Could not approve.");
  } finally {
    btn.disabled = false; btn.textContent = old;
  }
}

async function denyOne(id) {
  const reason = prompt("Reason for denial (will be sent to resident):");
  if (reason === null) return;
  const cleanReason = reason.trim() || "Denied by admin";

  try {
    await Api.denyVisitor(id, cleanReason);
    safeToast("Denied. Resident notified.");
    avState.selected.delete(String(id));
    avState.allTab.details.delete(Number(id));
    await refreshAll();
  } catch (err) {
    safeToast(err.message || "Could not deny.");
  }
}

/* ------------------------------------------------------------
   Bulk approve selected
   ------------------------------------------------------------ */
async function bulkApproveSelected() {
  const ids = [...avState.selected];
  if (!ids.length) { safeToast("Select at least one pre-registration."); return; }
  if (ids.length > AV_MAX_BULK) {
    safeToast(`Cannot approve more than ${AV_MAX_BULK} at once. You have ${ids.length} selected.`);
    return;
  }

  if (!confirm(`Approve ${ids.length} pre-registration${ids.length === 1 ? "" : "s"}?\n\nEach one will move to security review.`)) return;

  const btn = $("bulk-approve-btn");
  const old = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "Approving…"; }

  try {
    const r = await Api.bulkApproveAdmin(ids);
    safeToast(`✅ Approved: ${r.ok} · Failed: ${r.failed}`);
    if (r.failed > 0) console.warn("[bulk-approve] failures:", r.failures);

    avState.selected.clear();
    avState.allTab.details.clear();
    await refreshAll();
  } catch (err) {
    safeToast(err.message || "Bulk approval failed.");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = old; }
  }
}

/* ------------------------------------------------------------
   Bulk deny selected
   ------------------------------------------------------------ */
async function bulkDenySelected() {
  const ids = [...avState.selected];
  if (!ids.length) { safeToast("Select at least one pre-registration."); return; }
  if (ids.length > AV_MAX_BULK) {
    safeToast(`Cannot deny more than ${AV_MAX_BULK} at once. You have ${ids.length} selected.`);
    return;
  }

  const reason = prompt(`Reason for denying ${ids.length} pre-registration${ids.length === 1 ? "" : "s"} (will be sent to residents):`);
  if (reason === null) return;
  const cleanReason = reason.trim() || "Denied by admin";

  const btn = $("bulk-deny-btn");
  const old = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "Denying…"; }

  try {
    const r = await Api.bulkDenyVisitors(ids, cleanReason);
    safeToast(`❌ Denied: ${r.ok} · Failed: ${r.failed}`);
    if (r.failed > 0) console.warn("[bulk-deny] failures:", r.failures);

    avState.selected.clear();
    avState.allTab.details.clear();
    await refreshAll();
  } catch (err) {
    safeToast(err.message || "Bulk denial failed.");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = old; }
  }
}

/* ------------------------------------------------------------
   Approve all pending (typed confirmation)
   ------------------------------------------------------------ */
function openConfirmAllModal() {
  const modal = $("confirm-all-modal");
  if (!modal) return;

  const total  = avState.total || 0;
  const willDo = Math.min(AV_MAX_BULK, total);

  const textEl = $("confirm-all-text");
  if (textEl) {
    textEl.innerHTML = `
      This will approve <b>${willDo}</b> pending pre-registration${willDo === 1 ? "" : "s"}
      (out of ${total} total${total > AV_MAX_BULK ? `, capped at ${AV_MAX_BULK} per click` : ""}).
      They will all move to security review.
    `;
  }

  const input = $("confirm-all-input");
  const goBtn = $("confirm-all-go");

  if (input) {
    input.value = "";
    input.oninput = () => {
      if (goBtn) goBtn.disabled = input.value.trim() !== "APPROVE ALL";
    };
  }
  if (goBtn) {
    goBtn.disabled = true;
    goBtn.textContent = "Approve all";
  }

  modal.style.display = "flex";
  if (input) setTimeout(() => input.focus(), 50);
}

function closeConfirmAllModal() {
  const modal = $("confirm-all-modal");
  if (modal) modal.style.display = "none";
}

async function approveAllPending() {
  const btn = $("confirm-all-go");
  const old = btn ? btn.textContent : "Approve all";
  if (btn) { btn.disabled = true; btn.textContent = "Approving…"; }

  try {
    const r = await Api.bulkApproveAllAdmin("APPROVE ALL", AV_MAX_BULK);
    safeToast(`✅ Approved ${r.ok} · Failed ${r.failed} · ${r.remaining} remaining`);
    if (r.failed > 0) console.warn("[approve-all] failures:", r.failures);

    closeConfirmAllModal();
    avState.selected.clear();
    avState.allTab.details.clear();
    await refreshAll();
  } catch (err) {
    safeToast(err.message || "Bulk approval failed.");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = old; }
  }
}

/* ------------------------------------------------------------
   All visits tab
   ------------------------------------------------------------ */
async function loadAll() {
  const el = $("all-list");
  if (!el) return;
  el.innerHTML = `<div class="empty-state">Loading…</div>`;

  const myId = ++_allReqId;

  let result;
  try {
    result = await Api.getVisitorGroups({
      status: avState.allTab.status,
      q:      avState.allTab.q,
      page:   avState.allTab.page,
      limit:  avState.allTab.limit,
    });
  } catch (err) {
    if (myId !== _allReqId) return;
    el.innerHTML = `<div class="empty-state" style="color:var(--clay)">
      Could not load: ${escapeHtml(err.message)}
    </div>`;
    return;
  }

  if (myId !== _allReqId) return;

  avState.allTab.total      = result.total;
  avState.allTab.page       = result.page;
  avState.allTab.totalPages = result.totalPages;

  if (!result.data.length) {
    el.innerHTML = `<div class="empty-state">No visits match your filter.</div>`;
    renderAllPagination();
    return;
  }

  /* Enrich rows with per-visit aggregate counts.
     Prefer server-provided counts; only fall back to per-row fetch
     when the list endpoint doesn't return them. */
  const needsDetail = result.data.some(
    (g) => typeof g.inside_count !== "number" || typeof g.checked_out_count !== "number"
  );

  let enriched = result.data.map((g) => ({
    g,
    visitors:   g.visitors || [],
    inside:     typeof g.inside_count     === "number" ? g.inside_count     : 0,
    done:       typeof g.checked_out_count === "number" ? g.checked_out_count : 0,
  }));

  if (needsDetail) {
    // Limit concurrency to avoid hammering the backend with a burst of requests.
    enriched = await mapWithConcurrency(result.data, 6, async (g) => {
      const cached = avState.allTab.details.get(g.id);
      if (cached) return { g, ...cached };
      try {
        const detail  = await Api.getVisitorGroup(g.id);
        const body    = detail.data || detail;
        const visitors = body.visitors || [];
        const inside  = visitors.filter((v) => v.status === "checked_in").length;
        const done    = visitors.filter((v) => v.status === "checked_out").length;
        const payload = { visitors, inside, done };
        avState.allTab.details.set(g.id, payload);
        return { g, ...payload };
      } catch {
        return { g, visitors: [], inside: 0, done: 0 };
      }
    });
  }

  el.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Visit date</th><th>House</th><th>Host</th>
            <th>Visitors</th><th>Inside</th>
            <th>Code</th><th>Status</th><th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${enriched.map(({ g, visitors, inside, done }) => `
            <tr>
              <td>${escapeHtml(fmtDate(g.visit_date))}</td>
              <td>${escapeHtml(g.house_number)}</td>
              <td>${escapeHtml(g.resident_name)}</td>
              <td>${g.headcount}</td>
              <td>
                ${inside > 0
                  ? `<b style="color:var(--teal);">${inside} on-site</b>`
                  : done === visitors.length && visitors.length > 0
                    ? `<span style="color:var(--ink-70);">all left</span>`
                    : `<span style="color:var(--ink-40);">—</span>`}
              </td>
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

/* Run async tasks with a bounded concurrency (avoids 50 parallel requests). */
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

function renderAllPagination() {
  const el = $("all-pagination");
  if (!el) return;

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
   Details modal (in-page — replaces window.open/document.write)
   ------------------------------------------------------------ */
async function viewDetails(id) {
  let g;
  try {
    const r = await Api.getVisitorGroup(id);
    g = r.data || r;
  } catch (err) {
    safeToast(err.message || "Could not load.");
    return;
  }

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.style.cssText =
    "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;";

  const card = document.createElement("div");
  card.className = "modal-card";
  card.style.cssText =
    "background:#fff;max-width:560px;width:100%;max-height:85vh;overflow:auto;border-radius:8px;padding:24px;box-shadow:0 10px 40px rgba(0,0,0,.25);";
  card.innerHTML = `
    <h2 style="margin-top:0;">Visit #${escapeHtml(g.id)}</h2>
    <p><b>Date:</b> ${escapeHtml(fmtDate(g.visit_date))}</p>
    <p><b>House:</b> ${escapeHtml(g.house_number)} · <b>Host:</b> ${escapeHtml(g.resident_name)}</p>
    <p><b>Status:</b> ${statusBadge(g.status)}</p>
    ${g.access_code ? `<p><b>Code:</b> <span style="font-family:monospace;font-size:1.4rem;">${escapeHtml(g.access_code)}</span></p>` : ""}
    <h3>Visitors</h3>
    <ul style="padding-left:20px;">
      ${(g.visitors || []).map((v) =>
        `<li>${escapeHtml(v.name)}${v.phone ? " · " + escapeHtml(v.phone) : ""}</li>`
      ).join("") || "<li><em>No visitors listed</em></li>"}
    </ul>
    <div style="margin-top:20px;text-align:right;">
      <button class="btn btn--ghost" data-close>Close</button>
    </div>
  `;

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  const close = () => {
    document.removeEventListener("keydown", onKey);
    overlay.remove();
  };
  const onKey = (e) => { if (e.key === "Escape") close(); };

  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  card.querySelector("[data-close]").addEventListener("click", close);
  document.addEventListener("keydown", onKey);
}

/* ------------------------------------------------------------
   Refresh helper
   ------------------------------------------------------------ */
async function refreshAll() {
  await Promise.all([loadTiles(), loadPending(), loadAll()]);
}

/* ------------------------------------------------------------
   Init
   ------------------------------------------------------------ */
document.addEventListener("DOMContentLoaded", async () => {
  if (typeof requireRole === "function" &&
      !requireRole("admin", "super-admin")) return;

  setupTabs((tab) => {
    // Lazy refetch when switching tabs, in case a previous load failed.
    if (tab === "all" && !avState.allTab.total) loadAll();
  });

  /* Bulk bar buttons */
  const bulkApproveBtn = $("bulk-approve-btn");
  const bulkDenyBtn    = $("bulk-deny-btn");
  const bulkClearBtn   = $("bulk-clear-btn");
  const approveAllBtn  = $("btn-approve-all");

  if (bulkApproveBtn) bulkApproveBtn.addEventListener("click", bulkApproveSelected);
  if (bulkDenyBtn)    bulkDenyBtn.addEventListener("click", bulkDenySelected);
  if (bulkClearBtn)   bulkClearBtn.addEventListener("click", () => {
    avState.selected.clear();
    document.querySelectorAll(".chk-row").forEach((chk) => (chk.checked = false));
    updateBulkBar();
  });
  if (approveAllBtn)  approveAllBtn.addEventListener("click", openConfirmAllModal);

  /* Confirm-all modal */
  const cancelBtn = $("confirm-all-cancel");
  const goBtn     = $("confirm-all-go");
  if (cancelBtn) cancelBtn.addEventListener("click", closeConfirmAllModal);
  if (goBtn)     goBtn.addEventListener("click", approveAllPending);

  /* All-visits filter */
  const allFilter = $("all-filter");
  if (allFilter) {
    allFilter.addEventListener("submit", (e) => {
      e.preventDefault();
      const statusEl = $("filter-status");
      const qEl      = $("filter-q");
      avState.allTab.status = statusEl ? statusEl.value : "";
      avState.allTab.q      = qEl ? qEl.value.trim() : "";
      avState.allTab.page   = 1;
      loadAll();
    });
  }

  const clearBtn = $("filter-clear");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      const statusEl = $("filter-status");
      const qEl      = $("filter-q");
      if (statusEl) statusEl.value = "";
      if (qEl)      qEl.value = "";
      avState.allTab.status = "";
      avState.allTab.q      = "";
      avState.allTab.page   = 1;
      loadAll();
    });
  }

  await refreshAll();
});