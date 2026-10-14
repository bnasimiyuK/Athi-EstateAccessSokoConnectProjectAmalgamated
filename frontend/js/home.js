/* ============================================================
   home.js — Discover page
   All figures come from the backend. Every API call is
   defensively wrapped so a missing/failing endpoint degrades
   gracefully instead of leaving the UI on "Loading…".
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
  const back     = new Date(iso);
  const backTime = back.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" });
  let relative;
  if (diffMins < 60) relative = `in ${diffMins} min`;
  else {
    const hrs  = Math.floor(diffMins / 60);
    const mins = diffMins % 60;
    relative = mins > 0 ? `in ${hrs}h ${mins}m` : `in ${hrs}h`;
  }
  return { relative, backTime };
}

/* ---------------- category icons (UI decoration only) ---------------- */
const CATEGORY_EMOJI = {
  "Plumbing": "🔧", "Cleaning": "🧽", "Housekeeping": "🏠",
  "Electrical": "⚡", "Electrical & Solar": "⚡", "Errands": "🏃",
  "Gardening": "🌿", "Painting": "🎨", "Moving": "📦",
  "Tutoring": "📚", "Pharmacy": "💊", "Cobbler": "👞",
  "Bicycle repairs": "🚲", "Mechanic": "🔩", "Car wash": "🚗",
  "Agro vet": "🐄", "Mason": "🧱", "Carpenter": "🪚",
  "School": "🏫", "Clinic": "🩺", "Hospital": "🏥",
  "Supermarket": "🏪", "Poshomill": "🌾", "Butchery": "🥩",
  "Water vendor": "💧", "Exhauster": "🚛", "Restaurant": "🍽️",
  "Grocery": "🛒", "Fresh Groceries": "🛒", "Garbage Collector": "🗑️",
};
function categoryIcon(input) {
  const obj = (input && typeof input === "object") ? input : { label: input };
  return obj.icon || CATEGORY_EMOJI[obj.label] || "🌐";
}

/* ---------------- state ---------------- */
const _state = {
  categories: [],
  courts: [],
  activeCategory: null,
  allProviders: [],
  categoriesExpanded: false,
  quickFilter: "all",
};

const discoverState = {
  page: 1,
  limit: 6,
  total: 0,
  totalPages: 1,
  accumulated: [],
};

/* ============================================================
   Safe API wrapper — never throws, always returns a fallback.
   ============================================================ */
async function safeApi(method, fallback, ...args) {
  try {
    if (typeof Api === "undefined" || typeof Api[method] !== "function") {
      console.warn(`[home] Api.${method} not available`);
      return fallback;
    }
    const r = await Api[method](...args);
    return r ?? fallback;
  } catch (err) {
    console.warn(`[home] Api.${method} failed:`, err.message || err);
    return fallback;
  }
}

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
    $court.innerHTML = `<option value="">All courts</option>`;
    $court.disabled = false;
    return;
  }

  $court.innerHTML = `<option value="">All courts</option>` +
    list.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
  $court.disabled = false;
}

/* ============================================================
   NOTICE BANNER
   ============================================================ */
async function renderNotice() {
  const labelEl = document.getElementById("notice-label");
  const textEl  = document.getElementById("notice-text");
  if (!labelEl || !textEl) return;

  const notice = await safeApi("getNotice", null);
  if (!notice) {
    labelEl.textContent = "ATHI HIGHWAY ESTATE NOTICE";
    textEl.textContent  = "Welcome to Athi Soko Connect — your trusted estate directory.";
    return;
  }
  labelEl.textContent = notice.label || "ATHI HIGHWAY ESTATE NOTICE";
  textEl.textContent  = notice.text  || "";
}

/* ============================================================
   HERO EYEBROW
   ============================================================ */
async function renderHeroEyebrow() {
  const el = document.getElementById("hero-eyebrow");
  if (!el) return;

  const r = await safeApi("getPhaseRange", null);
  if (r && r.min != null && r.max != null) {
    const range = r.min === r.max ? `Phase ${r.min}` : `Phase ${r.min}-${r.max}`;
    el.innerHTML = `<i class="fas fa-check-circle"></i> Athi Highway Estate · ${range} · Residents only`;
    return;
  }

  const phases = [...new Set(
    _state.courts.map((c) => Number(c.phase)).filter((v) => !isNaN(v))
  )].sort((a, b) => a - b);

  if (!phases.length) {
    el.innerHTML = `<i class="fas fa-check-circle"></i> Athi Highway Estate · Residents only`;
    return;
  }
  const range = phases[0] === phases[phases.length - 1]
    ? `Phase ${phases[0]}`
    : `Phase ${phases[0]}-${phases[phases.length - 1]}`;
  el.innerHTML = `<i class="fas fa-check-circle"></i> Athi Highway Estate · ${range} · Residents only`;
}

/* ============================================================
   HERO STATS
   ============================================================ */
function renderStats(providers) {
  const list = Array.isArray(providers) ? providers : [];
  const total    = list.length;
  const verified = list.filter((p) => p.verified).length;
  const readyNow = list.filter((p) => p.isAvailable !== false).length;
  const courts   = [...new Set(list.map((p) => p.courtName).filter(Boolean))];

  const totalEl = document.getElementById("stat-providers");
  if (totalEl) totalEl.textContent = total.toLocaleString();

  const courtsEl = document.getElementById("stat-courts");
  if (courtsEl) {
    courtsEl.textContent = courts.length
      ? `Across ${courts.length} court${courts.length === 1 ? "" : "s"}`
      : "Across the estate";
  }

  const verifiedEl = document.getElementById("stat-verified");
  if (verifiedEl) verifiedEl.textContent = verified.toLocaleString();

  const verifiedSub = document.getElementById("stat-verified-sub");
  if (verifiedSub) {
    const pct = total > 0 ? Math.round((verified / total) * 100) : 0;
    verifiedSub.textContent = total > 0
      ? `${pct}% · Approved after admin review`
      : "Approved after admin review";
  }

  const readyEl = document.getElementById("stat-ready");
  if (readyEl) readyEl.textContent = readyNow.toLocaleString();

  const readyCountEl = document.getElementById("ready-count");
  if (readyCountEl) readyCountEl.textContent = readyNow.toLocaleString();
}

function renderStatsFallback() {
  const dash = (id, txt = "0") => {
    const el = document.getElementById(id);
    if (el) el.textContent = txt;
  };
  dash("stat-providers", "0");
  dash("stat-verified", "0");
  dash("stat-ready", "0");
  dash("ready-count", "0");
  const sub1 = document.getElementById("stat-courts");
  if (sub1) sub1.textContent = "Across the estate";
  const sub2 = document.getElementById("stat-verified-sub");
  if (sub2) sub2.textContent = "Approved after admin review";
}

/* ============================================================
   GATE CLEARANCE
   ============================================================ */
async function renderGateClearance() {
  const pill = document.getElementById("gate-clearance-pill");
  if (!pill) return;

  const data = await safeApi("getGateStatus", null);

  if (!data || !data.status) {
    const nowEAT = new Date(new Date().toLocaleString("en-US", {
      timeZone: "Africa/Nairobi",
    }));
    const h = nowEAT.getHours();
    if (h >= 6 && h < 22) {
      pill.className = "pill pill--live";
      pill.textContent = "Gate: Live";
    } else {
      pill.className = "pill pill--closed";
      pill.textContent = "Gate 2 Closed";
    }
    return;
  }

  const map = { live: "pill--live", busy: "pill--busy", closed: "pill--closed" };
  pill.className = `pill ${map[data.status] || "pill--live"}`;
  pill.textContent = data.label || "Gate: Live";
  pill.dataset.status = data.status;

  let tooltip;
  switch (data.status) {
    case "live":
      tooltip = `Gate 2 open. Closes in ${data.nextChangeMinutes || "?"} min (22:00 EAT). Gate 1 open 24/7.`;
      break;
    case "busy":
      tooltip = `Gate 2 closing in ${data.nextChangeMinutes || "?"} min. Gate 1 remains open.`;
      break;
    case "closed":
      tooltip = `Gate 2 reopens in ${data.nextChangeMinutes || "?"} min (06:00 EAT). Gate 1 open 24/7.`;
      break;
    default:
      tooltip = "Gate status unavailable";
  }
  pill.title = tooltip;

  if (data.nextChangeMinutes != null && data.nextChangeMinutes > 0) {
    const msUntilChange = data.nextChangeMinutes * 60 * 1000;
    const delay = Math.min(msUntilChange + 5000, 60000);
    clearTimeout(renderGateClearance._timer);
    renderGateClearance._timer = setTimeout(renderGateClearance, delay);
  }
}

/* ============================================================
   CATEGORY TILES
   ============================================================ */
function renderCategoryTiles() {
  const el = document.getElementById("category-tiles");
  if (!el) return;

  const allActive = _state.activeCategory === null;

  const countsById = {};
  _state.allProviders.forEach((p) => {
    const cid = p.category;
    if (cid != null) countsById[cid] = (countsById[cid] || 0) + 1;
  });

  const totalProviders = _state.allProviders.length ||
    _state.categories.reduce((sum, c) => sum + (c.count || 0), 0);

  const INITIAL_COUNT = 5;
  const visibleCats = _state.categoriesExpanded
    ? _state.categories
    : _state.categories.slice(0, INITIAL_COUNT);

  let html = `
    <button type="button" class="category-tile ${allActive ? "is-active" : ""}" data-cat="">
      <div class="category-tile_icon">📋</div>
      <div class="category-tile_label">All Providers</div>
      <div class="category-tile_count">${totalProviders || 0}</div>
    </button>
  `;

  html += visibleCats.map((c) => {
    const isActive = _state.activeCategory === c.id;
    const count = c.count ?? countsById[c.id] ?? 0;
    return `
      <button type="button" class="category-tile ${isActive ? "is-active" : ""}" data-cat="${c.id}">
        <div class="category-tile_icon">${categoryIcon(c)}</div>
        <div class="category-tile_label">${escapeHtml(c.label)}</div>
        <div class="category-tile_count">${count}</div>
      </button>
    `;
  }).join("");

  el.innerHTML = html;

  el.querySelectorAll(".category-tile").forEach((btn) => {
    btn.addEventListener("click", () => {
      const raw = btn.dataset.cat;
      _state.activeCategory = raw === "" ? null : parseInt(raw, 10);
      renderCategoryTiles();
      updateResultsHeading();
      discoverState.page = 1;
      discoverState.accumulated = [];
      renderResults();
    });
  });

  updateViewAllLink();
}

function updateViewAllLink() {
  const link = document.getElementById("view-all-categories");
  if (!link) return;

  const total = _state.categories.length;
  if (total <= 5) { link.style.display = "none"; return; }
  link.style.display = "inline-block";

  if (_state.categoriesExpanded) {
    link.classList.add("is-expanded");
    link.textContent = "Show fewer categories ▴";
  } else {
    link.classList.remove("is-expanded");
    link.textContent = `View more categories (${total - 5}) ▾`;
  }
}

function setupViewAllToggle() {
  const link = document.getElementById("view-all-categories");
  if (!link) return;
  link.addEventListener("click", (e) => {
    e.preventDefault();
    _state.categoriesExpanded = !_state.categoriesExpanded;
    renderCategoryTiles();
  });
}

/* ============================================================
   RESULTS HEADING
   ============================================================ */
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

/* ============================================================
   POPULATE FILTERS + STATS
   ============================================================ */
async function populateFilters() {
  /* Categories */
  let counted = await safeApi("getCategoryCounts", null);
  if (!Array.isArray(counted) || !counted.length) {
    counted = await safeApi("getCategories", []);
  }
  _state.categories = Array.isArray(counted) ? counted : [];
  renderCategoryTiles();

  /* Courts */
  const courts = await safeApi("getCourts", []);
  _state.courts = Array.isArray(courts) ? courts : [];
  buildPhaseOptions(_state.courts);
  filterCourtsByPhase("");

  /* Hero eyebrow */
  await renderHeroEyebrow();

  /* Providers — used for stats + category count fallback */
  const all = await safeApi("getProviders", [], { limit: 9999 });
  const list = Array.isArray(all) ? all : (all?.data || []);
  _state.allProviders = list;

  renderCategoryTiles();
  if (list.length) renderStats(list);
  else             renderStatsFallback();

  /* Notice + gate */
  await renderNotice();
  await renderGateClearance();
}

/* ============================================================
   PROVIDER CARD
   ============================================================ */
function providerCard(p) {
  const initials = initialsOf(p.name);
  const cat = p.categoryLabel || "Service";

  const verifiedPill = p.verified
    ? `<span class="badge badge--verified">Verified</span>`
    : "";

  const availabilityPill = p.isAvailable === false
    ? `<span class="badge" style="background:#e74c3c;color:white;">Busy</span>`
    : "";

  const badge = verifiedPill + (availabilityPill ? " " + availabilityPill : "");

  const rating      = Number(p.rating || 0).toFixed(1);
  const reviewCount = Number(p.reviews || 0);
  const services    = servicesArray(p).slice(0, 3);
  const price       = Number(p.priceFrom || 0);

  const locParts = [];
  if (p.courtName)     locParts.push(escapeHtml(p.courtName));
  if (p.phase != null) locParts.push(`Phase ${p.phase}`);
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
      <div class="busy-countdown busy-line" data-until="${p.unavailableUntil || ""}">
        ${text}
      </div>`;
  }

  return `
    <a class="card" href="provider.html?id=${encodeURIComponent(p.id)}">
      <div class="card-top">
        <div class="card-top_left">
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

/* ============================================================
   FILTERS + RESULTS
   ============================================================ */
function buildDiscoverFilters() {
  return {
    verified: _state.quickFilter === "all",
    available: _state.quickFilter === "available" ? true : "",
    search:   (document.getElementById("q")?.value || "").trim(),
    phase:    document.getElementById("phase")?.value || "",
    courtId:  document.getElementById("court")?.value || "",
    category: _state.activeCategory ?? "",
    maxPrice: document.getElementById("maxPrice")?.value || "",
    sort:     document.getElementById("sort-by")?.value || "rating",
    page:     discoverState.page,
    limit:    discoverState.limit,
  };
}

async function renderResults({ append = false } = {}) {
  const grid = document.getElementById("provider-grid");
  if (!grid) return;

  if (!append) {
    grid.innerHTML = `<div class="empty-state">Loading providers…</div>`;
    discoverState.accumulated = [];
  }

  const result = await safeApi("getProviders", { data: [], total: 0 }, buildDiscoverFilters());
  const providers = Array.isArray(result) ? result : (result?.data || []);

  discoverState.total      = result?.total      ?? providers.length;
  discoverState.page       = result?.page       ?? 1;
  discoverState.limit      = result?.limit      ?? discoverState.limit;
  discoverState.totalPages = result?.totalPages ?? 1;

  if (append) discoverState.accumulated.push(...providers);
  else        discoverState.accumulated = providers;

  const countEl = document.getElementById("results-count");
  if (countEl) {
    if (discoverState.total === 0) {
      countEl.textContent = "No providers found";
    } else {
      countEl.textContent =
        `${discoverState.accumulated.length} of ${discoverState.total} provider${discoverState.total === 1 ? "" : "s"}`;
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

function renderLoadMoreButton() {
  let btn = document.getElementById("load-more-btn");

  const shown   = discoverState.accumulated.length;
  const total   = discoverState.total;
  const hasMore = shown < total;

  if (!hasMore) { if (btn) btn.remove(); return; }

  if (!btn) {
    btn = document.createElement("button");
    btn.id = "load-more-btn";
    btn.type = "button";
    btn.className = "btn btn--ghost";
    btn.style.cssText =
      "display:block; margin:24px auto 8px; min-height:44px; padding:12px 32px;";
    btn.addEventListener("click", handleLoadMore);
    document.getElementById("provider-grid").insertAdjacentElement("afterend", btn);
  }

  btn.textContent = `Load more (${total - shown} remaining)`;
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

/* ---------------- Countdown ticker ---------------- */
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
   QUICK FILTER CHIPS
   ============================================================ */
function setupQuickFilters() {
  const chips = document.querySelectorAll(".dx-chip--btn[data-quick]");
  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      chips.forEach((c) => c.classList.remove("is-active"));
      chip.classList.add("is-active");
      _state.quickFilter = chip.dataset.quick || "all";
      discoverState.page = 1;
      discoverState.accumulated = [];
      renderResults();
    });
  });
}

/* ============================================================
   LIVE SYNC INDICATOR
   ============================================================ */
async function fetchLastSyncTime() {
  const iso = await safeApi("getLastSync", null);
  return iso || new Date().toISOString();
}

function classifyFreshness(iso) {
  const diffMin = (Date.now() - new Date(iso).getTime()) / 60000;
  if (diffMin < 15)  return "fresh";
  if (diffMin < 120) return "recent";
  if (diffMin < 720) return "stale";
  return "offline";
}

function formatTimeEAT(iso) {
  return new Date(iso).toLocaleTimeString("en-KE", {
    hour: "2-digit", minute: "2-digit", hour12: false,
    timeZone: "Africa/Nairobi",
  });
}

async function renderSyncIndicator() {
  const el = document.getElementById("sync-indicator");
  const t  = document.getElementById("sync-time");
  if (!el || !t) return;

  const tick = async () => {
    const iso    = await fetchLastSyncTime();
    const status = classifyFreshness(iso);
    t.textContent = formatTimeEAT(iso);
    t.setAttribute("datetime", iso);

    el.classList.remove(
      "sync-indicator--recent",
      "sync-indicator--stale",
      "sync-indicator--offline"
    );
    if (status !== "fresh") el.classList.add(`sync-indicator--${status}`);
    el.title = `Last synced at ${formatTimeEAT(iso)} EAT. Click to refresh.`;
  };

  await tick();

  el.addEventListener("click", async () => {
    if (el.classList.contains("is-refreshing")) return;
    el.classList.add("is-refreshing");
    await Promise.all([tick(), new Promise((r) => setTimeout(r, 500))]);
    el.classList.remove("is-refreshing");
    if (typeof toast === "function") toast("Directory refreshed.");
  });

  setInterval(tick, 60000);
}

/* ============================================================
   GATE RULES MODAL
   ============================================================ */
async function setupGateRulesModal() {
  const triggers = document.querySelectorAll('[data-open="gate-rules"]');
  const modal   = document.getElementById("gate-rules-modal");
  if (!triggers.length || !modal) return;

  const tbody   = document.getElementById("gate-rules-body");
  const updated = document.getElementById("gate-rules-updated");

  const data = await safeApi("getGateRules", null);

  const open = async (e) => {
    if (e) e.preventDefault();

    if (tbody) {
      if (data?.rules?.length) {
        tbody.innerHTML = data.rules.map((r) => `
          <tr><th>${escapeHtml(r.label)}</th><td>${escapeHtml(r.body)}</td></tr>
        `).join("");
      } else {
        tbody.innerHTML = `
          <tr><th>Gate 1</th><td>Open 24/7 for residents and registered visitors.</td></tr>
          <tr><th>Gate 2</th><td>Open 06:00 – 22:00 EAT daily.</td></tr>
          <tr><th>Visitors</th><td>Must be pre-registered or announced at the control desk.</td></tr>
        `;
      }
    }

    if (updated) {
      const iso = data?.updatedAt || await fetchLastSyncTime();
      updated.textContent = `${formatTimeEAT(iso)} EAT`;
      updated.setAttribute("datetime", iso);
    }

    modal.classList.add("is-open");
    document.body.style.overflow = "hidden";

    const btn = modal.querySelector("[data-close-modal]");
    if (btn) btn.focus();
  };

  const close = () => {
    modal.classList.remove("is-open");
    document.body.style.overflow = "";
  };

  triggers.forEach((t) => t.addEventListener("click", open));

  modal.addEventListener("click", (e) => {
    if (e.target === modal || e.target.matches("[data-close-modal]")) close();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.classList.contains("is-open")) close();
  });
}

/* ============================================================
   BOOT
   ============================================================ */
document.addEventListener("DOMContentLoaded", async () => {
  /* NOTE: Discover is a public page. We do NOT hard-gate on
     requireAuth() — otherwise nothing renders for guests and
     the page stays on "Loading…". */

  /* Wait for the API base to be discovered before any API call.
     On the mobile app this can take up to ~2s while LAN
     candidates are probed; on desktop it resolves instantly. */
  try {
    if (window.__apiReady) await window.__apiReady;
  } catch (err) {
    console.warn("[home] API discovery failed:", err);
  }

  try {
    await populateFilters();
    setupQuickFilters();
    setupViewAllToggle();
    updateResultsHeading();
    await renderResults();
    startCountdownTicker();

    renderSyncIndicator();
    setupGateRulesModal();
  } catch (err) {
    console.error("[home] init failed:", err);
    // Last-resort: make sure the grid is never stuck on "Loading…"
    const grid = document.getElementById("provider-grid");
    if (grid && grid.querySelector(".empty-state")) {
      grid.innerHTML = `<div class="empty-state">Could not load providers. Please refresh.</div>`;
    }
    renderStatsFallback();
  }

  renderGateClearance();
  setInterval(renderGateClearance, 60000);

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

  const $maxPrice = document.getElementById("maxPrice");
  if ($maxPrice) {
    $maxPrice.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        discoverState.page = 1;
        discoverState.accumulated = [];
        renderResults();
      }, 200);
    });
  }

  const $sort = document.getElementById("sort-by");
  if ($sort) {
    $sort.addEventListener("change", () => {
      discoverState.page = 1;
      discoverState.accumulated = [];
      renderResults();
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

  const $reset = document.getElementById("reset-search");
  if ($reset) {
    $reset.addEventListener("click", () => {
      if ($q)        $q.value = "";
      if ($phase)    $phase.value = "";
      if ($court)    $court.value = "";
      if ($maxPrice) $maxPrice.value = "";

      _state.activeCategory = null;
      _state.quickFilter    = "all";

      document.querySelectorAll(".dx-chip--btn[data-quick]").forEach((c) => {
        c.classList.toggle("is-active", c.dataset.quick === "all");
      });

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