/* ============================================================
   admin-providers.js — All providers list + Excel/PDF
   Mirrors admin-residents.js: Phase → searchable Court, plus
   status (verified) and free-text search.
   ============================================================ */

const PROVIDERS_PER_PAGE = 20;

const providersState = {
  page:    1,
  limit:   PROVIDERS_PER_PAGE,
  total:   0,
  totalPages: 1,
  search:  "",
  phase:   "",
  courtId: "",
  verified: "",   // "" | "true" | "false"
};

let ALL_COURTS      = [];
let FILTERED_COURTS = [];

/* ------------------------------------------------------------
   1. Load courts once + wire the Phase filter
   ------------------------------------------------------------ */
async function setupPhaseFilter() {
  const phaseSel = document.getElementById("filter-phase");
  if (!phaseSel) return;

  try {
    ALL_COURTS = await Api.getCourts();
  } catch (err) {
    console.error("[admin-providers] court load failed:", err);
    phaseSel.innerHTML = `<option value="">Failed to load phases</option>`;
    if (typeof toast === "function") toast("Could not load phases/courts.");
    return;
  }

  const phaseNames = [...new Set(ALL_COURTS.map((c) => String(c.phase)))]
    .filter(Boolean)
    .sort();

  phaseSel.innerHTML =
    `<option value="">All phases</option>` +
    phaseNames.map((p) => `<option value="${p}">Phase ${p}</option>`).join("");
  phaseSel.disabled = false;

  FILTERED_COURTS = ALL_COURTS.slice();
  enableCourtSearch(true);
  renderCourtList("");

  phaseSel.addEventListener("change", () => {
    const phase = phaseSel.value;
    providersState.phase   = phase;
    providersState.courtId = "";
    providersState.page    = 1;

    if (!phase) {
      FILTERED_COURTS = ALL_COURTS.slice();
    } else {
      FILTERED_COURTS = ALL_COURTS.filter(
        (c) => String(c.phase) === String(phase)
      );
    }

    clearCourtSelection();
    enableCourtSearch(true);
    renderCourtList("");
  });
}

/* ------------------------------------------------------------
   2. Searchable court picker
   ------------------------------------------------------------ */
function enableCourtSearch(enabled) {
  const el = document.getElementById("filter-court-search");
  if (!el) return;
  el.disabled = !enabled;
  el.placeholder = enabled ? "All courts — type to search…" : "Select a phase first…";
}

function clearCourtSelection() {
  const searchEl = document.getElementById("filter-court-search");
  const hidden   = document.getElementById("filter-court");
  const listEl   = document.getElementById("filter-court-list");

  if (searchEl) searchEl.value = "";
  if (hidden)   hidden.value   = "";
  if (listEl)   listEl.style.display = "none";

  providersState.courtId = "";
}

function renderCourtList(query) {
  const listEl = document.getElementById("filter-court-list");
  if (!listEl) return;

  const q = (query || "").toLowerCase().trim();

  const options = [
    { id: "", name: "All courts", isAll: true },
    ...FILTERED_COURTS.filter((c) => !q || c.name.toLowerCase().includes(q)),
  ];

  listEl.innerHTML = "";

  if (!options.length) {
    listEl.innerHTML = `<div style="padding:10px 12px;color:var(--ink-70);font-size:0.9rem;">
      No courts match "${query}"
    </div>`;
    listEl.style.display = "block";
    return;
  }

  options.forEach((c) => {
    const row = document.createElement("div");
    row.textContent = c.name;
    row.style.padding      = "10px 12px";
    row.style.cursor       = "pointer";
    row.style.fontSize     = "0.95rem";
    row.style.borderBottom = "1px solid var(--line)";
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

  providersState.courtId = isAll ? "" : String(court.id);
  if (hidden)   hidden.value   = providersState.courtId;
  if (searchEl) searchEl.value = isAll ? "" : court.name;
  if (listEl)   listEl.style.display = "none";
}

function setupCourtPicker() {
  const searchEl = document.getElementById("filter-court-search");
  const listEl   = document.getElementById("filter-court-list");
  if (!searchEl || !listEl) return;

  searchEl.addEventListener("focus", () => {
    if (!searchEl.disabled && FILTERED_COURTS.length) {
      renderCourtList(searchEl.value);
    }
  });

  searchEl.addEventListener("input", () => {
    providersState.courtId = "";
    const hidden = document.getElementById("filter-court");
    if (hidden) hidden.value = "";
    renderCourtList(searchEl.value);
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".court-picker")) {
      listEl.style.display = "none";
    }
  });
}

/* ------------------------------------------------------------
   3. Render providers
   ------------------------------------------------------------ */
async function renderProviders() {
  const el = document.getElementById("providers-list");
  if (!el) return;

  el.innerHTML = `<div class="empty-state">Loading providers…</div>`;

  let result;
  try {
    result = await Api.getProviders({
      verified: providersState.verified || undefined,
      q:        providersState.search   || undefined,
      phase:    providersState.phase    || undefined,
      courtId:  providersState.courtId  || undefined,
      page:     providersState.page,
      limit:    providersState.limit,
    });
  } catch (err) {
    console.error("[admin-providers] load failed:", err);
    el.innerHTML = `<div class="empty-state" style="color:var(--clay)">
      Could not load providers: ${err.message}
    </div>`;
    return;
  }

  const providers = Array.isArray(result) ? result : (result.data || []);
  providersState.total      = result.total      ?? providers.length;
  providersState.page       = result.page       ?? 1;
  providersState.limit      = result.limit      ?? PROVIDERS_PER_PAGE;
  providersState.totalPages = result.totalPages ?? 1;

  if (!providers.length) {
    el.innerHTML = `<div class="empty-state">No providers match your filters.</div>`;
    const pager = document.getElementById("providers-pagination");
    if (pager) pager.innerHTML = "";
    return;
  }

  el.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Category</th>
            <th>Phase</th>
            <th>Court</th>
            <th>Phone</th>
            <th>Status</th>
            <th>Rating</th>
          </tr>
        </thead>
        <tbody>
          ${providers.map((p) => `
            <tr>
              <td>${p.name || "—"}</td>
              <td>${categoryLabel(p.category) || "—"}</td>
              <td>${p.phase ? "Phase " + p.phase : "—"}</td>
              <td>${p.courtName || "—"}</td>
              <td>${p.phone || "—"}</td>
              <td>${verifiedBadge(p.verified)}</td>
              <td>${p.rating ? Number(p.rating).toFixed(1) : "—"}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;

  renderProvidersPagination();
  wireProvidersPagination();
}

/* ------------------------------------------------------------
   4. Pagination
   ------------------------------------------------------------ */
function renderProvidersPagination() {
  const el = document.getElementById("providers-pagination");
  if (!el) return;

  const { page, limit, total, totalPages } = providersState;
  const startRow = total === 0 ? 0 : ((page - 1) * limit) + 1;
  const endRow   = Math.min(page * limit, total);

  el.innerHTML = `
    <div class="pagination"
         style="display:flex;justify-content:space-between;align-items:center;
                gap:12px;flex-wrap:wrap;margin-top:18px;padding:12px 4px;
                border-top:1px solid var(--line);">
      <div style="font-size:0.9rem;color:var(--ink-70);">
        Showing <b>${startRow}–${endRow}</b> of <b>${total}</b> provider${total === 1 ? "" : "s"}
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button class="btn btn--ghost btn--small"
                data-pv-page="prev" ${page <= 1 ? "disabled" : ""}>« Prev</button>
        <span style="font-size:0.9rem;color:var(--ink-70);padding:0 4px;">
          Page <b>${page}</b> of <b>${totalPages}</b>
        </span>
        <button class="btn btn--ghost btn--small"
                data-pv-page="next" ${page >= totalPages ? "disabled" : ""}>Next »</button>
      </div>
    </div>`;
}

function wireProvidersPagination() {
  document.querySelectorAll("[data-pv-page]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const dir = btn.dataset.pvPage;
      if (dir === "prev" && providersState.page > 1) {
        providersState.page--;
      } else if (dir === "next" && providersState.page < providersState.totalPages) {
        providersState.page++;
      } else {
        return;
      }
      await renderProviders();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}

/* ------------------------------------------------------------
   5. Filter form handlers
   ------------------------------------------------------------ */
function setupProvidersFilterForm() {
  const form  = document.getElementById("providers-filter");
  const clear = document.getElementById("filter-clear");

  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    applyFilters();
  });

  clear?.addEventListener("click", () => {
    const phaseSel = document.getElementById("filter-phase");
    const statusSel = document.getElementById("filter-status");
    const searchEl = document.getElementById("filter-search");

    if (searchEl)  searchEl.value  = "";
    if (phaseSel)  phaseSel.value  = "";
    if (statusSel) statusSel.value = "";

    FILTERED_COURTS = ALL_COURTS.slice();
    clearCourtSelection();
    enableCourtSearch(true);
    renderCourtList("");

    providersState.search   = "";
    providersState.phase    = "";
    providersState.courtId  = "";
    providersState.verified = "";
    providersState.page     = 1;

    renderProviders();
  });
}

function applyFilters() {
  const searchEl  = document.getElementById("filter-search");
  const phaseSel  = document.getElementById("filter-phase");
  const statusSel = document.getElementById("filter-status");
  const hidden    = document.getElementById("filter-court");

  providersState.search   = searchEl  ? searchEl.value.trim() : "";
  providersState.phase    = phaseSel  ? phaseSel.value        : "";
  providersState.verified = statusSel ? statusSel.value       : "";
  providersState.courtId  = hidden    ? hidden.value          : "";
  providersState.page     = 1;

  renderProviders();
}

/* ------------------------------------------------------------
   6. Export — Excel + PDF
   ------------------------------------------------------------ */
async function downloadProvidersReport(kind /* "xlsx" | "pdf" */) {
  const btnId = kind === "xlsx" ? "btn-excel-providers" : "btn-pdf-providers";
  const btn   = document.getElementById(btnId);
  if (!btn) return;

  const originalText = btn.textContent;
  btn.disabled    = true;
  btn.textContent = "⏳ Preparing…";

  try {
    const blob = await Api.downloadProvidersReport(kind, {
      verified: providersState.verified || undefined,
      q:        providersState.search   || undefined,
      phase:    providersState.phase    || undefined,
      courtId:  providersState.courtId  || undefined,
    });

    const url = URL.createObjectURL(blob);
    const a   = document.createElement("a");
    a.href     = url;
    a.download = `athi-soko-providers-${new Date().toISOString().slice(0, 10)}.${kind}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    if (typeof toast === "function") toast(`Providers report downloaded (${kind.toUpperCase()}).`);
  } catch (err) {
    console.error(`[admin-providers] ${kind} export failed:`, err);
    if (typeof toast === "function") toast(`Could not download ${kind.toUpperCase()}.`);
  } finally {
    btn.disabled    = false;
    btn.textContent = originalText;
  }
}

function setupProvidersExportButtons() {
  document
    .getElementById("btn-excel-providers")
    ?.addEventListener("click", () => downloadProvidersReport("xlsx"));
  document
    .getElementById("btn-pdf-providers")
    ?.addEventListener("click", () => downloadProvidersReport("pdf"));
}

/* ------------------------------------------------------------
   7. Init
   ------------------------------------------------------------ */
document.addEventListener("DOMContentLoaded", async () => {
  if (typeof requireRole === "function" &&
    !requireRole("admin", "super-admin")) return;

  const steps = [
    ["setupPhaseFilter",            setupPhaseFilter],
    ["setupCourtPicker",            setupCourtPicker],
    ["setupProvidersFilterForm",    setupProvidersFilterForm],
    ["setupProvidersExportButtons", setupProvidersExportButtons],
  ];

  for (const [name, fn] of steps) {
    try {
      await fn();
      console.log(`[admin-providers] ✅ ${name}`);
    } catch (err) {
      console.error(`[admin-providers] ❌ ${name} failed:`, err);
    }
  }

  try {
    await renderProviders();
  } catch (err) {
    console.error("[admin-providers] ❌ initial render failed:", err);
  }
});