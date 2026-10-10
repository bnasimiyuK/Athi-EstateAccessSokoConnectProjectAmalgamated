/* ============================================================
   auth.js — token & session helpers (load BEFORE api.js)
   Super admin passes every guard.
   ============================================================ */

const TOKEN_KEY = "asc_token";
const USER_KEY  = "asc_user";

/* ---------- Save / retrieve token ---------- */
function saveSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function getUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function isLoggedIn() {
  return !!getToken();
}

function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

function isSuperAdmin() {
  const u = getUser();
  return !!(u && u.role === "super-admin");
}

/* ---------- Logout and redirect ---------- */
function logout() {
  clearSession();
  window.location.href = "login.html";
}

/* ---------- Home page per role ---------- */
function homeForRole(role) {
  switch (role) {
    case "super-admin": return "super-admin.html";
    case "admin":       return "admin.html";
    case "security":    return "security-visitors.html";
    case "vendor":      return "provider-dashboard.html";
    case "resident":    return "dashboard.html";
    default:            return "index.html";
  }
}

/* ---------- Redirect by role ---------- */
function redirectByRole(role) {
  window.location.href = homeForRole(role);
}

/* ---------- Guard: require login (any role, super admin passes) ---------- */
function requireLogin() {
  if (!isLoggedIn()) {
    window.location.href = "login.html?next=" +
      encodeURIComponent(window.location.pathname);
    return false;
  }
  return true;
}

/* ---------- Guard: require one of the given roles ----------
   Super admin passes EVERY role check so they can inspect,
   test, and maintain any part of the system.
   ------------------------------------------------------------ */
function requireRole(...roles) {
  const user = getUser();

  // Super admin → always allowed
  if (user && user.role === "super-admin") return true;

  if (!user) {
    window.location.href = "login.html?next=" +
      encodeURIComponent(window.location.pathname);
    return false;
  }
  if (!roles.includes(user.role)) {
    // Not authorized → send them to their own home page
    window.location.href = homeForRole(user.role);
    return false;
  }
  return true;
}

/* ---------- Convenience guards for common checks ---------- */
function requireAdmin()    { return requireRole("admin"); }
function requireVendor()   { return requireRole("vendor", "provider"); }
function requireResident() { return requireRole("resident"); }
function requireSecurity() { return requireRole("security"); }