/* ============================================================
   admin.js — verification queue + report review for estate admin
   ============================================================ */

function setupTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("is-active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("is-active"));
      btn.classList.add("is-active");
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add("is-active");
    });
  });
}

async function renderVerifyQueue(allProviders) {
  const pending = allProviders.filter((p) => !p.verified);
  document.getElementById("count-verify").textContent = pending.length ? `(${pending.length})` : "";
  const el = document.getElementById("tab-verify");

  if (!pending.length) {
    el.innerHTML = `<div class="empty-state">No listings waiting for review.</div>`;
    return;
  }

  el.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Name</th><th>Category</th><th>Zone</th><th>Phone</th><th>Action</th></tr></thead>
        <tbody>
          ${pending.map((p) => `
            <tr>
              <td>${p.name}</td>
              <td>${categoryLabel(p.category)}</td>
              <td>${p.zone}</td>
              <td>${p.phone}</td>
              <td class="row-actions">
                <button class="btn btn--accent btn--small" data-approve="${p.id}">Approve</button>
                <button class="btn btn--danger btn--small" data-reject="${p.id}">Reject</button>
              </td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;

  el.querySelectorAll("[data-approve]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      await Api.updateProvider(btn.dataset.approve, { verified: true });
      toast("Provider approved and now visible to residents.");
      renderAll();
    })
  );
  el.querySelectorAll("[data-reject]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      await Api.removeProvider(btn.dataset.reject);
      toast("Listing rejected and removed.");
      renderAll();
    })
  );
}

async function renderReports() {
  const reports = (await Api.getReports()).slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const open = reports.filter((r) => r.status === "open");
  document.getElementById("count-reports").textContent = open.length ? `(${open.length})` : "";
  const el = document.getElementById("tab-reports");

  if (!reports.length) {
    el.innerHTML = `<div class="empty-state">No reports have been filed.</div>`;
    return;
  }

  el.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Provider</th><th>Reason</th><th>Details</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>
          ${reports.map((r) => `
            <tr>
              <td>${r.providerName}</td>
              <td>${r.reason}</td>
              <td style="max-width:260px;">${r.details}</td>
              <td>${statusBadge(r.status === "open" ? "requested" : "completed")}</td>
              <td>${r.status === "open"
                ? `<button class="btn btn--ghost btn--small" data-resolve="${r.id}">Mark reviewed</button>`
                : `<span class="meta">Reviewed</span>`}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;

  el.querySelectorAll("[data-resolve]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      await Api.updateReport(btn.dataset.resolve, { status: "reviewed" });
      toast("Report marked as reviewed.");
      renderAll();
    })
  );
}

function renderAllProviders(providers) {
  const el = document.getElementById("tab-providers");
  el.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Name</th><th>Category</th><th>Status</th><th>Rating</th><th>Action</th></tr></thead>
        <tbody>
          ${providers.map((p) => `
            <tr>
              <td>${p.name}</td>
              <td>${categoryLabel(p.category)}</td>
              <td>${verifiedBadge(p.verified)}</td>
              <td>${p.rating ? p.rating.toFixed(1) : "—"}</td>
              <td><button class="btn btn--danger btn--small" data-remove="${p.id}">Remove</button></td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;

  el.querySelectorAll("[data-remove]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (confirm("Remove this provider from the platform?")) {
        await Api.removeProvider(btn.dataset.remove);
        toast("Provider removed.");
        renderAll();
      }
    })
  );
}

async function renderAll() {
  const providers = await Api.getProviders();
  await renderVerifyQueue(providers);
  await renderReports();
  renderAllProviders(providers);
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadCategoryCache();
  setupTabs();
  renderAll();
});
