/* ============================================================
   provider-profile.js — vendor manages their own profile
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

  document.getElementById("profile-root").innerHTML = `
    <div class="card" style="max-width:720px; padding:24px;">

      <!-- Availability toggle -->
      <div id="availability-box" style="display:flex; justify-content:space-between; align-items:center;
                  padding:14px 16px; border-radius:8px;
                  background:${p.isAvailable ? "#e8f5e9" : "#fdecea"};
                  border:1px solid ${p.isAvailable ? "#a5d6a7" : "#f5c6cb"};
                  margin-bottom:24px;">
        <div>
          <div id="availability-label" style="font-weight:600; color:${p.isAvailable ? "#2e7d32" : "#c0392b"};">
            ${p.isAvailable ? "✅ Available for new bookings" : "⏸️ Not accepting bookings"}
          </div>
          <div id="availability-sublabel" style="font-size:0.85rem; color:var(--ink-70); margin-top:2px;">
            ${p.isAvailable
              ? "Residents can find and book you on the Discover page."
              : "Your profile is hidden from new searches. Existing bookings are unaffected."}
          </div>
        </div>
        <label style="position:relative; display:inline-block; width:52px; height:28px; flex-shrink:0;">
          <input type="checkbox" id="availability-toggle" ${p.isAvailable ? "checked" : ""}
                 style="opacity:0; width:0; height:0;">
          <span id="availability-slider" style="position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0;
                background-color:${p.isAvailable ? "#27ae60" : "#ccc"}; border-radius:28px; transition:.3s;"></span>
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
    const servicesArr = servicesRaw
      ? servicesRaw.split(/\s*,\s*/).filter(Boolean)
      : [];

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

/* ---------------- wire availability toggle ---------------- */
function wireAvailabilityToggle(p) {
  const toggle = document.getElementById("availability-toggle");
  if (!toggle) return;

  toggle.addEventListener("change", async () => {
    const newValue = toggle.checked;

    const box       = document.getElementById("availability-box");
    const label     = document.getElementById("availability-label");
    const sublabel  = document.getElementById("availability-sublabel");
    const slider    = document.getElementById("availability-slider");

    try {
      await Api.updateProvider(p.id, { isAvailable: newValue });

      // Update the UI on success
      slider.style.backgroundColor = newValue ? "#27ae60" : "#ccc";
      box.style.background    = newValue ? "#e8f5e9" : "#fdecea";
      box.style.borderColor   = newValue ? "#a5d6a7" : "#f5c6cb";
      label.style.color       = newValue ? "#2e7d32" : "#c0392b";
      label.textContent       = newValue
        ? "✅ Available for new bookings"
        : "⏸️ Not accepting bookings";
      sublabel.textContent    = newValue
        ? "Residents can find and book you on the Discover page."
        : "Your profile is hidden from new searches. Existing bookings are unaffected.";

      toast(newValue ? "You're now visible on Discover." : "You're now hidden from Discover.");
    } catch (err) {
      console.error("[provider-profile] availability failed:", err);
      // Revert the toggle on failure
      toggle.checked = !newValue;
      toast("Could not update availability. Please try again.");
    }
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