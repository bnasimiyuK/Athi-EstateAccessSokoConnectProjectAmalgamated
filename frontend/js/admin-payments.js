/* ============================================================
   admin-payments.js — pending queue + manual entry
   ============================================================ */

const PAY_PER_PAGE = 20;
const payState = {
  page: 1, limit: PAY_PER_PAGE, total: 0, totalPages: 1,
  status: "pending", q: "",
};

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function payStatusBadge(status) {
  const map = {
    pending:  `<span class="badge" style="background:#c8862a;color:#fff;">Pending</span>`,
    verified: `<span class="badge badge--verified">Verified</span>`,
    rejected: `<span class="badge" style="background:#b0472e;color:#fff;">Rejected</span>`,
  };
  return map[status] || escapeHtml(status);
}

async function loadPaySummary() {
  try {
    const [pend, veri, rej] = await Promise.all([
      Api.getPayments({ status: "pending",  limit: 500 }),
      Api.getPayments({ status: "verified", limit: 500 }),
      Api.getPayments({ status: "rejected", limit: 500 }),
    ]);
    document.getElementById("tile-pending").textContent  = pend.total;
    document.getElementById("tile-verified").textContent = veri.total;
    document.getElementById("tile-rejected").textContent = rej.total;
  } catch (err) {
    console.error("[admin-payments] summary failed:", err);
  }
}

async function loadPayPayments() {
  const wrap = document.getElementById("payments-table-wrap");
  wrap.innerHTML = `<div class="empty-state">Loading payments…</div>`;

  let result;
  try {
    result = await Api.getPayments({
      status: payState.status,
      q:      payState.q,
      page:   payState.page,
      limit:  payState.limit,
    });
  } catch (err) {
    wrap.innerHTML = `<div class="empty-state" style="color:var(--clay)">Could not load: ${escapeHtml(err.message)}</div>`;
    return;
  }

  payState.total      = result.total;
  payState.page       = result.page;
  payState.totalPages = result.totalPages;

  if (!result.data.length) {
    wrap.innerHTML = `<div class="empty-state">No payments match this filter.</div>`;
    renderPayPagination();
    return;
  }

  wrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Date</th><th>House #</th><th>Resident</th>
          <th>Amount</th><th>Receipt</th><th>Month</th>
          <th>Status</th><th>Action</th>
        </tr>
      </thead>
      <tbody>
        ${result.data.map((p) => `
          <tr data-id="${p.id}">
            <td>${escapeHtml(String(p.paymentDate).slice(0, 10))}</td>
            <td>${escapeHtml(p.houseNumber)}</td>
            <td>${escapeHtml(p.residentName || "—")}</td>
            <td>KSh ${Number(p.amount).toLocaleString()}</td>
            <td>${escapeHtml(p.mpesaReceipt || "—")}</td>
            <td>${escapeHtml(p.invoiceMonth || "—")}</td>
            <td>${payStatusBadge(p.status)}</td>
            <td>
              ${p.status === "pending" ? `
                <button class="btn btn--accent btn--small" data-verify="${p.id}">✓ Verify</button>
                <button class="btn btn--danger btn--small" data-reject="${p.id}">✕ Reject</button>
              ` : `<span class="meta">${escapeHtml(p.status)}</span>`}
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  wrap.querySelectorAll("[data-verify]").forEach((b) =>
    b.addEventListener("click", () => verifyPay(b.dataset.verify))
  );
  wrap.querySelectorAll("[data-reject]").forEach((b) =>
    b.addEventListener("click", () => rejectPay(b.dataset.reject))
  );

  renderPayPagination();
}

async function verifyPay(id) {
  if (!confirm("Verify this payment? It will be allocated to the oldest unpaid invoice.")) return;
  try {
    const r = await Api.verifyPayment(id);
    toast(r.invoiceId ? `Verified & allocated to invoice #${r.invoiceId}` : "Verified.");
    await loadPaySummary();
    await loadPayPayments();
  } catch (err) {
    toast(err.message || "Verify failed.");
  }
}

async function rejectPay(id) {
  const reason = prompt("Rejection reason (optional):");
  if (reason === null) return;
  try {
    await Api.rejectPayment(id, reason);
    toast("Payment rejected.");
    await loadPaySummary();
    await loadPayPayments();
  } catch (err) {
    toast(err.message || "Reject failed.");
  }
}

function renderPayPagination() {
  const el = document.getElementById("payments-pagination");
  const { page, limit, total, totalPages } = payState;
  if (!total) { el.innerHTML = ""; return; }

  const startRow = (page - 1) * limit + 1;
  const endRow   = Math.min(page * limit, total);

  el.innerHTML = `
    <div class="pagination" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-top:18px;padding:12px 4px;border-top:1px solid var(--line);">
      <div style="font-size:0.9rem;color:var(--ink-70);">
        Showing <b>${startRow}–${endRow}</b> of <b>${total}</b>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button class="btn btn--ghost btn--small" data-pay-page="prev" ${page <= 1 ? "disabled" : ""}>« Prev</button>
        <span style="font-size:0.9rem;color:var(--ink-70);padding:0 4px;">Page <b>${page}</b> of <b>${totalPages}</b></span>
        <button class="btn btn--ghost btn--small" data-pay-page="next" ${page >= totalPages ? "disabled" : ""}>Next »</button>
      </div>
    </div>
  `;

  el.querySelectorAll("[data-pay-page]").forEach((b) => {
    b.addEventListener("click", () => {
      if (b.dataset.payPage === "prev" && payState.page > 1) payState.page--;
      if (b.dataset.payPage === "next" && payState.page < payState.totalPages) payState.page++;
      loadPayPayments();
    });
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  if (typeof requireRole === "function" && !requireRole("admin")) return;

  const urlStatus = new URLSearchParams(location.search).get("status");
  if (urlStatus) {
    document.getElementById("filter-status").value = urlStatus;
    payState.status = urlStatus;
  }

  await loadPaySummary();
  await loadPayPayments();

  document.getElementById("payments-filter").addEventListener("submit", (e) => {
    e.preventDefault();
    payState.status = document.getElementById("filter-status").value;
    payState.q      = document.getElementById("filter-q").value.trim();
    payState.page   = 1;
    loadPayPayments();
  });

  document.getElementById("filter-clear").addEventListener("click", () => {
    document.getElementById("filter-status").value = "pending";
    document.getElementById("filter-q").value = "";
    payState.status = "pending"; payState.q = ""; payState.page = 1;
    loadPayPayments();
  });

  const modal = document.getElementById("manual-payment-modal");

  document.getElementById("btn-manual-payment").addEventListener("click", () => {
    modal.style.display = "flex";
    document.getElementById("mp-date").value = new Date().toISOString().slice(0, 10);
  });

  document.getElementById("mp-cancel").addEventListener("click", () => {
    modal.style.display = "none";
    document.getElementById("manual-payment-form").reset();
  });

  document.getElementById("manual-payment-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("mp-submit");
    btn.disabled = true; btn.textContent = "Saving…";

    try {
      await Api.recordManualPayment({
        houseNumber:  document.getElementById("mp-house").value.trim(),
        amount:       Number(document.getElementById("mp-amount").value),
        mpesaReceipt: document.getElementById("mp-receipt").value.trim() || null,
        mpesaPhone:   document.getElementById("mp-phone").value.trim() || null,
        paymentDate:  document.getElementById("mp-date").value || null,
        notes:        document.getElementById("mp-notes").value.trim() || null,
      });
      toast("Payment recorded as pending.");
      modal.style.display = "none";
      document.getElementById("manual-payment-form").reset();
      await loadPaySummary();
      await loadPayPayments();
    } catch (err) {
      toast(err.message || "Could not save.");
    } finally {
      btn.disabled = false; btn.textContent = "Save payment";
    }
  });
});