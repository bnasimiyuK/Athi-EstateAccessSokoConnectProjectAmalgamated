/* ============================================================
   provider-profile.js — vendor manages their own profile
   + modal duration picker (specific durations only)
   ============================================================ */

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

/* ---------------- render ---------------- */
function renderProfile(p, categories) {
  const catOptions = categories.map((c) =>
    `<option value="${c.id}" ${c.id === p.category ? "selected" : ""}>${escapeHtml(c.label)}</option>`
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
          <label for="pf-category">Category</label>
          <select id="pf-category" required>
            <option value="">— Select category —</option>
            ${catOptions}
          </select>
        </div>

        <div class="field">
          <label for="pf-hours">Working hours</label>
          <input id="pf-hours" type="text" value="${escapeHtml(p.hours || "")}"
                 placeholder="e.g. Mon-Sat, 8am-5pm" />
        </div>

        <div style="display:grid; grid-template-columns:2fr 1fr; gap:12px;">
          <div class="field">
            <label for="pf-price">Starting price (KSh)</label>
            <input id="pf-price" type="number" min="0" value="${Number(p.priceFrom || 0)}" />
          </div>
          <div class="field">
            <label for="pf-unit">Price unit</label>
            <input id="pf-unit" type="text" value="${escapeHtml(p.priceUnit || "per visit")}"
                   placeholder="per visit / per hour" />
          </div>
        </div>

        <div class="field">
          <label for="pf-services">Services (comma-separated)</label>
          <input id="pf-services" type="text" value="${escapeHtml(servicesToInput(p.services))}"
                 placeholder="e.g. Cleaning, Laundry, Ironing" />
        </div>

        <div class="field">
          <label for="pf-bio">About your business</label>
          <textarea id="pf-bio" rows="4" placeholder="Tell residents about your work…">${escapeHtml(p.bio || "")}</textarea>
        </div>

        <div style="display:flex; gap:8px; margin-top:18px;">
          <button type="submit" class="btn btn--accent" id="save-btn">Save changes</button>
          <a href="provider-dashboard.html" class="btn btn--ghost">Cancel</a>
        </div>

        <p id="profile-msg" style="font-size:0.88rem;margin:10px 0 0;display:none;"></p>
      </form>
    </div>
  `;

  wireForm(p);
  wireAvailabilityToggle(p);
}

/* ---------------- wire form ---------------- */
function wireForm(p) {
  const form = document.getElementById("profile-form");
  const msg  = document.getElementById("profile-msg");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("save-btn");
    btn.disabled = true;
    btn.textContent = "Saving…";
    msg.style.display = "none";

    const servicesRaw = document.getElementById("pf-services").value.trim();
    const servicesArr = servicesRaw ? servicesRaw.split(/\s*,\s*/).filter(Boolean) : [];

    const payload = {
      name:      document.getElementById("pf-name").value.trim(),
      category:  document.getElementById("pf-category").value,
      hours:     document.getElementById("pf-hours").value.trim(),
      priceFrom: Number(document.getElementById("pf-price").value) || 0,
      priceUnit: document.getElementById("pf-unit").value.trim() || "per visit",
      bio:       document.getElementById("pf-bio").value.trim(),
      services:  servicesArr,
    };

    try {
      await Api.updateProvider(p.id, payload);
      toast("Profile saved.");
      msg.textContent = "✅ Saved successfully.";
      msg.style.color = "var(--teal)";
      msg.style.display = "block";
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

    /* ---------- Turning ON ---------- */
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

    /* ---------- Turning OFF — ask for duration ---------- */
    const minutes = await askForDurationModal();
    if (minutes === null) {
      // User cancelled — revert the toggle
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
   Modal picker (specific durations only — no indefinite)
   Resolves to: null (cancel) | minutes > 0
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
            Number of hours (1–72)
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
    const customBox   = overlay.querySelector("#custom-box") || overlay.querySelector("#dur-custom-box");
    const customInput = overlay.querySelector("#dur-custom-hours");

    /* Preset buttons */
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

    /* Custom hours */
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

    /* Cancel */
    overlay.querySelector("#dur-cancel").addEventListener("click", () => {
      overlay.remove();
      resolve(null);
    });
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) { overlay.remove(); resolve(null); }
    });

    /* Confirm */
    confirmBtn.addEventListener("click", () => {
      if (selectedMins === null || selectedMins <= 0) return;
      overlay.remove();
      resolve(selectedMins);
    });
  });
}

/* ---------------- init ---------------- */
document.addEventListener("DOMContentLoaded", async () => {
  const user = getUser();
  if (!user || user.role !== "vendor") {
    window.location.href = "login.html?next=%2Fprovider-profile.html";
    return;
  }

  try {
    const [provider, categories] = await Promise.all([
      Api.getProvider(user.id),
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
      `<div class="empty-state">Could not load your profile.</div>`;
  }
});