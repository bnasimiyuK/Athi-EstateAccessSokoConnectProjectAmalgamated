/* ============================================================
   pending.js — admin approval queue for residents + vendors
   Only accessible to admins (checked via requireRole).
   ============================================================ */

/* ------------------------------------------------------------
   Which tab is currently active
   ------------------------------------------------------------ */
let activeTab = "residents";

/* ------------------------------------------------------------
   Format "3 hours ago" style timestamps
   ------------------------------------------------------------ */
function timeAgo(iso) {
  if (!iso) return "";
  const then = new Date(iso);
  const now  = new Date();
  const diff = Math.floor((now - then) / 1000); // seconds

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
   Helper to update the count text (e.g., "Vendors (2)")
   ------------------------------------------------------------ */
function updateCount(kind, delta) {
  const id = kind === "residents" ? "count-residents" : "count-vendors";
  const el = document.getElementById(id);
  if (el) {
    const current = parseInt(el.textContent.replace(/[^0-9]/g, '')) || 0;
    el.textContent = `(${Math.max(0, current + delta)})`;
  }
}

/* ------------------------------------------------------------
   Render a single pending card
   ------------------------------------------------------------ */
function pendingCard(item, kind) {
  const isResident = kind === "residents";

  const contact = isResident
    ? `<div class="meta"><i class="fas fa-phone"></i> ${item.phone || "—"}</div>
       <div class="meta"><i class="fas fa-envelope"></i> ${item.email || "—"}</div>
       <div class="meta"><i class="fas fa-map-marker-alt"></i> Phase ${item.phase} · ${item.courtName}</div>`
    : `<div class="meta"><i class="fas fa-tag"></i> ${categoryLabel(item.category)}</div>
       <div class="meta"><i class="fas fa-phone"></i> ${item.phone || "—"}</div>
       <div class="meta"><i class="fas fa-map-marker-alt"></i> ${item.zone || "—"}</div>`;

  const label = isResident ? item.fullName : item.name;

  // FIXED: Wrapped ${item.id} in quotes so string IDs don't break JavaScript
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
   Load residents
   ------------------------------------------------------------ */
async function loadResidents() {
  const listEl = document.getElementById("residents-list");
  listEl.innerHTML = `<div class="empty-state">Loading…</div>`;

  try {
    const residents = await Api.getResidents({ verified: "false" });

    document.getElementById("count-residents").textContent = `(${residents.length})`;

    if (!residents.length) {
      listEl.innerHTML = `<div class="empty-state">No pending residents. 🎉</div>`;
      return;
    }

    listEl.innerHTML = residents.map((r) => pendingCard(r, "residents")).join("");
  } catch (err) {
    console.error("[pending] failed to load residents:", err);
    listEl.innerHTML = `<div class="empty-state" style="color:var(--clay)">Could not load residents: ${err.message}</div>`;
  }
}

/* ------------------------------------------------------------
   Load vendors
   ------------------------------------------------------------ */
async function loadVendors() {
  const listEl = document.getElementById("vendors-list");
  listEl.innerHTML = `<div class="empty-state">Loading…</div>`;

  try {
    const vendors = await Api.getProviders({ verified: "false" });

    document.getElementById("count-vendors").textContent = `(${vendors.length})`;

    if (!vendors.length) {
      listEl.innerHTML = `<div class="empty-state">No pending vendors. 🎉</div>`;
      return;
    }

    listEl.innerHTML = vendors.map((v) => pendingCard(v, "vendors")).join("");
  } catch (err) {
    console.error("[pending] failed to load vendors:", err);
    listEl.innerHTML = `<div class="empty-state" style="color:var(--clay)">Could not load vendors: ${err.message}</div>`;
  }
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
      toast("✅ Resident approved. Welcome email sent.");
    } else {
      await Api.updateProvider(id, { verified: true });
      toast("✅ Vendor approved.");
    }

    // OPTIMIZED: Remove the card from the DOM instantly instead of reloading the whole list
    const card = document.querySelector(`.pending-card[data-id="${id}"]`);
    if (card) {
      card.remove();
      updateCount(kind, -1);
    } else {
      // Fallback in case the card isn't found in the DOM
      if (kind === "residents") await loadResidents();
      else await loadVendors();
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
  const label2 = kind === "residents" ? "resident" : "vendor";

  if (!confirm(`Reject ${label}? This will delete their application.`)) return;

  try {
    if (kind === "residents") {
      await Api.removeResident(id);
      toast("Resident application rejected.");
    } else {
      await Api.removeProvider(id);
      toast("Vendor application rejected.");
    }

    // OPTIMIZED: Remove the card from the DOM instantly
    const card = document.querySelector(`.pending-card[data-id="${id}"]`);
    if (card) {
      card.remove();
      updateCount(kind, -1);
    } else {
      if (kind === "residents") await loadResidents();
      else await loadVendors();
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
  if (!requireRole("admin")) return;

  setupTabs();

  try {
    await loadCategoryCache();
  } catch (e) {
    console.warn("[pending] category cache failed:", e);
  }

  await Promise.all([loadResidents(), loadVendors()]);
});