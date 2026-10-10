/* ============================================================
   pending.js â€” admin approval queue for residents + vendors
   + Prev/Next pagination for both columns
   ============================================================ */

/* ------------------------------------------------------------
   Which tab is currently active
   ------------------------------------------------------------ */
let activeTab = "residents";

/* ------------------------------------------------------------
   Pagination state for both columns
   ------------------------------------------------------------ */
const PENDING_PER_PAGE = 10;

const pendingState = {
  residents: { page: 1, limit: PENDING_PER_PAGE, total: 0, totalPages: 1 },
  vendors:   { page: 1, limit: PENDING_PER_PAGE, total: 0, totalPages: 1 },
};

/* ------------------------------------------------------------
   Format "3 hours ago" style timestamps
   ------------------------------------------------------------ */
function timeAgo(iso) {
  if (!iso) return "";
  const then = new Date(iso);
  const now  = new Date();
  const diff = Math.floor((now - then) / 1000);

  if (diff < 60) return "just now";
  if (diff < 3600) {
    const m = Math.floor(diff / 60);
    return `${m} minute${m === 1 ? "" : "s"} ago`;
  }
  if (diff < 86400) {
    const h = Math.floor(diff / 3600);
    return `${h} hour${h === 1 ? "" : "s"} ago`;
  }
  const d = Math.floor(diff / 86400);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

/* ------------------------------------------------------------
   Render a single pending card
   ------------------------------------------------------------ */
function pendingCard(item, kind) {
  const isResident = kind === "residents";

  const contact = isResident
    ? `<div class="meta"><i class="fas fa-phone"></i> ${item.phone || "â€”"}</div>
       <div class="meta"><i class="fas fa-envelope"></i> ${item.email || "â€”"}</div>
       <div class="meta"><i class="fas fa-map-marker-alt"></i> Phase ${item.phase} Â· ${item.courtName}</div>`
    : `<div class="meta"><i class="fas fa-tag"></i> ${categoryLabel(item.category)}</div>
       <div class="meta"><i class="fas fa-phone"></i> ${item.phone || "â€”"}</div>
       <div class="meta"><i class="fas fa-map-marker-alt"></i> ${item.zone || "â€”"}</div>`;

  const label = isResident ? item.fullName : item.name;

  return `
    <div class="pending-card" data-id="${item.id}">
      <div>
        <div class="name">${label}</div>
        ${contact}
        <div class="when"><i class="fas fa-clock"></i> Registered ${timeAgo(item.createdAt)}</div>
      </div>
      <div class="actions">
        <button class="btn btn--accent btn--small" onclick="approve('${item.id}', '${kind}')">
          <i class="fas fa-check"></i> Approve
        </button>
        <button class="btn btn--danger btn--small" onclick="reject('${item.id}', '${kind}', '${label.replace(/'/g, "\\'")}')">
          <i class="fas fa-times"></i> Reject
        </button>
      </div>
    </div>
  `;
}

/* ------------------------------------------------------------
   Pagination footer HTML for a given column
   ------------------------------------------------------------ */
function paginationHtml(kind) {
  const state = pendingState[kind];
  const { page, limit, total, totalPages } = state;

  if (totalPages <= 1) return "";

  const startRow = ((page - 1) * limit) + 1;
  const endRow   = Math.min(page * limit, total);
  const prevDisabled = page <= 1 ? "disabled" : "";
  const nextDisabled = page >= totalPages ? "disabled" : "";

  return `
    <div style="display:flex;justify-content:space-between;align-items:center;
                gap:12px;flex-wrap:wrap;margin-top:18px;padding:12px 4px;
                border-top:1px solid var(--line);">
      <div style="font-size:0.85rem;color:var(--ink-70);">
        Showing <b>${startRow}â€“${endRow}</b> of <b>${total}</b>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button class="btn btn--ghost btn--small" data-pending-page="${kind}:prev" ${prevDisabled}>
          Â« Prev
        </button>
        <span style="font-size:0.85rem;color:var(--ink-70);padding:0 4px;">
          Page <b>${page}</b> of <b>${totalPages}</b>
        </span>
        <button class="btn btn--ghost btn--small" data-pending-page="${kind}:next" ${nextDisabled}>
          Next Â»
        </button>
      </div>
    </div>
  `;
}

function wirePagination(kind) {
  const listId = kind === "residents" ? "residents-list" : "vendors-list";
  const listEl = document.getElementById(listId);
  if (!listEl) return;

  listEl.querySelectorAll(`[data-pending-page^="${kind}:"]`).forEach((btn) => {
    btn.addEventListener("click", async () => {
      const [, dir] = btn.dataset.pendingPage.split(":");
      const state = pendingState[kind];

      if (dir === "prev" && state.page > 1) {
        state.page--;
      } else if (dir === "next" && state.page < state.totalPages) {
        state.page++;
      } else {
        return;
      }

      if (kind === "residents") await loadResidents();
      else await loadVendors();
    });
  });
}

/* ------------------------------------------------------------
   Load residents (paginated)
   ------------------------------------------------------------ */
async function loadResidents() {
  const listEl = document.getElementById("residents-list");
  listEl.innerHTML = `<div class="empty-state">Loadingâ€¦</div>`;

  let result;
  try {
    result = await Api.getResidents({
      verified: "false",
      page:     pendingState.residents.page,
      limit:    pendingState.residents.limit,
    });
  } catch (err) {
    console.error("[pending] failed to load residents:", err);
    listEl.innerHTML = `<div class="empty-state" style="color:var(--clay)">Could not load residents: ${err.message}</div>`;
    return;
  }

  // Support both legacy (array) and paginated (envelope)
  const residents = Array.isArray(result) ? result : (result.data || []);
  pendingState.residents.total      = result.total      ?? residents.length;
  pendingState.residents.page       = result.page       ?? 1;
  pendingState.residents.limit      = result.limit      ?? PENDING_PER_PAGE;
  pendingState.residents.totalPages = result.totalPages ?? 1;

  document.getElementById("count-residents").textContent =
    pendingState.residents.total ? `(${pendingState.residents.total})` : "";

  if (!residents.length) {
    listEl.innerHTML = `<div class="empty-state">No pending residents. 🎉</div>`;
    return;
  }

  listEl.innerHTML =
    residents.map((r) => pendingCard(r, "residents")).join("") +
    paginationHtml("residents");

  wirePagination("residents");
}

/* ------------------------------------------------------------
   Load vendors (paginated)
   ------------------------------------------------------------ */
async function loadVendors() {
  const listEl = document.getElementById("vendors-list");
  listEl.innerHTML = `<div class="empty-state">Loadingâ€¦</div>`;

  let result;
  try {
    result = await Api.getProviders({
      verified: "false",
      page:     pendingState.vendors.page,
      limit:    pendingState.vendors.limit,
    });
  } catch (err) {
    console.error("[pending] failed to load vendors:", err);
    listEl.innerHTML = `<div class="empty-state" style="color:var(--clay)">Could not load vendors: ${err.message}</div>`;
    return;
  }

  const vendors = Array.isArray(result) ? result : (result.data || []);
  pendingState.vendors.total      = result.total      ?? vendors.length;
  pendingState.vendors.page       = result.page       ?? 1;
  pendingState.vendors.limit      = result.limit      ?? PENDING_PER_PAGE;
  pendingState.vendors.totalPages = result.totalPages ?? 1;

  document.getElementById("count-vendors").textContent =
    pendingState.vendors.total ? `(${pendingState.vendors.total})` : "";

  if (!vendors.length) {
    listEl.innerHTML = `<div class="empty-state">No pending residents. 🎉</div>`;
    return;
  }

  listEl.innerHTML =
    vendors.map((v) => pendingCard(v, "vendors")).join("") +
    paginationHtml("vendors");

  wirePagination("vendors");
}

/* ------------------------------------------------------------
   Approve
   ------------------------------------------------------------ */
async function approve(id, kind) {
  const label = kind === "residents" ? "resident" : "vendor";

  if (!confirm(`Approve this ${label}?`)) return;

  try {
    if (kind === "residents") {
      await Api.updateResident(id, { verified: true });
      toast("âœ… Resident approved. Welcome email sent.");
    } else {
      await Api.updateProvider(id, { verified: true });
      toast("âœ… Vendor approved.");
    }

    // Reload the current page (pagination-aware)
    if (kind === "residents") {
      // If we just emptied the last row on this page, step back
      if (document.querySelectorAll("#residents-list .pending-card").length === 1
          && pendingState.residents.page > 1) {
        pendingState.residents.page--;
      }
      await loadResidents();
    } else {
      if (document.querySelectorAll("#vendors-list .pending-card").length === 1
          && pendingState.vendors.page > 1) {
        pendingState.vendors.page--;
      }
      await loadVendors();
    }
  } catch (err) {
    console.error("[pending] approve failed:", err);
    toast(err.message || "Approval failed.");
  }
}

/* ------------------------------------------------------------
   Reject
   ------------------------------------------------------------ */
async function reject(id, kind, label) {
  if (!confirm(`Reject ${label}? This will delete their application.`)) return;

  try {
    if (kind === "residents") {
      await Api.removeResident(id);
      toast("Resident application rejected.");

      if (document.querySelectorAll("#residents-list .pending-card").length === 1
          && pendingState.residents.page > 1) {
        pendingState.residents.page--;
      }
      await loadResidents();
    } else {
      await Api.removeProvider(id);
      toast("Vendor application rejected.");

      if (document.querySelectorAll("#vendors-list .pending-card").length === 1
          && pendingState.vendors.page > 1) {
        pendingState.vendors.page--;
      }
      await loadVendors();
    }
  } catch (err) {
    console.error("[pending] reject failed:", err);
    toast(err.message || "Rejection failed.");
  }
}

/* ------------------------------------------------------------
   Tab switching
   ------------------------------------------------------------ */
function setupTabs() {
  document.querySelectorAll("#pendingTabs .tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeTab = btn.dataset.tab;

      document.querySelectorAll("#pendingTabs .tab-btn").forEach((b) =>
        b.classList.toggle("is-active", b === btn)
      );

      document.querySelectorAll(".tab-panel").forEach((p) => {
        p.classList.toggle("is-active", p.id === `tab-${activeTab}`);
      });
    });
  });
}

/* ------------------------------------------------------------
   Init
   ------------------------------------------------------------ */
document.addEventListener("DOMContentLoaded", async () => {
  if (!requireRole("admin", "super-admin")) return;

  setupTabs();

  try {
    await loadCategoryCache();
  } catch (e) {
    console.warn("[pending] category cache failed:", e);
  }

  await Promise.all([loadResidents(), loadVendors()]);
});