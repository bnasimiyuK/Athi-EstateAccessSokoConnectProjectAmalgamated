/* ============================================================
   security-visitors.js — security role dashboard
   Tabs: approvals | today | check-in/out
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
    checked_in:       `<span class="badge" style="background:#2f6f5e;color:#fff;">Checked in</span>`,
    completed:        `<span class="badge" style="background:#2f6f5e;color:#fff;">Completed</span>`,
    expired:          `<span class="badge" style="background:#b0472e;color:#fff;">Expired</span>`,
  };
  return map[s] || escapeHtml(s);
}

/* ------------------------------------------------------------
   Tabs
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
   Summary tiles — now uses live-stats endpoint
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
   Approvals
   ------------------------------------------------------------ */
async function loadApprovals() {
  const el = document.getElementById("approvals-list");
  el.innerHTML = `<div class="empty-state">Loading…</div>`;

  let rows;
  try {
    rows = await Api.getVisitorPendingSecurity();
  } catch (err) {
    el.innerHTML = `<div class="empty-state" style="color:var(--clay)">Could not load: ${escapeHtml(err.message)}</div>`;
    return;
  }

  const countEl = document.getElementById("count-approvals");
  if (countEl) countEl.textContent = rows.length ? `(${rows.length})` : "";

  if (!rows.length) {
    el.innerHTML = `<div class="empty-state">No pre-registrations waiting for security approval.</div>`;
    return;
  }

  el.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Visit date</th><th>Time</th><th>House</th><th>Host</th>
            <th>Visitors</th><th>Purpose</th><th>Admin approved</th><th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((g) => `
            <tr data-id="${g.id}">
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

  el.querySelectorAll("[data-approve]").forEach((b) =>
    b.addEventListener("click", () => approve(g(b), b))
  );
  el.querySelectorAll("[data-deny]").forEach((b) =>
    b.addEventListener("click", () => deny(b.dataset.deny))
  );
  el.querySelectorAll("[data-view]").forEach((b) =>
    b.addEventListener("click", () => viewDetails(b.dataset.view))
  );

  function g(btn) { return btn.dataset.approve; }
}

async function approve(id, btn) {
  if (!confirm("Approve this visit?\n\nThe 6-digit access code will be generated and emailed to the visitor and host.")) return;
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = "Approving…";

  try {
    const r = await Api.approveVisitorSecurity(id);
    toast(`✅ Approved. Code: ${r.code}`);
    await loadTiles();
    await loadApprovals();
  } catch (err) {
    toast(err.message || "Could not approve.");
  } finally {
    btn.disabled = false; btn.textContent = old;
  }
}

async function deny(id) {
  const reason = prompt("Reason for denial:");
  if (reason === null) return;
  try {
    await Api.denyVisitor(id, reason);
    toast("Denied.");
    await loadTiles();
    await loadApprovals();
  } catch (err) {
    toast(err.message || "Could not deny.");
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
  } catch (err) {
    toast(err.message || "Could not load.");
  }
}

/* ------------------------------------------------------------
   Today's list
   ------------------------------------------------------------ */
async function loadToday() {
  const el = document.getElementById("today-list");
  const date = document.getElementById("today-date").value;
  const q = document.getElementById("today-q").value.trim();

  if (!date) { el.innerHTML = `<div class="empty-state">Pick a date.</div>`; return; }
  el.innerHTML = `<div class="empty-state">Loading…</div>`;

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

  el.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Time</th><th>House</th><th>Host</th><th>Visitors</th>
            <th>Code</th><th>Status</th><th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${result.data.map((g) => `
            <tr>
              <td>${escapeHtml(g.expected_time_hhmm || "—")}</td>
              <td>${escapeHtml(g.house_number)}</td>
              <td>${escapeHtml(g.resident_name)}</td>
              <td>${g.headcount}</td>
              <td><b style="font-family:monospace;">${escapeHtml(g.access_code || "—")}</b></td>
              <td>${statusBadge(g.status)}</td>
              <td>
                ${g.status === "approved"   ? `<button class="btn btn--accent btn--small" data-in="${g.id}">Check in</button>` : ""}
                ${g.status === "checked_in" ? `<button class="btn btn--accent btn--small" data-out="${g.id}">Check out</button>` : ""}
                <button class="btn btn--ghost btn--small" data-view="${g.id}">View</button>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;

  el.querySelectorAll("[data-in]").forEach((b) => b.addEventListener("click", () => checkin(b.dataset.in)));
  el.querySelectorAll("[data-out]").forEach((b) => b.addEventListener("click", () => checkout(b.dataset.out)));
  el.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => viewDetails(b.dataset.view)));
}

async function checkin(id) {
  if (!confirm("Check in this visitor?")) return;
  try {
    await Api.checkinVisitor({ groupId: id });
    toast("Checked in.");
    await loadTiles(); await loadToday();
  } catch (err) { toast(err.message || "Could not check in."); }
}

async function checkout(id) {
  if (!confirm("Check out this visitor?")) return;
  try {
    await Api.checkoutVisitor({ groupId: id });
    toast("Checked out.");
    await loadTiles(); await loadToday();
  } catch (err) { toast(err.message || "Could not check out."); }
}

/* ------------------------------------------------------------
   Check-in search
   ------------------------------------------------------------ */
async function searchCheckin() {
  const q = document.getElementById("ci-search").value.trim();
  const el = document.getElementById("ci-result");
  if (!q) { el.innerHTML = ""; return; }

  el.innerHTML = `<div class="empty-state">Searching…</div>`;

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
      <html><head><title>Visitor Register — ${date}</title>
      <style>
        body { font-family: -apple-system, sans-serif; padding: 24px; color:#111; }
        h1 { margin-bottom: 4px; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { text-align: left; padding: 8px; border-bottom: 1px solid #ccc; font-size: 13px; }
        th { background: #f3f3f3; }
        .code { font-family: monospace; font-weight: bold; font-size: 14px; }
      </style>
      </head><body>
        <h1>Visitor Register — ${date}</h1>
        <p>Athi Estate Access · Generated ${new Date().toLocaleString("en-KE")}</p>
        <table>
          <thead>
            <tr><th>Time</th><th>House</th><th>Host</th><th>Visitor</th><th>Phone</th><th>Vehicle</th><th>Code</th><th>In</th><th>Out</th></tr>
          </thead>
          <tbody>
            ${rows.flatMap((g) =>
              g.visitors.map((v) => `
                <tr>
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
  } catch (err) {
    toast(err.message || "Could not load register.");
  }
}

/* ------------------------------------------------------------
   Init
   ------------------------------------------------------------ */
document.addEventListener("DOMContentLoaded", async () => {
  if (typeof requireRole === "function" && !requireRole("security", "admin")) return;

  /* Tabs */
  setupTabs();

  /* Today date default */
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById("today-date").value = today;

  /* Wire buttons */
  document.getElementById("btn-refresh-today").addEventListener("click", loadToday);
  document.getElementById("btn-print-register").addEventListener("click", printRegister);
  document.getElementById("btn-ci-search").addEventListener("click", searchCheckin);
  document.getElementById("ci-search").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); searchCheckin(); }
  });

  /* Load everything */
  await loadTiles();
  await loadApprovals();
  await loadToday();
});