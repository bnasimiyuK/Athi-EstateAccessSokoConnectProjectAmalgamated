/* ============================================================
   dashboard.js — resident's booking list + review flow
   + Prev/Next pagination

   Depends on (loaded before this file):
     • js/auth.js
     • js/api.js
     • js/main.js   (provides global `toast`, `formatDate` if present)
   Falls back to local implementations if main.js doesn't define them.
   ============================================================ */

/* ---------- Defensive helpers (only used if not already global) ---------- */
if (typeof window.formatDate !== "function") {
  window.formatDate = function (value) {
    if (!value) return "—";
    const d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString("en-GB", {
      day: "2-digit", month: "short", year: "numeric",
    });
  };
}

if (typeof window.toast !== "function") {
  window.toast = function (message) {
    let el = document.getElementById("__global_toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "__global_toast";
      el.className = "toast";
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add("toast--visible");
    clearTimeout(el.__t);
    el.__t = setTimeout(() => el.classList.remove("toast--visible"), 2600);
  };
}

/* ---------- Module state ---------- */
let reviewTargetBooking = null;

const BOOKINGS_PER_PAGE = 10;
const bookingsState = {
  page:       1,
  limit:      BOOKINGS_PER_PAGE,
  total:      0,
  totalPages: 1,
};

/* ------------------------------------------------------------
   Status badge
   ------------------------------------------------------------ */
function getStatusBadge(status) {
  const badges = {
    requested:   '<span class="badge" style="background:#f39c12;color:#fff;padding:4px 8px;border-radius:4px;">Requested</span>',
    confirmed:   '<span class="badge" style="background:#3498db;color:#fff;padding:4px 8px;border-radius:4px;">Confirmed</span>',
    in_progress: '<span class="badge" style="background:#9b59b6;color:#fff;padding:4px 8px;border-radius:4px;">In Progress</span>',
    completed:   '<span class="badge" style="background:#27ae60;color:#fff;padding:4px 8px;border-radius:4px;">Completed</span>',
    cancelled:   '<span class="badge" style="background:#e74c3c;color:#fff;padding:4px 8px;border-radius:4px;">Cancelled</span>',
  };
  return badges[status] || `<span class="badge">${status}</span>`;
}

/* ------------------------------------------------------------
   Booking list
   ------------------------------------------------------------ */
async function renderBookings() {
  const list = document.getElementById("booking-list");
  if (!list) return;

  list.innerHTML = `<div class="empty-state">Loading bookings…</div>`;

  let result;
  try {
    result = await Api.getBookings({
      page:  bookingsState.page,
      limit: bookingsState.limit,
    });
  } catch (err) {
    list.innerHTML = `<div class="empty-state">Couldn't reach the server. Is the backend running?</div>`;
    return;
  }

  const bookings = Array.isArray(result) ? result : (result.data || result.items || []);
  bookingsState.total      = result.total      ?? bookings.length;
  bookingsState.page       = result.page       ?? 1;
  bookingsState.limit      = result.limit      ?? BOOKINGS_PER_PAGE;
  bookingsState.totalPages = result.totalPages ?? 1;

  if (!bookings.length) {
    list.innerHTML = `<div class="empty-state">
      No bookings yet. <a href="index.html">Find a provider</a> to get started.
    </div>`;
    return;
  }

  list.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Provider</th><th>Service</th><th>Date</th>
            <th>Status</th><th>Action</th>
          </tr>
        </thead>
        <tbody>${bookings.map(bookingRow).join("")}</tbody>
      </table>
    </div>
    ${bookingsPaginationHtml()}
  `;

  wireBookingsPagination();
  wireBookingRowActions(bookings);
}

/* ------------------------------------------------------------
   One row
   ------------------------------------------------------------ */
function bookingRow(b) {
  const bookingId = b.id || b._id;
  let action = "";

  if (b.status === "requested") {
    action = `<button class="btn btn--ghost btn--small" data-cancel="${bookingId}">Cancel Request</button>`;
  } else if (b.status === "confirmed") {
    action = `<button class="btn btn--ghost btn--small" data-cancel="${bookingId}">Cancel</button>`;
  } else if (b.status === "in_progress") {
    action = `<span class="meta" style="color:#9b59b6;">Work in progress…</span>`;
  } else if (b.status === "completed" && !b.reviewed) {
    action = `<button class="btn btn--accent btn--small" data-review="${bookingId}">Leave a review</button>`;
  } else if (b.reviewed) {
    action = `<span class="meta">Reviewed</span>`;
  } else if (b.status === "cancelled") {
    action = `<span class="meta" style="color:#e74c3c;">Cancelled</span>`;
  }

  let reasonHtml = "";
  if (b.status === "cancelled" && b.cancellationReason) {
    reasonHtml = `<div class="meta" style="color:var(--clay);font-size:0.85em;margin-top:4px;">Reason: ${b.cancellationReason}</div>`;
  }

  return `<tr>
    <td>${b.providerName || "—"}</td>
    <td>${b.service || "—"}</td>
    <td>${window.formatDate(b.date)}</td>
    <td>${getStatusBadge(b.status)}</td>
    <td>${action} ${reasonHtml}</td>
  </tr>`;
}

/* ------------------------------------------------------------
   Pagination footer
   ------------------------------------------------------------ */
function bookingsPaginationHtml() {
  const { page, limit, total, totalPages } = bookingsState;
  if (totalPages <= 1) return "";

  const startRow = ((page - 1) * limit) + 1;
  const endRow   = Math.min(page * limit, total);
  const prevDisabled = page <= 1 ? "disabled" : "";
  const nextDisabled = page >= totalPages ? "disabled" : "";

  return `
    <div style="display:flex;justify-content:space-between;align-items:center;
                gap:12px;flex-wrap:wrap;margin-top:18px;padding:12px 4px;
                border-top:1px solid var(--line);">
      <div style="font-size:0.9rem;color:var(--ink-70);">
        Showing <b>${startRow}-${endRow}</b> of <b>${total}</b>
        booking${total === 1 ? "" : "s"}
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button class="btn btn--ghost btn--small" data-bookings-page="prev" ${prevDisabled}>« Prev</button>
        <span style="font-size:0.9rem;color:var(--ink-70);padding:0 4px;">
          Page <b>${page}</b> of <b>${totalPages}</b>
        </span>
        <button class="btn btn--ghost btn--small" data-bookings-page="next" ${nextDisabled}>Next »</button>
      </div>
    </div>
  `;
}

function wireBookingsPagination() {
  const list = document.getElementById("booking-list");
  if (!list) return;

  list.querySelectorAll("[data-bookings-page]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const dir = btn.dataset.bookingsPage;
      if (dir === "prev" && bookingsState.page > 1) bookingsState.page--;
      else if (dir === "next" && bookingsState.page < bookingsState.totalPages) bookingsState.page++;
      else return;

      await renderBookings();
      list.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function wireBookingRowActions(bookings) {
  const list = document.getElementById("booking-list");
  if (!list) return;

  list.querySelectorAll("[data-review]").forEach((btn) =>
    btn.addEventListener("click", () => openReview(btn.dataset.review, bookings))
  );
  list.querySelectorAll("[data-cancel]").forEach((btn) =>
    btn.addEventListener("click", () => cancelBooking(btn.dataset.cancel))
  );
}

/* ------------------------------------------------------------
   Cancel
   ------------------------------------------------------------ */
async function cancelBooking(id) {
  const reason = prompt("Please provide a reason for cancelling this booking:");
  if (reason === null) return;
  if (!reason.trim()) {
    window.toast("A reason is required to cancel a booking.");
    return;
  }
  try {
    await Api.updateBooking(id, { status: "cancelled", cancellationReason: reason });
    window.toast("Booking cancelled.");
    await renderBookings();
  } catch (err) {
    window.toast("Couldn't cancel the booking.");
  }
}

/* ------------------------------------------------------------
   Review modal
   ------------------------------------------------------------ */
function openReview(bookingId, bookings) {
  reviewTargetBooking = bookings.find((b) =>
    String(b.id) === String(bookingId) || String(b._id) === String(bookingId)
  );
  if (!reviewTargetBooking) {
    window.toast("Error: Could not find booking details.");
    return;
  }
  document.getElementById("review-target").textContent =
    `${reviewTargetBooking.providerName} — ${reviewTargetBooking.service}`;
  document.getElementById("review-modal").classList.add("is-open");
}

async function handleReviewSubmit(e) {
  e.preventDefault();
  if (!reviewTargetBooking) return;
  const targetId = reviewTargetBooking.id || reviewTargetBooking._id;

  try {
    await Api.addReview({
      providerId: reviewTargetBooking.providerId,
      bookingId:  targetId,
      author:     "You",
      rating:     Number(document.getElementById("review-rating").value),
      text:       document.getElementById("review-text").value,
    });
    await Api.updateBooking(targetId, { reviewed: true });

    document.getElementById("review-modal").classList.remove("is-open");
    document.getElementById("review-form").reset();
    window.toast("Thanks — your review helps other residents.");
    await renderBookings();
  } catch (err) {
    window.toast("Couldn't submit the review.");
  }
}

/* ------------------------------------------------------------
   Init
   ------------------------------------------------------------ */
document.addEventListener("DOMContentLoaded", () => {
  const user = JSON.parse(localStorage.getItem("asc_user") || "null");

  const role = String(user?.role || "")
    .toLowerCase()
    .replace(/[_\s]+/g, "-");

  const isVendor   = role === "vendor" || role === "provider";
  const isAdmin    = role === "admin"  || role === "super-admin";
  const isResident = role === "resident";

  if (isVendor) {
    window.location.replace("provider-dashboard.html");
    return;
  }

  if (!user || (!isResident && !isAdmin)) {
    if (!/\/login\.html$/.test(location.pathname)) {
      window.location.replace(
        "login.html?next=" + encodeURIComponent(location.pathname)
      );
    }
    return;
  }

  // Admin / super-admin: read-only view
  if (isAdmin) {
    const root =
      document.getElementById("booking-list") ||
      document.querySelector(".dx-main") ||
      document.body;

    root.innerHTML = `
      <div class="empty-state" style="text-align:left;padding:28px;">
        <h2 style="margin-top:0;">Read-only view</h2>
        <p style="color:var(--ink-70);max-width:52ch;">
          You are signed in as <strong>${role}</strong>.
          This page is where residents track their own bookings.
          To manage all bookings across the estate, use the admin tools:
        </p>
        <p style="margin:18px 0 0;display:flex;gap:10px;flex-wrap:wrap;">
          <a href="super-admin.html" class="btn btn--primary">Super Admin dashboard</a>
          <a href="admin.html" class="btn btn--ghost">Admin dashboard</a>
          <a href="index.html" class="btn btn--ghost">Go to Discover</a>
        </p>
      </div>
    `;
    return;
  }

  // Resident
  renderBookings();

  const form = document.getElementById("review-form");
  if (form) form.addEventListener("submit", handleReviewSubmit);

  const cancelBtn = document.getElementById("review-cancel");
  if (cancelBtn) {
    cancelBtn.addEventListener("click", () => {
      document.getElementById("review-modal").classList.remove("is-open");
    });
  }
});