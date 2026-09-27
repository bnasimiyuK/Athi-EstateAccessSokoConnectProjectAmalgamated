/* ============================================================
   residents.js — public resident signup
   Submits to POST /api/auth/register-resident
   Account created as verified = 0 (pending admin approval)
   ============================================================ */

let ALL_COURTS = [];
let FILTERED_COURTS = [];
let selectedCourtId = "";

/* ------------------------------------------------------------
   Load courts
   ------------------------------------------------------------ */
async function loadCourts() {
  try {
    ALL_COURTS = await Api.getCourts();
    console.log(`[residents] loaded ${ALL_COURTS.length} courts`);
  } catch (err) {
    console.error("[residents] failed to load courts:", err);
    toast("Could not load court list. Please refresh.");
  }
}

/* ------------------------------------------------------------
   Phase → enable court search
   ------------------------------------------------------------ */
function enableCourtSearch(phase) {
  const searchEl = document.getElementById("courtSearch");
  const listEl   = document.getElementById("courtList");

  if (!phase) {
    searchEl.disabled = true;
    searchEl.value = "";
    searchEl.placeholder = "Select a phase first…";
    listEl.style.display = "none";
    selectedCourtId = "";
    document.getElementById("court").value = "";
    return;
  }

  FILTERED_COURTS = ALL_COURTS.filter((c) => String(c.phase) === String(phase));
  console.log(`[residents] phase ${phase} → ${FILTERED_COURTS.length} courts`);

  searchEl.disabled = false;
  searchEl.value = "";
  searchEl.placeholder = "Start typing a court name…";
  renderCourtList("");
}

/* ------------------------------------------------------------
   Render filtered courts
   ------------------------------------------------------------ */
function renderCourtList(query) {
  const listEl = document.getElementById("courtList");
  const q = (query || "").toLowerCase().trim();

  const matches = FILTERED_COURTS.filter((c) =>
    c.name.toLowerCase().includes(q)
  );

  listEl.innerHTML = "";

  if (!matches.length) {
    listEl.innerHTML = `<div style="padding:10px 12px; color:var(--ink-70); font-size:0.9rem;">No courts match "${query}"</div>`;
    listEl.style.display = "block";
    return;
  }

  matches.forEach((c) => {
    const row = document.createElement("div");
    row.textContent = c.name;
    row.style.padding = "10px 12px";
    row.style.cursor = "pointer";
    row.style.fontSize = "0.95rem";
    row.style.borderBottom = "1px solid var(--line)";
    row.addEventListener("mouseenter", () => row.style.background = "var(--paper-dim)");
    row.addEventListener("mouseleave", () => row.style.background = "");
    row.addEventListener("click", () => selectCourt(c));
    listEl.appendChild(row);
  });

  listEl.style.display = "block";
}

/* ------------------------------------------------------------
   Court selected
   ------------------------------------------------------------ */
function selectCourt(court) {
  selectedCourtId = String(court.id);
  document.getElementById("court").value = selectedCourtId;
  document.getElementById("courtSearch").value = court.name;
  document.getElementById("courtList").style.display = "none";
  console.log(`[residents] selected court: ${court.name} (id ${court.id})`);
}

/* ------------------------------------------------------------
   Password validation
   Returns { valid, message }
   ------------------------------------------------------------ */
function validatePassword(password) {
  if (password.length < 8) {
    return { valid: false, message: "Password must be at least 8 characters." };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: "Password must contain at least one uppercase letter." };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: "Password must contain at least one lowercase letter." };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, message: "Password must contain at least one number." };
  }
  return { valid: true };
}

/* ------------------------------------------------------------
   Submit form
   ------------------------------------------------------------ */
async function handleSubmit(e) {
  e.preventDefault();

  const btn = document.getElementById("registerBtn");
  btn.disabled = true;

  const firstName = document.getElementById("firstName").value.trim();
  const lastName  = document.getElementById("lastName").value.trim();
  const fullName  = `${firstName} ${lastName}`.trim();

  const pwEl            = document.getElementById("password");
  const cpwEl           = document.getElementById("confirmPassword");
  const password        = pwEl  ? pwEl.value  : "";
  const confirmPassword = cpwEl ? cpwEl.value : "";

  /* ---------- Validation (uses toasts now) ---------- */
  if (!firstName) {
    toast("Please enter your first name.");
    btn.disabled = false; return;
  }
  if (!lastName) {
    toast("Please enter your last name.");
    btn.disabled = false; return;
  }
  if (!document.getElementById("phone").value.trim()) {
    toast("Please enter your phone number.");
    btn.disabled = false; return;
  }
  if (!selectedCourtId) {
    toast("Please select a court.");
    btn.disabled = false; return;
  }

  /* ---------- Password rules ---------- */
  const pwCheck = validatePassword(password);
  if (!pwCheck.valid) {
    toast(pwCheck.message);
    btn.disabled = false; return;
  }
  if (password !== confirmPassword) {
    toast("Passwords do not match.");
    btn.disabled = false; return;
  }

  /* ---------- Terms checkbox ---------- */
  if (!document.getElementById("terms").checked) {
    toast("Please agree to the Terms and Privacy Policy to continue.");
    btn.disabled = false; return;
  }

  const payload = {
    fullName,
    phone:   document.getElementById("phone").value.trim(),
    email:   document.getElementById("email").value.trim() || null,
    courtId: selectedCourtId,
    password,
  };

  /* ---------- Submit ---------- */
  showMessage("Submitting…", false);

  try {
    await Api.registerResident(payload);

    /* Persistent inline success + celebratory toast */
    showMessage(
      `✅ Thank you, ${fullName}. Your registration is pending admin approval. ` +
      `You'll receive an email once your account is approved.`,
      false
    );
    toast(`Registration submitted! Pending admin approval, ${firstName}.`);

    /* Reset form */
    e.target.reset();
    selectedCourtId = "";
    const searchEl = document.getElementById("courtSearch");
    searchEl.disabled = true;
    searchEl.value = "";
    searchEl.placeholder = "Select a phase first…";
    document.getElementById("courtList").style.display = "none";

  } catch (err) {
    console.error("[residents] submit failed:", err);
    /* Backend error → toast (transient) + hide the "Submitting…" inline box */
    document.getElementById("backendResponse").classList.add("hidden");
    toast(err.message || "Could not submit registration.");
  } finally {
    btn.disabled = false;
  }
}

/* ------------------------------------------------------------
   Inline message box (used only for persistent "Submitting…" and
   final success confirmation — validation errors use toast())
   ------------------------------------------------------------ */
function showMessage(text, isError) {
  const box = document.getElementById("backendResponse");
  const txt = document.getElementById("responseText");
  box.classList.remove("hidden");
  box.classList.toggle("error", !!isError);
  txt.textContent = text;
}

/* ------------------------------------------------------------
   Init
   ------------------------------------------------------------ */
document.addEventListener("DOMContentLoaded", async () => {
  console.log("[residents] DOM ready");

  await loadCourts();

  const phaseEl  = document.getElementById("phase");
  const searchEl = document.getElementById("courtSearch");
  const listEl   = document.getElementById("courtList");

  phaseEl.addEventListener("change", (e) => enableCourtSearch(e.target.value));
  searchEl.addEventListener("input", (e) => renderCourtList(e.target.value));

  searchEl.addEventListener("focus", () => {
    if (!searchEl.disabled && FILTERED_COURTS.length) {
      renderCourtList(searchEl.value);
    }
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest("#courtSearch") && !e.target.closest("#courtList")) {
      listEl.style.display = "none";
    }
  });

  document.getElementById("residentForm").addEventListener("submit", handleSubmit);

  document.getElementById("clearBtn").addEventListener("click", () => {
    document.getElementById("residentForm").reset();
    selectedCourtId = "";
    searchEl.disabled = true;
    searchEl.value = "";
    searchEl.placeholder = "Select a phase first…";
    listEl.style.display = "none";
    document.getElementById("backendResponse").classList.add("hidden");
  });
});