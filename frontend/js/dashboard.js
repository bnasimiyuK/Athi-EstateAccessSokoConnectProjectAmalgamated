/* ============================================================
   dashboard.js — resident's booking list + review flow
   + Prev/Next pagination
   ============================================================ */

let reviewTargetBooking = null;

/* ---------------- pagination state ---------------- */
const BOOKINGS_PER_PAGE = 10;

const bookingsState = {
  page:       1,
  limit:      BOOKINGS_PER_PAGE,
  total:      0,
  totalPages: 1,
};

/* ------------------------------------------------------------
   Status badge helper
   ------------------------------------------------------------ */
function getStatusBadge(status) {
  const badges = {
    'requested':   '<span class="badge" style="background:#f39c12; color:white; padding:4px 8px; border-radius:4px;">Requested</span>',
    'confirmed':   '<span class="badge" style="background:#3498db; color:white; padding:4px 8px; border-radius:4px;">Confirmed</span>',
    'in_progress': '<span class="badge" style="background:#9b59b6; color:white; padding:4px 8px; border-radius:4px;">In Progress</span>',
    'completed':   '<span class="badge" style="background:#27ae60; color:white; padding:4px 8px; border-radius:4px;">Completed</span>',
    'cancelled':   '<span class="badge" style="background:#e74c3c; color:white; padding:4px 8px; border-radius:4px;">Cancelled</span>'
  };
  return badges[status] || `<span class="badge">${status}</span>`;
}

/* ------------------------------------------------------------
   Booking list (paginated)
   ------------------------------------------------------------ */
async function renderBookings() {
  const list = document.getElementById("booking-list");
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

  // Handle both legacy (array) and paginated (envelope) responses
  const bookings = Array.isArray(result) ? result : (result.data || []);
  bookingsState.total      = result.total      ?? bookings.length;
  bookingsState.page       = result.page       ?? 1;
  bookingsState.limit      = result.limit      ?? BOOKINGS_PER_PAGE;
  bookingsState.totalPages = result.totalPages ?? 1;

  if (!bookings.length) {
    list.innerHTML = `<div class="empty-state">No bookings yet. <a href="index.html">Find a provider</a> to get started.</div>`;
    return;
  }

  list.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Provider</th><th>Service</th><th>Date</th><th>Status</th><th>Action</th></tr>
        </thead>
        <tbody>
          ${bookings.map(bookingRow).join("")}
        </tbody>
      </table>
    </div>
    ${bookingsPaginationHtml()}
  `;

  wireBookingsPagination();
  wireBookingRowActions(bookings);
}

/* ------------------------------------------------------------
   One row of the bookings table
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
    reasonHtml = `<div class="meta" style="color:var(--clay); font-size:0.85em; margin-top:4px;">Reason: ${b.cancellationReason}</div>`;
  }

  return `<tr>
    <td>${b.providerName}</td>
    <td>${b.service}</td>
    <td>${formatDate(b.date)}</td>
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
        Showing <b>${startRow}–${endRow}</b> of <b>${total}</b>
        booking${total === 1 ? "" : "s"}
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button class="btn btn--ghost btn--small" data-bookings-page="prev" ${prevDisabled}>
          « Prev
        </button>
        <span style="font-size:0.9rem;color:var(--ink-70);padding:0 4px;">
          Page <b>${page}</b> of <b>${totalPages}</b>
        </span>
        <button class="btn btn--ghost btn--small" data-bookings-page="next" ${nextDisabled}>
          Next »
        </button>
      </div>
    </div>
  `;
}

function wireBookingsPagination() {
  const list = document.getElementById("booking-list");

  list.querySelectorAll("[data-bookings-page]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const dir = btn.dataset.bookingsPage;

      if (dir === "prev" && bookingsState.page > 1) {
        bookingsState.page--;
      } else if (dir === "next" && bookingsState.page < bookingsState.totalPages) {
        bookingsState.page++;
      } else {
        return;
      }

      await renderBookings();
      document.getElementById("booking-list")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function wireBookingRowActions(bookings) {
  const list = document.getElementById("booking-list");

  list.querySelectorAll("[data-review]").forEach((btn) =>
    btn.addEventListener("click", () => openReview(btn.dataset.review, bookings))
  );

  list.querySelectorAll("[data-cancel]").forEach((btn) =>
    btn.addEventListener("click", () => cancelBooking(btn.dataset.cancel))
  );
}

/* ------------------------------------------------------------
   Cancel a booking
   ------------------------------------------------------------ */
async function cancelBooking(id) {
  const reason = prompt("Please provide a reason for cancelling this booking:");
  if (reason !== null && reason.trim() !== "") {
    try {
      await Api.updateBooking(id, { status: "cancelled", cancellationReason: reason });
      toast("Booking cancelled.");
      await renderBookings();
    } catch (err) {
      toast("Couldn't cancel the booking.");
    }
  } else if (reason !== null) {
    toast("A reason is required to cancel a booking.");
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
    toast("Error: Could not find booking details.");
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
    toast("Thanks — your review helps other residents.");
    await renderBookings();
  } catch (err) {
    toast("Couldn't submit the review.");
  }
}

/* ------------------------------------------------------------
   Init
   ------------------------------------------------------------ */
document.addEventListener("DOMContentLoaded", () => {
  const user = JSON.parse(localStorage.getItem("asc_user") || "null");
  if (user?.role === "vendor") {
    window.location.href = "provider-dashboard.html";
    return;
  }
  if (!user || user.role !== "resident") {
    window.location.href = "login.html?next=%2Fdashboard.html";
    return;
  }

  renderBookings();

  document.getElementById("review-form").addEventListener("submit", handleReviewSubmit);
  document.getElementById("review-cancel").addEventListener("click", () => {
    document.getElementById("review-modal").classList.remove("is-open");
  });
});