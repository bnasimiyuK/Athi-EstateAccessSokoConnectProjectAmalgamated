/* ============================================================
   home.js — Discover page: Phase → Court cascade + filters
   ============================================================ */

/* ---------------- helpers ---------------- */
function initialsOf(name) {
  return String(name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function servicesArray(p) {
  if (Array.isArray(p.services)) return p.services;
  if (!p.services) return [];
  return String(p.services)
    .split(/,\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/* ---------------- state ---------------- */
const _state = {
  categories: [],
  courts:     [],
};

/* ---------------- Phase → Court cascade ---------------- */
function buildPhaseOptions(courts) {
  const phases = [...new Set(courts.map((c) => Number(c.phase)))]
    .filter((v) => !isNaN(v))
    .sort((a, b) => a - b);

  const $phase = document.getElementById("phase");
  $phase.innerHTML = `<option value="">All phases</option>`;
  phases.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p;
    opt.textContent = `Phase ${p}`;
    $phase.appendChild(opt);
  });
}

function filterCourtsByPhase(phase) {
  const $court = document.getElementById("court");
  const list = phase
    ? _state.courts.filter((c) => Number(c.phase) === Number(phase))
    : _state.courts;

  if (!list.length) {
    $court.innerHTML = `<option value="">No courts</option>`;
    $court.disabled = true;
    return;
  }

  $court.innerHTML = `<option value="">All courts</option>` +
    list.map((c) =>
      `<option value="${c.id}">${escapeHtml(c.name)}</option>`
    ).join("");
  $court.disabled = false;
}

/* ---------------- populate ---------------- */
async function populateFilters() {
  /* Categories */
  _state.categories = typeof loadCategoryCache === "function"
    ? await loadCategoryCache()
    : await Api.getCategories();

  const $cat = document.getElementById("category");
  $cat.innerHTML = `<option value="">All categories</option>`;
  _state.categories.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.label;
    $cat.appendChild(opt);
  });

  /* Category chips */
  const $chips = document.getElementById("chip-row");
  $chips.innerHTML = "";

  const allChip = document.createElement("button");
  allChip.type = "button";
  allChip.className = "chip is-active";
  allChip.textContent = "All";
  allChip.onclick = () => setCategoryChip("", allChip);
  $chips.appendChild(allChip);

  _state.categories.forEach((c) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = c.label;
    chip.onclick = () => setCategoryChip(c.id, chip);
    $chips.appendChild(chip);
  });

  /* Courts → phase options + initial court list */
  try {
    _state.courts = await Api.getCourts();
    buildPhaseOptions(_state.courts);
    filterCourtsByPhase("");
  } catch (err) {
    console.error("[home] courts failed:", err);
  }

  /* Hero stats — fetch a full list once for the numbers */
  try {
    const all = await Api.getProviders();
    renderStats(all);
  } catch (err) {
    console.error("[home] stats failed:", err);
  }
}

function setCategoryChip(categoryId, chipEl) {
  document.getElementById("category").value = categoryId;
  document.querySelectorAll(".chip").forEach((c) => c.classList.remove("is-active"));
  chipEl.classList.add("is-active");
  renderResults();
}

/* ---------------- hero stats ---------------- */
function renderStats(providers) {
  document.getElementById("stat-providers").textContent = providers.length;
  document.getElementById("stat-verified").textContent  =
    providers.filter((p) => p.verified).length;
}

/* ---------------- provider card ---------------- */
function providerCard(p) {
  const initials = initialsOf(p.name);

  const cat = p.categoryLabel
    || (typeof categoryLabel === "function" ? categoryLabel(p.category) : "—");

  const badge = typeof verifiedBadge === "function"
    ? verifiedBadge(p.verified)
    : (p.verified ? `<span class="badge badge--verified">Verified</span>` : "");

  const rating      = Number(p.rating || 0).toFixed(1);
  const reviewCount = Number(p.reviews || 0);
  const services    = servicesArray(p).slice(0, 3);
  const price       = Number(p.priceFrom || 0);

  /* Location line: "Court · Phase N" */
  const locParts = [];
  if (p.courtName)      locParts.push(escapeHtml(p.courtName));
  if (p.phase != null)  locParts.push(`Phase ${p.phase}`);
  const loc = locParts.join(" · ");

  return `
    <a class="card" href="provider.html?id=${encodeURIComponent(p.id)}">
      <div class="card-top">
        <div style="display:flex; gap:12px; align-items:center;">
          <div class="avatar">${escapeHtml(initials)}</div>
          <div>
            <h3>${escapeHtml(p.name)}</h3>
            <div class="meta">${escapeHtml(cat)}${loc ? " · " + loc : ""}</div>
          </div>
        </div>
        ${badge}
      </div>

      <div class="rating">
        ⭐ ${rating} ${reviewCount ? `(${reviewCount})` : ""}
      </div>

      <div class="tags">
        ${services.map((s) => `<span class="tag">${escapeHtml(s)}</span>`).join("")}
      </div>

      <div class="card-footer">
        <span class="price">
          From KSh ${price.toLocaleString()}
          <small>${escapeHtml(p.priceUnit || "")}</small>
        </span>
        <span class="meta">${escapeHtml(p.hours || "")}</span>
      </div>
    </a>
  `;
}

/* ---------------- results ---------------- */
async function renderResults() {
  const grid = document.getElementById("provider-grid");
  grid.innerHTML = `<div class="empty-state">Loading providers…</div>`;

  const q        = document.getElementById("q").value.trim();
  const phase    = document.getElementById("phase").value;
  const court    = document.getElementById("court").value;
  const category = document.getElementById("category").value;
  const maxPrice = document.getElementById("maxPrice").value;

  // Build the query object — qsOf() in api.js will drop empty values
  const filters = {
    verified: true, // Discover only shows verified providers
    search:   q,
    phase:    phase,
    courtId:  court,
    category: category,
    maxPrice: maxPrice,
  };

  let results = [];
  try {
    results = await Api.getProviders(filters);
  } catch (err) {
    console.error("[home] providers failed:", err);
    grid.innerHTML = `<div class="empty-state">Could not load providers.</div>`;
    return;
  }

  document.getElementById("results-count").textContent =
    `${results.length} provider${results.length === 1 ? "" : "s"} found`;

  grid.innerHTML = results.length
    ? results.map(providerCard).join("")
    : `<div class="empty-state">No providers match your search.</div>`;
}

/* ---------------- init ---------------- */
document.addEventListener("DOMContentLoaded", async () => {
  if (typeof requireAuth === "function" && !requireAuth()) return;

  try {
    await populateFilters();
    await renderResults();
  } catch (err) {
    console.error("[home] init failed:", err);
  }

  /* Live search — debounce so we don't re-render on every keystroke */
  let searchTimer = null;
  document.getElementById("q").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderResults, 200);
  });

  /* Phase change → rebuild court list, then filter */
  document.getElementById("phase").addEventListener("change", (e) => {
    filterCourtsByPhase(e.target.value);
    renderResults();
  });

  document.getElementById("court").addEventListener("change", renderResults);
  document.getElementById("category").addEventListener("change", renderResults);
  document.getElementById("maxPrice").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderResults, 200);
  });

  /* Pressing Enter in the search box also re-renders immediately */
  document.getElementById("search-form").addEventListener("submit", (e) => {
    e.preventDefault();
    renderResults();
  });
});