/* ============================================================
   security-visitors.js â€” security dashboard
   Tabs: approvals (bulk) | today (per-visitor) | check-in/out
   - Paginated pending list with checkboxes + bulk actions
   - Approve ALL with typed confirmation
   - Email batching feedback on bulk approve
   ============================================================ */

const SV_PER_PAGE = 50;
const SV_MAX_BULK = 200;

const svState = {
  page:    1,
  limit:   SV_PER_PAGE,
  total:   0,
  totalPages: 1,
  selected: new Set(),
  rows:    [],
};

/* ------------------------------------------------------------
   Helpers
   ------------------------------------------------------------ */
function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function fmtDate(s) {
  if (!s) return "â€”";
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
    const s = await Api.getVisitorLiveStats();
    document.getElementById("tile-pending").textContent    = s.pending_security;
    document.getElementById("tile-today").textContent      = s.expected_today;
    document.getElementById("tile-checked-in").textContent = s.currently_on_site;
    document.getElementById("tile-completed").textContent  = s.completed_today;
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
  if (n > 0) countEl.textContent = n;

  const allChk = document.getElementById("chk-select-all");
  if (allChk) {
    const pageIds = svState.rows.map((r) => r.id);
    const selectedOnPage = pageIds.filter((id) => svState.selected.has(id)).length;
    allChk.checked = pageIds.length > 0 && selectedOnPage === pageIds.length;
    allChk.indeterminate = selectedOnPage > 0 && selectedOnPage < pageIds.length;
  }
}

/* ------------------------------------------------------------
   Pending approvals â€” paginated
   ------------------------------------------------------------ */
async function loadApprovals(page) {
  if (typeof page === "number") svState.page = page;
  const el = document.getElementById("approvals-list");
  el.innerHTML = `<div class="empty-state">Loadingâ€¦</div>`;

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

  svState.rows       = result.data || [];
  svState.total      = result.total || 0;
  svState.page       = result.page || 1;
  svState.totalPages = result.totalPages || 1;

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
              <td>${escapeHtml(g.expected_time_hhmm || "â€”")}</td>
              <td>${escapeHtml(g.house_number)}</td>
              <td>${escapeHtml(g.resident_name)}<br><small>${escapeHtml(g.resident_phone)}</small></td>
              <td>${g.headcount}</td>
              <td>${escapeHtml(g.purpose || "â€”")}</td>
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
      else svState.selected.delete(id);
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
  const { page, limit, total, totalPages } = svState;
  if (!total || totalPages <= 1) { el.innerHTML = ""; return; }

  const startRow = (page - 1) * limit + 1;
  const endRow   = Math.min(page * limit, total);

  el.innerHTML = `
    <div class="pagination" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-top:18px;padding:12px 4px;border-top:1px solid var(--line);">
      <div style="font-size:0.9rem;color:var(--ink-70);">
        Showing <b>${startRow}â€“${endRow}</b> of <b>${total}</b>
        ${svState.selected.size ? `<span style="margin-left:12px;color:var(--ochre);font-weight:600;">
          Â· ${svState.selected.size} selected
        </span>` : ""}
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button class="btn btn--ghost btn--small" data-spg="prev" ${page <= 1 ? "disabled" : ""}>Â« Prev</button>
        <span style="font-size:0.9rem;color:var(--ink-70);padding:0 4px;">Page <b>${page}</b> of <b>${totalPages}</b></span>
        <button class="btn btn--ghost btn--small" data-spg="next" ${page >= totalPages ? "disabled" : ""}>Next Â»</button>
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
  btn.disabled = true; btn.textContent = "Approvingâ€¦";

  try {
    const r = await Api.approveVisitorSecurity(id);
    toast(`âœ… Approved. Code: ${r.code}`);
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
  btn.disabled = true; btn.textContent = "Approving & sending emailsâ€¦";

  try {
    const r = await Api.bulkApproveSecurity(ids);
    const emailsMsg = r.emailsSent !== undefined
      ? ` Â· Emails: ${r.emailsSent} sent${r.emailsFailed ? ` Â· ${r.emailsFailed} failed` : ""}`
      : "";
    toast(`âœ… Approved: ${r.ok}${r.failed ? ` Â· Failed: ${r.failed}` : ""}${emailsMsg}`);

    if (r.failed > 0)     console.warn("[bulk-approve-security] failures:", r.failures);
    if (r.emailFailures && r.emailFailures.length) {
      console.warn("[bulk-approve-security] email failures:", r.emailFailures);
    }

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
  btn.disabled = true; btn.textContent = "Denyingâ€¦";

  try {
    const r = await Api.bulkDenyVisitors(ids, reason);
    toast(`âŒ Denied: ${r.ok}${r.failed ? ` Â· Failed: ${r.failed}` : ""}`);
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

  document.getElementById("confirm-all-text").innerHTML = `
    This will approve <b>${willDo}</b> pending pre-registration${willDo === 1 ? "" : "s"}
    (out of ${total} total${total > SV_MAX_BULK ? `, capped at ${SV_MAX_BULK} per click` : ""}).
    Each will generate a 6-digit code and email the visitor and host.
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
  btn.disabled = true; btn.textContent = "Approvingâ€¦";

  try {
    const r = await Api.bulkApproveAllSecurity("APPROVE ALL", SV_MAX_BULK);
    const emailsMsg = r.emailsSent !== undefined
      ? ` Â· Emails: ${r.emailsSent} sent${r.emailsFailed ? ` Â· ${r.emailsFailed} failed` : ""}`
      : "";
    toast(`âœ… Approved ${r.ok}${r.failed ? ` Â· Failed ${r.failed}` : ""}${emailsMsg} Â· ${r.remaining} remaining`);

    if (r.failed > 0)     console.warn("[approve-all-security] failures:", r.failures);
    if (r.emailFailures && r.emailFailures.length) {
      console.warn("[approve-all-security] email failures:", r.emailFailures);
    }

    closeConfirmAllModal();
    svState.selected.clear();
    await loadTiles();
    await loadApprovals();
  } catch (err) {
    toast(err.message || "Bulk approval failed.");
  } finally {
    btn.disabled = false; btn.textContent = "Approve all";
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
      <p><b>House:</b> ${escapeHtml(g.house_number)} Â· <b>Host:</b> ${escapeHtml(g.resident_name)} (${escapeHtml(g.resident_phone)})</p>
      <p><b>Purpose:</b> ${escapeHtml(g.purpose || "â€”")}</p>
      <p><b>Status:</b> ${statusBadge(g.status)}</p>
      ${g.access_code ? `<p><b>Code:</b> <span style="font-family:monospace;font-size:1.4rem;">${escapeHtml(g.access_code)}</span></p>` : ""}
      <h3>Visitors</h3>
      <ul style="padding-left:20px;">
        ${(g.visitors || []).map((v) => `
          <li style="margin-bottom:6px;">
            <b>${escapeHtml(v.name)}</b>
            ${v.phone ? " Â· " + escapeHtml(v.phone) : ""}
            ${v.email ? " Â· " + escapeHtml(v.email) : ""}
            ${v.vehicles && v.vehicles.length
              ? "<br><small>" + v.vehicles.map((veh) =>
                  `${escapeHtml(veh.type)}: ${escapeHtml(veh.plate)}`).join(" Â· ") + "</small>"
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
  } catch (err) {
    toast(err.message || "Could not load.");
  }
}

/* ------------------------------------------------------------
   Today's list â€” per-visitor rows
   ------------------------------------------------------------ */
async function loadToday() {
  const el = document.getElementById("today-list");
  const date = document.getElementById("today-date").value;
  const q = document.getElementById("today-q").value.trim();

  if (!date) { el.innerHTML = `<div class="empty-state">Pick a date.</div>`; return; }
  el.innerHTML = `<div class="empty-state">Loadingâ€¦</div>`;

  let result;
  try {
    result = await Api.getVisitorGroups({ date, q, limit: 200 });
  } catch (err) {
    el.innerHTML = `<div class="empty-state" style="color:var(--clay)">Could not load: ${escapeHtml(err.message)}</div>`;
    return;
  }

  if (!result.data.length) {
    el.innerHTML = `<div class="empty-state">No visitors found for ${escapeHtml(date)}.</div>`;
    return;
  }

  const groupsWithVisitors = await Promise.all(result.data.map(async (g) => {
    try {
      const detail = await Api.getVisitorGroup(g.id);
      return { group: g, visitors: detail.visitors || [] };
    } catch {
      return { group: g, visitors: [] };
    }
  }));

  el.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>House</th>
            <th>Visitor</th>
            <th>Vehicle</th>
            <th>Code</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${groupsWithVisitors.map(({ group: g, visitors }) => {
            const onSiteCount = visitors.filter((v) => v.status === "checked_in").length;
            const groupHeader = visitors.length > 1 ? `
              <tr style="background:var(--paper-dim);">
                <td colspan="7" style="font-size:0.85rem;color:var(--ink-70);padding:8px 16px;">
                  <b>Group #${g.id}</b> Â· ${visitors.length} visitors Â·
                  ${onSiteCount} on-site
                  ${onSiteCount > 0
                    ? `<button class="btn btn--ghost btn--small" data-out-all="${g.id}" style="margin-left:8px;">
                         Check out all remaining
                       </button>`
                    : ""}
                  <button class="btn btn--ghost btn--small" data-view="${g.id}" style="margin-left:4px;">View group</button>
                </td>
              </tr>
            ` : "";

            const visitorRows = visitors.map((v) => {
              const vehicles = (v.vehicles || []).map((veh) =>
                `${escapeHtml(veh.plate)}${veh.driver ? " (" + escapeHtml(veh.driver) + ")" : ""}`
              ).join(", ") || "â€”";

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
                  <td>${escapeHtml(g.expected_time_hhmm || "â€”")}</td>
                  <td>${escapeHtml(g.house_number)}</td>
                  <td>${escapeHtml(v.name)}</td>
                  <td>${vehicles}</td>
                  <td><b style="font-family:monospace;">${escapeHtml(g.access_code || "â€”")}</b></td>
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
  } catch (err) {
    toast(err.message || "Could not check in.");
  }
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
  } catch (err) {
    toast(err.message || "Could not check out.");
  }
}

async function checkoutGroup(groupId) {
  if (!confirm("Check out all visitors still on-site in this group?")) return;
  try {
    await Api.checkoutVisitor({ groupId });
    toast("All remaining visitors checked out.");
    await loadTiles();
    await loadToday();
  } catch (err) {
    toast(err.message || "Could not check out group.");
  }
}

/* Group-level wrappers for search tab */
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
  const q = document.getElementById("ci-search").value.trim();
  const el = document.getElementById("ci-result");
  if (!q) { el.innerHTML = ""; return; }

  el.innerHTML = `<div class="empty-state">Searchingâ€¦</div>`;

  try {
    const r = await Api.getVisitorGroups({ q, limit: 20 });
    if (!r.data.length) {
      el.innerHTML = `<div class="empty-state">No matching visit found.</div>`;
      return;
    }

    const g = r.data[0];
    el.innerHTML = `
      <div class="alert-card" style="max-width:640px;">
        <div class="alert-card__head">Match: Visit #${g.id}</div>
        <div class="alert-card__body">
          <p><b>House:</b> ${escapeHtml(g.house_number)} Â· <b>Host:</b> ${escapeHtml(g.resident_name)}</p>
          <p><b>Date:</b> ${escapeHtml(fmtDate(g.visit_date))}</p>
          <p><b>Code:</b> <span style="font-family:monospace;font-size:1.4rem;">${escapeHtml(g.access_code || "â€”")}</span></p>
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
    el.innerHTML = `<div class="empty-state" style="color:var(--clay)">${escapeHtml(err.message)}</div>`;
  }
}

/* ------------------------------------------------------------
   Print register
   ------------------------------------------------------------ */
async function printRegister() {
  const date = document.getElementById("today-date").value;
  if (!date) { toast("Pick a date first."); return; }

  try {
    const rows = await Api.getVisitorRegister(date);
    if (!rows.length) { toast("No visitors for that date."); return; }

    const w = window.open("", "_blank");
    w.document.write(`
      <html><head><title>Visitor Register â€” ${date}</title>
      <style>
        body { font-family: -apple-system, sans-serif; padding: 24px; color:#111; }
        h1 { margin-bottom: 4px; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { text-align: left; padding: 8px; border-bottom: 1px solid #ccc; font-size: 13px; }
        th { background: #f3f3f3; }
        .code { font-family: monospace; font-weight: bold; font-size: 14px; }
      </style>
      </head><body>
        <h1>Visitor Register â€” ${date}</h1>
        <p>Athi Estate Access Â· Generated ${new Date().toLocaleString("en-KE")}</p>
        <table>
          <thead>
            <tr><th>Time</th><th>House</th><th>Host</th><th>Visitor</th><th>Phone</th><th>Vehicle</th><th>Code</th><th>In</th><th>Out</th></tr>
          </thead>
          <tbody>
            ${rows.flatMap((g) =>
              g.visitors.map((v) => `
                <tr>
                  <td>${escapeHtml(g.expected_time_hhmm || "â€”")}</td>
                  <td>${escapeHtml(g.house_number)}</td>
                  <td>${escapeHtml(g.resident_name)}</td>
                  <td>${escapeHtml(v.name)}</td>
                  <td>${escapeHtml(v.phone || "â€”")}</td>
                  <td>${v.vehicles && v.vehicles.length ? v.vehicles.map((veh) => escapeHtml(veh.plate)).join(", ") : "â€”"}</td>
                  <td class="code">${escapeHtml(g.access_code || "â€”")}</td>
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
  } catch (err) {
    toast(err.message || "Could not load register.");
  }
}

/* ------------------------------------------------------------
   Init
   ------------------------------------------------------------ */
document.addEventListener("DOMContentLoaded", async () => {
  if (typeof requireRole === "function" && !requireRole("security", "admin", "super-admin")) return;

  setupTabs();

  /* Today date default */
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById("today-date").value = today;

  /* Bulk bar buttons */
  const bulkApproveBtn = document.getElementById("bulk-approve-btn");
  const bulkDenyBtn    = document.getElementById("bulk-deny-btn");
  const bulkClearBtn   = document.getElementById("bulk-clear-btn");
  const approveAllBtn  = document.getElementById("btn-approve-all");

  if (bulkApproveBtn) bulkApproveBtn.addEventListener("click", bulkApproveSelected);
  if (bulkDenyBtn)    bulkDenyBtn.addEventListener("click", bulkDenySelected);
  if (bulkClearBtn)   bulkClearBtn.addEventListener("click", () => {
    svState.selected.clear();
    document.querySelectorAll(".chk-row").forEach((chk) => (chk.checked = false));
    updateBulkBar();
  });
  if (approveAllBtn)  approveAllBtn.addEventListener("click", openConfirmAllModal);

  /* Confirm-all modal */
  document.getElementById("confirm-all-cancel").addEventListener("click", closeConfirmAllModal);
  document.getElementById("confirm-all-go").addEventListener("click", approveAllPending);

  /* Today tab */
  document.getElementById("btn-refresh-today").addEventListener("click", loadToday);
  document.getElementById("btn-print-register").addEventListener("click", printRegister);

  /* Check-in / out search */
  document.getElementById("btn-ci-search").addEventListener("click", searchCheckin);
  document.getElementById("ci-search").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); searchCheckin(); }
  });

  /* Load everything */
  await loadTiles();
  await loadApprovals();
  await loadToday();
});