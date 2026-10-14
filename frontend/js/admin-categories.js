/* ============================================================
   admin-categories.js — super admin category management
   ============================================================ */

let editingCategoryId = null;
let currentCategories = [];

/* ------------------------------------------------------------
   Role helpers
   ------------------------------------------------------------ */
function getRoleFromToken() {
  try {
    const token = typeof getToken === "function" ? getToken() : null;
    if (!token) return null;
    return (JSON.parse(atob(token.split(".")[1])) || {}).role || null;
  } catch { return null; }
}
function getCurrentRole() {
  try {
    const u = typeof getCurrentUser === "function" ? getCurrentUser() : null;
    if (u && u.role) return u.role;
  } catch { /* ignore */ }
  return getRoleFromToken();
}
function isSuperAdmin() { return getCurrentRole() === "super"; }

/* ------------------------------------------------------------
   Load + render
   ------------------------------------------------------------ */
async function loadCategories() {
  const el = document.getElementById("cat-list");
  el.innerHTML = `<div class="empty-state">Loading…</div>`;

  try {
    currentCategories = await Api.getCategories();
  } catch (err) {
    el.innerHTML = `<div class="empty-state" style="color:var(--clay)">
      Could not load categories: ${escapeHtml(err.message)}</div>`;
    return;
  }

  if (!currentCategories.length) {
    el.innerHTML = `<div class="empty-state">No categories yet.</div>`;
    return;
  }

  el.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th style="width:60px;">Icon</th>
            <th>Label</th>
            <th style="width:110px; text-align:right;">Vendors</th>
            <th style="width:180px;">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${currentCategories.map((c) => `
            <tr>
              <td style="font-size:1.4rem; line-height:1; text-align:center;">
                ${escapeHtml(c.icon || "—")}
              </td>
              <td style="font-weight:600;">${escapeHtml(c.label)}</td>
              <td style="text-align:right;">${c.vendors ?? 0}</td>
              <td class="row-actions">
                <button class="btn btn--ghost btn--small" data-edit="${c.id}">Edit</button>
                <button class="btn btn--danger btn--small"
                        data-del="${c.id}"
                        data-label="${escapeAttr(c.label)}">Delete</button>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;

  wireActions();
}

function wireActions() {
  document.querySelectorAll("[data-edit]").forEach((b) =>
    b.addEventListener("click", () => openEdit(b.dataset.edit))
  );

  document.querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", async () => {
      const id = b.dataset.del;
      const label = b.dataset.label;
      if (!confirm(`Delete category "${label}"?\n\nThis will fail if any vendor still uses it.`)) return;

      b.disabled = true;
      b.textContent = "Deleting…";
      try {
        await Api.deleteCategory(id);
        toast(`Category "${label}" deleted.`);
        await loadCategories();
      } catch (err) {
        toast(err.message || "Could not delete category.");
        b.disabled = false;
        b.textContent = "Delete";
      }
    })
  );
}

/* ------------------------------------------------------------
   Modal
   ------------------------------------------------------------ */
function openAdd() {
  editingCategoryId = null;
  document.getElementById("cat-modal-title").textContent = "New category";
  document.getElementById("cat-label").value = "";
  document.getElementById("cat-icon").value  = "";
  document.getElementById("cat-error").style.display = "none";
  document.getElementById("cat-modal").style.display = "flex";
  document.getElementById("cat-label").focus();
}

function openEdit(id) {
  const c = currentCategories.find((x) => String(x.id) === String(id));
  if (!c) return;
  editingCategoryId = id;
  document.getElementById("cat-modal-title").textContent = "Edit category";
  document.getElementById("cat-label").value = c.label || "";
  document.getElementById("cat-icon").value  = c.icon  || "";
  document.getElementById("cat-error").style.display = "none";
  document.getElementById("cat-modal").style.display = "flex";
  document.getElementById("cat-label").focus();
}

function closeModal() {
  editingCategoryId = null;
  document.getElementById("cat-modal").style.display = "none";
}

/* ------------------------------------------------------------
   Save (create or update)
   ------------------------------------------------------------ */
async function saveCategory() {
  const label = document.getElementById("cat-label").value.trim();
  const icon  = document.getElementById("cat-icon").value.trim();
  const errEl = document.getElementById("cat-error");
  errEl.style.display = "none";

  if (!label) {
    errEl.textContent = "Label is required.";
    errEl.style.display = "block";
    return;
  }

  const btn = document.getElementById("cat-save");
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "Saving…";

  try {
    if (editingCategoryId) {
      await Api.updateCategory(editingCategoryId, { label, icon });
      toast("Category updated.");
    } else {
      await Api.createCategory({ label, icon });
      toast("Category created.");
    }
    closeModal();
    await loadCategories();
  } catch (err) {
    errEl.textContent = err.message || "Could not save.";
    errEl.style.display = "block";
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

/* ------------------------------------------------------------
   Helpers
   ------------------------------------------------------------ */
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
function escapeAttr(s) { return escapeHtml(s).replace(/"/g, "&quot;"); }

/* ------------------------------------------------------------
   Init
   ------------------------------------------------------------ */
document.addEventListener("DOMContentLoaded", () => {
  const role = getCurrentRole();

  if (role !== "super") {
    document.querySelector("main").innerHTML =
      `<div class="empty-state" style="color:var(--clay); margin-top:40px;">
        Access denied. Only super admins can manage categories.
      </div>`;
    return;
  }

  document.getElementById("btn-add-cat").addEventListener("click", openAdd);
  document.getElementById("cat-cancel").addEventListener("click", closeModal);
  document.getElementById("cat-save").addEventListener("click", saveCategory);
  document.getElementById("cat-modal").addEventListener("click", (e) => {
    if (e.target.id === "cat-modal") closeModal();
  });

  loadCategories();
});