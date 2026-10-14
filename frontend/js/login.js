/* ============================================================
   login.js — role-tabbed login form
   Supports 5 roles: super-admin, admin, security, resident, vendor
   ============================================================ */

let currentRole = "resident";

/* ------------------------------------------------------------
   Configure placeholder + label per role
   ------------------------------------------------------------ */
function applyRole(role) {
  currentRole = role;

  const label = document.getElementById("identifierLabel");
  const input = document.getElementById("identifier");

  if (!label || !input) return;

  if (role === "admin" || role === "super-admin" || role === "security") {
    /* Admin, super-admin, and security log in with email */
    label.innerHTML = '<i class="fas fa-envelope"></i> Email address';
    input.placeholder = "you@example.com";
    input.type = "email";
    input.value = "";
  } else {
    /* Resident & vendor log in with phone (Kenyan or international) */
    label.innerHTML = '<i class="fas fa-phone-alt"></i> Phone number';
    input.placeholder = "07XX XXX XXX";
    input.type = "tel";
    input.value = "";
  }

  document.querySelectorAll("#roleTabs .tab-btn").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.role === role);
  });
}

/* ------------------------------------------------------------
   Redirect after login, based on role (or `?next=` param)

   Priority:
   1. Security role    → security-visitors.html (always)
   2. Super Admin role → super-admin.html       (unless ?next=)
   3. ?next= param     → that URL               (deep links)
   4. Role default     → admin/resident/vendor pages
   ------------------------------------------------------------ */
function redirectAfterLogin(user) {
  if (user && user.role === "security") {
    window.location.href = "security-visitors.html";
    return;
  }

  if (user && user.role === "super-admin") {
    const params = new URLSearchParams(window.location.search);
    const next = params.get("next");
    window.location.href = next || "super-admin.html";
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const next = params.get("next");
  if (next) {
    window.location.href = next;
    return;
  }

  switch (user && user.role) {
    case "admin":  window.location.href = "admin.html"; break;
    case "vendor": window.location.href = "provider-dashboard.html"; break;
    case "resident":
    default:       window.location.href = "dashboard.html"; break;
  }
}

/* ------------------------------------------------------------
   Submit
   ------------------------------------------------------------ */
async function handleLogin(e) {
  e.preventDefault();

  const btn       = document.getElementById("loginBtn");
  const idInput   = document.getElementById("identifier");
  const passInput = document.getElementById("password");

  if (!idInput || !passInput) {
    showMessage("Login form is missing fields. Please refresh.", true);
    return;
  }

  const rawId    = idInput.value.trim();
  const password = passInput.value;

  if (!rawId || !password) {
    showMessage("Please fill in both fields.", true);
    return;
  }

  /* ---------- Client-side format validation ---------- */
  let normalizedIdentifier = rawId;

  if (currentRole === "admin" || currentRole === "super-admin" || currentRole === "security") {
    /* Admin, super-admin & security log in with email */
    if (typeof validateEmail === "function") {
      const check = validateEmail(rawId, { optional: false });
      if (!check.valid) { showMessage(check.reason, true); return; }
      normalizedIdentifier = check.normalized;
    }
  } else {
    /* Resident & vendor log in with phone */
    if (typeof normalizePhone === "function") {
      const check = normalizePhone(rawId);
      if (!check.valid) { showMessage(check.reason, true); return; }
      normalizedIdentifier = check.normalized;
    }
  }

  btn.disabled = true;
  showMessage("Signing in…", false);

  try {
    const result = await Api.login({
      role: currentRole,
      identifier: normalizedIdentifier,
      password: password,
    });

    saveSession(result.token, result.user);

    if (result.mustChangePassword) {
      window.location.href = "change-password.html?first=1";
      return;
    }

    redirectAfterLogin(result.user);
  } catch (err) {
    console.error("[login] failed:", err);
    showMessage(err && err.message ? err.message : "Login failed. Please try again.", true);
    btn.disabled = false;
  }
}

/* ------------------------------------------------------------
   Show message box
   ------------------------------------------------------------ */
function showMessage(text, isError) {
  const box = document.getElementById("loginMessage");
  const txt = document.getElementById("loginMessageText");
  if (!box || !txt) return;
  box.classList.remove("hidden");
  box.classList.toggle("error", !!isError);
  txt.textContent = text;
}

/* ------------------------------------------------------------
   Init
   ------------------------------------------------------------ */
document.addEventListener("DOMContentLoaded", () => {
  /* If already logged in, redirect */
  if (typeof isLoggedIn === "function" && isLoggedIn()) {
    const user = typeof getUser === "function" ? getUser() : null;
    if (user && user.role) redirectAfterLogin(user);
    return;
  }

  /* Tab handlers */
  document.querySelectorAll("#roleTabs .tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => applyRole(btn.dataset.role));
  });

  /* Default role */
  applyRole("resident");

  /* Form submit */
  const form = document.getElementById("loginForm");
  if (form) form.addEventListener("submit", handleLogin);
});