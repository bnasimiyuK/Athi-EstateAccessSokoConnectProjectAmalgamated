/* ============================================================
   social-auth.js — Google login button handler
   ============================================================ */

const SOCIAL_API_BASE =
  (typeof API_BASE !== "undefined" && API_BASE) || "http://127.0.0.1:4050";

function startSocialLogin(provider) {
  const url = `${SOCIAL_API_BASE}/auth/${provider}`;
  console.log(`[social] → ${url}`);
  window.location.href = url;
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-social]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      startSocialLogin(btn.dataset.social);
    });
  });
});