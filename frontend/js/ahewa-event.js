/* ============================================================
   ahewa-event.js — Event detail page
   Renders full matrix for admins + signatories,
   limited view for regular residents.
   ============================================================ */

const API = API_BASE;

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" });
}

function fmtDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" });
}

function fmtMoney(n) {
  return "KSh " + Number(n || 0).toLocaleString();
}

async function authFetch(path, options = {}) {
  const token = localStorage.getItem("asc_token");
  const headers = {
    "Content-Type": "application/json",
    Authorization: "Bearer " + (token || ""),
    ...(options.headers || {}),
  };
  const res = await fetch(API + path, { ...options, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function getEventId() {
  const params = new URLSearchParams(window.location.search);
  const id = parseInt(params.get("id"), 10);
  return isNaN(id) ? null : id;
}

function currentUserId() {
  try {
    const token = localStorage.getItem("asc_token");
    if (!token) return null;
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.id || null;
  } catch { return null; }
}

function currentUserRole() {
  try {
    const token = localStorage.getItem("asc_token");
    if (!token) return null;
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.role || null;
  } catch { return null; }
}

/* ============================================================
   RENDER — Event header (both modes)
   ============================================================ */
function renderHeader(d) {
  const e = d.event;
  const el = document.getElementById("event-header");
  const typeLabel = e.event_type === "PRINCIPAL" ? "Deceased principal" : "Deceased dependant";

  let statusBadge = "";
  if (d.access === "full") {
    statusBadge = e.is_disbursed
      ? `<span class="badge" style="background:#d1fae5;color:#065f46;">Disbursed</span>`
      : (d.is_fully_approved
        ? `<span class="badge" style="background:#fef3c7;color:#92400e;">Approved — pending disbursement</span>`
        : `<span class="badge badge--pending">Open</span>`);
  }

  el.innerHTML = `
    <div class="page-head page-head--with-actions" style="padding-top:0;">
      <div class="page-head__text">
        <h1 style="font-size:1.6rem; margin-bottom:4px;">${escapeHtml(e.event_title)}</h1>
        <p style="margin:0;">
          ${escapeHtml(typeLabel)} · ${fmtMoney(e.contribution_amount)} per member · Event date: ${fmtDate(e.event_date)}
          <br>
          <small style="color:var(--ink-70);">
            Affected member: <b>${escapeHtml(e.affected_member_name)}</b>
            (${escapeHtml(e.affected_member_house || "—")}${e.affected_member_court ? ` · ${escapeHtml(e.affected_member_court)}` : ""})
          </small>
        </p>
        ${e.description ? `<p style="margin-top:8px;">${escapeHtml(e.description)}</p>` : ""}
      </div>
      <div style="flex-shrink:0;">${statusBadge}</div>
    </div>
  `;
}

/* ============================================================
   RENDER — Limited view (regular resident)
   ============================================================ */
function renderLimitedView(d) {
  const container = document.getElementById("contrib-stats");
  const tableWrap = document.getElementById("contrib-table");
  const approvals = document.getElementById("approvals-panel");
  const exportsSection = document.getElementById("exports-section");

  // Hide admin-only sections
  approvals.parentElement.style.display = "none";
  if (exportsSection) exportsSection.style.display = "none";

  const me = d.my_contribution;

  // If resident isn't billed (e.g. they're the affected member), show a message
  if (!me) {
    document.getElementById("contrib-stats").innerHTML = "";
    document.getElementById("contrib-table").innerHTML = `
      <div class="empty-state" style="padding: 40px;">
        <b>You are not required to contribute to this event.</b>
        <br><br>
        ${d.is_affected_member
          ? "This event was created for you — you are the affected member."
          : "You are not currently an AHEWA member or were not part of AHEWA when this event was created."}
      </div>
    `;
    return;
  }

  // Show their own contribution tile row
  const statusBadge = me.status === "paid"
    ? `<span class="badge badge--verified">Paid</span>`
    : (me.status === "partial"
      ? `<span class="badge badge--pending">Partial</span>`
      : `<span class="badge badge--declined">Unpaid</span>`);

  const remaining = Number(me.amount_due) - Number(me.amount_paid);

  document.getElementById("contrib-stats").innerHTML = `
    <div class="stat-tile stat-tile--info">
      <div class="stat-tile__value">${fmtMoney(me.amount_due)}</div>
      <div class="stat-tile__label">Your contribution</div>
    </div>
    <div class="stat-tile ${me.status === "paid" ? "stat-tile--ok" : "stat-tile--warn"}">
      <div class="stat-tile__value">${fmtMoney(me.amount_paid)}</div>
      <div class="stat-tile__label">Amount paid</div>
    </div>
    <div class="stat-tile ${remaining > 0 ? "stat-tile--danger" : "stat-tile--ok"}">
      <div class="stat-tile__value">${fmtMoney(remaining)}</div>
      <div class="stat-tile__label">Outstanding</div>
    </div>
  `;

  // Replace table with a single-row confirmation
  document.getElementById("contrib-table").innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Event</th>
          <th>Your share</th>
          <th>Paid</th>
          <th>Status</th>
          <th>Paid on</th>
          <th>Receipt</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${escapeHtml(d.event.event_title)}</td>
          <td>${fmtMoney(me.amount_due)}</td>
          <td>${fmtMoney(me.amount_paid)}</td>
          <td>${statusBadge}</td>
          <td>${me.paid_at ? fmtDate(me.paid_at) : "—"}</td>
          <td>${escapeHtml(me.last_receipt || "—")}</td>
        </tr>
      </tbody>
    </table>
  `;

  // Add "Pay" button if owing
  if (remaining > 0) {
    const payRow = document.createElement("div");
    payRow.style.marginTop = "20px";
    payRow.innerHTML = `
      <a href="billing.html" class="btn btn--accent" style="display:inline-flex; gap:8px;">
        💳 Pay ${fmtMoney(remaining)} via M-Pesa →
      </a>
      <p style="color:var(--ink-70); font-size:0.85rem; margin-top:8px;">
        You'll be redirected to your billing page to complete the payment.
      </p>
    `;
    document.getElementById("contrib-table").insertAdjacentElement("afterend", payRow);
  }
}

/* ============================================================
   RENDER — Full view (admin or signatory)
   ============================================================ */
function renderFullView(d) {
  // Contribution stats
  const billed = d.contributions.length;
  const paid = d.contributions.filter(c => c.status === "paid").length;
  const collected = d.contributions.reduce((s, c) => s + Number(c.amount_paid || 0), 0);
  const expected = d.contributions.reduce((s, c) => s + Number(c.amount_due || 0), 0);
  const outstanding = expected - collected;

  document.getElementById("contrib-stats").innerHTML = `
    <div class="stat-tile stat-tile--info">
      <div class="stat-tile__value">${billed}</div>
      <div class="stat-tile__label">Members billed</div>
    </div>
    <div class="stat-tile stat-tile--ok">
      <div class="stat-tile__value">${paid} / ${billed}</div>
      <div class="stat-tile__label">Paid</div>
    </div>
    <div class="stat-tile stat-tile--ok">
      <div class="stat-tile__value">${collected.toLocaleString()}</div>
      <div class="stat-tile__label">Collected (KSh)</div>
    </div>
    <div class="stat-tile stat-tile--warn">
      <div class="stat-tile__value">${outstanding.toLocaleString()}</div>
      <div class="stat-tile__label">Outstanding (KSh)</div>
    </div>
  `;

  // Contribution matrix
  document.getElementById("contrib-table").innerHTML = `
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Member</th>
          <th>House</th>
          <th>Amount due</th>
          <th>Amount paid</th>
          <th>Status</th>
          <th>Paid on</th>
          <th>Receipt</th>
        </tr>
      </thead>
      <tbody>
        ${d.contributions.map((c, i) => {
          const statusBadge = c.status === "paid"
            ? `<span class="badge badge--verified">Paid</span>`
            : (c.status === "partial"
              ? `<span class="badge badge--pending">Partial</span>`
              : `<span class="badge badge--declined">Unpaid</span>`);
          return `
            <tr>
              <td>${i + 1}</td>
              <td>${escapeHtml(c.full_name)}</td>
              <td>${escapeHtml(c.house_number || "—")}</td>
              <td>${fmtMoney(c.amount_due)}</td>
              <td>${fmtMoney(c.amount_paid)}</td>
              <td>${statusBadge}</td>
              <td>${c.paid_at ? fmtDate(c.paid_at) : "—"}</td>
              <td>${escapeHtml(c.last_receipt || "—")}</td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;

  // Approvals panel
  renderApprovals(d);
}

/* ============================================================
   RENDER — Signatory approvals panel (admin + signatory only)
   ============================================================ */
function renderApprovals(d) {
  const el = document.getElementById("approvals-panel");

  if (!d.all_signatories.length) {
    el.innerHTML = `<div class="empty-state">No signatories designated.</div>`;
    return;
  }

  const uid = currentUserId();
  const userRole = currentUserRole();
  const isResidentUser = userRole === "resident";
  const iAmSignatory = isResidentUser && d.all_signatories.some(s => s.resident_id === uid);
  const iAlreadyApproved = isResidentUser && d.approvals.some(a => a.signatory_id === uid);

  const sigRows = d.all_signatories.map(s => {
    const approval = d.approvals.find(a => a.signatory_id === s.resident_id);
    const isMe = isResidentUser && s.resident_id === uid;
    return `
      <div class="signatory-pill" style="border-left-color: ${approval ? 'var(--teal)' : 'var(--ochre)'};">
        <div class="signatory-pill__role">${escapeHtml(s.role)}${isMe ? " (you)" : ""}</div>
        <div class="signatory-pill__name">${escapeHtml(s.full_name)}</div>
        <div style="margin-top:6px; font-size:0.8rem;">
          ${approval
            ? `<span style="color:var(--teal); font-weight:600;">✅ Approved ${fmtDateTime(approval.approved_at)}</span>`
            : `<span style="color:var(--ochre-dark); font-weight:600;">⏳ Awaiting approval</span>`}
        </div>
      </div>
    `;
  }).join("");

  const canApprove = iAmSignatory && !iAlreadyApproved && !d.event.is_disbursed;
  const canMarkDisbursed = d.is_fully_approved && !d.event.is_disbursed;

  el.innerHTML = `
    <div class="signatories-strip" style="margin-bottom: 20px;">
      ${sigRows}
    </div>

    <div style="display:flex; gap:12px; flex-wrap:wrap;">
      ${canApprove
        ? `<button class="btn btn--accent" id="btn-approve">✍️ Approve disbursement (as ${escapeHtml(currentRoleFor(d, uid))})</button>`
        : (iAlreadyApproved && !d.event.is_disbursed
          ? `<div class="notice" style="display:inline-block; padding:10px 16px;">You have already approved. Waiting on the other signatories.</div>`
          : "")}
      ${canMarkDisbursed
        ? `<button class="btn btn--primary" id="btn-mark-disbursed">💰 Mark as disbursed</button>`
        : ""}
      ${d.event.is_disbursed
        ? `<div class="notice" style="display:inline-block; padding:10px 16px; background:var(--teal-tint); color:var(--teal);">
             ✅ Disbursed on ${fmtDate(d.event.disbursed_at)}
           </div>`
        : ""}
    </div>
  `;

  if (canApprove) {
    document.getElementById("btn-approve").addEventListener("click", () => approveDisbursement(d));
  }
  if (canMarkDisbursed) {
    document.getElementById("btn-mark-disbursed").addEventListener("click", () => markDisbursed(d));
  }
}

function currentRoleFor(d, uid) {
  const s = d.all_signatories.find(x => x.resident_id === uid);
  return s ? s.role : "Signatory";
}

/* ============================================================
   ACTIONS
   ============================================================ */
async function approveDisbursement(d) {
  const notes = prompt("Any note for the record? (optional)") || null;
  try {
    await authFetch(`/ahewa/events/${d.event.id}/approve-disbursement`, {
      method: "POST",
      body: JSON.stringify({ notes }),
    });
    toast("Approval recorded.");
    await load();
  } catch (err) {
    alert("Could not record approval: " + err.message);
  }
}

async function markDisbursed(d) {
  if (!confirm("Confirm that the funds have been disbursed to the affected member? This is a bookkeeping record — actual payment is external.")) return;
  const notes = prompt("Disbursement notes? (optional)") || null;
  try {
    await authFetch(`/ahewa/events/${d.event.id}/mark-disbursed`, {
      method: "POST",
      body: JSON.stringify({ notes }),
    });
    toast("Marked as disbursed.");
    await load();
  } catch (err) {
    alert("Could not mark disbursed: " + err.message);
  }
}

/* ============================================================
   EXPORTS (Excel + PDF) — admin + signatory only
   ============================================================ */
function setupExports() {
  const xlsx = document.getElementById("btn-export-xlsx");
  const pdf = document.getElementById("btn-export-pdf");
  const id = getEventId();
  if (!xlsx || !pdf) return;

  xlsx.addEventListener("click", async () => {
    try {
      xlsx.disabled = true;
      xlsx.textContent = "⏳ Preparing…";
      const token = localStorage.getItem("asc_token");
      const res = await fetch(`${API}/ahewa/events/${id}/export.xlsx`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await downloadBlob(res, `ahewa-event-${id}.xlsx`);
    } catch (err) {
      alert("Export failed: " + err.message);
    } finally {
      xlsx.disabled = false;
      xlsx.textContent = "📥 Excel";
    }
  });

  pdf.addEventListener("click", async () => {
    try {
      pdf.disabled = true;
      pdf.textContent = "⏳ Preparing…";
      const token = localStorage.getItem("asc_token");
      const res = await fetch(`${API}/ahewa/events/${id}/export.pdf`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await downloadBlob(res, `ahewa-event-${id}.pdf`);
    } catch (err) {
      alert("Export failed: " + err.message);
    } finally {
      pdf.disabled = false;
      pdf.textContent = "📄 PDF";
    }
  });
}

async function downloadBlob(res, filename) {
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ============================================================
   MAIN LOAD
   ============================================================ */
async function load() {
  const id = getEventId();
  if (!id) {
    document.body.innerHTML = "<p style='padding:40px;'>Invalid event id.</p>";
    return;
  }

  try {
    const d = await authFetch(`/ahewa/events/${id}`);
    renderHeader(d);

    if (d.access === "full") {
      renderFullView(d);
    } else {
      renderLimitedView(d);
    }
  } catch (err) {
    console.error("[ahewa-event] load failed:", err);
    document.getElementById("event-header").innerHTML =
      `<div class="empty-state" style="color:var(--clay);">Failed to load event: ${escapeHtml(err.message)}</div>`;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  if (typeof requireAuth === "function" && !requireAuth()) return;
  setupExports();
  await load();
});