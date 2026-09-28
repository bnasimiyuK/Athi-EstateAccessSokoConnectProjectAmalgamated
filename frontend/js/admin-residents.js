/* ============================================================
   admin-residents.js — Approved residents list + Excel/PDF
   Filters: Phase (1|2) → searchable Court, both from /api/courts
   Mirrors the court-picker UX already used in residents.js
   ============================================================ */

const RESIDENTS_PER_PAGE = 20;

const residentsState = {
  page:    1,
  limit:   RESIDENTS_PER_PAGE,
  total:   0,
  totalPages: 1,
  search:  "",
  phase:   "",   // "1" | "2" | ""
  courtId: "",   // court id as string
};
console.log("[admin-residents] FILE LOADED — state initialised");
/* Cache of all courts loaded once at startup */
let ALL_COURTS     = [];   // full list from /api/courts
let FILTERED_COURTS = [];  // subset filtered by selected phase

/* ------------------------------------------------------------
   1. Load courts once + wire the Phase filter
   ------------------------------------------------------------ */
async function setupPhaseFilter() {
  const phaseSel = document.getElementById("filter-phase");
  if (!phaseSel) return;

  try {
    ALL_COURTS = await Api.getCourts();
  } catch (err) {
    console.error("[admin-residents] court load failed:", err);
    phaseSel.innerHTML = `<option value="">Failed to load phases</option>`;
    if (typeof toast === "function") toast("Could not load phases/courts.");
    return;
  }

  /* Derive distinct phases present in the courts data */
  const phaseNames = [...new Set(ALL_COURTS.map((c) => String(c.phase)))]
    .filter(Boolean)
    .sort();

  phaseSel.innerHTML =
    `<option value="">All phases</option>` +
    phaseNames.map((p) => `<option value="${p}">Phase ${p}</option>`).join("");
  phaseSel.disabled = false;

  /* Populate the court picker once (all courts initially) */
  FILTERED_COURTS = ALL_COURTS.slice();
  enableCourtSearch(true);
  renderCourtList("");

  /* Phase → refilter courts */
  phaseSel.addEventListener("change", () => {
    const phase = phaseSel.value;
    residentsState.phase   = phase;
    residentsState.courtId = "";
    residentsState.page    = 1;

    if (!phase) {
      FILTERED_COURTS = ALL_COURTS.slice();
    } else {
      FILTERED_COURTS = ALL_COURTS.filter(
        (c) => String(c.phase) === String(phase)
      );
    }

    /* Reset the court picker */
    clearCourtSelection();
    enableCourtSearch(true);
    renderCourtList("");
  });
}

/* ------------------------------------------------------------
   2. Searchable court picker
   ------------------------------------------------------------ */
function enableCourtSearch(enabled) {
  const searchEl = document.getElementById("filter-court-search");
  if (!searchEl) return;

  searchEl.disabled    = !enabled;
  searchEl.placeholder = enabled
    ? "All courts — type to search…"
    : "Select a phase first…";
}

function clearCourtSelection() {
  const searchEl = document.getElementById("filter-court-search");
  const hidden   = document.getElementById("filter-court");
  const listEl   = document.getElementById("filter-court-list");

  if (searchEl) searchEl.value = "";
  if (hidden)   hidden.value   = "";
  if (listEl)   listEl.style.display = "none";

  residentsState.courtId = "";
}

function renderCourtList(query) {
  const listEl = document.getElementById("filter-court-list");
  if (!listEl) return;

  const q = (query || "").toLowerCase().trim();

  /* "All courts" pseudo-option at top (clears the filter) */
  const options = [
    { id: "", name: "All courts", isAll: true },
    ...FILTERED_COURTS.filter((c) =>
      !q || c.name.toLowerCase().includes(q)
    ),
  ];

  listEl.innerHTML = "";

  if (!options.length) {
    listEl.innerHTML = `
      <div style="padding:10px 12px;color:var(--ink-70);font-size:0.9rem;">
        No courts match "${query}"
      </div>`;
    listEl.style.display = "block";
    return;
  }

  options.forEach((c) => {
    const row = document.createElement("div");
    row.textContent = c.name;
    row.style.padding       = "10px 12px";
    row.style.cursor        = "pointer";
    row.style.fontSize      = "0.95rem";
    row.style.borderBottom  = "1px solid var(--line)";
    if (c.isAll) {
      row.style.fontWeight = "600";
      row.style.color      = "var(--ink-70)";
    }
    row.addEventListener("mouseenter", () => row.style.background = "var(--paper-dim)");
    row.addEventListener("mouseleave", () => row.style.background = "");
    row.addEventListener("click", () => selectCourt(c));
    listEl.appendChild(row);
  });

  listEl.style.display = "block";
}

function selectCourt(court) {
  const searchEl = document.getElementById("filter-court-search");
  const hidden   = document.getElementById("filter-court");
  const listEl   = document.getElementById("filter-court-list");

  const isAll = court.isAll === true || !court.id;

  residentsState.courtId = isAll ? "" : String(court.id);
  if (hidden)   hidden.value   = residentsState.courtId;
  if (searchEl) searchEl.value = isAll ? "" : court.name;
  if (listEl)   listEl.style.display = "none";
}

function setupCourtPicker() {
  const searchEl = document.getElementById("filter-court-search");
  const listEl   = document.getElementById("filter-court-list");
  if (!searchEl || !listEl) return;

  /* Show list on focus */
  searchEl.addEventListener("focus", () => {
    if (!searchEl.disabled && FILTERED_COURTS.length) {
      renderCourtList(searchEl.value);
    }
  });

  /* Live filter as user types */
  searchEl.addEventListener("input", () => {
    /* typing invalidates the previously chosen court until they pick again */
    residentsState.courtId = "";
    const hidden = document.getElementById("filter-court");
    if (hidden) hidden.value = "";
    renderCourtList(searchEl.value);
  });

  /* Hide when clicking outside */
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".court-picker")) {
      listEl.style.display = "none";
    }
  });
}

/* ------------------------------------------------------------
   3. Render approved residents
   ------------------------------------------------------------ */
async function renderApprovedResidents() {
  const el = document.getElementById("residents-list");
  if (!el) return;

  el.innerHTML = `<div class="empty-state">Loading approved residents…</div>`;

  let result;
  try {
 result = await Api.getResidents({
  verified: "true",                                  // ✅ backend expects verified, not status
  q:        residentsState.search  || undefined,     // ✅ backend expects q, not search
  phase:    residentsState.phase   || undefined,     // ✅ matches
  courtId:  residentsState.courtId || undefined,     // ✅ matches
  page:     residentsState.page,
  limit:    residentsState.limit,
});
  } catch (err) {
    console.error("[admin-residents] load failed:", err);
    el.innerHTML = `<div class="empty-state" style="color:var(--clay)">
      Could not load residents: ${err.message}
    </div>`;
    return;
  }

  const residents = Array.isArray(result) ? result : (result.data || []);
  residentsState.total      = result.total      ?? residents.length;
  residentsState.page       = result.page       ?? 1;
  residentsState.limit      = result.limit      ?? RESIDENTS_PER_PAGE;
  residentsState.totalPages = result.totalPages ?? 1;

  if (!residents.length) {
    el.innerHTML = `<div class="empty-state">No approved residents match your filters.</div>`;
    const pager = document.getElementById("residents-pagination");
    if (pager) pager.innerHTML = "";
    return;
  }

  el.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Full name</th>
            <th>ID number</th>
            <th>Phone</th>
            <th>Phase</th>
            <th>Court</th>
            <th>Role</th>
            <th>Approved on</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${residents.map((r) => `
            <tr>
              <td>AR-${String(r.id).padStart(3, "0")}</td>
              <td>${r.fullName || r.full_name || "—"}</td>
              <td>${r.idNumber || r.id_number || "—"}</td>
              <td>${r.phone || "—"}</td>
              <td>${r.phase ? "Phase " + r.phase : "—"}</td>
              <td>${r.courtName || (r.court && r.court.name) || "—"}</td>
              <td>${r.role || "Resident"}</td>
              <td>${formatDate(r.approvedAt || r.approved_at || r.createdAt)}</td>
              <td><span class="badge badge--ok">Approved</span></td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;

  renderResidentsPagination();
  wireResidentsPagination();
}

/* ------------------------------------------------------------
   4. Pagination
   ------------------------------------------------------------ */
function renderResidentsPagination() {
  const el = document.getElementById("residents-pagination");
  if (!el) return;

  const { page, limit, total, totalPages } = residentsState;
  const startRow = total === 0 ? 0 : ((page - 1) * limit) + 1;
  const endRow   = Math.min(page * limit, total);

  el.innerHTML = `
    <div class="pagination"
         style="display:flex;justify-content:space-between;align-items:center;
                gap:12px;flex-wrap:wrap;margin-top:18px;padding:12px 4px;
                border-top:1px solid var(--line);">
      <div style="font-size:0.9rem;color:var(--ink-70);">
        Showing <b>${startRow}–${endRow}</b> of <b>${total}</b> resident${total === 1 ? "" : "s"}
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button class="btn btn--ghost btn--small"
                data-res-page="prev" ${page <= 1 ? "disabled" : ""}>« Prev</button>
        <span style="font-size:0.9rem;color:var(--ink-70);padding:0 4px;">
          Page <b>${page}</b> of <b>${totalPages}</b>
        </span>
        <button class="btn btn--ghost btn--small"
                data-res-page="next" ${page >= totalPages ? "disabled" : ""}>Next »</button>
      </div>
    </div>`;
}

function wireResidentsPagination() {
  document.querySelectorAll("[data-res-page]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const dir = btn.dataset.resPage;
      if (dir === "prev" && residentsState.page > 1) {
        residentsState.page--;
      } else if (dir === "next" && residentsState.page < residentsState.totalPages) {
        residentsState.page++;
      } else {
        return;
      }
      await renderApprovedResidents();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}

/* ------------------------------------------------------------
   5. Filter form handlers
   ------------------------------------------------------------ */
function setupResidentsFilterForm() {
  const form  = document.getElementById("residents-filter");
  const clear = document.getElementById("filter-clear");

  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    residentsState.search = document.getElementById("filter-search").value.trim();
    residentsState.page   = 1;
    renderApprovedResidents();
  });

  clear?.addEventListener("click", () => {
    const phaseSel = document.getElementById("filter-phase");
    const searchEl = document.getElementById("filter-search");

    if (searchEl) searchEl.value = "";
    if (phaseSel) phaseSel.value = "";

    /* Reset court picker back to "All courts" */
    FILTERED_COURTS = ALL_COURTS.slice();
    clearCourtSelection();
    enableCourtSearch(true);
    renderCourtList("");

    residentsState.search  = "";
    residentsState.phase   = "";
    residentsState.courtId = "";
    residentsState.page    = 1;

    renderApprovedResidents();
  });
}

/* ------------------------------------------------------------
   6. Export — Excel + PDF (uses Api.downloadResidentsReport)
   ------------------------------------------------------------ */
async function downloadResidentsReport(kind /* "xlsx" | "pdf" */) {
  const btnId = kind === "xlsx" ? "btn-excel-residents" : "btn-pdf-residents";
  const btn   = document.getElementById(btnId);
  if (!btn) return;

  const originalText = btn.textContent;
  btn.disabled    = true;
  btn.textContent = "⏳ Preparing…";

  try {
   const blob = await Api.downloadResidentsReport(kind, {
  q:       residentsState.search  || undefined,
  phase:   residentsState.phase   || undefined,
  courtId: residentsState.courtId || undefined,
});

    const url = URL.createObjectURL(blob);
    const a   = document.createElement("a");
    a.href     = url;
    a.download = `athi-soko-approved-residents-${new Date().toISOString().slice(0, 10)}.${kind}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    if (typeof toast === "function") {
      toast(`Residents report downloaded (${kind.toUpperCase()}).`);
    }
  } catch (err) {
    console.error(`[admin-residents] ${kind} export failed:`, err);
    if (typeof toast === "function") toast(`Could not download ${kind.toUpperCase()}.`);
  } finally {
    btn.disabled    = false;
    btn.textContent = originalText;
  }
}

function setupResidentsExportButtons() {
  document
    .getElementById("btn-excel-residents")
    ?.addEventListener("click", () => downloadResidentsReport("xlsx"));
  document
    .getElementById("btn-pdf-residents")
    ?.addEventListener("click", () => downloadResidentsReport("pdf"));
}

/* ------------------------------------------------------------
   7. Helpers
   ------------------------------------------------------------ */
function formatDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      day:   "2-digit",
      month: "short",
      year:  "numeric",
    });
  } catch {
    return "—";
  }
}
console.log("[admin-residents] init block reached");
/* ------------------------------------------------------------
   8. Init
   ------------------------------------------------------------ */
document.addEventListener("DOMContentLoaded", async () => {
  if (typeof requireRole === "function" && !requireRole("admin")) return;

  await setupPhaseFilter();
  setupCourtPicker();
  setupResidentsFilterForm();
  setupResidentsExportButtons();
  await renderApprovedResidents();
});