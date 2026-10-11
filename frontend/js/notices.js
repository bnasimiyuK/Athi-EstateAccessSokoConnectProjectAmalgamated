/* ============================================================
   notices.js — Estate notice board
   Reads + writes /api/notices
   Admin/super can create/edit/delete. Everyone can read.
   Safe on other pages — bails out if the notice-board UI is absent.
   ============================================================ */

const NOTICES_PER_PAGE = 20;

const noticesState = {
  page: 1,
  limit: NOTICES_PER_PAGE,
  total: 0,
  totalPages: 1,
  filters: { q: "", category: "" },
};
let editingNoticeId = null;

const CATEGORY_META = {
  utility:   { label: "Utility",   icon: "💧" },
  security:  { label: "Security",  icon: "🛡️" },
  rules:     { label: "Rules",     icon: "📋" },
  event:     { label: "Event",     icon: "🎉" },
  billing:   { label: "Billing",   icon: "🧾" },
  service:   { label: "Service",   icon: "🛠️" },
  community: { label: "Community", icon: "🏘️" },
};

/* ------------------------------------------------------------
   Role helpers
   ------------------------------------------------------------ */
function getRoleFromToken() {
  try {
    const token = typeof getToken === "function" ? getToken() : null;
    if (!token) return null;
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload && payload.role ? payload.role : null;
  } catch { return null; }
}

function getCurrentRole() {
  try {
    const u = typeof getCurrentUser === "function" ? getCurrentUser() : null;
    if (u && u.role) return u.role;
  } catch { /* ignore */ }
  return getRoleFromToken();
}

function isAdmin() {
  const r = getCurrentRole();
  return r === "admin" || r === "super" || r === "super-admin";
}

function isSuperAdmin() {
  const r = getCurrentRole();
  return r === "super" || r === "super-admin";
}

/* ------------------------------------------------------------
   Helpers
   ------------------------------------------------------------ */
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function relativeTime(iso) {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (isNaN(then)) return "";
  const diff = Date.now() - then;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/* ------------------------------------------------------------
   Header — but only if the notice-board UI is present.
   ------------------------------------------------------------ */
function renderHeader() {
  const role = getCurrentRole();

  // User chip
  if (role) {
    const chip       = document.getElementById("user-chip");
    const nameEl     = document.getElementById("chip-name");
    const roleEl     = document.getElementById("chip-role");
    const loginLink  = document.getElementById("login-link");
    const logoutBtn  = document.getElementById("logoutBtn");

    if (chip)      chip.style.display = "";
    if (loginLink) loginLink.style.display = "none";
    if (logoutBtn) logoutBtn.style.display = "";

    try {
      const u = getCurrentUser();
      if (nameEl && u) nameEl.textContent = u.fullName || u.name || "Member";
    } catch { /* ignore */ }

    if (roleEl) {
      roleEl.textContent = role.toUpperCase();
      roleEl.style.background =
        (role === "super" || role === "super-admin") ? "var(--ink)" : "var(--ochre)";
    }
  }

  // Admin actions (show only to admin / super-admin)
  if (isAdmin()) {
    const adminMenu    = document.getElementById("admin-menu-slot");
    const adminActions = document.getElementById("admin-actions");
    if (adminMenu)    adminMenu.style.display = "";
    if (adminActions) adminActions.style.display = "";

    document.querySelectorAll("[data-super-only]").forEach((el) => {
      el.style.display = isSuperAdmin() ? "" : "none";
    });
  }

  // Wire dropdown toggles
  document.querySelectorAll(".nav-dropdown > a").forEach((toggle) => {
    toggle.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const menu = toggle.nextElementSibling;
      if (!menu) return;
      document.querySelectorAll(".dropdown-menu.show").forEach((m) => {
        if (m !== menu) m.classList.remove("show");
      });
      menu.classList.toggle("show");
    });
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".nav-dropdown")) {
      document.querySelectorAll(".dropdown-menu.show")
        .forEach((m) => m.classList.remove("show"));
    }
  });
}

/* ------------------------------------------------------------
   Load + render list
   ------------------------------------------------------------ */
async function loadNotices() {
  const el = document.getElementById("notices-list");
  if (!el) return;   // not on a notice-board page — silently do nothing

  el.innerHTML = `<div class="empty-state">Loading notices…</div>`;

  let result;
  try {
    const params = {
      page:  noticesState.page,
      limit: noticesState.limit,
      ...(noticesState.filters.q        ? { q: noticesState.filters.q }               : {}),
      ...(noticesState.filters.category ? { category: noticesState.filters.category } : {}),
    };
    result = await Api.getNotices(params);
  } catch (err) {
    console.error("[notices] load failed:", err);
    el.innerHTML = `<div class="empty-state" style="color:var(--clay)">
      Could not load notices: ${escapeHtml(err.message)}
    </div>`;
    return;
  }

  const rows = Array.isArray(result) ? result : (result.data || []);
  noticesState.total      = result.total      ?? rows.length;
  noticesState.page       = result.page       ?? 1;
  noticesState.totalPages = result.totalPages ?? 1;

  setText("hero-total", noticesState.total);
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  setText("hero-recent", rows.filter((r) =>
    new Date(r.created_at || r.createdAt).getTime() > sevenDaysAgo).length);
  setText("hero-pinned", rows.filter((r) => r.pinned).length);

  setText("results-count", `Showing ${rows.length} of ${noticesState.total} notices`);

  if (!rows.length) {
    el.innerHTML = `<div class="empty-state">No notices match your filters.</div>`;
    const pager = document.getElementById("pagination");
    if (pager) pager.innerHTML = "";
    return;
  }

  el.innerHTML = `<div class="notice-list">${rows.map(renderNoticeItem).join("")}</div>`;
  wireActions();
  renderPagination();
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function renderNoticeItem(n) {
  const cat          = CATEGORY_META[n.category] || { label: n.category || "Notice", icon: "📌" };
  const isAdminUser  = isAdmin();
  const pinnedClass  = n.pinned ? " is-pinned" : "";

  const body      = n.text        ?? n.body        ?? "";
  const createdAt = n.created_at  ?? n.createdAt   ?? null;
  const author    = n.author_name ?? n.author      ?? null;

  const actions = isAdminUser
    ? `
      <div class="notice-item__actions">
        <button class="btn btn--ghost btn--small" data-edit="${n.id}" title="Edit">Edit</button>
        <button class="btn btn--danger btn--small" data-delete="${n.id}" title="Delete">Delete</button>
      </div>
    `
    : "";

  return `
    <article class="notice-item${pinnedClass}">
      <div class="notice-item__icon notice-item__icon--${escapeHtml(n.category || "service")}">
        ${cat.icon}
      </div>
      <div>
        <div class="notice-item__head">
          ${n.pinned ? `<span class="notice-item__badge notice-item__pinned-badge">📌 Pinned</span>` : ""}
          <span class="notice-item__badge">${escapeHtml(cat.label)}</span>
          <h3 class="notice-item__title">${escapeHtml(n.title)}</h3>
        </div>
        <p class="notice-item__body">${escapeHtml(body)}</p>
        <div class="notice-item__meta">
          <span>${relativeTime(createdAt)}</span>
          ${author ? `<span>· by ${escapeHtml(author)}</span>` : ""}
        </div>
      </div>
      ${actions}
    </article>
  `;
}

function wireActions() {
  document.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.delete;
      if (!confirm("Delete this notice? This cannot be undone.")) return;
      btn.disabled = true;
      btn.textContent = "Deleting…";
      try {
        await Api.deleteNotice(id);
        toast("Notice deleted.");
        await loadNotices();
      } catch (err) {
        console.error("[notices] delete failed:", err);
        toast(err.message || "Could not delete notice.");
        btn.disabled = false;
        btn.textContent = "Delete";
      }
    });
  });

  document.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => openComposeForEdit(btn.dataset.edit));
  });
}

function renderPagination() {
  const el = document.getElementById("pagination");
  if (!el) return;
  if (noticesState.totalPages <= 1) { el.innerHTML = ""; return; }

  const prevDisabled = noticesState.page <= 1 ? "disabled" : "";
  const nextDisabled = noticesState.page >= noticesState.totalPages ? "disabled" : "";

  el.innerHTML = `
    <div class="pagination"
         style="display:flex;justify-content:space-between;align-items:center;
                gap:12px;margin-top:18px;padding:12px 4px;
                border-top:1px solid var(--line);">
      <div style="font-size:0.9rem;color:var(--ink-70);">
        Page <b>${noticesState.page}</b> of <b>${noticesState.totalPages}</b>
      </div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn--ghost btn--small" data-page="prev" ${prevDisabled}>« Prev</button>
        <button class="btn btn--ghost btn--small" data-page="next" ${nextDisabled}>Next »</button>
      </div>
    </div>
  `;

  el.querySelectorAll("[data-page]").forEach((b) => {
    b.addEventListener("click", () => {
      const dir = b.dataset.page;
      if (dir === "prev" && noticesState.page > 1) noticesState.page--;
      if (dir === "next" && noticesState.page < noticesState.totalPages) noticesState.page++;
      loadNotices();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}

/* ------------------------------------------------------------
   Compose modal
   ------------------------------------------------------------ */
function openCompose() {
  editingNoticeId = null;
  const title = document.getElementById("compose-title");
  const submit = document.getElementById("compose-submit");
  const form = document.getElementById("compose-form");
  const err = document.getElementById("compose-error");
  const modal = document.getElementById("compose-modal");
  const titleInput = document.getElementById("n-title");

  if (title)  title.textContent  = "New notice";
  if (submit) submit.textContent = "Publish";
  if (form)   form.reset();
  if (err)    err.hidden = true;
  if (modal)  modal.classList.add("is-open");
  if (titleInput) titleInput.focus();
}

function openComposeForEdit(id) {
  Api.getNotices({ page: 1, limit: 100 }).then((result) => {
    const rows   = Array.isArray(result) ? result : (result.data || []);
    const notice = rows.find((n) => String(n.id) === String(id));
    if (!notice) {
      toast("Could not find that notice.");
      return;
    }

    editingNoticeId = id;
    const title  = document.getElementById("compose-title");
    const submit = document.getElementById("compose-submit");
    const err    = document.getElementById("compose-error");
    const modal  = document.getElementById("compose-modal");
    const titleInput = document.getElementById("n-title");
    const catInput   = document.getElementById("n-category");
    const bodyInput  = document.getElementById("n-body");
    const pinInput   = document.getElementById("n-pinned");

    if (title)  title.textContent  = "Edit notice";
    if (submit) submit.textContent = "Save changes";
    if (err)    err.hidden = true;

    if (titleInput) titleInput.value  = notice.title    || "";
    if (catInput)   catInput.value    = notice.category || "service";
    if (bodyInput)  bodyInput.value   = notice.text     || notice.body || "";
    if (pinInput)   pinInput.checked  = !!notice.pinned;

    if (modal) modal.classList.add("is-open");
    if (titleInput) titleInput.focus();
  });
}

function closeCompose() {
  const modal = document.getElementById("compose-modal");
  if (modal) modal.classList.remove("is-open");
  editingNoticeId = null;
  const title = document.getElementById("compose-title");
  const submit = document.getElementById("compose-submit");
  if (title)  title.textContent  = "New notice";
  if (submit) submit.textContent = "Publish";
}

async function submitCompose(e) {
  e.preventDefault();
  const errEl = document.getElementById("compose-error");
  if (errEl) errEl.hidden = true;

  const titleInput  = document.getElementById("n-title");
  const catInput    = document.getElementById("n-category");
  const bodyInput   = document.getElementById("n-body");
  const pinInput    = document.getElementById("n-pinned");

  const payload = {
    title:    titleInput ? titleInput.value.trim() : "",
    category: catInput   ? catInput.value          : "service",
    text:     bodyInput  ? bodyInput.value.trim()  : "",
    pinned:   pinInput   ? pinInput.checked        : false,
  };

  if (!payload.title || !payload.text) {
    if (errEl) { errEl.textContent = "Title and message are required."; errEl.hidden = false; }
    return;
  }

  const btn = document.getElementById("compose-submit");
  if (btn) {
    btn.disabled = true;
    btn.dataset.originalLabel = btn.textContent;
    btn.textContent = editingNoticeId ? "Saving…" : "Publishing…";
  }

  try {
    if (editingNoticeId) {
      await Api.updateNotice(editingNoticeId, payload);
      toast("Notice updated.");
    } else {
      await Api.createNotice(payload);
      toast("Notice published.");
    }
    closeCompose();
    await loadNotices();
  } catch (err) {
    console.error("[notices] save failed:", err);
    if (errEl) { errEl.textContent = err.message || "Could not save notice."; errEl.hidden = false; }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = btn.dataset.originalLabel || "Publish";
    }
  }
}

/* ------------------------------------------------------------
   Init — with guards so it bails out cleanly on non-notice pages.
   ------------------------------------------------------------ */
document.addEventListener("DOMContentLoaded", async () => {
  // If there's no notice-board UI on this page, do nothing.
  const listEl = document.getElementById("notices-list");
  if (!listEl) return;

  renderHeader();

  // Filters
  const applyBtn = document.getElementById("apply-filters");
  const resetBtn = document.getElementById("reset-filters");
  const searchEl = document.getElementById("filter-search");
  const catEl    = document.getElementById("filter-category");

  if (applyBtn) {
    applyBtn.addEventListener("click", () => {
      noticesState.filters.q        = searchEl ? searchEl.value.trim() : "";
      noticesState.filters.category = catEl    ? catEl.value           : "";
      noticesState.page = 1;
      loadNotices();
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      if (searchEl) searchEl.value = "";
      if (catEl)    catEl.value    = "";
      noticesState.filters = { q: "", category: "" };
      noticesState.page = 1;
      loadNotices();
    });
  }

  if (searchEl) {
    searchEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && applyBtn) applyBtn.click();
    });
  }

  // Compose modal
  const newBtn = document.getElementById("btn-new-notice");
  if (newBtn) newBtn.addEventListener("click", openCompose);

  const cancelBtn = document.getElementById("compose-cancel");
  if (cancelBtn) cancelBtn.addEventListener("click", closeCompose);

  const composeForm = document.getElementById("compose-form");
  if (composeForm) composeForm.addEventListener("submit", submitCompose);

  const composeModal = document.getElementById("compose-modal");
  if (composeModal) {
    composeModal.addEventListener("click", (e) => {
      if (e.target.id === "compose-modal") closeCompose();
    });
  }

  await loadNotices();
});