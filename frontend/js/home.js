/* ============================================================
   home.js — Discover page with category-first landing
   + Category tiles with "View more" / "Show fewer" pagination
   + Provider results "Load more" pagination
   + Live "Busy until" countdown on provider cards
   ============================================================ */

/* ---------------- helpers ---------------- */
function initialsOf(name) {
  return String(name || "?")
    .split(/\s+/).filter(Boolean).map((n) => n[0]).slice(0, 2).join("").toUpperCase();
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function servicesArray(p) {
  if (Array.isArray(p.services)) return p.services;
  if (!p.services) return [];
  return String(p.services).split(/,\s*/).map((s) => s.trim()).filter(Boolean);
}

function formatTimeUntil(iso) {
  if (!iso) return null;
  const diffMs   = new Date(iso) - new Date();
  const diffMins = Math.round(diffMs / 60000);

  if (diffMins <= 0) return { relative: "any moment", backTime: null };

  const back = new Date(iso);
  const backTime = back.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" });

  let relative;
  if (diffMins < 60) {
    relative = `in ${diffMins} min`;
  } else {
    const hrs  = Math.floor(diffMins / 60);
    const mins = diffMins % 60;
    relative = mins > 0 ? `in ${hrs}h ${mins}m` : `in ${hrs}h`;
  }
  return { relative, backTime };
}

/* Category icons (label → emoji) */
function categoryIcon(label) {
  const icons = {
    Plumbing:          "🔧",
    Cleaning:          "🧽",
    Electrical:        "⚡",
    Errands:           "🏃",
    Gardening:         "🌿",
    Painting:          "🎨",
    Moving:            "📦",
    Tutoring:          "📚",
    Pharmacy:          "💊",
    Cobbler:           "👞",
    "Bicycle repairs": "🚲",
    Mechanic:          "🔩",
    "Car wash":        "🚗",
    "Agro vet":        "🐄",
    Mason:             "🧱",
    Carpenter:         "🪚",
    School:            "🏫",
    Clinic:            "🩺",
    Hospital:          "🏥",
    Supermarket:       "🏪",
    Poshomill:         "🌾",
    Butchery:          "🥩",
    "Water vendor":    "💧",
    Exhauster:         "🚛",
    Restaurant:        "🍽️",
    Grocery:           "🛍️",
  };
  return icons[label] || "🧰";
}

/* ---------------- state ---------------- */
const _state = {
  categories: [],
  courts: [],
  activeCategory: null,
};

const INITIAL_CATEGORY_COUNT = 4;
const CATEGORIES_PER_PAGE    = 5;
let   VISIBLE_CATEGORY_COUNT = INITIAL_CATEGORY_COUNT;

const discoverState = {
  page: 1,
  limit: 6,
  total: 0,
  totalPages: 1,
  accumulated: [],
};

/* ---------------- Phase → Court cascade ---------------- */
function buildPhaseOptions(courts) {
  const phases = [...new Set(courts.map((c) => Number(c.phase)))]
    .filter((v) => !isNaN(v)).sort((a, b) => a - b);

  const $phase = document.getElementById("phase");
  if (!$phase) return;
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
  if (!$court) return;
  const list = phase
    ? _state.courts.filter((c) => Number(c.phase) === Number(phase))
    : _state.courts;

  if (!list.length) {
    $court.innerHTML = `<option value="">No courts</option>`;
    $court.disabled = true;
    return;
  }

  $court.innerHTML = `<option value="">All courts</option>` +
    list.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
  $court.disabled = false;
}

/* ============================================================
   CATEGORY TILES
   ============================================================ */
function renderCategoryTiles() {
  const el = document.getElementById("category-tiles");
  const loadMoreBtn  = document.getElementById("btn-load-more-categories");
  const showFewerBtn = document.getElementById("btn-show-fewer-categories");
  if (!el) return;

  const totalCategories   = _state.categories.length;
  const visibleCategories = _state.categories.slice(0, VISIBLE_CATEGORY_COUNT);

  const tiles = visibleCategories.map((c) => {
    const isActive = _state.activeCategory === c.id;
    return `
      <button type="button" class="category-tile ${isActive ? "is-active" : ""}"
              data-cat="${c.id}">
        <div class="category-tile__icon">${categoryIcon(c.label)}</div>
        <div class="category-tile__label">${escapeHtml(c.label)}</div>
      </button>
    `;
  }).join("");

  const allActive = _state.activeCategory === null;
  const allTile = `
    <button type="button" class="category-tile ${allActive ? "is-active" : ""}"
            data-cat="">
      <div class="category-tile__icon">🌐</div>
      <div class="category-tile__label">All Providers</div>
    </button>
  `;

  el.innerHTML = tiles + allTile;

  el.querySelectorAll(".category-tile").forEach((btn) => {
    btn.addEventListener("click", () => {
      const raw = btn.dataset.cat;
      _state.activeCategory = raw === "" ? null : parseInt(raw, 10);

      renderCategoryTiles();
      updateResultsHeading();

      discoverState.page = 1;
      discoverState.accumulated = [];
      renderResults();

      document.getElementById("results-heading")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  if (loadMoreBtn) {
    if (VISIBLE_CATEGORY_COUNT < totalCategories) {
      loadMoreBtn.style.display = "inline-flex";
      loadMoreBtn.textContent = "View more categories";
    } else {
      loadMoreBtn.style.display = "none";
    }
  }

  if (showFewerBtn) {
    if (VISIBLE_CATEGORY_COUNT > INITIAL_CATEGORY_COUNT) {
      showFewerBtn.style.display = "inline-block";
    } else {
      showFewerBtn.style.display = "none";
    }
  }
}

function updateResultsHeading() {
  const h = document.getElementById("results-heading");
  if (!h) return;

  if (_state.activeCategory === null) {
    h.textContent = "All providers";
  } else {
    const cat = _state.categories.find((c) => c.id === _state.activeCategory);
    h.textContent = cat ? `${cat.label} providers` : "Providers";
  }
}

/* ---------------- populate ---------------- */
async function populateFilters() {
  try {
    _state.categories = typeof loadCategoryCache === "function"
      ? await loadCategoryCache()
      : await Api.getCategories();
    renderCategoryTiles();
  } catch (err) {
    console.error("[home] categories failed:", err);
  }

  try {
    _state.courts = await Api.getCourts();
    buildPhaseOptions(_state.courts);
    filterCourtsByPhase("");
  } catch (err) {
    console.error("[home] courts failed:", err);
  }

  try {
    const all = await Api.getProviders();
    renderStats(all);
  } catch (err) {
    console.error("[home] stats failed:", err);
  }

  /* ----- Optional routes: never let a 404 kill the page ----- */
  if (typeof Api.getPhaseRange === "function") {
    try { await Api.getPhaseRange(); } catch (e) { /* ignore */ }
  }
  if (typeof Api.getNotice === "function") {
    try { await Api.getNotice(); } catch (e) { /* ignore */ }
  }
  if (typeof Api.getGateRules === "function") {
    try { await Api.getGateRules(); } catch (e) { /* ignore */ }
  }
}

/* ---------------- hero stats ---------------- */
function renderStats(providers) {
  const arr = Array.isArray(providers) ? providers : (providers?.data || []);
  const pEl = document.getElementById("stat-providers");
  const vEl = document.getElementById("stat-verified");
  if (pEl) pEl.textContent = arr.length;
  if (vEl) vEl.textContent = arr.filter((p) => p.verified).length;
}

/* ---------------- provider card ---------------- */
function providerCard(p) {
  const initials = initialsOf(p.name);
  const cat = p.categoryLabel
    || (typeof categoryLabel === "function" ? categoryLabel(p.category) : "—");

  const verifiedPill = typeof verifiedBadge === "function"
    ? verifiedBadge(p.verified)
    : (p.verified ? `<span class="badge badge--verified">Verified</span>` : "");

  const availabilityPill = p.isAvailable === false
    ? `<span class="badge" style="background:#e74c3c;color:white;">Busy</span>`
    : "";

  const badge = verifiedPill + (availabilityPill ? " " + availabilityPill : "");

  const rating      = Number(p.rating || 0).toFixed(1);
  const reviewCount = Number(p.reviews || 0);
  const services    = servicesArray(p).slice(0, 3);
  const price       = Number(p.priceFrom || 0);

  const locParts = [];
  if (p.courtName)      locParts.push(escapeHtml(p.courtName));
  if (p.phase != null)  locParts.push(`Phase ${p.phase}`);
  const loc = locParts.join(" · ");

  let busyLine = "";
  if (p.isAvailable === false) {
    let text;
    if (p.unavailableUntil) {
      const t = formatTimeUntil(p.unavailableUntil);
      text = (t && t.backTime)
        ? `⏸️ Busy until ${t.backTime} · ${t.relative}`
        : "⏸️ Busy · back any moment";
    } else {
      text = "⏸️ Busy · not accepting bookings";
    }
    busyLine = `
      <div class="busy-countdown"
           data-until="${p.unavailableUntil || ""}"
           style="
             font-size: 0.78rem;
             color: #c0392b;
             background: #fdecea;
             border-left: 3px solid #e74c3c;
             padding: 4px 8px;
             border-radius: 4px;
             margin-top: 6px;
           ">
        ${text}
      </div>`;
  }

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

      ${busyLine}

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

/* ---------------- Build current filters ---------------- */
function buildDiscoverFilters() {
  const $q    = document.getElementById("q");
  const $ph   = document.getElementById("phase");
  const $ct   = document.getElementById("court");
  const $mp   = document.getElementById("maxPrice");

  return {
    verified: true,
    search:   $q ? $q.value.trim() : "",
    phase:    $ph ? $ph.value : "",
    courtId:  $ct ? $ct.value : "",
    category: _state.activeCategory ?? "",
    maxPrice: $mp ? $mp.value : "",
    page:     discoverState.page,
    limit:    discoverState.limit,
  };
}

/* ---------------- results ---------------- */
async function renderResults({ append = false } = {}) {
  const grid = document.getElementById("provider-grid");
  if (!grid) return;

  if (!append) {
    grid.innerHTML = `<div class="empty-state">Loading providers…</div>`;
    discoverState.accumulated = [];
  }

  let result;
  try {
    result = await Api.getProviders(buildDiscoverFilters());
  } catch (err) {
    console.error("[home] providers failed:", err);
    if (!append) grid.innerHTML = `<div class="empty-state">Could not load providers.</div>`;
    return;
  }

  const providers = Array.isArray(result) ? result : (result.data || []);
  discoverState.total      = result.total      ?? providers.length;
  discoverState.page       = result.page       ?? 1;
  discoverState.limit      = result.limit      ?? discoverState.limit;
  discoverState.totalPages = result.totalPages ?? 1;

  if (append) {
    discoverState.accumulated.push(...providers);
  } else {
    discoverState.accumulated = providers;
  }

  const countEl = document.getElementById("results-count");
  if (countEl) {
    if (discoverState.total === 0) {
      countEl.textContent = "No providers found";
    } else {
      countEl.textContent =
        `Showing ${discoverState.accumulated.length} of ${discoverState.total} provider${discoverState.total === 1 ? "" : "s"}`;
    }
  }

  if (!discoverState.accumulated.length) {
    grid.innerHTML = `<div class="empty-state">No providers match your search.</div>`;
    renderLoadMoreButton();
    return;
  }

  grid.innerHTML = discoverState.accumulated.map(providerCard).join("");
  renderLoadMoreButton();
}

/* ---------------- Load More button ---------------- */
function renderLoadMoreButton() {
  let btn = document.getElementById("load-more-btn");

  const shown   = discoverState.accumulated.length;
  const total   = discoverState.total;
  const hasMore = shown < total;

  if (!hasMore) {
    if (btn) btn.remove();
    return;
  }

  if (!btn) {
    btn = document.createElement("button");
    btn.id = "load-more-btn";
    btn.type = "button";
    btn.className = "btn btn--ghost";
    btn.style.cssText =
      "display:block; margin: 24px auto 8px; min-height:44px; padding: 12px 32px;";
    btn.addEventListener("click", handleLoadMore);
    document.getElementById("provider-grid").insertAdjacentElement("afterend", btn);
  }

  const remaining = total - shown;
  btn.textContent = `Load more (${remaining} remaining)`;
  btn.disabled = false;
}

async function handleLoadMore() {
  const btn = document.getElementById("load-more-btn");
  if (!btn) return;

  btn.disabled = true;
  btn.textContent = "Loading…";

  discoverState.page++;
  await renderResults({ append: true });
}

/* ---------------- Live countdown ticker ---------------- */
function startCountdownTicker() {
  if (startCountdownTicker._id) clearInterval(startCountdownTicker._id);

  startCountdownTicker._id = setInterval(() => {
    document.querySelectorAll(".busy-countdown").forEach((el) => {
      const until = el.dataset.until;
      if (!until) return;

      const t = formatTimeUntil(until);
      el.textContent = (t && t.backTime)
        ? `⏸️ Busy until ${t.backTime} · ${t.relative}`
        : "⏸️ Busy · back any moment";
    });
  }, 30000);
}

/* ============================================================
   CATEGORY PAGINATION
   ============================================================ */
function setupCategoryLoadMore() {
  const moreBtn  = document.getElementById("btn-load-more-categories");
  const fewerBtn = document.getElementById("btn-show-fewer-categories");

  if (moreBtn) {
    moreBtn.addEventListener("click", () => {
      VISIBLE_CATEGORY_COUNT += CATEGORIES_PER_PAGE;
      renderCategoryTiles();
    });
  }

  if (fewerBtn) {
    fewerBtn.addEventListener("click", () => {
      VISIBLE_CATEGORY_COUNT = Math.max(
        INITIAL_CATEGORY_COUNT,
        VISIBLE_CATEGORY_COUNT - CATEGORIES_PER_PAGE
      );
      renderCategoryTiles();
    });
  }
}

/* ---------------- init ---------------- */
document.addEventListener("DOMContentLoaded", async () => {
  // Discover is public — no auth gate.

  try {
    await populateFilters();
    setupCategoryLoadMore();
    updateResultsHeading();
    await renderResults();
    startCountdownTicker();
  } catch (err) {
    console.error("[home] init failed:", err);
  }

  let searchTimer = null;
  const $q = document.getElementById("q");
  if ($q) {
    $q.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        discoverState.page = 1;
        discoverState.accumulated = [];
        renderResults();
      }, 200);
    });
  }

  const $phase = document.getElementById("phase");
  if ($phase) {
    $phase.addEventListener("change", (e) => {
      filterCourtsByPhase(e.target.value);
      discoverState.page = 1;
      discoverState.accumulated = [];
      renderResults();
    });
  }

  const $court = document.getElementById("court");
  if ($court) {
    $court.addEventListener("change", () => {
      discoverState.page = 1;
      discoverState.accumulated = [];
      renderResults();
    });
  }

  const $max = document.getElementById("maxPrice");
  if ($max) {
    $max.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        discoverState.page = 1;
        discoverState.accumulated = [];
        renderResults();
      }, 200);
    });
  }

  const $form = document.getElementById("search-form");
  if ($form) {
    $form.addEventListener("submit", (e) => {
      e.preventDefault();
      discoverState.page = 1;
      discoverState.accumulated = [];
      renderResults();
    });
  }

  const resetBtn = document.getElementById("reset-search");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      if ($q) $q.value = "";
      if ($phase) $phase.value = "";
      if ($court) $court.value = "";
      if ($max) $max.value = "";

      _state.activeCategory = null;
      renderCategoryTiles();
      updateResultsHeading();

      filterCourtsByPhase("");
      discoverState.page = 1;
      discoverState.accumulated = [];
      renderResults();
      if (typeof toast === "function") toast("Filters cleared.");
    });
  }
});