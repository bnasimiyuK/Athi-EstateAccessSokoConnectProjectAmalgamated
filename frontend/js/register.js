/* ============================================================
   register.js — Vendor application (login-first flow)

   1. Require an authenticated resident (session-based)
   2. Only then show the vendor listing form
   3. Backend MUST also enforce this — see backend/routes/providers.js
   ============================================================ */

let verifiedResident = null;

/* ---------------- progress step helper ---------------- */
function setStep(n) {
  document.querySelectorAll(".reg-steps li[data-step]").forEach((li) => {
    const step = Number(li.dataset.step);
    li.classList.toggle("is-done",    step < n);
    li.classList.toggle("is-current", step === n);
  });
}

/* ---------------- show/hide panels ---------------- */
function showPanel(which) {
  const checkForm = document.getElementById("resident-check-form");
  const regForm   = document.getElementById("register-form");
  const doneCard  = document.getElementById("done-card");
  const preview   = document.getElementById("listing-preview");
  const layout    = document.getElementById("reg-layout");

  if (checkForm) checkForm.hidden = which !== "check";
  if (regForm)   regForm.hidden   = which !== "form";
  if (doneCard)  doneCard.hidden  = which !== "done";
  if (preview)   preview.hidden   = which !== "form";
  if (layout)    layout.classList.toggle("reg-layout--split", which === "form");
}

/* ---------------- inline messages ---------------- */
function showCheckMessage(text, isError) {
  const el = document.getElementById("check-message");
  if (!el) return;
  if (!text) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.textContent = text;
  el.classList.toggle("msg--error", !!isError);
  el.classList.toggle("msg--info",  !isError);
}

/* ------------------------------------------------------------
   Session helper — reads the current user from whichever
   mechanism the rest of the app uses.
   Order of preference:
     1. getUser()          — defined in main.js / auth.js
     2. Auth.currentUser() — alternate convention
     3. Auth.getUser()
     4. Auth.user
     5. localStorage       — legacy keys
   ------------------------------------------------------------ */
function getSessionUser() {
  try {
    if (typeof getUser === "function") {
      const u = getUser();
      if (u && (u.id || u.email || u.role)) return u;
    }
  } catch { /* ignore */ }

  try {
    if (typeof Auth !== "undefined") {
      if (typeof Auth.currentUser === "function") {
        const u = Auth.currentUser();
        if (u) return u;
      }
      if (typeof Auth.getUser === "function") {
        const u = Auth.getUser();
        if (u) return u;
      }
      if (Auth.user) return Auth.user;
    }
  } catch { /* ignore */ }

  try {
    const keys = ["asc_user", "athi_user", "user", "currentUser"];
    for (const k of keys) {
      const raw = localStorage.getItem(k) || sessionStorage.getItem(k);
      if (raw) {
        const u = JSON.parse(raw);
        if (u && (u.id || u.email || u.role)) return u;
      }
    }
  } catch { /* ignore */ }

  return null;
}

/* ------------------------------------------------------------
   Server-side session check — source of truth.
   Falls back to the cached session if the call fails.
   ------------------------------------------------------------ */
async function fetchMe() {
  if (typeof Api === "undefined") return null;
  try {
    if (typeof Api.me === "function")               return await Api.me();
    if (typeof Api.getMe === "function")            return await Api.getMe();
    if (typeof Api.getCurrentResident === "function") return await Api.getCurrentResident();
  } catch (err) {
    console.warn("[register] fetchMe failed:", err);
  }
  return null;
}

/* ---------------- boot ---------------- */
document.addEventListener("DOMContentLoaded", async () => {
  const checkForm = document.getElementById("resident-check-form");
  const regForm   = document.getElementById("register-form");
  const backBtn   = document.getElementById("back-btn");
  const againBtn  = document.getElementById("again-btn");

  if (regForm)  regForm.addEventListener("submit", handleSubmitVendor);
  if (backBtn)  backBtn.addEventListener("click", resetFlow);
  if (againBtn) againBtn.addEventListener("click", resetFlow);

  // Live preview listeners
  ["r-name", "r-category", "r-hours", "r-price", "r-price-unit", "r-bio", "r-services"]
    .forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("input",  updatePreview);
      el.addEventListener("change", updatePreview);
    });

  /* ---------- 1. Require a session ---------- */
  const cachedUser = getSessionUser();

  // Ask the server who we are — this is the authoritative check.
  const meFromServer = await fetchMe();
  const me = meFromServer || cachedUser;

  if (!me) {
    // Not logged in — bounce to login with a return URL
    const next = encodeURIComponent(location.pathname + location.search);
    window.location.replace(`/login.html?next=${next}`);
    return;
  }

  /* ---------- 2. Role check ---------- */
  const role = String(me.role || "").toLowerCase().replace(/[_\s]/g, "-");

  if (role && !["resident", "provider", "vendor", "admin", "super-admin"].includes(role)) {
    // Unknown role — send to a safe page
    window.location.replace("/index.html");
    return;
  }

  /* ---------- 3. Admin / super-admin: send to admin panel ---------- */
  if (role === "admin" || role === "super-admin") {
    window.location.replace("/admin.html");
    return;
  }

  /* ---------- 4. Verification check ---------- */
  // If `verified` is explicitly false → block. If undefined/null → allow.
  if (me.verified === false || me.verified === 0) {
    showPanel("check");
    setStep(1);
    if (checkForm) {
      checkForm.innerHTML = `
        <h2>Step 1 — Account pending</h2>
        <p class="form-card_lead">
          Hi ${me.fullName || me.name || "resident"} — your resident account is
          still waiting for admin approval. You'll be able to list a service
          once it's verified.
        </p>
        <div class="form-actions">
          <a href="/index.html" class="btn btn--ghost">Back to Discover</a>
        </div>`;
    }
    return;
  }

  /* ---------- 5. Signed in + eligible → show the form ---------- */
  verifiedResident = me;

  // Skip the phone-verification step — we already know who this is.
  if (checkForm) checkForm.hidden = true;

  const info = document.getElementById("resident-info");
  if (info) {
    info.innerHTML =
      `✅ Signed in as <strong>${me.fullName || me.name || "Resident"}</strong>`
      + (me.phase     != null ? ` — Phase ${me.phase}`    : "")
      + (me.courtName        ? `, ${me.courtName}`         : "")
      + (me.phone            ? ` (${me.phone})`             : "");
  }

  await populateCategorySelect();
  showPanel("form");
  setStep(2);
  updatePreview();
});

/* ------------------------------------------------------------
   Load categories into the Step 2 dropdown
   ------------------------------------------------------------ */
async function populateCategorySelect() {
  const select = document.getElementById("r-category");
  if (!select) return;
  if (select.options.length > 0) return; // already populated

  try {
    if (typeof Api === "undefined" || typeof Api.getCategories !== "function") return;
    const categories = await Api.getCategories();
    const arr = Array.isArray(categories) ? categories : (categories?.data || []);

    select.innerHTML = "";
    arr.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.label || c.name || "Category";
      select.appendChild(opt);
    });
  } catch (err) {
    console.error("[register] failed to load categories:", err);
    if (typeof toast === "function") toast("Could not load service categories.");
  }
}

/* ------------------------------------------------------------
   STEP 2 - Submit the vendor application
   ------------------------------------------------------------ */
async function handleSubmitVendor(e) {
  e.preventDefault();

  if (!verifiedResident) {
    showCheckMessage("Please sign in as a resident first.", true);
    return;
  }

  const services = (document.getElementById("r-services")?.value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!services.length) {
    if (typeof toast === "function") toast("Add at least one service, separated by commas.");
    return;
  }

  // The backend derives identity from the session; we send residentId
  // as a convenience but the server MUST ignore it and use the session.
  const residentId =
    verifiedResident.id       ||
    verifiedResident.residentId ||
    verifiedResident.userId;

  const payload = {
    residentId,
    phone:      verifiedResident.phone,
    name:       document.getElementById("r-name").value.trim(),
    category:   document.getElementById("r-category").value,
    hours:      document.getElementById("r-hours").value.trim(),
    priceFrom:  Number(document.getElementById("r-price").value),
    priceUnit:  document.getElementById("r-price-unit").value,
    bio:        document.getElementById("r-bio").value.trim(),
    services,
  };

  const btn   = document.getElementById("submit-btn");
  const msgEl = document.getElementById("submit-message");
  if (btn) btn.disabled = true;
  if (msgEl) msgEl.hidden = true;

  try {
    if (typeof Api === "undefined" || typeof Api.registerProvider !== "function") {
      throw new Error("Registration service unavailable.");
    }

    await Api.registerProvider(payload);

    // Populate confirmation details
    const doneResident = document.getElementById("done-resident");
    const doneTime     = document.getElementById("done-time");
    if (doneResident) {
      doneResident.textContent =
        verifiedResident.fullName || verifiedResident.name || "";
    }
    if (doneTime) {
      doneTime.textContent = new Date().toLocaleString();
    }

    showPanel("done");
    setStep(3);

    if (typeof toast === "function") {
      toast(`Thanks, ${payload.name}! Your listing is pending admin verification.`);
    }

  } catch (err) {
    console.error("[register] submit failed:", err);
    if (msgEl) {
      msgEl.textContent = err.message || "Couldn't submit your listing. Please try again.";
      msgEl.hidden = false;
      msgEl.classList.add("msg--error");
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ------------------------------------------------------------
   Live Preview Logic
   ------------------------------------------------------------ */
function updatePreview() {
  const nameEl = document.getElementById("r-name");
  if (!nameEl) return; // preview not on this page

  const name      = nameEl.value.trim();
  const catSelect = document.getElementById("r-category");
  const catText   = catSelect?.options[catSelect.selectedIndex]?.text || "Category";
  const hours     = document.getElementById("r-hours").value.trim();
  const price     = document.getElementById("r-price").value;
  const priceUnit = document.getElementById("r-price-unit").value;
  const bio       = document.getElementById("r-bio").value.trim();
  const services  = document.getElementById("r-services").value
                      .split(",").map((s) => s.trim()).filter(Boolean);

  const set = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };

  set("p-name",  name || "Your Business Name");
  set("p-cat",   catText);
  set("p-bio",   bio || "Your short description will appear here.");
  set("p-hours", hours || "Working hours");
  set("p-price", price ? `KSh ${price} ${priceUnit}` : "Price");

  const tags = document.getElementById("p-tags");
  if (tags) {
    tags.innerHTML = "";
    services.forEach((s) => {
      const span = document.createElement("span");
      span.className = "listing-card_tag";
      span.textContent = s;
      tags.appendChild(span);
    });
  }

  if (verifiedResident) {
    const parts = [];
    if (verifiedResident.phase     != null) parts.push(`Phase ${verifiedResident.phase}`);
    if (verifiedResident.courtName) parts.push(verifiedResident.courtName);
    set("p-loc", parts.join(", "));
  }
}

/* ------------------------------------------------------------
   Reset the flow — in the login-first design, "reset" just
   means: go back to Discover and start over.
   ------------------------------------------------------------ */
function resetFlow() {
  verifiedResident = null;
  window.location.href = "/index.html";
}