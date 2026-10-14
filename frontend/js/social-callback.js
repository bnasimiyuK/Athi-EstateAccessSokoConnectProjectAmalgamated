/* ============================================================
   social-callback.js - runs on social-callback.html
   Reads the token + user from the URL fragment, saves the
   session, then routes by role.
   ============================================================ */

(function () {
  const statusEl = document.getElementById("social-status");

  const hash   = window.location.hash.slice(1);
  const params = new URLSearchParams(hash);
  const token    = params.get("token");
  const userRaw  = params.get("user");
  const err      = params.get("error");

  if (err) {
    statusEl.textContent = "Sign-in failed: " + decodeURIComponent(err);
    setTimeout(() => (window.location.href = "login.html"), 2500);
    return;
  }

  if (!token || !userRaw) {
    statusEl.textContent = "Missing session data. Redirecting to login…";
    setTimeout(() => (window.location.href = "login.html"), 2000);
    return;
  }

  let user;
  try { user = JSON.parse(decodeURIComponent(userRaw)); }
  catch (e) {
    statusEl.textContent = "Bad session data. Redirecting to login…";
    setTimeout(() => (window.location.href = "login.html"), 2000);
    return;
  }

  saveSession(token, user);
  history.replaceState(null, "", "social-callback.html");

  /* Route by role - super admins go to the admin dashboard too */
  if (user.role === "admin" || user.role === "super") {
    window.location.href = "admin.html";
  } else if (user.role === "vendor") {
    window.location.href = "provider-dashboard.html";
  } else {
    window.location.href = "dashboard.html";
  }
})();