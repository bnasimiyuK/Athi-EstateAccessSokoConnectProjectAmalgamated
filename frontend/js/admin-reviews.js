/* ============================================================
   admin-reviews.js — Admin view for all platform reviews
   With server-side pagination
   ============================================================ */

/* ------------------------------------------------------------
   Pagination state
   ------------------------------------------------------------ */
const REVIEWS_PER_PAGE = 20;

const reviewsState = {
  page:       1,
  limit:      REVIEWS_PER_PAGE,
  total:      0,
  totalPages: 1,
};

/* ------------------------------------------------------------
   Load + render reviews for the current page
   ------------------------------------------------------------ */
async function loadReviews() {
  const listEl = document.getElementById("reviews-list");
  listEl.innerHTML = `<div class="empty-state">Loading reviews…</div>`;

  try {
    const result = await Api.getAllReviews({
      page:  reviewsState.page,
      limit: reviewsState.limit,
    });

    // Handle both legacy (array) and new (envelope) responses safely
    const reviews = Array.isArray(result) ? result : (result.data || []);
    reviewsState.total      = result.total      ?? reviews.length;
    reviewsState.page       = result.page       ?? 1;
    reviewsState.limit      = result.limit      ?? REVIEWS_PER_PAGE;
    reviewsState.totalPages = result.totalPages ?? 1;

    if (!reviews.length) {
      listEl.innerHTML = `
        <div class="empty-state">No reviews have been submitted yet. 🎉</div>
      `;
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
      ${paginationHtml()}
    `;

    wireRowActions();
    wirePagination();
  } catch (err) {
    console.error("[admin-reviews] Failed to load:", err);
    listEl.innerHTML = `
      <div class="empty-state" style="color:var(--clay)">
        Could not load reviews: ${err.message}
      </div>`;
  }
}

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
   Pagination controls (HTML)
   ------------------------------------------------------------ */
function paginationHtml() {
  const { page, limit, total, totalPages } = reviewsState;

  const startRow = ((page - 1) * limit) + 1;
  const endRow   = Math.min(page * limit, total);

  const prevDisabled = page <= 1 ? "disabled" : "";
  const nextDisabled = page >= totalPages ? "disabled" : "";

  return `
    <div class="pagination"
         style="display:flex;justify-content:space-between;align-items:center;
                gap:12px;flex-wrap:wrap;margin-top:18px;padding:12px 4px;
                border-top:1px solid var(--line);">
      <div class="pagination__info" style="font-size:0.9rem;color:var(--ink-70);">
        Showing <b>${startRow}–${endRow}</b> of <b>${total}</b>
        review${total === 1 ? "" : "s"}
      </div>
      <div class="pagination__controls"
           style="display:flex;gap:8px;align-items:center;">
        <button class="btn btn--ghost btn--small" data-page="prev" ${prevDisabled}>
          « Prev
        </button>
        <span style="font-size:0.9rem;color:var(--ink-70);padding:0 4px;">
          Page <b>${page}</b> of <b>${totalPages}</b>
        </span>
        <button class="btn btn--ghost btn--small" data-page="next" ${nextDisabled}>
          Next »
        </button>
      </div>
    </div>
  `;
}

/* ------------------------------------------------------------
   Wire row action buttons
   ------------------------------------------------------------ */
function wireRowActions() {
  const listEl = document.getElementById("reviews-list");

  listEl.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", () => deleteReview(btn.dataset.delete));
  });

  listEl.querySelectorAll("[data-review]").forEach((btn) => {
    btn.addEventListener("click", () => markReviewed(btn.dataset.review));
  });
}

/* ------------------------------------------------------------
   Wire pagination buttons
   ------------------------------------------------------------ */
function wirePagination() {
  const listEl = document.getElementById("reviews-list");

  listEl.querySelectorAll("[data-page]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const dir = btn.dataset.page;

      if (dir === "prev" && reviewsState.page > 1) {
        reviewsState.page--;
      } else if (dir === "next" && reviewsState.page < reviewsState.totalPages) {
        reviewsState.page++;
      } else {
        return;
      }

      await loadReviews();
      document.querySelector(".tab-row")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

/* ------------------------------------------------------------
   Mark reviewed — reload current page (preserves page number)
   ------------------------------------------------------------ */
async function markReviewed(reviewId) {
  try {
    await Api.updateReview(reviewId, { status: "reviewed" });
    toast("Review marked as reviewed.");
    await loadReviews();
  } catch (err) {
    console.error("Failed to update review:", err);
    toast(err.message || "Could not update the review.");
  }
}

/* ------------------------------------------------------------
   Delete — reload current page (with page-clamp on empty)
   ------------------------------------------------------------ */
async function deleteReview(reviewId) {
  if (!confirm("Are you sure you want to delete this review? This cannot be undone.")) return;

  try {
    await Api.deleteReview(reviewId);
    toast("Review deleted.");

    // If we just deleted the last item on this page, step back
    const currentRows = document.querySelectorAll(
      "#reviews-list tbody tr"
    ).length;
    if (currentRows === 1 && reviewsState.page > 1) {
      reviewsState.page--;
    }

    await loadReviews();
  } catch (err) {
    console.error("Failed to delete review:", err);
    toast("Could not delete the review.");
  }
}

/* ------------------------------------------------------------
   Init
   ------------------------------------------------------------ */
document.addEventListener("DOMContentLoaded", async () => {
  if (typeof requireRole === "function" &&
    !requireRole("admin", "super-admin")) return;

  await loadReviews();
});