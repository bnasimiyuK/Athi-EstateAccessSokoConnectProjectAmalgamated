/* ============================================================
   dashboard.js — resident's booking list + review flow
   Status progression: requested -> confirmed -> completed.
   ============================================================ */

let reviewTargetBooking = null;

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

  bookings = bookings.slice().sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );

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
          <tr><th>Provider</th><th>Service</th><th>Date</th><th>Status</th><th>Action</th></tr>
        </thead>
        <tbody>
          ${bookings.map(bookingRow).join("")}
        </tbody>
      </table>
    </div>`;

  list.querySelectorAll("[data-confirm]").forEach((btn) =>
    btn.addEventListener("click", () => updateStatus(btn.dataset.confirm, "confirmed"))
  );
  list.querySelectorAll("[data-complete]").forEach((btn) =>
    btn.addEventListener("click", () => updateStatus(btn.dataset.complete, "completed"))
  );
  list.querySelectorAll("[data-review]").forEach((btn) =>
    btn.addEventListener("click", () => openReview(btn.dataset.review, bookings))
  );
}

/* ------------------------------------------------------------
   One row of the bookings table
   ------------------------------------------------------------ */
function bookingRow(b) {
  // Handle both MongoDB _id and standard id
  const bookingId = b.id || b._id; 

  let action = "";
  if (b.status === "requested") {
    action = `<button class="btn btn--ghost btn--small" data-confirm="${bookingId}">Simulate confirm</button>`;
  } else if (b.status === "confirmed") {
    action = `<button class="btn btn--ghost btn--small" data-complete="${bookingId}">Mark completed</button>`;
  } else if (b.status === "completed" && !b.reviewed) {
    action = `<button class="btn btn--accent btn--small" data-review="${bookingId}">Leave a review</button>`;
  } else if (b.reviewed) {
    action = `<span class="meta">Reviewed</span>`;
  }

  return `<tr>
    <td>${b.providerName}</td>
    <td>${b.service}</td>
    <td>${formatDate(b.date)}</td>
    <td>${statusBadge(b.status)}</td>
    <td>${action}</td>
  </tr>`;
}

/* ------------------------------------------------------------
   Status updates
   ------------------------------------------------------------ */
async function updateStatus(id, status) {
  try {
    await Api.updateBooking(id, { status });
    toast(`Booking marked ${status}.`);
    renderBookings();
  } catch (err) {
    toast("Couldn't update the booking.");
  }
}

/* ------------------------------------------------------------
   Review modal
   ------------------------------------------------------------ */
function openReview(bookingId, bookings) {
  // FIX: Convert both to strings to safely compare "2" (from HTML) with 2 (from DB)
  reviewTargetBooking = bookings.find((b) =>
    String(b.id) === String(bookingId) || String(b._id) === String(bookingId)
  );

  if (!reviewTargetBooking) {
    console.error("Could not find booking with ID:", bookingId);
    console.log("Available bookings:", bookings); // Debugging helper
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

  // Get the correct ID format for the API
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

  document.getElementById("review-form")
    .addEventListener("submit", handleReviewSubmit);

  document.getElementById("review-cancel")
    .addEventListener("click", () => {
      document.getElementById("review-modal").classList.remove("is-open");
    });
});