/* ============================================================
   dashboard.js — resident's booking list + review flow
   Status progression: requested -> confirmed -> in_progress -> completed.
   ============================================================ */

let reviewTargetBooking = null;

/* ------------------------------------------------------------
   Helper: Render colored status badges
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
   Booking list
   ------------------------------------------------------------ */
async function renderBookings() {
  const list = document.getElementById("booking-list");
  let bookings = [];
  try {
    bookings = await Api.getBookings();
  } catch (err) {
    list.innerHTML = `<div class="empty-state">Couldn't reach the server. Is the backend running?</div>`;
    return;
  }

  bookings = bookings.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

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
    </div>`;

  // Attach event listeners for review buttons (Resident side only)
  list.querySelectorAll("[data-review]").forEach((btn) =>
    btn.addEventListener("click", () => openReview(btn.dataset.review, bookings))
  );
}

/* ------------------------------------------------------------
   One row of the bookings table
   ------------------------------------------------------------ */
function bookingRow(b) {
  const bookingId = b.id || b._id; 
  let action = "";

  // Resident actions: Mostly waiting, then reviewing
  if (b.status === "requested") {
    action = `<span class="meta" style="color:#f39c12;">Waiting for vendor…</span>`;
  } else if (b.status === "confirmed") {
    action = `<span class="meta" style="color:#3498db;">Vendor confirmed</span>`;
  } else if (b.status === "in_progress") {
    action = `<span class="meta" style="color:#9b59b6;">Work in progress…</span>`;
  } else if (b.status === "completed" && !b.reviewed) {
    action = `<button class="btn btn--accent btn--small" data-review="${bookingId}">Leave a review</button>`;
  } else if (b.reviewed) {
    action = `<span class="meta">Reviewed</span>`;
  } else if (b.status === "cancelled") {
    action = `<span class="meta" style="color:#e74c3c;">Cancelled</span>`;
  }

  return `<tr>
    <td>${b.providerName}</td>
    <td>${b.service}</td>
    <td>${formatDate(b.date)}</td>
    <td>${getStatusBadge(b.status)}</td>
    <td>${action}</td>
  </tr>`;
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
      author: "You",
      rating: Number(document.getElementById("review-rating").value),
      text: document.getElementById("review-text").value,
    });
    await Api.updateBooking(targetId, { reviewed: true });
    
    document.getElementById("review-modal").classList.remove("is-open");
    document.getElementById("review-form").reset();
    toast("Thanks — your review helps other residents.");
    renderBookings();
  } catch (err) {
    toast("Couldn't submit the review.");
  }
}

/* ------------------------------------------------------------
   Init (with role guard)
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