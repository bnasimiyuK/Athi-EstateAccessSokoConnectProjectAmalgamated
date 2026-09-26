/* ============================================================
   admin.js — verification queue + report review for estate admin
   + live dashboard stats (via /api/admin/stats)
   ============================================================ */

/* ------------------------------------------------------------
   Tab switching
   ------------------------------------------------------------ */
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

/* ------------------------------------------------------------
   Programmatically switch tabs (used by stat tiles)
   ------------------------------------------------------------ */
function switchTab(tabName) {
  const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
  if (btn) {
    btn.click();
    // Smooth-scroll to the tabs
    document.querySelector(".tab-row")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

/* ------------------------------------------------------------
   Dashboard stats — fills the 4 summary tiles
   ------------------------------------------------------------ */
async function loadDashboardStats() {
  try {
    const stats = await Api.getAdminStats();

    document.getElementById("tile-pending-residents").textContent  = stats.pendingResidents;
    document.getElementById("tile-pending-vendors").textContent    = stats.pendingVendors;
    document.getElementById("tile-approved-residents").textContent = stats.approvedResidents;
    document.getElementById("tile-approved-vendors").textContent   = stats.approvedVendors;

    console.log("[admin] stats loaded:", stats);
  } catch (err) {
    console.error("[admin] failed to load stats:", err);

    // Leave tiles as em-dash so it's clear something failed
    ["tile-pending-residents","tile-pending-vendors","tile-approved-residents","tile-approved-vendors"]
      .forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.textContent = "—";
      });
  }
}

/* ------------------------------------------------------------
   Verification queue (pending providers)
   ------------------------------------------------------------ */
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
      await renderAll();
    })
  );
  el.querySelectorAll("[data-reject]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      await Api.removeProvider(btn.dataset.reject);
      toast("Listing rejected and removed.");
      await renderAll();
    })
  );
}

/* ------------------------------------------------------------
   Reports
   ------------------------------------------------------------ */
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
      await renderAll();
    })
  );
}

/* ------------------------------------------------------------
   All providers table
   ------------------------------------------------------------ */
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
        await renderAll();
      }
    })
  );
}

/* ------------------------------------------------------------
   Full refresh — providers + reports + stats
   ------------------------------------------------------------ */
async function renderAll() {
  const providers = await Api.getProviders();
  await renderVerifyQueue(providers);
  await renderReports();
  renderAllProviders(providers);

  // Refresh the summary tiles too
  await loadDashboardStats();
}

/* ------------------------------------------------------------
   Init
   ------------------------------------------------------------ */
/* ------------------------------------------------------------
   Export buttons — Excel and PDF downloads
   Endpoints: GET /api/admin/export.xlsx
              GET /api/admin/export.pdf
   ------------------------------------------------------------ */
async function downloadAdminReport(kind /* "xlsx" | "pdf" */) {
  const btnId = kind === "xlsx" ? "btn-excel" : "btn-pdf";
  const btn = document.getElementById(btnId);
  if (!btn) return;

  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "⏳ Preparing…";

  try {
    // Api.getToken() must exist in your api.js — it returns the JWT
 // Use auth.js's getToken() — the source of truth for the JWT.
const token = typeof getToken === "function" ? getToken() : null;
if (!token) throw new Error("Not logged in — no token found.");

    const res = await fetch(`http://localhost:4050/api/admin/export.${kind}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 401 || res.status === 403) {
      alert("Please log in as admin.");
      window.location.href = "login.html?next=%2Fadmin.html";
      return;
    }
    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${msg}`);
    }

    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `athi-soko-report-${new Date().toISOString().slice(0, 10)}.${kind}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    toast(`Report downloaded (${kind.toUpperCase()}).`);
  } catch (err) {
    console.error(`[admin] ${kind} export failed:`, err);
    alert(`Could not download ${kind.toUpperCase()}. See console for details.`);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

function setupExportButtons() {
  const btnExcel = document.getElementById("btn-excel");
  const btnPdf   = document.getElementById("btn-pdf");

  if (btnExcel) btnExcel.addEventListener("click", () => downloadAdminReport("xlsx"));
  if (btnPdf)   btnPdf.addEventListener("click",   () => downloadAdminReport("pdf"));
}

/* ------------------------------------------------------------
   Init
   ------------------------------------------------------------ */
document.addEventListener("DOMContentLoaded", async () => {
  // Guard: must be admin
  if (typeof requireRole === "function" && !requireRole("admin")) return;

  // Wire up the export buttons immediately, before any async work
  setupExportButtons();

  await loadCategoryCache();
  setupTabs();

  // Load everything
  await renderAll();
});