/* ============================================================
   home.js — Discover page: Phase → Court cascade + filters
   + Prev/Next pagination
   + Live countdown on Busy provider cards ("Busy until HH:MM")
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

/* ---------------- time-until formatter ---------------- */
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

/* ---------------- state ---------------- */
const _state = { categories: [], courts: [] };
const discoverState = { page: 1, limit: 6, total: 0, totalPages: 1 };

/* ---------------- Phase → Court cascade ---------------- */
function buildPhaseOptions(courts) {
  const phases = [...new Set(courts.map((c) => Number(c.phase)))]
    .filter((v) => !isNaN(v)).sort((a, b) => a - b);

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
    list.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
  $court.disabled = false;
}

/* ---------------- populate ---------------- */
async function populateFilters() {
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
}

function setCategoryChip(categoryId, chipEl) {
  document.getElementById("category").value = categoryId;
  document.querySelectorAll(".chip").forEach((c) => c.classList.remove("is-active"));
  chipEl.classList.add("is-active");
  discoverState.page = 1;
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

  /* ---------- Busy countdown strip ---------- */
  let busyLine = "";
  if (p.isAvailable === false) {
    let text;

    if (p.unavailableUntil) {
      const t = formatTimeUntil(p.unavailableUntil);
      text = (t && t.backTime)
        ? `⏸️ Busy until ${t.backTime} · ${t.relative}`
        : "⏸️ Busy · back any moment";
    } else {
      /* Safety fallback for indefinite mode */
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
  return {
    verified: true,
    search:   document.getElementById("q").value.trim(),
    phase:    document.getElementById("phase").value,
    courtId:  document.getElementById("court").value,
    category: document.getElementById("category").value,
    maxPrice: document.getElementById("maxPrice").value,
    page:     discoverState.page,
    limit:    discoverState.limit,
  };
}

/* ---------------- results ---------------- */
async function renderResults() {
  const grid = document.getElementById("provider-grid");
  grid.innerHTML = `<div class="empty-state">Loading providers…</div>`;

  let result;
  try {
    result = await Api.getProviders(buildDiscoverFilters());
  } catch (err) {
    console.error("[home] providers failed:", err);
    grid.innerHTML = `<div class="empty-state">Could not load providers.</div>`;
    return;
  }

  const providers = Array.isArray(result) ? result : (result.data || []);
  discoverState.total      = result.total      ?? providers.length;
  discoverState.page       = result.page       ?? 1;
  discoverState.limit      = result.limit      ?? discoverState.limit;
  discoverState.totalPages = result.totalPages ?? 1;

  if (discoverState.total === 0) {
    document.getElementById("results-count").textContent = "No providers found";
  } else {
    const startRow = ((discoverState.page - 1) * discoverState.limit) + 1;
    const endRow   = Math.min(discoverState.page * discoverState.limit, discoverState.total);
    document.getElementById("results-count").textContent =
      `Showing ${startRow}–${endRow} of ${discoverState.total} provider${discoverState.total === 1 ? "" : "s"}`;
  }

  if (!providers.length) {
    grid.innerHTML = `<div class="empty-state">No providers match your search.</div>`;
    renderPaginationFooter();
    return;
  }

  grid.innerHTML = providers.map(providerCard).join("");
  renderPaginationFooter();
}

/* ---------------- Pagination footer ---------------- */
function renderPaginationFooter() {
  const grid   = document.getElementById("provider-grid");
  const parent = grid.parentElement;
  let footer   = document.getElementById("discover-pagination");

  const { page, limit, total, totalPages } = discoverState;

  if (totalPages <= 1) {
    if (footer) footer.remove();
    return;
  }

  const prevDisabled = page <= 1 ? "disabled" : "";
  const nextDisabled = page >= totalPages ? "disabled" : "";

  if (!footer) {
    footer = document.createElement("div");
    footer.id = "discover-pagination";
    footer.style.cssText =
      "display:flex;justify-content:space-between;align-items:center;gap:12px;" +
      "flex-wrap:wrap;margin-top:24px;padding-top:16px;width:100%;";
    parent.appendChild(footer);
  }

  footer.innerHTML = `
    <div style="font-size:0.9rem;color:var(--ink-70);">
      Showing <b>${((page - 1) * limit) + 1}–${Math.min(page * limit, total)}</b>
      of <b>${total}</b> provider${total === 1 ? "" : "s"}
    </div>
    <div style="display:flex;gap:8px;align-items:center;">
      <button class="btn btn--ghost btn--small" data-discover-page="prev" ${prevDisabled}>
        « Prev
      </button>
      <span style="font-size:0.9rem;color:var(--ink-70);padding:0 4px;">
        Page <b>${page}</b> of <b>${totalPages}</b>
      </span>
      <button class="btn btn--ghost btn--small" data-discover-page="next" ${nextDisabled}>
        Next »
      </button>
    </div>
  `;

  footer.querySelectorAll("[data-discover-page]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const dir = btn.dataset.discoverPage;

      if (dir === "prev" && discoverState.page > 1) {
        discoverState.page--;
      } else if (dir === "next" && discoverState.page < discoverState.totalPages) {
        discoverState.page++;
      } else {
        return;
      }

      await renderResults();
      document.getElementById("results-heading")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
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
  }, 30000); // every 30 seconds
}

/* ---------------- init ---------------- */
document.addEventListener("DOMContentLoaded", async () => {
  if (typeof requireAuth === "function" && !requireAuth()) return;

  try {
    await populateFilters();
    await renderResults();
    startCountdownTicker();
  } catch (err) {
    console.error("[home] init failed:", err);
  }

  let searchTimer = null;
  document.getElementById("q").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      discoverState.page = 1;
      renderResults();
    }, 200);
  });

  document.getElementById("phase").addEventListener("change", (e) => {
    filterCourtsByPhase(e.target.value);
    discoverState.page = 1;
    renderResults();
  });

  document.getElementById("court").addEventListener("change", () => {
    discoverState.page = 1;
    renderResults();
  });

  document.getElementById("category").addEventListener("change", () => {
    discoverState.page = 1;
    renderResults();
  });

  document.getElementById("maxPrice").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      discoverState.page = 1;
      renderResults();
    }, 200);
  });

  document.getElementById("search-form").addEventListener("submit", (e) => {
    e.preventDefault();
    discoverState.page = 1;
    renderResults();
  });

  /* Reset filters button */
  const resetBtn = document.getElementById("reset-search");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      document.getElementById("q").value = "";
      document.getElementById("phase").value = "";
      document.getElementById("court").value = "";
      document.getElementById("category").value = "";
      document.getElementById("maxPrice").value = "";

      document.querySelectorAll(".chip").forEach((c) => c.classList.remove("is-active"));
      document.querySelector(".chip")?.classList.add("is-active");

      filterCourtsByPhase("");
      discoverState.page = 1;
      renderResults();
      toast("Filters cleared.");
    });
  }
});