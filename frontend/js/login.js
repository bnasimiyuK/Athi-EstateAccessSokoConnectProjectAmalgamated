/* ============================================================
   login.js — role-tabbed login form
   Supports 5 roles: admin, super-admin, security, resident, vendor
   ============================================================ */

let currentRole = "resident";

/* ------------------------------------------------------------
   Configure placeholder + label per role
   ------------------------------------------------------------ */
function applyRole(role) {
  currentRole = role;

  const label = document.getElementById("identifierLabel");
  const input = document.getElementById("identifier");

  if (role === "admin" || role === "super-admin" || role === "security") {
    /* Admin, super-admin, and security log in with email */
    label.innerHTML = `<i class="fas fa-envelope"></i> Email address`;
    input.placeholder = "you@example.com";
    input.type = "email";
    input.value = "";
  } else {
    /* Resident & vendor log in with phone (Kenyan or international) */
    label.innerHTML = `<i class="fas fa-phone-alt"></i> Phone number`;
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
   2. Super Admin role → super-admin.html       (always, unless ?next=)
   3. ?next= param     → that URL               (deep links)
   4. Role default     → admin/resident/vendor pages
   ------------------------------------------------------------ */
function redirectAfterLogin(user) {
  /* 1. Security always goes to its own dashboard. */
  if (user?.role === "security") {
    window.location.href = "security-visitors.html";
    return;
  }

  /* 2. Super admin always goes to the super-admin dashboard,
        unless an explicit ?next= is provided. */
  if (user?.role === "super-admin") {
    const params = new URLSearchParams(window.location.search);
    const next = params.get("next");
    window.location.href = next || "super-admin.html";
    return;
  }

  /* 3. Honor ?next= for everyone else */
  const params = new URLSearchParams(window.location.search);
  const next = params.get("next");
  if (next) {
    window.location.href = next;
    return;
  }

  /* 4. Role-based default */
  switch (user?.role) {
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

  const btn        = document.getElementById("loginBtn");
  const identifier = document.getElementById("identifier").value.trim();
  const password   = document.getElementById("password").value;

  if (!identifier || !password) {
    showMessage("Please fill in both fields.", true);
    return;
  }

  /* ---------- Client-side format validation ---------- */
  let normalizedIdentifier = identifier;

  if (currentRole === "admin" || currentRole === "super-admin" || currentRole === "security") {
    /* Admin, super-admin & security log in with email */
    const check = validateEmail(identifier, { optional: false });
    if (!check.valid) { showMessage(check.reason, true); return; }
    normalizedIdentifier = check.normalized;
  } else {
    /* Resident & vendor log in with phone (Kenyan or international) */
    const check = normalizePhone(identifier);
    if (!check.valid) { showMessage(check.reason, true); return; }
    normalizedIdentifier = check.normalized;
  }

  if (password.length === 0) {
    showMessage("Password is required.", true);
    return;
  }

  btn.disabled = true;
  showMessage("Signing in…", false);

  try {
    const result = await Api.login({
      role: currentRole,
      identifier: normalizedIdentifier,
      password,
    });

    /* Save token + user */
    saveSession(result.token, result.user);

    /* Forced password change takes priority */
    if (result.mustChangePassword) {
      window.location.href = "change-password.html?first=1";
      return;
    }

    /* Otherwise redirect by role */
    redirectAfterLogin(result.user);

  } catch (err) {
    console.error("[login] failed:", err);
    showMessage(err.message || "Login failed. Please try again.", true);
    btn.disabled = false;
  }
}

/* ------------------------------------------------------------
   Show message box
   ------------------------------------------------------------ */
function showMessage(text, isError) {
  const box = document.getElementById("loginMessage");
  const txt = document.getElementById("loginMessageText");
  box.classList.remove("hidden");
  box.classList.toggle("error", !!isError);
  txt.textContent = text;
}

/* ------------------------------------------------------------
   Init
   ------------------------------------------------------------ */
document.addEventListener("DOMContentLoaded", () => {
  /* If already logged in, redirect */
  if (isLoggedIn()) {
    const user = getUser();
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
  document.getElementById("loginForm").addEventListener("submit", handleLogin);
});