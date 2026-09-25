/* ============================================================
   register.js — vendor application (two-step flow)
   1. Verify the applicant is a registered + verified resident
   2. Only then show the vendor listing form
   ============================================================ */

let verifiedResident = null;

/* ------------------------------------------------------------
   STEP 1 — Verify residency by phone
   ------------------------------------------------------------ */
async function handleVerifyResident(e) {
  e.preventDefault();

  const phone = document.getElementById("r-phone").value.trim();
  const msgEl = document.getElementById("check-message");

  if (!phone) {
    showCheckMessage("Please enter your phone number.", true);
    return;
  }

  showCheckMessage("Checking…", false);

  try {
    // Fetch all residents with this phone (backend filters by q)
    const list = await Api.getResidents({ q: phone });

    // Exact match on phone (backend q does partial match, we need exact)
    const match = list.find((r) => r.phone === phone);

    if (!match) {
      showCheckMessage(
        "❌ No resident found with that phone number. Please sign up as a resident first.",
        true
      );
      return;
    }

    if (!match.verified) {
      showCheckMessage(
        "⏳ Your resident account is still pending admin approval. Please try again once approved.",
        true
      );
      return;
    }

    // ✅ Resident exists and is verified
    verifiedResident = match;
    showCheckMessage("", false); // clear

    // Populate the read-only info banner
    document.getElementById("resident-info").innerHTML =
      `✅ Verified resident: <strong>${match.fullName}</strong> — Phase ${match.phase}, ${match.courtName} (${match.phone})`;

    // Swap forms
    document.getElementById("resident-check-form").style.display = "none";
    document.getElementById("register-form").style.display = "block";

    // Load category dropdown for step 2
    await populateCategorySelect();
  } catch (err) {
    console.error("[register] resident check failed:", err);
    showCheckMessage("Could not verify. Please try again.", true);
  }
}

/* ------------------------------------------------------------
   Show inline message under Step 1
   ------------------------------------------------------------ */
function showCheckMessage(text, isError) {
  const el = document.getElementById("check-message");
  if (!text) {
    el.style.display = "none";
    el.textContent = "";
    return;
  }
  el.style.display = "block";
  el.textContent = text;
  el.style.color = isError ? "var(--clay)" : "var(--ink-70)";
}

/* ------------------------------------------------------------
   Load categories into the Step 2 dropdown
   ------------------------------------------------------------ */
async function populateCategorySelect() {
  const select = document.getElementById("r-category");
  if (select.options.length > 0) return; // already populated

  try {
    const categories = await loadCategoryCache();
    select.innerHTML = "";

    categories.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.label;
      select.appendChild(opt);
    });
  } catch (err) {
    console.error("[register] failed to load categories:", err);
    toast("Could not load service categories.");
  }
}

/* ------------------------------------------------------------
   STEP 2 — Submit the vendor application
   ------------------------------------------------------------ */
async function handleSubmitVendor(e) {
  e.preventDefault();

  if (!verifiedResident) {
    alert(
      "❌ You haven't verified your residency yet.\n\n" +
      "Please scroll up, enter your phone number, and click 'Verify residency' first."
    );
    return;
  }

  const services = document
    .getElementById("r-services")
    .value.split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!services.length) {
    toast("Add at least one service, separated by commas.");
    return;
  }

  const payload = {
    // Inherited from verified resident
    residentId: verifiedResident.id,
    phone:      verifiedResident.phone,
    // phase + court come from the resident record on the backend
    // (only include here if backend requires them explicitly)
    // phase: verifiedResident.phase,
    // courtId: verifiedResident.courtId,

    // Vendor-specific fields
    name:      document.getElementById("r-name").value.trim(),
    category:  document.getElementById("r-category").value,
    hours:     document.getElementById("r-hours").value.trim(),
    priceFrom: Number(document.getElementById("r-price").value),
    priceUnit: document.getElementById("r-price-unit").value,
    bio:       document.getElementById("r-bio").value.trim(),
    services,
  };

  const btn = e.target.querySelector("button[type=submit]");
  btn.disabled = true;

  try {
    await Api.registerProvider(payload);
    toast(`Thanks, ${payload.name}! Your listing is pending admin verification.`);

    // Reset the whole flow
    e.target.reset();
    document.getElementById("register-form").style.display = "none";
    document.getElementById("resident-check-form").style.display = "block";
    document.getElementById("r-phone").value = "";
    verifiedResident = null;
  } catch (err) {
    console.error("[register] submit failed:", err);
    toast(err.message || "Couldn't submit your listing. Please try again.");
  } finally {
    btn.disabled = false;
  }
}

/* ------------------------------------------------------------
   Init
   ------------------------------------------------------------ */
document.addEventListener("DOMContentLoaded", () => {
  document
    .getElementById("resident-check-form")
    .addEventListener("submit", handleVerifyResident);

  document
    .getElementById("register-form")
    .addEventListener("submit", handleSubmitVendor);
});