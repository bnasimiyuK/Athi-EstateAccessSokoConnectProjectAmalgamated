/* ============================================================
   provider-dashboard.js — vendor view of incoming bookings
   Fetch all at once, group by status, per-section Load More
   ============================================================ */

/* ---------------- helpers ---------------- */
function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-KE", {
      day: "numeric", month: "short", year: "numeric",
    });
  } catch { return "—"; }
}

function statusBadge(status) {
  const map = {
    requested:   "badge--requested",
    confirmed:   "badge--confirmed",
    in_progress: "badge--info",
    completed:   "badge--completed",
    cancelled:   "badge--declined",
  };
  const cls = map[status] || "badge--requested";
  return `<span class="badge ${cls}">${escapeHtml(status.replace('_', ' '))}</span>`;
}

function getUser() {
  try { return JSON.parse(localStorage.getItem("asc_user") || "null"); }
  catch { return null; }
}

/* ------------------------------------------------------------
   Global state — fetched once, sliced client-side
   ------------------------------------------------------------ */
const SECTION_LIMIT = 2;

let allBookings = [];         // full list from the server
const shownCount = {           // how many of each status are currently visible
  requested:   SECTION_LIMIT,
  confirmed:   SECTION_LIMIT,
  in_progress: SECTION_LIMIT,
  completed:   SECTION_LIMIT,
  cancelled:   SECTION_LIMIT,
};

/* ---------------- booking card ---------------- */
function bookingCard(b, variant) {
  const actions = [];

  if (variant === "new") {
    actions.push(`<button class="btn btn--accent btn--small" data-confirm="${b.id}">Accept Order</button>`);
    actions.push(`<button class="btn btn--danger btn--small" data-decline="${b.id}">Decline</button>`);
  } else if (variant === "confirmed") {
    actions.push(`<button class="btn btn--accent btn--small" data-start="${b.id}">Start Work</button>`);
    actions.push(`<button class="btn btn--ghost btn--small" data-decline="${b.id}">Cancel</button>`);
  } else if (variant === "in-progress") {
    actions.push(`<button class="btn btn--accent btn--small" data-complete="${b.id}">Mark Completed</button>`);
    actions.push(`<button class="btn btn--ghost btn--small" data-decline="${b.id}">Cancel</button>`);
  }

  let starsHtml = "";
  if (b.rating) {
    starsHtml = `<li><span>Rating</span><span style="color:#d4af37;">${"★".repeat(b.rating)}${"☆".repeat(5 - b.rating)}</span></li>`;
  }

  let reasonHtml = "";
  if (b.status === "cancelled" && b.cancellationReason) {
    reasonHtml = `<li><span>Reason</span><span style="color:var(--clay);">${escapeHtml(b.cancellationReason)}</span></li>`;
  }

  return `
    <div class="card" style="margin-bottom:12px;">
      <div class="card-top">
        <div>
          <h3 style="margin:0 0 4px;">Booking #${b.id}</h3>
          <div class="meta">
            <b>${escapeHtml(b.residentName || "Unknown resident")}</b>
            ${b.residentPhone ? ` · ${escapeHtml(b.residentPhone)}` : ""}
          </div>
        </div>
        <div>${statusBadge(b.status)}</div>
      </div>

      <ul class="info-list" style="margin:6px 0 12px;">
        <li><span>Service</span><span>${escapeHtml(b.service || "—")}</span></li>
        <li><span>Date</span><span>${formatDate(b.date)}</span></li>
        ${b.notes ? `<li><span>Notes</span><span>${escapeHtml(b.notes)}</span></li>` : ""}
        <li><span>Requested</span><span>${formatDate(b.createdAt)}</span></li>
        ${starsHtml}
        ${reasonHtml}
      </ul>

      <div class="row-actions">${actions.join("")}</div>
    </div>`;
}

/* ------------------------------------------------------------
   Render a single section
   - Slices the full list by status
   - Shows only the first `shownCount[key]` items
   - Shows a "Load more" button if there are more to reveal
   ------------------------------------------------------------ */
function sectionHtml(sectionKey, backendStatus, title, variant) {
  const items = allBookings.filter((b) => b.status === backendStatus);
  const total = items.length;
  if (total === 0) return "";

  const shown = Math.min(shownCount[sectionKey], total);
  const visible = items.slice(0, shown);
  const hasMore = shown < total;
  const remaining = total - shown;

  const footer = hasMore
    ? `<button class="btn btn--ghost btn--small" data-load-more="${sectionKey}"
               style="display:block; margin:12px auto 24px; min-height:44px; padding:10px 24px;">
         Load more (${remaining} remaining)
       </button>`
    : "";

  return `
    <h2 style="margin-top:32px;">
      ${title}
      <span style="color:var(--ink-40);font-size:1rem;">(${total})</span>
    </h2>
    ${visible.map((b) => bookingCard(b, variant)).join("")}
    ${footer}`;
}

/* ------------------------------------------------------------
   Render everything from state (no fetch)
   ------------------------------------------------------------ */
function renderSections() {
  const el = document.getElementById("provider-bookings");

  const hasAny = allBookings.length > 0;

  if (!hasAny) {
    el.innerHTML = `<div class="empty-state">
      No bookings yet. When residents request your services, they'll appear here.
    </div>`;
    return;
  }

  el.innerHTML = `
    ${sectionHtml("requested",   "requested",   "New Requests",               "new")}
    ${sectionHtml("confirmed",   "confirmed",   "Confirmed (Ready to Start)",  "confirmed")}
    ${sectionHtml("in_progress", "in_progress", "In Progress",                 "in-progress")}
    ${sectionHtml("completed",   "completed",   "Completed",                   "done")}
    ${sectionHtml("cancelled",   "cancelled",   "Cancelled",                   "done")}
  `;

  wireActions();
}

/* ------------------------------------------------------------
   Fetch all bookings once
   ------------------------------------------------------------ */
async function loadBookings() {
  const el = document.getElementById("provider-bookings");
  el.innerHTML = `<div class="empty-state">Loading bookings…</div>`;

  try {
    // No params → backend returns plain array (legacy mode)
    const result = await Api.getBookings();
    allBookings = Array.isArray(result) ? result : (result.data || []);
  } catch (err) {
    console.error("[provider-dashboard] load failed:", err);
    el.innerHTML = `<div class="empty-state">Could not load bookings.</div>`;
    return;
  }

  // Reset visible counts on fresh load
  Object.keys(shownCount).forEach((k) => shownCount[k] = SECTION_LIMIT);

  renderSections();
}

/* ------------------------------------------------------------
   Wire all buttons
   ------------------------------------------------------------ */
function wireActions() {
  const el = document.getElementById("provider-bookings");

  el.querySelectorAll("[data-confirm]").forEach((btn) =>
    btn.addEventListener("click", () => updateStatus(btn.dataset.confirm, "confirmed"))
  );

  el.querySelectorAll("[data-start]").forEach((btn) =>
    btn.addEventListener("click", () => updateStatus(btn.dataset.start, "in_progress"))
  );

  el.querySelectorAll("[data-complete]").forEach((btn) =>
    btn.addEventListener("click", () => updateStatus(btn.dataset.complete, "completed"))
  );

  el.querySelectorAll("[data-decline]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const reason = prompt("Please provide a reason for declining/cancelling this booking:");
      if (reason !== null && reason.trim() !== "") {
        updateStatus(btn.dataset.decline, "cancelled", reason);
      } else if (reason !== null) {
        toast("A reason is required to cancel or decline a booking.");
      }
    })
  );

  // Per-section Load more — just reveal more from the local array
  el.querySelectorAll("[data-load-more]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const sectionKey = btn.dataset.loadMore;
      shownCount[sectionKey] += SECTION_LIMIT;
      renderSections();   // re-render from state — no fetch
    })
  );
}

/* ------------------------------------------------------------
   Status update — reload all from server
   ------------------------------------------------------------ */
async function updateStatus(id, status, reason = null) {
  try {
    const payload = { status };
    if (reason) payload.cancellationReason = reason;

    await Api.updateBooking(id, payload);
    await loadBookings();   // refresh everything (items move sections)
  } catch (err) {
    console.error("[provider-dashboard] update failed:", err);
    toast(err.message || "Could not update booking.");
  }
}

/* ------------------------------------------------------------
   Init
   ------------------------------------------------------------ */
document.addEventListener("DOMContentLoaded", async () => {
  const user = getUser();
  if (!user || user.role !== "vendor") {
    window.location.href = "login.html?next=%2Fprovider-dashboard.html";
    return;
  }

  if (user.name) {
    document.getElementById("page-title").textContent =
      `Incoming bookings — ${user.name}`;
  }

  await loadBookings();
});