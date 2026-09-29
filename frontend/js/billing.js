/* ============================================================
   billing.js — resident view: invoices + payments + self-report
   ============================================================ */

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function invBadge(status) {
  const map = {
    paid:    `<span class="badge badge--verified">Paid</span>`,
    unpaid:  `<span class="badge" style="background:#c8862a;color:#fff;">Unpaid</span>`,
    partial: `<span class="badge" style="background:#4a7ba7;color:#fff;">Partial</span>`,
    overdue: `<span class="badge" style="background:#b0472e;color:#fff;">Overdue</span>`,
  };
  return map[status] || escapeHtml(status);
}

function payBadge(status) {
  const map = {
    pending:  `<span class="badge" style="background:#c8862a;color:#fff;">Pending verification</span>`,
    verified: `<span class="badge badge--verified">Verified</span>`,
    rejected: `<span class="badge" style="background:#b0472e;color:#fff;">Rejected</span>`,
  };
  return map[status] || escapeHtml(status);
}

/* ------------------------------------------------------------
   Load billing settings (paybill instructions)
   ------------------------------------------------------------ */
async function loadSettings() {
  try {
    const s = await Api.getBillingSettings();
    document.getElementById("pb-business").textContent = s.paybillNumber;
    document.getElementById("pb-amount").textContent   = "KSh " + Number(s.monthlyFee).toLocaleString();
    document.getElementById("pb-name").textContent     = "VICTOR/DOUGLAS/ISAAC";
  } catch (err) {
    console.error("[billing] settings failed:", err);
  }
}

/* ------------------------------------------------------------
   Load me (for house number)
   ------------------------------------------------------------ */
async function loadMe() {
  try {
    const me = await Api.me();
    const hno = me.houseNumber || "Not assigned";
    document.getElementById("my-house").textContent = hno;
    document.getElementById("pb-account").textContent = me.houseNumber || "(assigned by admin)";
  } catch (err) {
    console.error("[billing] me failed:", err);
  }
}

/* ------------------------------------------------------------
   Load invoices + compute status
   ------------------------------------------------------------ */
async function loadInvoices() {
  const wrap = document.getElementById("my-invoices");
  wrap.innerHTML = `<div class="empty-state">Loading invoices…</div>`;

  let invs;
  try {
    invs = await Api.getMyInvoices();
  } catch (err) {
    wrap.innerHTML = `<div class="empty-state" style="color:var(--clay)">Could not load: ${escapeHtml(err.message)}</div>`;
    return;
  }

  /* Compute aggregate status */
  const totalDue  = invs.reduce((s, i) => s + Number(i.amountDue), 0);
  const totalPaid = invs.reduce((s, i) => s + Number(i.amountPaid), 0);
  const balance   = totalDue - totalPaid;
  const hasOverdue = invs.some((i) => i.status === "overdue");

  const statusEl = document.getElementById("my-status");
  const tileEl   = document.getElementById("my-status-tile");
  tileEl.className = "stat-tile " + (hasOverdue ? "stat-tile--danger"
                        : balance > 0      ? "stat-tile--warn"
                        : "stat-tile--ok");
  statusEl.textContent = hasOverdue ? "Overdue" : balance > 0 ? "Outstanding" : "Paid up";

  document.getElementById("my-balance").textContent = balance.toLocaleString();

  if (!invs.length) {
    wrap.innerHTML = `<div class="empty-state">No invoices yet. Admin will generate them.</div>`;
    return;
  }

  wrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Month</th>
          <th>Amount due</th>
          <th>Amount paid</th>
          <th>Balance</th>
          <th>Due date</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${invs.map((i) => `
          <tr>
            <td><b>${escapeHtml(i.billingMonth)}</b></td>
            <td>KSh ${Number(i.amountDue).toLocaleString()}</td>
            <td>KSh ${Number(i.amountPaid).toLocaleString()}</td>
            <td>KSh ${Number(i.balance).toLocaleString()}</td>
            <td>${escapeHtml(String(i.dueDate).slice(0, 10))}</td>
            <td>${invBadge(i.status)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

/* ------------------------------------------------------------
   Load payments
   ------------------------------------------------------------ */
async function loadPayments() {
  const wrap = document.getElementById("my-payments");
  wrap.innerHTML = `<div class="empty-state">Loading payments…</div>`;

  let pays;
  try {
    pays = await Api.getMyPayments();
  } catch (err) {
    wrap.innerHTML = `<div class="empty-state" style="color:var(--clay)">Could not load: ${escapeHtml(err.message)}</div>`;
    return;
  }

  if (!pays.length) {
    wrap.innerHTML = `<div class="empty-state">No payments recorded yet.</div>`;
    return;
  }

  wrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Amount</th>
          <th>Receipt</th>
          <th>For month</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${pays.map((p) => `
          <tr>
            <td>${escapeHtml(String(p.paymentDate).slice(0, 10))}</td>
            <td>KSh ${Number(p.amount).toLocaleString()}</td>
            <td>${escapeHtml(p.mpesaReceipt || "—")}</td>
            <td>${escapeHtml(p.invoiceMonth || "—")}</td>
            <td>${payBadge(p.status)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

/* ------------------------------------------------------------
   Init
   ------------------------------------------------------------ */
document.addEventListener("DOMContentLoaded", async () => {
  if (typeof requireAuth === "function" && !requireAuth()) return;

  await Promise.all([loadSettings(), loadMe()]);
  await Promise.all([loadInvoices(), loadPayments()]);

  const modal = document.getElementById("report-modal");

  document.getElementById("btn-report-payment").addEventListener("click", () => {
    modal.style.display = "flex";
    document.getElementById("rp-date").value = new Date().toISOString().slice(0, 10);
  });

  document.getElementById("rp-cancel").addEventListener("click", () => {
    modal.style.display = "none";
    document.getElementById("report-form").reset();
  });

  document.getElementById("report-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("rp-submit");
    btn.disabled = true; btn.textContent = "Submitting…";

    try {
      await Api.selfReportPayment({
        amount:       Number(document.getElementById("rp-amount").value),
        mpesaReceipt: document.getElementById("rp-receipt").value.trim(),
        mpesaPhone:   document.getElementById("rp-phone").value.trim() || null,
        paymentDate:  document.getElementById("rp-date").value || null,
      });
      toast("✅ Submitted. Admin will verify shortly.");
      modal.style.display = "none";
      document.getElementById("report-form").reset();
      await Promise.all([loadInvoices(), loadPayments()]);
    } catch (err) {
      toast(err.message || "Could not submit.");
    } finally {
      btn.disabled = false; btn.textContent = "Submit";
    }
  });
});