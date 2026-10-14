/* ============================================================
   admin-admins.js - super-admin page: manage other admins
   ============================================================ */

document.addEventListener("DOMContentLoaded", async () => {
  /* Guard: must be logged in */
  if (typeof requireLogin === "function" && !requireLogin()) return;

  /* Guard: must be a super admin */
  const user = getUser();
  if (!user || user.role !== "super") {
    alert("Only super admins can manage admins.");
    window.location.href = "admin.html";
    return;
  }

  /* Passed the guard - reveal the page (was hidden by the inline script) */
  document.documentElement.style.visibility = "visible";

  await loadAdmins();

  /* Wire up the modals + buttons */
  const btnNew    = document.getElementById("btnNewAdmin");
  const btnCancel = document.getElementById("btnCancelNewAdmin");
  const btnSave   = document.getElementById("btnSaveNewAdmin");
  const btnClose  = document.getElementById("btnCloseTempPw");
  const btnCopy   = document.getElementById("btnCopyTempPw");

  if (btnNew)    btnNew.addEventListener("click", openNewAdminModal);
  if (btnCancel) btnCancel.addEventListener("click", closeNewAdminModal);
  if (btnSave)   btnSave.addEventListener("click", createAdmin);
  if (btnClose)  btnClose.addEventListener("click", () => {
    document.getElementById("tempPwModal").style.display = "none";
  });
  if (btnCopy)   btnCopy.addEventListener("click", () => {
    const text = document.getElementById("tempPwValue").textContent;
    navigator.clipboard.writeText(text).then(() => toast("Copied!"));
  });
});

/* ------------------------------------------------------------
   Load + render the admin list
   ------------------------------------------------------------ */
async function loadAdmins() {
  const box = document.getElementById("adminsTable");
  if (!box) return;

  box.innerHTML = `<div class="empty-state">Loading…</div>`;

  let admins;
  try {
    admins = await Api.getAdmins();
  } catch (err) {
    box.innerHTML = `<div class="empty-state" style="color:#c0392b;">${err.message}</div>`;
    return;
  }

  if (!admins.length) {
    box.innerHTML = `<div class="empty-state">No admins yet.</div>`;
    return;
  }

  const me         = getUser();
  const superCount = admins.filter((a) => a.role === "super").length;

  const rows = admins.map((a) => {
    const isMe    = a.id === me.id;
    const isSuper = a.role === "super";

    /* Cannot demote/delete the last remaining super admin */
    const isLastSuper = isSuper && superCount === 1;

    return `
      <tr>
        <td>${escapeHtml(a.full_name)}${isMe ? " <em style='color:#6b7280;'>(you)</em>" : ""}</td>
        <td>${escapeHtml(a.email)}</td>
        <td>
          <span class="badge ${isSuper ? "badge--verified" : ""}" style="${isSuper ? "" : "background:#e5e7eb;color:#374151;"}">
            ${isSuper ? "SUPER" : "ADMIN"}
          </span>
        </td>
        <td>${a.must_change_password ? '<span style="color:#c0392b;">Pending first login</span>' : "Active"}</td>
        <td style="text-align:right; white-space:nowrap;">
          <button type="button" class="btn btn--ghost btn--small" data-action="reset" data-id="${a.id}">
            Reset password
          </button>

          ${(!isSuper || !isMe) && !isLastSuper ? `
            <button type="button" class="btn btn--ghost btn--small" data-action="role" data-id="${a.id}" data-role="${isSuper ? "admin" : "super"}">
              ${isSuper ? "Demote" : "Promote"}
            </button>
          ` : ""}

          ${!isMe && !isLastSuper ? `
            <button type="button" class="btn btn--ghost btn--small" style="color:#c0392b;" data-action="delete" data-id="${a.id}" data-name="${escapeHtml(a.full_name)}">
              Delete
            </button>
          ` : ""}
        </td>
      </tr>
    `;
  }).join("");

  box.innerHTML = `
    <table style="width:100%; border-collapse:collapse; background:#fff; border-radius:8px; overflow:hidden;">
      <thead>
        <tr style="background:#f3f4f6; text-align:left;">
          <th style="padding:12px;">Name</th>
          <th style="padding:12px;">Email</th>
          <th style="padding:12px;">Role</th>
          <th style="padding:12px;">Status</th>
          <th style="padding:12px;"></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  box.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => handleRowAction(btn));
  });
}

/* ------------------------------------------------------------
   Row actions: reset / promote-demote / delete
   ------------------------------------------------------------ */
async function handleRowAction(btn) {
  const id     = parseInt(btn.dataset.id, 10);
  const action = btn.dataset.action;

  if (action === "reset") {
    if (!confirm("Reset this admin's password? A new temp password will be generated.")) return;
    try {
      const r = await Api.resetAdminPassword(id);
      showTempPassword(r.tempPassword);
    } catch (err) { toast(err.message); }
    return;
  }

  if (action === "role") {
    const newRole = btn.dataset.role;
    const verb    = newRole === "super" ? "Promote to super admin" : "Demote to admin";
    if (!confirm(`${verb}?`)) return;
    try {
      await Api.updateAdmin(id, { role: newRole });
      toast("Role updated.");
      loadAdmins();
    } catch (err) { toast(err.message); }
    return;
  }

  if (action === "delete") {
    const name = btn.dataset.name;
    if (!confirm(`Delete ${name}? This cannot be undone.`)) return;
    try {
      await Api.deleteAdmin(id);
      toast("Admin deleted.");
      loadAdmins();
    } catch (err) { toast(err.message); }
  }
}

/* ------------------------------------------------------------
   Modal helpers
   ------------------------------------------------------------ */
function openNewAdminModal() {
  document.getElementById("newAdminName").value  = "";
  document.getElementById("newAdminEmail").value = "";
  document.getElementById("newAdminRole").value  = "admin";
  document.getElementById("newAdminModal").style.display = "flex";
}

function closeNewAdminModal() {
  document.getElementById("newAdminModal").style.display = "none";
}

async function createAdmin() {
  const fullName = document.getElementById("newAdminName").value.trim();
  const email    = document.getElementById("newAdminEmail").value.trim();
  const role     = document.getElementById("newAdminRole").value;

  if (!fullName || !email) { toast("Please fill in both fields."); return; }

  try {
    const r = await Api.createAdmin({ fullName, email, role });
    closeNewAdminModal();
    showTempPassword(r.tempPassword);
    loadAdmins();
  } catch (err) { toast(err.message); }
}

function showTempPassword(pw) {
  document.getElementById("tempPwValue").textContent = pw;
  document.getElementById("tempPwModal").style.display = "flex";
}

/* ------------------------------------------------------------
   Small helper
   ------------------------------------------------------------ */
function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}