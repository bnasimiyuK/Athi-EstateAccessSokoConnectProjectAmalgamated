/* ============================================================
   admin-visitors.js — admin stage-1 approval + audit list
   ============================================================ */

const AV_PER_PAGE = 50;
const avState = {
  page: 1, limit: AV_PER_PAGE, total: 0, totalPages: 1,
  status: "", q: "",
};

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
    const [pending, pendingSec, all30] = await Promise.all([
      Api.getVisitorPendingAdmin(),
      Api.getVisitorPendingSecurity(),
      Api.getVisitorGroups({ from: new Date(Date.now() - 30*864e5).toISOString().slice(0,10), limit: 500 }),
    ]);
    document.getElementById("tile-pending").textContent     = pending.length;
    document.getElementById("tile-pending-sec").textContent = pendingSec.length;

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
   Pending approvals
   ------------------------------------------------------------ */
async function loadPending() {
  const el = document.getElementById("pending-list");
  el.innerHTML = `<div class="empty-state">Loading…</div>`;

  let rows;
  try {
    rows = await Api.getVisitorPendingAdmin();
  } catch (err) {
    el.innerHTML = `<div class="empty-state" style="color:var(--clay)">Could not load: ${escapeHtml(err.message)}</div>`;
    return;
  }

  document.getElementById("count-pending").textContent = rows.length ? `(${rows.length})` : "";

  if (!rows.length) {
    el.innerHTML = `<div class="empty-state">No pre-registrations waiting for admin approval.</div>`;
    return;
  }

  el.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Submitted</th><th>Visit date</th><th>House</th><th>Host</th>
            <th>Visitors</th><th>Purpose</th><th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((g) => `
            <tr data-id="${g.id}">
              <td>${escapeHtml(fmtDate(g.created_at))}</td>
              <td><b>${escapeHtml(fmtDate(g.visit_date))}</b>${g.expected_time ? " " + escapeHtml(String(g.expected_time).slice(0,5)) : ""}</td>
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

  el.querySelectorAll("[data-approve]").forEach((b) =>
    b.addEventListener("click", () => approve(b.dataset.approve, b))
  );
  el.querySelectorAll("[data-deny]").forEach((b) =>
    b.addEventListener("click", () => deny(b.dataset.deny))
  );
  el.querySelectorAll("[data-view]").forEach((b) =>
    b.addEventListener("click", () => viewDetails(b.dataset.view))
  );
}

async function approve(id, btn) {
  if (!confirm("Approve this visit at stage 1?\n\nSecurity will still need to approve at stage 2.")) return;
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = "Approving…";
  try {
    await Api.approveVisitorAdmin(id);
    toast("✅ Stage-1 approved. Waiting for security.");
    await loadTiles(); await loadPending(); await loadAll();
  } catch (err) {
    toast(err.message || "Could not approve.");
  } finally {
    btn.disabled = false; btn.textContent = old;
  }
}

async function deny(id) {
  const reason = prompt("Reason for denial (will be sent to resident):");
  if (reason === null) return;
  try {
    await Api.denyVisitor(id, reason);
    toast("Denied. Resident notified.");
    await loadTiles(); await loadPending(); await loadAll();
  } catch (err) {
    toast(err.message || "Could not deny.");
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
      status: avState.status, q: avState.q,
      page: avState.page, limit: avState.limit,
    });
  } catch (err) {
    el.innerHTML = `<div class="empty-state" style="color:var(--clay)">Could not load: ${escapeHtml(err.message)}</div>`;
    return;
  }

  avState.total      = result.total;
  avState.page       = result.page;
  avState.totalPages = result.totalPages;

  if (!result.data.length) {
    el.innerHTML = `<div class="empty-state">No visits match your filter.</div>`;
    renderPagination();
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
  renderPagination();
}

function renderPagination() {
  const el = document.getElementById("all-pagination");
  const { page, limit, total, totalPages } = avState;
  if (!total) { el.innerHTML = ""; return; }
  const startRow = (page - 1) * limit + 1;
  const endRow   = Math.min(page * limit, total);

  el.innerHTML = `
    <div class="pagination" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-top:18px;padding:12px 4px;border-top:1px solid var(--line);">
      <div style="font-size:0.9rem;color:var(--ink-70);">
        Showing <b>${startRow}–${endRow}</b> of <b>${total}</b>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button class="btn btn--ghost btn--small" data-av-page="prev" ${page <= 1 ? "disabled" : ""}>« Prev</button>
        <span style="font-size:0.9rem;color:var(--ink-70);padding:0 4px;">Page <b>${page}</b> of <b>${totalPages}</b></span>
        <button class="btn btn--ghost btn--small" data-av-page="next" ${page >= totalPages ? "disabled" : ""}>Next »</button>
      </div>
    </div>
  `;
  el.querySelectorAll("[data-av-page]").forEach((b) => {
    b.addEventListener("click", () => {
      if (b.dataset.avPage === "prev" && avState.page > 1) avState.page--;
      if (b.dataset.avPage === "next" && avState.page < avState.totalPages) avState.page++;
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
  if (typeof requireRole === "function" && !requireRole("admin")) return;

  setupTabs();

  document.getElementById("all-filter").addEventListener("submit", (e) => {
    e.preventDefault();
    avState.status = document.getElementById("filter-status").value;
    avState.q      = document.getElementById("filter-q").value.trim();
    avState.page   = 1;
    loadAll();
  });

  document.getElementById("filter-clear").addEventListener("click", () => {
    document.getElementById("filter-status").value = "";
    document.getElementById("filter-q").value = "";
    avState.status = ""; avState.q = ""; avState.page = 1;
    loadAll();
  });

  await loadTiles();
  await loadPending();
  await loadAll();
});