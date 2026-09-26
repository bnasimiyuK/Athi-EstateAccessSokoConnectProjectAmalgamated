/* ============================================================
   admin-reviews.js — Admin view for all platform reviews
   ============================================================ */

document.addEventListener("DOMContentLoaded", async () => {
  // 1. Guard: Must be admin
  if (typeof requireRole === "function" && !requireRole("admin")) return;

  const listEl = document.getElementById("reviews-list");

  try {
    // 2. Fetch all reviews
    const reviews = await Api.getAllReviews();

    if (!reviews.length) {
      listEl.innerHTML = `<div class="empty-state">No reviews have been submitted yet. 🎉</div>`;
      return;
    }

    // 3. Render the table
    listEl.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Provider</th>
              <th>Resident</th>
              <th>Rating</th>
              <th>Review</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${reviews.map(reviewRow).join("")}
          </tbody>
        </table>
      </div>
    `;

    // 4. Add event listeners for any action buttons (e.g., Delete)
    listEl.querySelectorAll("[data-delete]").forEach((btn) => {
      btn.addEventListener("click", () => deleteReview(btn.dataset.delete));
    });

  } catch (err) {
    console.error("[admin-reviews] Failed to load:", err);
    listEl.innerHTML = `<div class="empty-state" style="color:var(--clay)">Could not load reviews: ${err.message}</div>`;
  }
});

/* ------------------------------------------------------------
   Render a single review row
   ------------------------------------------------------------ */
function reviewRow(r) {
  // Format the stars (e.g., 5 stars = ★★★★★)
  const stars = "★".repeat(r.rating) + "☆".repeat(5 - r.rating);
  
  // Format the date (reusing your existing timeAgo or formatDate if available)
  const dateStr = typeof formatDate === "function" ? formatDate(r.date) : new Date(r.date).toLocaleDateString();

  return `
    <tr>
      <td>${dateStr}</td>
      <td><strong>${r.providerName || "Unknown Vendor"}</strong></td>
      <td>${r.author || "Anonymous"}</td>
      <td style="color: #d4af37; font-size: 1.2rem;">${stars}</td>
      <td style="max-width: 300px;">"${r.text}"</td>
      <td>
        <button class="btn btn--danger btn--small" data-delete="${r.id || r._id}">
          <i class="fas fa-trash"></i> Delete
        </button>
      </td>
    </tr>
  `;
}

/* ------------------------------------------------------------
   Delete a review (Optional, but recommended for admins)
   ------------------------------------------------------------ */
async function deleteReview(reviewId) {
  if (!confirm("Are you sure you want to delete this review? This cannot be undone.")) return;

  try {
    // Note: You'll need to add a deleteReview method to your api.js
    // await Api.deleteReview(reviewId);
    toast("Review deleted.");
    location.reload(); // Reload the page to refresh the list
  } catch (err) {
    console.error("Failed to delete review:", err);
    toast("Could not delete the review.");
  }
}