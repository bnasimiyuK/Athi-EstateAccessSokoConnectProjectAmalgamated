/* ============================================================
   auth.js — token & session helpers (load BEFORE api.js)
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

/* ---------- Logout and redirect ---------- */
function logout() {
  clearSession();
  window.location.href = "login.html";
}

/* ---------- Redirect by role ---------- */
function redirectByRole(role) {
  switch (role) {
    case "admin":    return window.location.href = "admin.html";
    case "resident": return window.location.href = "index.html";
    case "vendor":   return window.location.href = "dashboard.html";
    default:         return window.location.href = "index.html";
  }
}

/* ---------- Guard: require login (any role) ---------- */
function requireLogin() {
  if (!isLoggedIn()) {
    window.location.href = "login.html?next=" +
      encodeURIComponent(window.location.pathname);
    return false;
  }
  return true;
}

/* ---------- Guard: require a specific role ---------- */
function requireRole(...allowed) {
  if (!requireLogin()) return false;
  const user = getUser();
  if (!user || !allowed.includes(user.role)) {
    alert("You don't have permission to view this page.");
    redirectByRole(user ? user.role : "resident");
    return false;
  }
  return true;
}