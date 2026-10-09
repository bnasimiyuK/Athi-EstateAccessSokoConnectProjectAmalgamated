/* ============================================================
   residents.js — public resident signup (with STK + manual payment)
   - STK push  : Api.stkPush → Api.stkQuery (auto-approve)
   - Manual    : Api.registerResident (admin verifies)
   Uses API_BASE (from api.js) so it works from port 3000 or 4050.
   Now uses validators.js for phone/name/email/password checks.
   ============================================================ */

let ALL_COURTS        = [];
let FILTERED_COURTS   = [];
let selectedCourtId   = "";
let FEES = { AHE: 1, AHEWA: 1 };

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

async function loadFees() {
  try {
    const s = await Api.getBillingSettings();
    if (s && s.feeAhe != null)   FEES.AHE   = Number(s.feeAhe);
    if (s && s.feeAhewa != null) FEES.AHEWA = Number(s.feeAhewa);
    const aheBtn  = document.getElementById("btn-stk-pay-ahe");
    const bothBtn = document.getElementById("btn-stk-pay-both");
    const total = FEES.AHE + FEES.AHEWA;
    if (aheBtn)  aheBtn.innerHTML  = `<i class="fas fa-bolt"></i> Pay AHE only (KSh ${FEES.AHE.toLocaleString()})`;
    if (bothBtn) bothBtn.innerHTML = `<i class="fas fa-bolt"></i> Pay AHE + AHEWA (KSh ${total.toLocaleString()})`;
  } catch (err) {
    console.warn("[residents] could not load fee settings:", err);
  }
}

async function loadPaybill() {
  try {
    const s = await Api.getBillingSettings();
    const el = document.getElementById("reg-paybill");
    if (el) el.textContent = s.paybillNumber || "—";
  } catch (err) {
    console.warn("[residents] could not load billing settings:", err);
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
   Shared form validation — uses validators.js
   ------------------------------------------------------------ */
function collectAndValidateForm({ requireAheReceipt = true } = {}) {
  const firstName = document.getElementById("firstName").value.trim();
  const lastName  = document.getElementById("lastName").value.trim();
  const fullName  = `${firstName} ${lastName}`.trim();
  const rawPhone  = document.getElementById("phone").value.trim();
  const email     = document.getElementById("email").value.trim();

  const pwEl            = document.getElementById("password");
  const cpwEl           = document.getElementById("confirmPassword");
  const password        = pwEl  ? pwEl.value  : "";
  const confirmPassword = cpwEl ? cpwEl.value : "";

  /* ---------- First name ---------- */
  const firstNameCheck = validateName(firstName, "First name");
  if (!firstNameCheck.valid) { toast(firstNameCheck.reason); return { ok: false }; }

  /* ---------- Last name ---------- */
  const lastNameCheck = validateName(lastName, "Last name");
  if (!lastNameCheck.valid) { toast(lastNameCheck.reason); return { ok: false }; }

  /* ---------- Phone (normalizes +254XXXXXXXXX or foreign) ---------- */
  const phoneCheck = normalizePhone(rawPhone);
  if (!phoneCheck.valid) { toast(phoneCheck.reason); return { ok: false }; }
  const phone = phoneCheck.normalized;

  /* ---------- Email (optional) ---------- */
  let normalizedEmail = null;
  if (email) {
    const emailCheck = validateEmail(email, { optional: true });
    if (!emailCheck.valid) { toast(emailCheck.reason); return { ok: false }; }
    normalizedEmail = emailCheck.normalized;
  }

  /* ---------- Court ---------- */
  if (!selectedCourtId) { toast("Please select a court."); return { ok: false }; }

  /* ---------- Password ---------- */
  const pwCheck = validatePassword(password);
  if (!pwCheck.valid) { toast(pwCheck.reason); return { ok: false }; }
  if (password !== confirmPassword) { toast("Passwords do not match."); return { ok: false }; }

  /* ---------- Terms ---------- */
  if (!document.getElementById("terms").checked) {
    toast("Please agree to the Terms and Privacy Policy to continue.");
    return { ok: false };
  }

  /* ---------- AHE receipt ---------- */
  const aheReceipt = document.getElementById("ahe-receipt").value.trim();
  const ahePhone   = document.getElementById("ahe-phone").value.trim();
  if (requireAheReceipt && !aheReceipt) {
    toast("AHE registration M-Pesa receipt is required.");
    return { ok: false };
  }

  /* ---------- AHEWA receipt ---------- */
  const joinAHEWA    = document.getElementById("join-ahewa").checked;
  const ahewaReceipt = document.getElementById("ahewa-receipt").value.trim();
  const ahewaPhone   = document.getElementById("ahewa-phone").value.trim();

  if (requireAheReceipt && joinAHEWA && !ahewaReceipt) {
    toast("You selected AHEWA — please enter the AHEWA M-Pesa receipt.");
    return { ok: false };
  }

  return {
    ok: true,
    data: {
      firstName, lastName, fullName,
      phone,                 /* normalized +254XXXXXXXXX or +<country> */
      email: normalizedEmail,
      password, joinAHEWA,
      aheReceipt, ahePhone, ahewaReceipt, ahewaPhone,
    },
  };
}

/* ------------------------------------------------------------
   STK push — initiate, poll, auto-approve on success
   ------------------------------------------------------------ */
async function initiateStkPush(includeAHEWA) {
  const statusEl = document.getElementById("stk-status");
  const btnAhe   = document.getElementById("btn-stk-pay-ahe");
  const btnBoth  = document.getElementById("btn-stk-pay-both");

  const show = (msg, kind) => {
    if (!statusEl) return;
    statusEl.hidden = false;
    statusEl.classList.remove("is-info", "is-ok", "is-error");
    statusEl.classList.add("is-" + (kind || "info"));
    statusEl.innerHTML = msg;
  };

  const check = collectAndValidateForm({ requireAheReceipt: false });
  if (!check.ok) return;
  const d = check.data;

  /* ---------- Normalize the STK phone too ---------- */
  const rawStkPhone = document.getElementById("stk-phone").value.trim() || d.phone;
  const stkPhoneCheck = normalizePhone(rawStkPhone);
  if (!stkPhoneCheck.valid) {
    show("❌ " + stkPhoneCheck.reason, "error");
    return;
  }
  const stkPhone = stkPhoneCheck.normalized;

  const amount = includeAHEWA ? FEES.AHE + FEES.AHEWA : FEES.AHE;

  btnAhe.disabled  = true;
  btnBoth.disabled = true;
  show(`Sending STK push for KSh ${amount.toLocaleString()}…`, "info");

  try {
    const payload = {
      fullName:  d.fullName,
      phone:     d.phone,
      email:     d.email || null,
      courtId:   selectedCourtId,
      password:  d.password,
      joinAHEWA: !!includeAHEWA,
    };

    const r = await Api.stkPush({
      phone:        stkPhone,
      amount:       amount,
      purpose:      "AHE_REG",
      includeAHEWA: !!includeAHEWA,
      signup:       payload,
    });

    if (!r || !r.ok) {
      show("❌ " + ((r && r.error) || "Could not send STK push."), "error");
      btnAhe.disabled  = false;
      btnBoth.disabled = false;
      return;
    }

    show("📱 Enter your M-Pesa PIN on your phone… (waiting up to 90s)", "info");

    const crid     = r.checkoutRequestId;
    const deadline = Date.now() + 90_000;

    while (Date.now() < deadline) {
      await new Promise((res) => setTimeout(res, 3000));

      let q = {};
      try {
        q = await Api.stkQuery(crid);
      } catch (e) {
        console.warn("[residents] stk query poll failed:", e.message);
        q = { status: "unknown" };
      }

      if (q.status === "paid") {
        show("✅ Payment received! Your account is approved — you can log in now.", "ok");
        toast("Registration complete! You can log in now.");

        document.getElementById("residentForm").reset();
        selectedCourtId = "";
        const searchEl = document.getElementById("courtSearch");
        searchEl.disabled = true;
        searchEl.value = "";
        searchEl.placeholder = "Select a phase first…";
        document.getElementById("courtList").style.display = "none";
        document.getElementById("ahewa-fields").hidden = true;
        document.getElementById("stk-phone").value = "";

        btnAhe.disabled  = false;
        btnBoth.disabled = false;
        return;
      }

      if (q.status === "failed") {
        show("❌ Payment failed or cancelled. Use the manual Paybill below.", "error");
        btnAhe.disabled  = false;
        btnBoth.disabled = false;
        return;
      }
    }

    show("⌛ No response yet. Check your phone, or use the manual Paybill below.", "error");
    btnAhe.disabled  = false;
    btnBoth.disabled = false;
  } catch (err) {
    console.error("[residents] STK error:", err);
    show("❌ " + (err.message || "STK push failed."), "error");
    btnAhe.disabled  = false;
    btnBoth.disabled = false;
  }
}

/* ------------------------------------------------------------
   Manual submit — paste receipts, wait for admin
   ------------------------------------------------------------ */
async function handleSubmit(e) {
  e.preventDefault();

  const btn = document.getElementById("registerBtn");
  btn.disabled = true;

  const check = collectAndValidateForm({ requireAheReceipt: true });
  if (!check.ok) { btn.disabled = false; return; }
  const d = check.data;

  const payments = [
    { type: "AHE_REG", amount: FEES.AHE, mpesaReceipt: d.aheReceipt, mpesaPhone: d.ahePhone || null },
  ];
  if (d.joinAHEWA) {
    payments.push({
      type: "AHEWA_REG", amount: FEES.AHEWA,
      mpesaReceipt: d.ahewaReceipt, mpesaPhone: d.ahewaPhone || null,
    });
  }

  const payload = {
    fullName: d.fullName,
    phone:    d.phone,
    email:    d.email || null,
    courtId:  selectedCourtId,
    password: d.password,
    joinAHEWA: d.joinAHEWA,
    payments,
  };

  showMessage("Submitting…", false);

  try {
    const res = await Api.registerResident(payload);

    showMessage(
      `✅ Thank you, ${d.fullName}. Your registration is pending admin verification ` +
      `of your AHE payment${d.joinAHEWA ? " and AHEWA payment" : ""}. ` +
      `You'll receive an email once your account is approved.`,
      false
    );
    toast(`Registration submitted! Pending verification, ${d.firstName}.`);
    console.log("[residents] created:", res);

    e.target.reset();
    selectedCourtId = "";
    const searchEl = document.getElementById("courtSearch");
    searchEl.disabled = true;
    searchEl.value = "";
    searchEl.placeholder = "Select a phase first…";
    document.getElementById("courtList").style.display = "none";
    document.getElementById("ahewa-fields").hidden = true;
    document.getElementById("stk-phone").value = "";
    const stkStatusEl = document.getElementById("stk-status");
    if (stkStatusEl) { stkStatusEl.hidden = true; stkStatusEl.innerHTML = ""; }

  } catch (err) {
    console.error("[residents] submit failed:", err);
    document.getElementById("backendResponse").classList.add("hidden");
    toast(err.message || "Could not submit registration.");
  } finally {
    btn.disabled = false;
  }
}

/* ------------------------------------------------------------
   Inline message box
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

  await Promise.all([loadCourts(), loadPaybill(), loadFees()]);

  const phaseEl     = document.getElementById("phase");
  const searchEl    = document.getElementById("courtSearch");
  const listEl      = document.getElementById("courtList");
  const phoneEl     = document.getElementById("phone");
  const stkPhoneEl  = document.getElementById("stk-phone");
  const stkStatusEl = document.getElementById("stk-status");
  const btnAhe      = document.getElementById("btn-stk-pay-ahe");
  const btnBoth     = document.getElementById("btn-stk-pay-both");

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

  /* AHEWA checkbox → reveal manual AHEWA receipt inputs */
  document.getElementById("join-ahewa").addEventListener("change", (e) => {
    document.getElementById("ahewa-fields").hidden = !e.target.checked;
  });

  /* Two STK buttons */
  if (btnAhe)  btnAhe.addEventListener("click",  () => initiateStkPush(false));
  if (btnBoth) btnBoth.addEventListener("click", () => initiateStkPush(true));

  /* Auto-fill STK phone from main phone field */
  if (phoneEl && stkPhoneEl) {
    phoneEl.addEventListener("blur", () => {
      if (!stkPhoneEl.value) stkPhoneEl.value = phoneEl.value;
    });
  }

  document.getElementById("residentForm").addEventListener("submit", handleSubmit);

  document.getElementById("clearBtn").addEventListener("click", () => {
    document.getElementById("residentForm").reset();
    selectedCourtId = "";
    searchEl.disabled = true;
    searchEl.value = "";
    searchEl.placeholder = "Select a phase first…";
    listEl.style.display = "none";
    document.getElementById("backendResponse").classList.add("hidden");
    document.getElementById("ahewa-fields").hidden = true;
    if (stkPhoneEl) stkPhoneEl.value = "";
    if (stkStatusEl) { stkStatusEl.hidden = true; stkStatusEl.innerHTML = ""; }
  });
});