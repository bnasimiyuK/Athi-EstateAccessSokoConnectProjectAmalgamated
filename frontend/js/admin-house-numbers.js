/* ============================================================
   admin-house-numbers.js — assign {CourtName}-{A|B}{NN}
   Dropdown-based, with 15 houses per side (A01–A15, B01–B15).
   ============================================================ */

const HN_PER_PAGE = 20;
const HN_HOUSES_PER_SIDE = 15;   // 15 right (A), 15 left (B) = 30 per court

const hnState = {
  page: 1, limit: HN_PER_PAGE, total: 0, totalPages: 1,
  status: "unassigned", phase: "", courtId: "", q: "",
};

let HN_ALL_COURTS = [];
let HN_FILTERED_COURTS = [];
let HN_COURT_NAMES = new Map();
let HN_ASSIGNED = new Map();      // houseNumber → residentId

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/* Generate 30 possible house numbers for a court */
function houseOptionsFor(courtName) {
  const out = [];
  for (let i = 1; i <= HN_HOUSES_PER_SIDE; i++) {
    const nn = String(i).padStart(2, "0");
    out.push(`${courtName}-A${nn}`);
    out.push(`${courtName}-B${nn}`);
  }
  return out;
}

/* ------------------------------------------------------------
   Load courts + phases
   ------------------------------------------------------------ */
async function setupHNFilters() {
  const phaseSel = document.getElementById("filter-phase");

  try {
    HN_ALL_COURTS = await Api.getCourts();
  } catch (err) {
    console.error("[admin-house-numbers] courts failed:", err);
    phaseSel.innerHTML = `<option value="">Failed to load</option>`;
    return;
  }

  for (const c of HN_ALL_COURTS) HN_COURT_NAMES.set(String(c.id), c.name);

  const phases = [...new Set(HN_ALL_COURTS.map((c) => String(c.phase)))]
    .filter(Boolean).sort();

  phaseSel.innerHTML =
    `<option value="">All phases</option>` +
    phases.map((p) => `<option value="${p}">Phase ${p}</option>`).join("");
  phaseSel.disabled = false;

  HN_FILTERED_COURTS = HN_ALL_COURTS.slice();
  renderHNCourtList("");
  enableHNCourtSearch(true);

  phaseSel.addEventListener("change", () => {
    const phase = phaseSel.value;
    hnState.phase = phase;
    hnState.courtId = "";
    hnState.page = 1;

    HN_FILTERED_COURTS = phase
      ? HN_ALL_COURTS.filter((c) => String(c.phase) === String(phase))
      : HN_ALL_COURTS.slice();

    clearHNCourtSelection();
    renderHNCourtList("");
  });
}

function enableHNCourtSearch(enabled) {
  const s = document.getElementById("filter-court-search");
  if (!s) return;
  s.disabled = !enabled;
  s.placeholder = enabled ? "All courts — type to search…" : "Select phase first…";
}

function clearHNCourtSelection() {
  const s = document.getElementById("filter-court-search");
  const h = document.getElementById("filter-court");
  const l = document.getElementById("filter-court-list");
  if (s) s.value = "";
  if (h) h.value = "";
  if (l) l.style.display = "none";
  hnState.courtId = "";
}

function renderHNCourtList(query) {
  const listEl = document.getElementById("filter-court-list");
  const q = String(query || "").toLowerCase().trim();
  const matches = HN_FILTERED_COURTS.filter((c) =>
    c.name.toLowerCase().includes(q)
  );

  listEl.innerHTML = "";
  if (!matches.length) {
    listEl.innerHTML = `<div style="padding:10px 12px;color:var(--ink-70);font-size:0.9rem;">No matches</div>`;
    listEl.style.display = "block";
    return;
  }

  for (const c of matches) {
    const row = document.createElement("div");
    row.textContent = c.name;
    row.style.cssText = "padding:10px 12px;cursor:pointer;font-size:0.95rem;border-bottom:1px solid var(--line);";
    row.addEventListener("mouseenter", () => (row.style.background = "var(--paper-dim)"));
    row.addEventListener("mouseleave", () => (row.style.background = ""));
    row.addEventListener("click", () => selectHNCourt(c));
    listEl.appendChild(row);
  }
  listEl.style.display = "block";
}

function selectHNCourt(court) {
  document.getElementById("filter-court").value = court.id;
  document.getElementById("filter-court-search").value = court.name;
  document.getElementById("filter-court-list").style.display = "none";
  hnState.courtId = String(court.id);
}

/* ------------------------------------------------------------
   Load assigned house numbers
   ------------------------------------------------------------ */
async function loadAssigned() {
  try {
    const rows = await Api.getAssignedHouseNumbers();
    HN_ASSIGNED = new Map();
    for (const r of rows) HN_ASSIGNED.set(r.house_number, r.resident_id);
  } catch (err) {
    console.error("[admin-house-numbers] assigned failed:", err);
    HN_ASSIGNED = new Map();
  }
}

/* ------------------------------------------------------------
   Load summary tiles
   ------------------------------------------------------------ */
async function loadHNSummary() {
  try {
    const s = await Api.getHouseNumberSummary();
    document.getElementById("tile-assigned").textContent   = s.assigned;
    document.getElementById("tile-unassigned").textContent = s.unassigned;
    document.getElementById("tile-total").textContent      = s.total;
  } catch (err) {
    console.error("[admin-house-numbers] summary failed:", err);
  }
}

/* ------------------------------------------------------------
   Build the dropdown for one resident
   ------------------------------------------------------------ */
function houseSelectHtml(resident) {
  const courtName = resident.courtName || "";
  const options = houseOptionsFor(courtName);
  const current = resident.houseNumber || "";

  const opts = options.map((hno) => {
    const owner = HN_ASSIGNED.get(hno);
    const taken = owner != null && owner !== resident.id;

    const selected = hno === current ? " selected" : "";
    const disabled = taken && hno !== current ? " disabled" : "";
    const suffix = taken && hno !== current ? "  (taken)" : "";

    return `<option value="${escapeHtml(hno)}"${selected}${disabled}>${escapeHtml(hno)}${suffix}</option>`;
  }).join("");

  return `
    <select class="input hn-select" data-id="${resident.id}" style="min-width:220px;">
      <option value="">— select —</option>
      ${opts}
    </select>
  `;
}

/* ------------------------------------------------------------
   Load residents
   ------------------------------------------------------------ */
async function loadHNResidents() {
  const wrap = document.getElementById("hn-table-wrap");
  wrap.innerHTML = `<div class="empty-state">Loading residents…</div>`;

  let result;
  try {
    await loadAssigned();
    result = await Api.getHouseNumberResidents({
      q: hnState.q,
      courtId: hnState.courtId,
      status: hnState.status,
      page: hnState.page,
      limit: hnState.limit,
    });
  } catch (err) {
    wrap.innerHTML = `<div class="empty-state" style="color:var(--clay)">Could not load: ${escapeHtml(err.message)}</div>`;
    return;
  }

  hnState.total      = result.total;
  hnState.page       = result.page;
  hnState.totalPages = result.totalPages;

  if (!result.data.length) {
    wrap.innerHTML = `<div class="empty-state">No residents match this filter.</div>`;
    renderHNPagination();
    return;
  }

  wrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Resident</th>
          <th>Phone</th>
          <th>Phase</th>
          <th>Court</th>
          <th>House number</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        ${result.data.map((r) => `
          <tr data-id="${r.id}">
            <td>${escapeHtml(r.fullName)}</td>
            <td>${escapeHtml(r.phone)}</td>
            <td>Phase ${escapeHtml(r.phase)}</td>
            <td>${escapeHtml(r.courtName)}</td>
            <td>${houseSelectHtml(r)}</td>
            <td>
              <button class="btn btn--accent btn--small" data-save="${r.id}">Save</button>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  wrap.querySelectorAll("[data-save]").forEach((btn) => {
    btn.addEventListener("click", () => saveHN(btn.dataset.save, btn));
  });

  renderHNPagination();
}

async function saveHN(id, btn) {
  const select = document.querySelector(`.hn-select[data-id="${id}"]`);
  if (!select) return;
  const value = select.value.trim();

  if (!value) {
    toast("Pick a house number first.");
    return;
  }

  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Saving…";

  try {
    await Api.setResidentHouseNumber(id, value);
    toast(`House number set: ${value}`);
    await loadHNSummary();
    await loadHNResidents();
  } catch (err) {
    toast(err.message || "Could not save.");
    btn.disabled = false;
    btn.textContent = original;
  }
}

/* ------------------------------------------------------------
   Pagination
   ------------------------------------------------------------ */
function renderHNPagination() {
  const el = document.getElementById("hn-pagination");
  const { page, limit, total, totalPages } = hnState;
  if (!total) { el.innerHTML = ""; return; }

  const startRow = (page - 1) * limit + 1;
  const endRow   = Math.min(page * limit, total);

  el.innerHTML = `
    <div class="pagination" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-top:18px;padding:12px 4px;border-top:1px solid var(--line);">
      <div style="font-size:0.9rem;color:var(--ink-70);">
        Showing <b>${startRow}–${endRow}</b> of <b>${total}</b>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button class="btn btn--ghost btn--small" data-hn-page="prev" ${page <= 1 ? "disabled" : ""}>« Prev</button>
        <span style="font-size:0.9rem;color:var(--ink-70);padding:0 4px;">Page <b>${page}</b> of <b>${totalPages}</b></span>
        <button class="btn btn--ghost btn--small" data-hn-page="next" ${page >= totalPages ? "disabled" : ""}>Next »</button>
      </div>
    </div>
  `;

  el.querySelectorAll("[data-hn-page]").forEach((b) => {
    b.addEventListener("click", () => {
      if (b.dataset.hnPage === "prev" && hnState.page > 1) hnState.page--;
      if (b.dataset.hnPage === "next" && hnState.page < hnState.totalPages) hnState.page++;
      loadHNResidents();
    });
  });
}

/* ------------------------------------------------------------
   CSV template + upload
   ------------------------------------------------------------ */
function downloadCSVTemplate() {
  const csv = "phone,houseNumber\n+254720689389,Riverside-A01\n+254715408527,Riverside-B01\n";
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = "house-numbers-template.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const header = lines.shift().split(",").map((h) => h.trim().toLowerCase());
  const phoneIdx = header.indexOf("phone");
  const hnIdx    = header.indexOf("housenumber");
  if (phoneIdx === -1 || hnIdx === -1) {
    throw new Error("CSV must have 'phone' and 'houseNumber' columns.");
  }
  return lines.map((line) => {
    const cols = line.split(",").map((c) => c.trim());
    return { phone: cols[phoneIdx] || "", houseNumber: cols[hnIdx] || "" };
  });
}

async function uploadCSV(file) {
  const text = await file.text();
  let rows;
  try {
    rows = parseCSV(text);
  } catch (err) {
    toast(err.message);
    return;
  }

  if (!rows.length) { toast("CSV is empty."); return; }
  if (!confirm(`Upload ${rows.length} row(s)?`)) return;

  try {
    const result = await Api.bulkAssignHouseNumbers(rows);
    await loadHNSummary();
    await loadHNResidents();

    const summary = [
      `✅ Assigned: ${result.ok}`,
      result.notFound.length  ? `⚠️ Phone not found: ${result.notFound.length}` : "",
      result.invalid.length   ? `❌ Invalid: ${result.invalid.length}`          : "",
      result.duplicate.length ? `🔁 Duplicates: ${result.duplicate.length}`    : "",
    ].filter(Boolean).join(" · ");

    toast(summary);
  } catch (err) {
    toast(err.message || "Upload failed.");
  }
}

/* ------------------------------------------------------------
   Init
   ------------------------------------------------------------ */
document.addEventListener("DOMContentLoaded", async () => {
  if (typeof requireRole === "function" &&
    !requireRole("admin", "super-admin")) return;

  await setupHNFilters();
  await loadHNSummary();
  await loadHNResidents();

  document.getElementById("hn-filter").addEventListener("submit", (e) => {
    e.preventDefault();
    hnState.q = document.getElementById("filter-q").value.trim();
    hnState.page = 1;
    loadHNResidents();
  });

  document.getElementById("filter-status").addEventListener("change", (e) => {
    hnState.status = e.target.value;
    hnState.page = 1;
    loadHNResidents();
  });

  document.getElementById("filter-clear").addEventListener("click", () => {
    document.getElementById("filter-q").value = "";
    document.getElementById("filter-status").value = "unassigned";
    document.getElementById("filter-phase").value = "";
    clearHNCourtSelection();
    HN_FILTERED_COURTS = HN_ALL_COURTS.slice();
    renderHNCourtList("");
    hnState.status = "unassigned";
    hnState.phase  = "";
    hnState.courtId = "";
    hnState.q = "";
    hnState.page = 1;
    loadHNResidents();
  });

  document.getElementById("filter-court-search").addEventListener("input", (e) => {
    renderHNCourtList(e.target.value);
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest("#filter-court-search") && !e.target.closest("#filter-court-list")) {
      const l = document.getElementById("filter-court-list");
      if (l) l.style.display = "none";
    }
  });

  document.getElementById("btn-download-template").addEventListener("click", downloadCSVTemplate);

  document.getElementById("btn-upload-csv").addEventListener("click", () => {
    document.getElementById("csv-input").click();
  });

  document.getElementById("csv-input").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) uploadCSV(file);
    e.target.value = "";
  });
});