/* ============================================================
   home.js — search, filter, and render the provider directory
   ============================================================ */

async function populateFilters() {
  const categories = await loadCategoryCache();

  const categorySelect = document.getElementById("category");
  categorySelect.innerHTML = `<option value="">All categories</option>`;

  categories.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.label;
    categorySelect.appendChild(opt);
  });

  const allProviders = await Api.getProviders();

  const zoneSelect = document.getElementById("zone");
  zoneSelect.innerHTML = `<option value="">All zones</option>`;

  const zones = [...new Set(allProviders.map((p) => p.zone))].sort();

  zones.forEach((z) => {
    const opt = document.createElement("option");
    opt.value = z;
    opt.textContent = z;
    zoneSelect.appendChild(opt);
  });

  /* -------- CATEGORY CHIPS -------- */
  const chipRow = document.getElementById("chip-row");
  chipRow.innerHTML = "";

  const allChip = document.createElement("button");
  allChip.type = "button";
  allChip.className = "chip is-active";
  allChip.textContent = "All";
  allChip.onclick = () => setCategoryChip("", allChip);

  chipRow.appendChild(allChip);

  categories.forEach((c) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = c.label;

    chip.onclick = () => setCategoryChip(c.id, chip);

    chipRow.appendChild(chip);
  });

  renderStats(allProviders);
}

function setCategoryChip(categoryId, chipEl) {
  document.getElementById("category").value = categoryId;

  document.querySelectorAll(".chip").forEach((c) =>
    c.classList.remove("is-active")
  );

  chipEl.classList.add("is-active");

  renderResults();
}

function renderStats(providers) {
  document.getElementById("stat-providers").textContent =
    providers.length;

  document.getElementById("stat-verified").textContent =
    providers.filter((p) => p.verified).length;
}

function providerCard(p) {
  const initials = p.name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("");

  return `
    <a class="card" href="provider.html?id=${p.id}">
      <div class="card-top">
        <div style="display:flex; gap:12px; align-items:center;">
          <div class="avatar">${initials}</div>
          <div>
            <h3>${p.name}</h3>
            <div class="meta">${categoryLabel(p.category)} · ${p.zone}</div>
          </div>
        </div>
        ${verifiedBadge(p.verified)}
      </div>

      <div class="rating">
        ${starString(p.rating)} ${p.reviews ? `(${p.reviews})` : ""}
      </div>

      <div class="tags">
        ${p.services
          .slice(0, 3)
          .map((s) => `<span class="tag">${s}</span>`)
          .join("")}
      </div>

      <div class="card-footer">
        <span class="price">
          From KSh ${p.priceFrom} <small>${p.priceUnit}</small>
        </span>
        <span class="meta">${p.hours}</span>
      </div>
    </a>
  `;
}

async function renderResults() {
  const grid = document.getElementById("provider-grid");

  grid.innerHTML = `<div class="empty-state">Loading providers…</div>`;

  const q = document.getElementById("q").value.trim();
  const category = document.getElementById("category").value;
  const zone = document.getElementById("zone").value;

  let results = [];

  try {
    results = await Api.getProviders({ q, category, zone });
  } catch (err) {
    grid.innerHTML = `<div class="empty-state">Server error. Check backend.</div>`;
    return;
  }

  document.getElementById("results-count").textContent =
    `${results.length} provider${results.length === 1 ? "" : "s"} found`;

  grid.innerHTML = results.length
    ? results.map(providerCard).join("")
    : `<div class="empty-state">No providers found.</div>`;
}

/* ---------------- INIT ---------------- */
document.addEventListener("DOMContentLoaded", async () => {
  await populateFilters();
  await renderResults();

  document
    .getElementById("search-form")
    .addEventListener("submit", (e) => {
      e.preventDefault();
      renderResults();
    });

  document
    .getElementById("category")
    .addEventListener("change", renderResults);

  document
    .getElementById("zone")
    .addEventListener("change", renderResults);
});