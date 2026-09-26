/* ============================================================
   admin-reviews.js — Admin view for all platform reviews
   ============================================================ */

document.addEventListener("DOMContentLoaded", async () => {
  if (typeof requireRole === "function" && !requireRole("admin")) return;

  const listEl = document.getElementById("reviews-list");

  try {
    const reviews = await Api.getAllReviews();

    if (!reviews.length) {
      listEl.innerHTML = `<div class="empty-state">No reviews have been submitted yet. 🎉</div>`;
      return;
    }

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
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${reviews.map(reviewRow).join("")}
          </tbody>
        </table>
      </div>
    `;

    listEl.querySelectorAll("[data-delete]").forEach((btn) => {
      btn.addEventListener("click", () => deleteReview(btn.dataset.delete));
    });

    listEl.querySelectorAll("[data-review]").forEach((btn) => {
      btn.addEventListener("click", () => markReviewed(btn.dataset.review));
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
  const stars = "★".repeat(r.rating) + "☆".repeat(5 - r.rating);

  const dateStr = typeof formatDate === "function"
    ? formatDate(r.date)
    : new Date(r.date).toLocaleDateString();

  const status = r.status || "pending";
  const statusBadge = status === "reviewed"
    ? `<span class="badge" style="background:#27ae60;color:white;padding:4px 8px;border-radius:4px;">Reviewed</span>`
    : `<span class="badge" style="background:#f39c12;color:white;padding:4px 8px;border-radius:4px;">Pending</span>`;

  const reviewBtn = status === "pending"
    ? `<button class="btn btn--accent btn--small" data-review="${r.id}">Mark reviewed</button>`
    : `<span class="meta" style="color:var(--ink-40);">—</span>`;

  return `
    <tr>
      <td>${dateStr}</td>
      <td><strong>${r.providerName || "Unknown Vendor"}</strong></td>
      <td>${r.author || "Anonymous"}</td>
      <td style="color:#d4af37;font-size:1.2rem;">${stars}</td>
      <td style="max-width:300px;">"${r.text}"</td>
      <td>${statusBadge}</td>
      <td>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${reviewBtn}
          <button class="btn btn--danger btn--small" data-delete="${r.id}">Delete</button>
        </div>
      </td>
    </tr>
  `;
}

/* ------------------------------------------------------------
   Mark reviewed
   ------------------------------------------------------------ */
async function markReviewed(reviewId) {
  try {
    await Api.updateReview(reviewId, { status: "reviewed" });
    toast("Review marked as reviewed.");
    location.reload();
  } catch (err) {
    console.error("Failed to update review:", err);
    toast(err.message || "Could not update the review.");
  }
}

/* ------------------------------------------------------------
   Delete
   ------------------------------------------------------------ */
async function deleteReview(reviewId) {
  if (!confirm("Are you sure you want to delete this review? This cannot be undone.")) return;

  try {
    await Api.deleteReview(reviewId);
    toast("Review deleted.");
    location.reload();
  } catch (err) {
    console.error("Failed to delete review:", err);
    toast("Could not delete the review.");
  }
}