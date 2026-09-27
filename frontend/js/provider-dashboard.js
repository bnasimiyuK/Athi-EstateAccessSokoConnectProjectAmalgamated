/* ============================================================
   provider-dashboard.js — vendor view of incoming bookings
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

/* ---------------- section renderer ---------------- */
function renderSection(title, bookings, variant) {
  if (!bookings.length) return "";

  return `
    <h2 style="margin-top:32px;">
      ${title}
      <span style="color:var(--ink-40);font-size:1rem;">(${bookings.length})</span>
    </h2>
    ${bookings.map((b) => bookingCard(b, variant)).join("")}`;
}

/* ---------------- load + render ---------------- */
async function loadBookings() {
  const el = document.getElementById("provider-bookings");
  el.innerHTML = `<div class="empty-state">Loading bookings…</div>`;

  let bookings;
  try {
    bookings = await Api.getBookings();
  } catch (err) {
    console.error("[provider-dashboard] load failed:", err);
    el.innerHTML = `<div class="empty-state">Could not load bookings.</div>`;
    return;
  }

  const requested   = bookings.filter((b) => b.status === "requested");
  const confirmed   = bookings.filter((b) => b.status === "confirmed");
  const inProgress  = bookings.filter((b) => b.status === "in_progress");
  const completed   = bookings.filter((b) => b.status === "completed");
  const cancelled   = bookings.filter((b) => b.status === "cancelled");

  if (!bookings.length) {
    el.innerHTML = `<div class="empty-state">
      No bookings yet. When residents request your services, they'll appear here.
    </div>`;
    return;
  }

  el.innerHTML = `
    ${renderSection("New Requests", requested, "new")}
    ${renderSection("Confirmed (Ready to Start)", confirmed, "confirmed")}
    ${renderSection("In Progress", inProgress, "in-progress")}
    ${renderSection("Completed", completed, "done")}
    ${renderSection("Cancelled", cancelled, "done")}
  `;

  wireActions();
}

/* ---------------- wire buttons ---------------- */
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
        // CHANGED: alert → toast
        toast("A reason is required to cancel or decline a booking.");
      }
    })
  );
}

async function updateStatus(id, status, reason = null) {
  try {
    const payload = { status };
    if (reason) payload.cancellationReason = reason;
    
    await Api.updateBooking(id, payload);
    await loadBookings();
  } catch (err) {
    console.error("[provider-dashboard] update failed:", err);
    // CHANGED: alert → toast
    toast(err.message || "Could not update booking.");
  }
}

/* ---------------- init ---------------- */
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