/* ============================================================
   change-password.js - authenticated password change
   Requires the user to already be logged in (has a JWT).
   ============================================================ */

/* ------------------------------------------------------------
   Password validator - same rules as signup
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
   Submit handler
   ------------------------------------------------------------ */
async function handleSubmit(e) {
  e.preventDefault();

  const btn = document.getElementById("submitBtn");

  const currentPassword = document.getElementById("currentPassword").value;
  const newPassword     = document.getElementById("newPassword").value;
  const confirmPassword = document.getElementById("confirmPassword").value;

  // Validation
  if (!currentPassword) {
    showMessage("Please enter your current password.", true);
    return;
  }
  if (newPassword === currentPassword) {
    showMessage("New password must be different from the current one.", true);
    return;
  }
  const pwCheck = validatePassword(newPassword);
  if (!pwCheck.valid) {
    showMessage(pwCheck.message, true);
    return;
  }
  if (newPassword !== confirmPassword) {
    showMessage("New passwords do not match.", true);
    return;
  }

  btn.disabled = true;
  showMessage("Saving…", false);

  try {
    await Api.changePassword({ currentPassword, newPassword });

    showMessage("✅ Password updated. Redirecting…", false);

    // Small delay so user sees the success
    setTimeout(() => {
      const user = getUser();
      redirectByRole(user ? user.role : "resident");
    }, 900);

  } catch (err) {
    console.error("[change-password] failed:", err);
    showMessage(err.message || "Could not update password.", true);
    btn.disabled = false;
  }
}

/* ------------------------------------------------------------
   Show message
   ------------------------------------------------------------ */
function showMessage(text, isError) {
  const box = document.getElementById("cpMessage");
  const txt = document.getElementById("cpMessageText");
  box.classList.remove("hidden");
  box.classList.toggle("error", !!isError);
  txt.textContent = text;
}

/* ------------------------------------------------------------
   Init
   ------------------------------------------------------------ */
document.addEventListener("DOMContentLoaded", () => {
  // Must be logged in to reach this page
  if (!requireLogin()) return;

  // Show "first login" notice if URL has ?first=1
  const params = new URLSearchParams(window.location.search);
  if (params.get("first") === "1") {
    document.getElementById("firstLoginNotice").style.display = "block";
    document.getElementById("introText").textContent =
      "For your security, please replace your temporary password with a permanent one.";
  }

  // Wire up the form
  document.getElementById("changePasswordForm")
    .addEventListener("submit", handleSubmit);
});