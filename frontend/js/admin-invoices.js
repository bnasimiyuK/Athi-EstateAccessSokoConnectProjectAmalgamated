/* ============================================================
   admin-invoices.js — list, generate, mark overdue,
                       per-row actions + bulk select (hybrid)
   ============================================================ */

const INV_PER_PAGE = 20;
const invState = {
  page: 1, limit: INV_PER_PAGE, total: 0, totalPages: 1,
  month: "", status: "", q: "",
};

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function statusBadge(status) {
  const map = {
    paid:    `<span class="badge badge--verified">Paid</span>`,
    unpaid:  `<span class="badge badge--unpaid">Unpaid</span>`,
    partial: `<span class="badge badge--partial">Partial</span>`,
    overdue: `<span class="badge badge--overdue">Overdue</span>`,
    exempt:  `<span class="badge" style="background:#4a5670;color:#fff;">Exempt</span>`,
  };
  return map[status] || escapeHtml(status);
}

/* ------------------------------------------------------------
   Per-row action buttons (unchanged)
   ------------------------------------------------------------ */
function renderInvoiceActions(inv) {
  if (inv.status === "paid") {
    return `<span style="font-size:0.8rem;color:var(--ink-70);">—</span>`;
  }

  const btns = [];

  if (inv.status !== "exempt") {
    btns.push(`<button class="btn btn--ghost btn--small"
                       data-inv-exempt="${inv.id}"
                       title="Exempt this invoice (valid reason)">🔓</button>`);
  } else {
    btns.push(`<button class="btn btn--ghost btn--small"
                       data-inv-restore="${inv.id}"
                       title="Restore to unpaid">↺</button>`);
  }

  if (inv.status !== "overdue") {
    btns.push(`<button class="btn btn--danger btn--small"
                       data-inv-overdue="${inv.id}"
                       title="Mark this invoice overdue">⚠️</button>`);
  } else {
    btns.push(`<button class="btn btn--ghost btn--small"
                       data-inv-restore="${inv.id}"
                       title="Restore to unpaid">↺</button>`);
  }

  return btns.join(" ");
}

async function setInvoiceStatus(id, status) {
  let reason = null;
  if (status === "exempt") {
    reason = prompt("Reason for exemption (optional):");
    if (reason === null) return;
  }

  try {
    await Api.setInvoiceStatus(id, status, reason);
    toast(
      status === "exempt"  ? "🔓 Marked as exempt."  :
      status === "overdue" ? "⚠️ Marked as overdue." :
                             "↺ Restored to unpaid."
    );
    await loadINVSummary();
    await loadINVInvoices();
  } catch (err) {
    toast(err.message || "Could not update invoice.");
  }
}

/* ------------------------------------------------------------
   Bulk selection helpers
   ------------------------------------------------------------ */
function getSelectedInvoiceIds() {
  return [...document.querySelectorAll(".inv-row-check:checked")]
    .map((cb) => Number(cb.dataset.id));
}

function updateBulkBar() {
  const bar   = document.getElementById("bulk-actions");
  const count = document.getElementById("bulk-count");
  if (!bar) return;

  const n = getSelectedInvoiceIds().length;
  if (n === 0) {
    bar.style.display = "none";
    return;
  }
  bar.style.display = "flex";
  if (count) count.textContent = `${n} selected`;
}

async function bulkApplyStatus(status) {
  const ids = getSelectedInvoiceIds();
  if (!ids.length) { toast("Select at least one invoice."); return; }

  let reason = null;
  if (status === "exempt") {
    reason = prompt(`Reason for exempting ${ids.length} invoice(s) (optional):`);
    if (reason === null) return;
  } else if (status === "overdue") {
    if (!confirm(`Mark ${ids.length} invoice(s) as overdue?\n\nThis blocks the affected residents.`)) return;
  } else {
    if (!confirm(`Restore ${ids.length} invoice(s) to unpaid?`)) return;
  }

  try {
    const r = await Api.bulkSetInvoiceStatus(ids, status, reason);
    toast(
      status === "exempt"  ? `🔓 ${r.updated} invoice(s) marked exempt.`  :
      status === "overdue" ? `⚠️ ${r.updated} invoice(s) marked overdue.` :
                             `↺ ${r.updated} invoice(s) restored.`
    );
    await loadINVSummary();
    await loadINVInvoices();
  } catch (err) {
    toast(err.message || "Bulk action failed.");
  }
}

/* ------------------------------------------------------------
   Summary tiles
   ------------------------------------------------------------ */
async function loadINVSummary() {
  try {
    const r = await Api.getInvoices({ limit: 500 });
    const all = r.data || [];
    document.getElementById("tile-total").textContent   = all.length;
    document.getElementById("tile-unpaid").textContent  =
      all.filter((i) => i.status === "unpaid" || i.status === "partial").length;
    document.getElementById("tile-paid").textContent    =
      all.filter((i) => i.status === "paid").length;
    document.getElementById("tile-overdue").textContent =
      all.filter((i) => i.status === "overdue").length;
    const exEl = document.getElementById("tile-exempt");
    if (exEl) exEl.textContent = all.filter((i) => i.status === "exempt").length;
  } catch (err) {
    console.error("[admin-invoices] summary failed:", err);
  }
}

/* ------------------------------------------------------------
   Invoices table
   ------------------------------------------------------------ */
async function loadINVInvoices() {
  const wrap = document.getElementById("invoices-table-wrap");
  wrap.innerHTML = `<div class="empty-state">Loading invoices…</div>`;

  let result;
  try {
    result = await Api.getInvoices({
      month:  invState.month,
      status: invState.status,
      q:      invState.q,
      page:   invState.page,
      limit:  invState.limit,
    });
  } catch (err) {
    wrap.innerHTML = `<div class="empty-state" style="color:var(--clay)">Could not load: ${escapeHtml(err.message)}</div>`;
    return;
  }

  invState.total      = result.total;
  invState.page       = result.page;
  invState.totalPages = result.totalPages;

  if (!result.data.length) {
    wrap.innerHTML = `<div class="empty-state">No invoices match your filter.</div>`;
    renderINVPagination();
    updateBulkBar();
    return;
  }

  const selectable = result.data.filter((i) => i.status !== "paid");

  wrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th style="width:36px;">
            ${selectable.length
              ? `<input type="checkbox" id="inv-select-all" style="cursor:pointer;" />`
              : ""}
          </th>
          <th>Month</th><th>House #</th><th>Resident</th>
          <th>Due</th><th>Paid</th><th>Balance</th>
          <th>Due date</th><th>Status</th><th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${result.data.map((i) => `
          <tr>
            <td>
              ${i.status === "paid"
                ? ""
                : `<input type="checkbox" class="inv-row-check"
                          data-id="${i.id}"
                          data-status="${escapeHtml(i.status)}"
                          style="cursor:pointer;" />`}
            </td>
            <td><b>${escapeHtml(i.billingMonth)}</b></td>
            <td>${escapeHtml(i.houseNumber)}</td>
            <td>${escapeHtml(i.residentName || "—")}<br><small style="color:var(--ink-70);">${escapeHtml(i.phone || "")}</small></td>
            <td>${Number(i.amountDue).toLocaleString()}</td>
            <td>${Number(i.amountPaid).toLocaleString()}</td>
            <td>${Number(i.balance).toLocaleString()}</td>
            <td>${escapeHtml(String(i.dueDate).slice(0, 10))}</td>
            <td>${statusBadge(i.status)}</td>
            <td>${renderInvoiceActions(i)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  /* --- Per-row action buttons --- */
  wrap.querySelectorAll("[data-inv-exempt]").forEach((b) =>
    b.addEventListener("click", () => setInvoiceStatus(Number(b.dataset.invExempt), "exempt")));
  wrap.querySelectorAll("[data-inv-overdue]").forEach((b) =>
    b.addEventListener("click", () => setInvoiceStatus(Number(b.dataset.invOverdue), "overdue")));
  wrap.querySelectorAll("[data-inv-restore]").forEach((b) =>
    b.addEventListener("click", () => setInvoiceStatus(Number(b.dataset.invRestore), "unpaid")));

  /* --- Checkbox behavior --- */
  const selectAll = document.getElementById("inv-select-all");
  const rowChecks = wrap.querySelectorAll(".inv-row-check");

  if (selectAll) {
    selectAll.addEventListener("change", (e) => {
      rowChecks.forEach((cb) => { cb.checked = e.target.checked; });
      updateBulkBar();
    });
  }
  rowChecks.forEach((cb) => cb.addEventListener("change", updateBulkBar));

  updateBulkBar();
  renderINVPagination();
}

function renderINVPagination() {
  const el = document.getElementById("invoices-pagination");
  const { page, limit, total, totalPages } = invState;
  if (!total) { el.innerHTML = ""; return; }

  const startRow = (page - 1) * limit + 1;
  const endRow   = Math.min(page * limit, total);

  el.innerHTML = `
    <div class="pagination" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-top:18px;padding:12px 4px;border-top:1px solid var(--line);">
      <div style="font-size:0.9rem;color:var(--ink-70);">
        Showing <b>${startRow}–${endRow}</b> of <b>${total}</b>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button class="btn btn--ghost btn--small" data-inv-page="prev" ${page <= 1 ? "disabled" : ""}>« Prev</button>
        <span style="font-size:0.9rem;color:var(--ink-70);padding:0 4px;">Page <b>${page}</b> of <b>${totalPages}</b></span>
        <button class="btn btn--ghost btn--small" data-inv-page="next" ${page >= totalPages ? "disabled" : ""}>Next »</button>
      </div>
    </div>
  `;

  el.querySelectorAll("[data-inv-page]").forEach((b) => {
    b.addEventListener("click", () => {
      if (b.dataset.invPage === "prev" && invState.page > 1) invState.page--;
      if (b.dataset.invPage === "next" && invState.page < invState.totalPages) invState.page++;
      loadINVInvoices();
    });
  });
}

/* ------------------------------------------------------------
   Init
   ------------------------------------------------------------ */
document.addEventListener("DOMContentLoaded", async () => {
  if (typeof requireRole === "function" && !requireRole("admin")) return;

  const now = new Date();
  const ym  = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  document.getElementById("generate-month").value = ym;

  const urlStatus = new URLSearchParams(location.search).get("status");
  if (urlStatus) {
    document.getElementById("filter-status").value = urlStatus;
    invState.status = urlStatus;
  }

  await loadINVSummary();
  await loadINVInvoices();

  document.getElementById("invoices-filter").addEventListener("submit", (e) => {
    e.preventDefault();
    invState.month  = document.getElementById("filter-month").value.trim();
    invState.status = document.getElementById("filter-status").value;
    invState.q      = document.getElementById("filter-q").value.trim();
    invState.page   = 1;
    loadINVInvoices();
  });

  document.getElementById("filter-clear").addEventListener("click", () => {
    document.getElementById("filter-month").value  = "";
    document.getElementById("filter-status").value = "";
    document.getElementById("filter-q").value      = "";
    invState.month = ""; invState.status = ""; invState.q = ""; invState.page = 1;
    loadINVInvoices();
  });

  document.getElementById("btn-generate").addEventListener("click", async () => {
    const month = document.getElementById("generate-month").value;
    if (!/^\d{4}-\d{2}$/.test(month)) { toast("Pick a month first."); return; }
    if (!confirm(`Generate invoices for ${month}?\n\nOne invoice per household. Already-generated ones are skipped.`)) return;

    try {
      const r = await Api.generateInvoices(month);
      toast(`✅ Created: ${r.created} · Skipped: ${r.skipped} · Eligible: ${r.eligible}`);
      await loadINVSummary();
      await loadINVInvoices();
    } catch (err) {
      toast(err.message || "Generation failed.");
    }
  });

  document.getElementById("btn-mark-overdue").addEventListener("click", async () => {
    if (!confirm("Mark all past-due invoices as overdue?\n\nThis also blocks access for residents with overdue balances.")) return;
    try {
      const r = await Api.markInvoicesOverdue();
      toast(`✅ Marked overdue: ${r.updated} invoice(s)`);
      await loadINVSummary();
      await loadINVInvoices();
    } catch (err) {
      toast(err.message || "Failed.");
    }
  });

  /* --- Bulk actions --- */
  document.getElementById("bulk-exempt").addEventListener("click",  () => bulkApplyStatus("exempt"));
  document.getElementById("bulk-overdue").addEventListener("click", () => bulkApplyStatus("overdue"));
  document.getElementById("bulk-restore").addEventListener("click", () => bulkApplyStatus("unpaid"));
  document.getElementById("bulk-clear").addEventListener("click",   () => {
    document.querySelectorAll(".inv-row-check").forEach((cb) => { cb.checked = false; });
    const sa = document.getElementById("inv-select-all");
    if (sa) sa.checked = false;
    updateBulkBar();
  });
});