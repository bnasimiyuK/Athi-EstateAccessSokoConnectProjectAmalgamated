/* ============================================================
   provider-profile.js — vendor manages their own profile
   + modal duration picker (specific durations only)
   + multi-category offerings editor
   ============================================================ */

/* ---------------- module state ---------------- */
let _offerings  = [];   // each: { id?, category, priceFrom, priceUnit, services[], sortOrder }
let _categories = [];   // [{ id, label }, …]

/* ---------------- constants ---------------- */
const UNIT_OPTIONS = [
  "per visit",
  "per hour",
  "per day",
  "per session",
  "per trip",
  "per kg",
  "per load",
  "per item",
];

/* ---------------- helpers ---------------- */
function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getUser() {
  try { return JSON.parse(localStorage.getItem("asc_user") || "null"); }
  catch { return null; }
}

function servicesToInput(services) {
  if (Array.isArray(services)) return services.join(", ");
  return String(services || "");
}

function splitServices(raw) {
  return String(raw || "")
    .split(/\s*,\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isKnownUnit(unit) {
  return UNIT_OPTIONS.includes(unit);
}

function unitFieldHtml(idx, currentUnit) {
  const known = isKnownUnit(currentUnit);
  const selected = known ? currentUnit : "__custom__";

  const opts = UNIT_OPTIONS.map((u) =>
    `<option value="${u}"${u === selected ? " selected" : ""}>${u}</option>`
  ).join("");

  return `
    <select class="offering-unit-select" data-idx="${idx}">
      ${opts}
      <option value="__custom__"${selected === "__custom__" ? " selected" : ""}>Custom…</option>
    </select>
    <input type="text"
           class="offering-unit-custom"
           data-idx="${idx}"
           placeholder="e.g. per 5kg load"
           value="${escapeHtml(known ? "" : currentUnit || "")}"
           style="margin-top:6px; ${known ? "display:none;" : ""}" />
  `;
}

/* ============================================================
   SYNCHRONISE — read the current DOM state back into _offerings
   Called at the top of every save. This is the single most
   important function in this file: it guarantees that what the
   user sees on screen is exactly what gets sent to the server,
   regardless of whether change/input events fired correctly.
   ============================================================ */
function syncOfferingsFromDom() {
  const rows = document.querySelectorAll(".offering-row");

  /* If the number of rows doesn't match _offerings, rebuild from scratch */
  if (rows.length !== _offerings.length) {
    const rebuilt = [];
    rows.forEach((row) => {
      const idx = Number(row.dataset.idx);

      /* Preserve the id of the corresponding in-memory entry if it exists */
      const previous = _offerings[idx] || {};
      rebuilt.push({
        id:        previous.id || null,
        category:  null,
        priceFrom: 0,
        priceUnit: "per visit",
        services:  [],
        sortOrder: previous.sortOrder ?? idx,
      });
    });
    _offerings = rebuilt;
  }

  rows.forEach((row, idx) => {
    if (!_offerings[idx]) return;

    const catEl     = row.querySelector(".offering-category");
    const priceEl   = row.querySelector(".offering-price");
    const unitSelEl = row.querySelector(".offering-unit-select");
    const unitTxtEl = row.querySelector(".offering-unit-custom");
    const svcEl     = row.querySelector(".offering-services");

    if (catEl) {
      const v = catEl.value;
      _offerings[idx].category = v ? Number(v) : null;
    }
    if (priceEl) {
      _offerings[idx].priceFrom = Number(priceEl.value) || 0;
    }
    if (svcEl) {
      _offerings[idx].services = splitServices(svcEl.value);
    }

    if (unitSelEl && unitSelEl.value && unitSelEl.value !== "__custom__") {
      _offerings[idx].priceUnit = unitSelEl.value;
    } else if (unitTxtEl && unitTxtEl.value.trim()) {
      _offerings[idx].priceUnit = unitTxtEl.value.trim();
    } else if (!_offerings[idx].priceUnit) {
      _offerings[idx].priceUnit = "per visit";
    }
  });
}

/* ============================================================
   RENDER — whole profile card
   ============================================================ */
function renderProfile(p, categories) {
  _categories = Array.isArray(categories) ? categories : [];

  const catOptions = _categories.map((c) =>
    `<option value="${c.id}" ${c.id === p.category ? "selected" : ""}>${escapeHtml(c.label || c.name || "Category")}</option>`
  ).join("");

  const isAvailable = p.isAvailable !== false;

  let labelText = "✅ Available for new bookings";
  if (!isAvailable) {
    if (p.unavailableUntil) {
      const back = new Date(p.unavailableUntil);
      labelText = `⏸️ Not accepting bookings (back at ${back.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })})`;
    } else {
      labelText = "⏸️ Not accepting bookings";
    }
  }

  const subText = isAvailable
    ? "Residents can find and book you on the Discover page."
    : "Your profile stays visible on Discover with a Busy badge. Bookings are paused.";

  document.getElementById("profile-root").innerHTML = `
    <div class="card" style="max-width:720px; padding:24px;">

      <div id="availability-box" style="display:flex; justify-content:space-between; align-items:center;
                  padding:14px 16px; border-radius:8px;
                  background:${isAvailable ? "#e8f5e9" : "#fdecea"};
                  border:1px solid ${isAvailable ? "#a5d6a7" : "#f5c6cb"};
                  margin-bottom:24px;">
        <div>
          <div id="availability-label" style="font-weight:600; color:${isAvailable ? "#2e7d32" : "#c0392b"};">
            ${labelText}
          </div>
          <div id="availability-sublabel" style="font-size:0.85rem; color:var(--ink-70); margin-top:2px;">
            ${subText}
          </div>
        </div>
        <label style="position:relative; display:inline-block; width:52px; height:28px; flex-shrink:0;">
          <input type="checkbox" id="availability-toggle" ${isAvailable ? "checked" : ""}
                 style="opacity:0; width:0; height:0;">
          <span id="availability-slider" style="position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0;
                background-color:${isAvailable ? "#27ae60" : "#ccc"}; border-radius:28px; transition:.3s;"></span>
        </label>
      </div>

      <h2 style="margin-top:0;">Edit details</h2>

      <form id="profile-form">
        <div class="field">
          <label for="pf-name">Business name</label>
          <input id="pf-name" type="text" required value="${escapeHtml(p.name)}" />
        </div>

        <div class="field">
          <label for="pf-hours">Working hours</label>
          <input id="pf-hours" type="text" value="${escapeHtml(p.hours || "")}"
                 placeholder="e.g. Mon-Sat, 8am-5pm" />
        </div>

        <div class="field">
          <label for="pf-bio">About your business</label>
          <textarea id="pf-bio" rows="3" placeholder="Tell residents about your work…">${escapeHtml(p.bio || "")}</textarea>
        </div>

        <hr style="margin:22px 0 16px; border:none; border-top:1px solid var(--line);" />

        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <div>
            <h3 style="margin:0; font-size:1rem;">Services &amp; categories</h3>
            <p style="margin:2px 0 0; font-size:0.82rem; color:var(--ink-70);">
              Add each category you offer, with its own price and services list.
            </p>
          </div>
          <button type="button" class="btn btn--ghost btn--small" id="offering-add-btn">+ Add category</button>
        </div>

        <div id="offerings-list" style="display:flex; flex-direction:column; gap:10px; margin:12px 0 0;"></div>

        <div style="display:none;">
          <select id="pf-category">${catOptions}</select>
          <input id="pf-price" type="number" />
          <input id="pf-unit" type="text" />
          <input id="pf-services" type="text" />
        </div>

        <div style="display:flex; gap:8px; margin-top:22px;">
          <button type="submit" class="btn btn--accent" id="save-btn">Save changes</button>
          <a href="provider-dashboard.html" class="btn btn--ghost">Cancel</a>
        </div>

        <p id="profile-msg" style="font-size:0.88rem;margin:10px 0 0;display:none;"></p>
      </form>
    </div>
  `;

  /* Load offerings into memory */
  if (Array.isArray(p.offerings) && p.offerings.length) {
    _offerings = p.offerings.map((o, idx) => ({
      id:        o.id || null,
      category:  o.category || null,
      priceFrom: Number(o.priceFrom || 0),
      priceUnit: o.priceUnit || "per visit",
      services:  Array.isArray(o.services) ? o.services.slice() : splitServices(o.services),
      sortOrder: o.sortOrder ?? idx,
    }));
  } else if (p.category) {
    _offerings = [{
      id:        null,
      category:  p.category,
      priceFrom: Number(p.priceFrom || 0),
      priceUnit: p.priceUnit || "per visit",
      services:  Array.isArray(p.services) ? p.services.slice() : splitServices(p.services),
      sortOrder: 0,
    }];
  } else {
    _offerings = [];
  }

  renderOfferings();
  wireAddOffering();
  wireForm(p);
  wireAvailabilityToggle(p);
}

/* ============================================================
   OFFERINGS EDITOR
   ============================================================ */
function renderOfferings() {
  const root = document.getElementById("offerings-list");
  if (!root) return;

  if (!_offerings.length) {
    root.innerHTML = `
      <div class="empty-state" style="padding:14px; font-size:0.88rem;">
        No service offerings yet. Click <b>+ Add category</b> to start.
      </div>`;
    return;
  }

  const catOptsFor = (selected) =>
    `<option value="">- Select category -</option>` +
    _categories.map((c) => {
      const label = c.label || c.name || "Category";
      const sel = String(c.id) === String(selected) ? " selected" : "";
      return `<option value="${c.id}"${sel}>${escapeHtml(label)}</option>`;
    }).join("");

  root.innerHTML = _offerings.map((o, idx) => `
    <div class="offering-row" data-idx="${idx}"
         style="border:1px solid var(--line); border-radius:8px; padding:12px; background:#fafbfc;">

      <div style="display:flex; gap:10px; align-items:flex-start;">
        <div class="field" style="flex:1;">
          <label style="font-size:0.78rem;">Category</label>
          <select class="offering-category" data-idx="${idx}">
            ${catOptsFor(o.category)}
          </select>
        </div>
        <div class="field" style="width:110px;">
          <label style="font-size:0.78rem;">Price (KSh)</label>
          <input type="number" min="0" class="offering-price"
                 data-idx="${idx}" value="${Number(o.priceFrom || 0)}" />
        </div>
        <div class="field" style="width:160px;">
          <label style="font-size:0.78rem;">Unit</label>
          ${unitFieldHtml(idx, o.priceUnit)}
        </div>
        <button type="button" class="btn btn--ghost btn--small offering-remove"
                data-idx="${idx}" title="Remove this category"
                style="margin-top:22px;">✕</button>
      </div>

      <div class="field" style="margin-top:10px;">
        <label style="font-size:0.78rem;">Services (comma-separated)</label>
        <input type="text" class="offering-services" data-idx="${idx}"
               value="${escapeHtml((o.services || []).join(", "))}"
               placeholder="e.g. Laundry, Ironing, Dry cleaning" />
      </div>
    </div>
  `).join("");

  /* Bind events — kept as a belt-and-braces sync, but they
     are no longer relied upon for correctness because
     syncOfferingsFromDom() runs at save time. */

  root.querySelectorAll(".offering-category").forEach((el) => {
    el.addEventListener("change", () => {
      _offerings[el.dataset.idx].category = el.value ? Number(el.value) : null;
    });
  });

  root.querySelectorAll(".offering-price").forEach((el) => {
    el.addEventListener("input", () => {
      _offerings[el.dataset.idx].priceFrom = Number(el.value) || 0;
    });
  });

  root.querySelectorAll(".offering-unit-select").forEach((el) => {
    el.addEventListener("change", () => {
      const idx = Number(el.dataset.idx);
      const row = el.closest(".offering-row");
      const customInput = row?.querySelector(".offering-unit-custom");

      if (el.value === "__custom__") {
        if (customInput) {
          customInput.style.display = "";
          customInput.focus();
          customInput.value = isKnownUnit(_offerings[idx].priceUnit) ? "" : (_offerings[idx].priceUnit || "");
          _offerings[idx].priceUnit = customInput.value.trim() || "per visit";
        }
      } else {
        if (customInput) customInput.style.display = "none";
        _offerings[idx].priceUnit = el.value;
      }
    });
  });

  root.querySelectorAll(".offering-unit-custom").forEach((el) => {
    el.addEventListener("input", () => {
      const idx = Number(el.dataset.idx);
      _offerings[idx].priceUnit = el.value.trim() || "per visit";
    });
  });

  root.querySelectorAll(".offering-services").forEach((el) => {
    el.addEventListener("input", () => {
      _offerings[el.dataset.idx].services = splitServices(el.value);
    });
  });

  root.querySelectorAll(".offering-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.idx);
      const off = _offerings[idx];
      if (off && off.id) {
        if (!confirm("Remove this category from your profile?")) return;
      }
      _offerings.splice(idx, 1);
      renderOfferings();
    });
  });
}

function wireAddOffering() {
  const btn = document.getElementById("offering-add-btn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    _offerings.push({
      id: null,
      category: _categories[0]?.id ?? null,
      priceFrom: 0,
      priceUnit: "per visit",
      services: [],
      sortOrder: _offerings.length,
    });
    renderOfferings();

    const rows = document.querySelectorAll(".offering-row");
    const last = rows[rows.length - 1];
    last?.querySelector(".offering-services")?.focus();
  });
}

/* ============================================================
   SAVE — primary fields + full offerings array
   ============================================================ */
function wireForm(p) {
  const form = document.getElementById("profile-form");
  const msg  = document.getElementById("profile-msg");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const btn = document.getElementById("save-btn");
    btn.disabled = true;
    btn.textContent = "Saving…";
    msg.style.display = "none";

    /* ---------- CRITICAL: pull current values from DOM ---------- */
    syncOfferingsFromDom();

    /* ---------- sanitise offerings ---------- */
    const dropped = [];
    const cleanedOfferings = _offerings.filter((o) => {
      const keep = o.category && Array.isArray(o.services) && o.services.length;
      if (!keep) dropped.push(o);
      return keep;
    }).map((o, idx) => ({
      ...(o.id ? { id: o.id } : {}),
      category:  Number(o.category),
      priceFrom: Number(o.priceFrom) || 0,
      priceUnit: o.priceUnit || "per visit",
      services:  o.services.slice(),
      sortOrder: o.sortOrder ?? idx,
    }));

    if (dropped.length) {
      console.warn("[provider-profile] dropped incomplete offerings:", dropped);
      msg.textContent = `Skipped ${dropped.length} incomplete service row${dropped.length > 1 ? "s" : ""}. Fill in a category and at least one service.`;
      msg.style.color = "var(--clay)";
      msg.style.display = "block";
    }

    if (!cleanedOfferings.length) {
      msg.textContent = "Add at least one category with services before saving.";
      msg.style.color = "var(--clay)";
      msg.style.display = "block";
      btn.disabled = false;
      btn.textContent = "Save changes";
      return;
    }

    /* ---------- primary fields = first offering ---------- */
    const primary = cleanedOfferings[0];

    const payload = {
      name:      document.getElementById("pf-name").value.trim(),
      hours:     document.getElementById("pf-hours").value.trim(),
      bio:       document.getElementById("pf-bio").value.trim(),

      category:  primary.category,
      priceFrom: primary.priceFrom,
      priceUnit: primary.priceUnit,
      services:  primary.services.slice(),

      offerings: cleanedOfferings,
    };

    /* Log the exact payload so you can confirm it in the console */
    console.log("[provider-profile] PATCH payload:", payload);

    try {
      const saved = await Api.updateProvider(p.id, payload);
      toast("Profile saved.");
      msg.textContent = "✅ Saved successfully.";
      msg.style.color = "var(--teal)";
      msg.style.display = "block";

      if (saved && Array.isArray(saved.offerings)) {
        _offerings = saved.offerings.map((o, idx) => ({
          id:        o.id || null,
          category:  o.category || null,
          priceFrom: Number(o.priceFrom || 0),
          priceUnit: o.priceUnit || "per visit",
          services:  Array.isArray(o.services) ? o.services.slice() : splitServices(o.services),
          sortOrder: o.sortOrder ?? idx,
        }));
        renderOfferings();
      }
    } catch (err) {
      console.error("[provider-profile] save failed:", err);
      msg.textContent = err.message || "Could not save. Please try again.";
      msg.style.color = "var(--clay)";
      msg.style.display = "block";
    } finally {
      btn.disabled = false;
      btn.textContent = "Save changes";
    }
  });
}

/* ============================================================
   Availability toggle with modal picker
   ============================================================ */
function wireAvailabilityToggle(p) {
  const toggle = document.getElementById("availability-toggle");
  if (!toggle) return;

  toggle.addEventListener("change", async () => {
    const newValue = toggle.checked;

    const box      = document.getElementById("availability-box");
    const label    = document.getElementById("availability-label");
    const sublabel = document.getElementById("availability-sublabel");
    const slider   = document.getElementById("availability-slider");

    if (newValue) {
      try {
        await Api.updateProvider(p.id, { isAvailable: true, unavailableUntil: null });

        slider.style.backgroundColor = "#27ae60";
        box.style.background   = "#e8f5e9";
        box.style.borderColor  = "#a5d6a7";
        label.style.color      = "#2e7d32";
        label.textContent      = "✅ Available for new bookings";
        sublabel.textContent   = "Residents can find and book you on the Discover page.";
        toast("You're now visible and bookable on Discover.");
      } catch (err) {
        console.error("[provider-profile] availability ON failed:", err);
        toggle.checked = false;
        toast("Could not update availability. Please try again.");
      }
      return;
    }

    const minutes = await askForDurationModal();
    if (minutes === null) {
      toggle.checked = true;
      return;
    }

    const unavailableUntil = new Date(Date.now() + minutes * 60 * 1000).toISOString();

    try {
      await Api.updateProvider(p.id, {
        isAvailable: false,
        unavailableUntil,
      });

      slider.style.backgroundColor = "#ccc";
      box.style.background   = "#fdecea";
      box.style.borderColor  = "#f5c6cb";
      label.style.color      = "#c0392b";

      const hrs  = Math.floor(minutes / 60);
      const mins = minutes % 60;
      const parts = [];
      if (hrs > 0)  parts.push(`${hrs} hr${hrs > 1 ? "s" : ""}`);
      if (mins > 0) parts.push(`${mins} min`);
      const pretty = parts.join(" ") || `${minutes} min`;

      const backTime = new Date(unavailableUntil).toLocaleTimeString("en-KE", {
        hour: "2-digit", minute: "2-digit",
      });

      label.textContent    = `⏸️ Not accepting bookings (back at ${backTime})`;
      sublabel.textContent = `You'll be back online in ${pretty}. Profile stays visible with a "Busy" badge.`;
      toast(`You'll be back online in ${pretty}.`);
    } catch (err) {
      console.error("[provider-profile] availability OFF failed:", err);
      toggle.checked = true;
      toast("Could not update availability. Please try again.");
    }
  });
}

/* ------------------------------------------------------------
   Modal picker
   ------------------------------------------------------------ */
function askForDurationModal() {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.cssText = `
      position: fixed; inset: 0; background: rgba(22, 35, 63, 0.55);
      z-index: 9999; display: flex; align-items: center; justify-content: center;
      padding: 20px;
    `;

    overlay.innerHTML = `
      <div style="
        background: #fff; border-radius: 12px; padding: 24px;
        max-width: 440px; width: 100%;
        box-shadow: 0 20px 60px rgba(0,0,0,0.25);
      ">
        <h3 style="margin: 0 0 6px; font-family: var(--font-display);">
          How long are you unavailable?
        </h3>
        <p style="font-size: 0.9rem; color: var(--ink-70); margin: 0 0 18px;">
          Your profile stays visible on Discover; bookings are paused until the timer ends.
        </p>

        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 12px;">
          <button type="button" class="btn btn--ghost dur-opt" data-mins="30">30 minutes</button>
          <button type="button" class="btn btn--ghost dur-opt" data-mins="60">1 hour</button>
          <button type="button" class="btn btn--ghost dur-opt" data-mins="120">2 hours</button>
          <button type="button" class="btn btn--ghost dur-opt" data-mins="240">4 hours</button>
          <button type="button" class="btn btn--ghost dur-opt" data-mins="480">8 hours</button>
          <button type="button" class="btn btn--ghost dur-opt" data-mins="1440">24 hours</button>
        </div>

        <button type="button" id="dur-show-custom" class="btn btn--ghost"
                style="width: 100%; margin-bottom: 10px;">Custom hours…</button>
        <div id="dur-custom-box" style="display:none; margin-bottom: 18px;">
          <label style="font-size:0.82rem; color:var(--ink-70); display:block; margin-bottom:4px;">
            Number of hours (1-72)
          </label>
          <input type="number" id="dur-custom-hours" min="1" max="72" value="3"
                 style="width:100%; padding:10px 12px; border:1px solid var(--line);
                        border-radius:6px; font-size:0.95rem;" />
        </div>

        <div style="display: flex; gap: 10px;">
          <button type="button" class="btn btn--ghost" id="dur-cancel" style="flex: 1;">Cancel</button>
          <button type="button" class="btn btn--accent" id="dur-confirm" style="flex: 1;" disabled>Confirm</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    let selectedMins = null;
    const confirmBtn  = overlay.querySelector("#dur-confirm");
    const customBox   = overlay.querySelector("#dur-custom-box");
    const customInput = overlay.querySelector("#dur-custom-hours");

    overlay.querySelectorAll(".dur-opt").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedMins = parseInt(btn.dataset.mins, 10);
        overlay.querySelectorAll(".dur-opt").forEach((b) => {
          b.classList.remove("btn--accent");
          b.classList.add("btn--ghost");
        });
        btn.classList.remove("btn--ghost");
        btn.classList.add("btn--accent");
        customBox.style.display = "none";
        confirmBtn.disabled = false;
      });
    });

    overlay.querySelector("#dur-show-custom").addEventListener("click", () => {
      customBox.style.display = "block";
      customInput.focus();
      overlay.querySelectorAll(".dur-opt").forEach((b) => {
        b.classList.remove("btn--accent");
        b.classList.add("btn--ghost");
      });
      const h = parseInt(customInput.value, 10);
      if (!isNaN(h) && h > 0 && h <= 72) { selectedMins = h * 60; confirmBtn.disabled = false; }
    });

    customInput.addEventListener("input", () => {
      const h = parseInt(customInput.value, 10);
      if (!isNaN(h) && h > 0 && h <= 72) { selectedMins = h * 60; confirmBtn.disabled = false; }
      else { selectedMins = null; confirmBtn.disabled = true; }
    });

    overlay.querySelector("#dur-cancel").addEventListener("click", () => {
      overlay.remove();
      resolve(null);
    });
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) { overlay.remove(); resolve(null); }
    });

    confirmBtn.addEventListener("click", () => {
      if (selectedMins === null || selectedMins <= 0) return;
      overlay.remove();
      resolve(selectedMins);
    });
  });
}

/* ============================================================
   INIT
   ============================================================ */
document.addEventListener("DOMContentLoaded", async () => {
  const user = getUser();

  const allowed = ["vendor", "provider", "admin", "super-admin"];
  const role = String(user?.role || "").toLowerCase().replace(/[_\s]+/g, "-");

  if (!user || !allowed.includes(role)) {
    if (!/\/login\.html$/.test(location.pathname)) {
      window.location.replace(
        "login.html?next=" + encodeURIComponent(location.pathname)
      );
    }
    return;
  }

  if (role === "admin" || role === "super-admin") {
    document.getElementById("profile-root").innerHTML = `
      <div class="empty-state" style="text-align:left; padding:24px;">
        <h2 style="margin-top:0;">Read-only view</h2>
        <p style="color:var(--ink-70);">
          You are signed in as <strong>${escapeHtml(role)}</strong>.
          This page is used by providers to manage their own listing.
          To manage providers as an admin, use
          <a href="admin-providers.html">Admin &rarr; Providers</a>
          or <a href="super-admin-providers.html">Super Admin &rarr; Providers</a>.
        </p>
        <p style="margin-bottom:0;">
          <a href="super-admin.html" class="btn btn--ghost" style="margin-right:8px;">Back to Super Admin</a>
          <a href="index.html" class="btn btn--ghost">Go to Discover</a>
        </p>
      </div>
    `;
    return;
  }

  try {
    const [provider, categories] = await Promise.all([
      (typeof Api.getMyProvider === "function"
        ? Api.getMyProvider()
        : Api.getProvider(user.id)),
      Api.getCategories(),
    ]);

    if (!provider) {
      document.getElementById("profile-root").innerHTML =
        `<div class="empty-state">Could not load your profile.</div>`;
      return;
    }

    renderProfile(provider, categories || []);
  } catch (err) {
    console.error("[provider-profile] init failed:", err);
    document.getElementById("profile-root").innerHTML =
      `<div class="empty-state">
         Could not load your profile. <br>
         <small style="color:var(--ink-70);">${escapeHtml(err.message || "")}</small>
       </div>`;
  }
});