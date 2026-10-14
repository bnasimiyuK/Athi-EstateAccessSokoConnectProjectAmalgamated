/* ============================================================
   admin-tools.js
   Full-featured modals replacing the old separate admin pages:
     - House numbers  →  dropdown per resident (with taken markers)
     - Categories     →  add / edit / delete (with icon picker)
     - Reviews        →  list + mark reviewed + delete
     - Admins         →  list + add + edit + reset password + promote/demote + delete
     - Trends         →  charts rendered by admin.js
   Super-admin gating for [data-super-only] in .admin-links.
   ============================================================ */

(function () {
  "use strict";

  /* ============================================================
     MODULE-LEVEL STATE
     ============================================================ */
  let TAKEN_HOUSE_NUMBERS = new Set();

  /* ============================================================
     LINK CLICK HANDLER (Admin tools links)
     ============================================================ */
  document.addEventListener("click", function (e) {
    const link = e.target.closest(
      ".admin-links a, .admin-tile[data-goto-tab], .dx-link-btn[data-modal]"
    );
    if (!link) return;

    if (link.dataset.gotoTab) {
      e.preventDefault();
      const tabBtn = document.querySelector(
        '.tab-btn[data-tab="' + link.dataset.gotoTab + '"]'
      );
      if (tabBtn) tabBtn.click();
      const anchor = document.getElementById("work-queue-anchor");
      if (anchor) anchor.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    if (link.dataset.modal) {
      e.preventDefault();
      openAdminModal(link.dataset.modal);
    }
  });

  /* ============================================================
     MODAL SYSTEM
     ============================================================ */
  function openAdminModal(name) {
    const tpl = document.getElementById("modal-tpl-" + name);
    if (!tpl) {
      console.warn("[admin-tools] No modal template for:", name);
      return;
    }

    const wrap = document.createElement("div");
    wrap.className = "admin-modal-backdrop";
    wrap.innerHTML =
      '<div class="admin-modal" role="dialog" aria-modal="true">' +
        '<button class="admin-modal__close" aria-label="Close">✕</button>' +
        '<div class="admin-modal__body"></div>' +
      '</div>';

    wrap.querySelector(".admin-modal__body").appendChild(tpl.content.cloneNode(true));

    wrap.addEventListener("click", function (ev) {
      if (ev.target === wrap || ev.target.classList.contains("admin-modal__close")) {
        closeModal(wrap);
      }
    });

    function onKey(ev) { if (ev.key === "Escape") closeModal(wrap); }
    document.addEventListener("keydown", onKey);
    wrap._onKey = onKey;

    document.body.appendChild(wrap);
    loadModalContent(name, wrap);
  }

  function closeModal(wrap) {
    if (wrap._onKey) document.removeEventListener("keydown", wrap._onKey);
    wrap.remove();
  }

  /* ============================================================
     CONTENT LOADERS
     ============================================================ */
  async function loadModalContent(name, wrap) {
    const body = wrap.querySelector(".admin-modal__body");
    const api  = window.api || null;

    // Trends modal — charts are rendered by admin.js
    if (name === "trends") {
      loadTrendsModal(wrap);
      return;
    }

    if (!api || typeof api.get !== "function") {
      body.querySelectorAll(".loading").forEach(function (el) {
        el.classList.remove("loading");
        el.textContent = "This will display once the API is available.";
      });
      return;
    }

    try {
      let rows = null, target = null;

      if (name === "reviews") {
        rows   = await api.get("/admin/reviews");
        target = body.querySelector("#reviews-list");

      } else if (name === "categories") {
        rows   = await api.get("/admin/categories");
        target = body.querySelector("#categories-list");

      } else if (name === "house-numbers") {
        const residents = await api.get("/admin/house-numbers");
        TAKEN_HOUSE_NUMBERS = new Set(
          (residents || []).map((r) => r.number).filter(Boolean)
        );
        try {
          const taken = await api.getTakenHouseNumbers();
          if (Array.isArray(taken) && taken.length) {
            TAKEN_HOUSE_NUMBERS = new Set(taken);
          }
        } catch { /* endpoint not present — ignore */ }

        rows   = residents;
        target = body.querySelector("#house-numbers-list");

      } else if (name === "admins") {
        rows   = await api.get("/admin/admins");
        target = body.querySelector("#admins-list");

        const user = typeof getUser === "function" ? getUser() : null;
        if (user && user.role === "super") {
          if (!body.querySelector("#btnAddAdminModal")) {
            const addBtn = document.createElement("button");
            addBtn.id = "btnAddAdminModal";
            addBtn.className = "admin-btn-add";
            addBtn.innerHTML = '<i class="fas fa-user-plus"></i> Add admin';

            target.parentNode.insertBefore(addBtn, target);
            addBtn.addEventListener("click", () => openNewAdminModal(target));
          }
        }
      }

      if (!target) return;
      target.classList.remove("loading");

      if (!rows || !rows.length) {
        target.innerHTML = "<em>Nothing here yet.</em>";
      } else {
        target.innerHTML = renderRows(name, rows);
      }

      /* Attach per-modal action handlers */
      if (name === "categories")    wireCategoryActions(wrap, target);
      if (name === "reviews")       wireReviewActions(wrap, target);
      if (name === "admins")        wireAdminActions(wrap, target);
      if (name === "house-numbers") wireHouseNumberActions(wrap, target);

    } catch (err) {
      console.warn("[admin-tools] load failed for", name, err);
      body.querySelectorAll(".loading").forEach(function (el) {
        el.classList.remove("loading");
        el.textContent = "Could not load " + name + ": " + (err.message || "unknown error");
      });
    }
  }

  /* ============================================================
     RENDERERS PER MODAL
     ============================================================ */
  function renderRows(name, rows) {
    /* ---------- REVIEWS ---------- */
    if (name === "reviews") {
      return rows.map(function (r) {
        const stars = "★".repeat(r.rating || 0) + "☆".repeat(5 - (r.rating || 0));
        const status = r.status || "pending";

        const statusBadge = status === "reviewed"
          ? '<span class="rev-badge rev-badge--ok">Reviewed</span>'
          : '<span class="rev-badge rev-badge--warn">Pending</span>';

        const markBtn = status === "pending"
          ? '<button type="button" class="rev-btn-icon" data-action="rv-reviewed" title="Mark reviewed">' +
              '<i class="fas fa-check"></i></button>'
          : '';

        const dateStr = r.date
          ? (typeof formatDate === "function"
              ? formatDate(r.date)
              : new Date(r.date).toLocaleDateString())
          : "";

        return '<div class="rev-card" data-id="' + escapeHtml(r.id) + '">' +
                 '<div class="rev-card__header">' +
                   '<span class="rev-card__vendor">' + escapeHtml(r.providerName || r.vendor || "Unknown vendor") + '</span>' +
                   '<span class="rev-card__stars">' + stars + '</span>' +
                 '</div>' +
                 '<p class="rev-card__text">"' + escapeHtml(r.text || r.comment || "") + '"</p>' +
                 '<div class="rev-card__footer">' +
                   '<span class="rev-card__meta">' +
                     'By <b>' + escapeHtml(r.author || "Anonymous") + '</b>' +
                     (dateStr ? ' · ' + escapeHtml(dateStr) : "") +
                   '</span>' +
                   '<div class="rev-card__actions">' +
                     statusBadge + markBtn +
                     '<button type="button" class="rev-btn-icon rev-btn-icon--danger" ' +
                             'data-action="rv-delete" title="Delete review">' +
                       '<i class="fas fa-trash"></i>' +
                     '</button>' +
                   '</div>' +
                 '</div>' +
               '</div>';
      }).join("");
    }

    /* ---------- CATEGORIES ---------- */
    if (name === "categories") {
      return rows.map(function (c) {
        const icon  = c.icon || "📁";
        const id    = c.id ?? c._id ?? "";
        const label = c.label || c.name || "";
        return '<div class="cat-row" data-id="' + escapeHtml(id) + '">' +
                 '<span class="cat-row__icon">' + escapeHtml(icon) + '</span>' +
                 '<span class="cat-row__name">' + escapeHtml(label) + '</span>' +
                 '<div class="cat-row__actions">' +
                   '<button type="button" class="btn-icon" data-action="cat-edit" title="Edit">' +
                     '<i class="fas fa-pencil"></i></button>' +
                   '<button type="button" class="btn-icon btn-icon--danger" data-action="cat-delete" title="Delete">' +
                     '<i class="fas fa-trash"></i></button>' +
                 '</div>' +
               '</div>';
      }).join("");
    }

    /* ---------- HOUSE NUMBERS ---------- */
    if (name === "house-numbers") {
      return rows.map(function (h) {
        const id      = h.id != null ? String(h.id) : "";
        const val     = (h.number || "").trim();
        const label   = h.name || h.fullName || "";
        const court   = (h.courtName || h.court || "").trim();
        const options = buildHouseNumberOptions(court, val);

        return '<div class="hn-row" data-id="' + escapeHtml(id) + '">' +
                 '<span class="hn-row__name">' +
                   escapeHtml(label) +
                   (court ? ' <small>· ' + escapeHtml(court) + '</small>' : '') +
                 '</span>' +
                 '<select class="hn-select" data-id="' + escapeHtml(id) + '">' +
                   options +
                 '</select>' +
                 '<button type="button" class="hn-save-btn" data-action="hn-save" title="Save">' +
                   '<i class="fas fa-check"></i>' +
                 '</button>' +
               '</div>';
      }).join("");
    }

    /* ---------- ADMINS ---------- */
    if (name === "admins") {
      const me = typeof getUser === "function" ? getUser() : null;
      const meId = me?.id;
      const superCount = rows.filter((a) => a.role === "super").length;

      return rows.map(function (a) {
        const isMe    = a.id === meId;
        const isSuper = a.role === "super";
        const isLast  = isSuper && superCount === 1;

        const badgeClass = isSuper ? "admin-row__badge--super" : "admin-row__badge--admin";

        return '<div class="admin-row" data-id="' + escapeHtml(a.id) + '" ' +
                    'data-name="' + escapeHtml(a.name || "") + '" ' +
                    'data-email="' + escapeHtml(a.email || "") + '" ' +
                    'data-role="' + escapeHtml(a.role || "") + '">' +
                 '<span class="admin-row__name">' +
                   escapeHtml(a.name || "(unnamed)") +
                   (isMe ? ' <em>(you)</em>' : "") +
                 '</span>' +
                 '<span class="admin-row__badge ' + badgeClass + '">' + escapeHtml(a.role || "") + '</span>' +
                 '<div class="admin-row__actions">' +
                   '<button type="button" class="btn-icon" data-action="adm-edit" title="Edit admin">' +
                     '<i class="fas fa-pencil"></i></button>' +
                   '<button type="button" class="btn-icon" data-action="adm-reset" title="Reset password">' +
                     '<i class="fas fa-key"></i></button>' +
                   (!isLast
                     ? '<button type="button" class="btn-icon" data-action="adm-role" ' +
                               'data-next-role="' + (isSuper ? "admin" : "super") + '" ' +
                               'title="' + (isSuper ? "Demote to admin" : "Promote to super admin") + '">' +
                         '<i class="fas fa-' + (isSuper ? 'arrow-down' : 'arrow-up') + '"></i></button>'
                     : '') +
                   (!isMe && !isLast
                     ? '<button type="button" class="btn-icon btn-icon--danger" data-action="adm-delete" title="Delete">' +
                         '<i class="fas fa-trash"></i></button>'
                     : '') +
                 '</div>' +
               '</div>';
      }).join("");
    }

    /* Fallback */
    return rows.map(function (row) {
      return "<div>" + escapeHtml(String(row)) + "</div>";
    }).join("");
  }

  /* ============================================================
     HOUSE NUMBER OPTION BUILDER
     ============================================================ */
  function buildHouseNumberOptions(court, current) {
    const opts = ['<option value="">— unassigned —</option>'];
    if (!court) return opts.join("");

    for (const side of ["A", "B"]) {
      for (let i = 1; i <= 15; i++) {
        const nn   = String(i).padStart(2, "0");
        const code = court + " " + side + nn;

        const isCurrent = code === current;
        const isTaken   = TAKEN_HOUSE_NUMBERS.has(code) && !isCurrent;

        opts.push(
          '<option value="' + escapeHtml(code) + '"' +
          (isCurrent ? ' selected' : '') +
          (isTaken   ? ' disabled'   : '') +
          '>' + escapeHtml(code) + (isTaken ? ' (taken)' : '') + '</option>'
        );
      }
    }

    if (current && !opts.join("").includes('value="' + current + '"')) {
      opts.push(
        '<option value="' + escapeHtml(current) + '" selected>' +
          escapeHtml(current) + ' (custom)</option>'
      );
    }

    return opts.join("");
  }

  /* ============================================================
     CATEGORY ACTIONS
     ============================================================ */
  function wireCategoryActions(wrap, target) {
    const api = window.api;

    const addForm = wrap.querySelector("#add-category-form");
    if (addForm) {
      addForm.className = "cat-add-form";

          addForm.innerHTML =
        '<div class="cat-input-group">' +
          '<label>Icon</label>' +
          '<input type="text" id="new-cat-icon" class="cat-input cat-input--icon" maxlength="4" placeholder="📁">' +
        '</div>' +
        '<div class="cat-input-group" style="flex-grow:1;">' +
          '<label>Label</label>' +
          '<input type="text" id="new-cat-name" class="cat-input cat-input--label" placeholder="e.g. Plumbing">' +
        '</div>' +
        '<button type="submit" class="cat-btn-add"><i class="fas fa-plus"></i> Add</button>' +
        '<p class="cat-icon-hint">' +
          '<i class="fas fa-search"></i> Search icons: ' +
          '<a href="https://emojipedia.org/search?q=" target="_blank" rel="noopener">Emojipedia</a> · ' +
          '<a href="https://getemoji.com/" target="_blank" rel="noopener">GetEmoji</a> · ' +
          '<a href="https://emojicopy.com/" target="_blank" rel="noopener">EmojiCopy</a> · ' +
          '<a href="https://fontawesome.com/search?o=r&m=free" target="_blank" rel="noopener">Font Awesome</a> ' +
          '<span style="opacity:.7;">— click one, search, then paste the emoji here</span>' +
        '</p>';

      const newIconIn = addForm.querySelector("#new-cat-icon");
      const newNameIn = addForm.querySelector("#new-cat-name");

      addForm.addEventListener("submit", async function (e) {
        e.preventDefault();
        const icon  = (newIconIn.value || "📁").trim().slice(0, 4) || "📁";
        const label = (newNameIn.value || "").trim();
        if (!label) return;

        const submitBtn = addForm.querySelector("button[type=submit]");
        submitBtn.disabled = true;

        try {
          const created = await api.createCategory({ label, icon });

          const newNode = document.createElement("div");
          newNode.className = "cat-row";
          newNode.dataset.id = created?.id ?? "";
          newNode.innerHTML =
            '<span class="cat-row__icon">' + escapeHtml(created?.icon || icon) + '</span>' +
            '<span class="cat-row__name">' + escapeHtml(created?.label || label) + '</span>' +
            '<div class="cat-row__actions">' +
              '<button type="button" class="btn-icon" data-action="cat-edit" title="Edit">' +
                '<i class="fas fa-pencil"></i></button>' +
              '<button type="button" class="btn-icon btn-icon--danger" data-action="cat-delete" title="Delete">' +
                '<i class="fas fa-trash"></i></button>' +
            '</div>';

          if (target.firstChild) target.insertBefore(newNode, target.firstChild);
          else target.appendChild(newNode);

          newNameIn.value = "";
          newIconIn.value = "";
          newIconIn.focus();
        } catch (err) {
          alert("Could not add category: " + err.message);
        } finally {
          submitBtn.disabled = false;
        }
      });
    }

    target.addEventListener("click", async function (e) {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const row = btn.closest(".cat-row");
      if (!row) return;

      const id       = row.dataset.id;
      const nameE    = row.querySelector(".cat-row__name");
      const iconE    = row.querySelector(".cat-row__icon");
      const oldLabel = nameE?.textContent || "";
      const oldIcon  = iconE?.textContent || "";

      if (btn.dataset.action === "cat-edit") {
        openCategoryEditor(row, { id, label: oldLabel, icon: oldIcon });
        return;
      }

      if (btn.dataset.action === "cat-delete") {
        if (!confirm('Delete category "' + oldLabel + '"?\n\nThis will fail if vendors still use it.')) return;
        try {
          await api.deleteCategory(id);
          row.remove();
        } catch (err) {
          alert("Could not delete: " + err.message);
        }
      }
    });
  }

  function openCategoryEditor(row, cat) {
    const api = window.api;

    const editor = document.createElement("div");
    editor.className = "cat-edit-row";
    editor.innerHTML =
      '<input type="text" class="cat-input cat-input--icon edit-icon" ' +
             'value="' + escapeHtml(cat.icon || "") + '" maxlength="4" placeholder="🔧">' +
      '<input type="text" class="cat-input cat-input--label edit-label" ' +
             'value="' + escapeHtml(cat.label) + '" maxlength="60" style="flex-grow:1;">' +
      '<button type="button" class="btn-icon btn-save edit-save" title="Save">' +
        '<i class="fas fa-check"></i></button>' +
      '<button type="button" class="btn-icon btn-cancel edit-cancel" title="Cancel">' +
        '<i class="fas fa-times"></i></button>';

    row.replaceWith(editor);

    const iconIn    = editor.querySelector(".edit-icon");
    const labelIn   = editor.querySelector(".edit-label");
    const saveBtn   = editor.querySelector(".edit-save");
    const cancelBtn = editor.querySelector(".edit-cancel");

    iconIn.focus();

    function makeRow(icon, label) {
      const r = document.createElement("div");
      r.className = "cat-row";
      r.dataset.id = cat.id;
      r.innerHTML =
        '<span class="cat-row__icon">' + escapeHtml(icon) + '</span>' +
        '<span class="cat-row__name">' + escapeHtml(label) + '</span>' +
        '<div class="cat-row__actions">' +
          '<button type="button" class="btn-icon" data-action="cat-edit" title="Edit">' +
            '<i class="fas fa-pencil"></i></button>' +
          '<button type="button" class="btn-icon btn-icon--danger" data-action="cat-delete" title="Delete">' +
            '<i class="fas fa-trash"></i></button>' +
        '</div>';
      return r;
    }

    cancelBtn.addEventListener("click", function () {
      editor.replaceWith(makeRow(cat.icon, cat.label));
    });

    saveBtn.addEventListener("click", async function () {
      const label = labelIn.value.trim();
      const icon  = iconIn.value.trim() || "📁";
      if (!label) { labelIn.focus(); return; }

      saveBtn.disabled = true;
      try {
        await api.updateCategory(cat.id, { label, icon });
        editor.replaceWith(makeRow(icon, label));
      } catch (err) {
        alert("Could not update: " + err.message);
        saveBtn.disabled = false;
      }
    });

    labelIn.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter")  { ev.preventDefault(); saveBtn.click(); }
      if (ev.key === "Escape") { ev.preventDefault(); cancelBtn.click(); }
    });
    iconIn.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter")  { ev.preventDefault(); labelIn.focus(); }
      if (ev.key === "Escape") { ev.preventDefault(); cancelBtn.click(); }
    });
  }

  /* ============================================================
     REVIEW ACTIONS
     ============================================================ */
  function wireReviewActions(wrap, target) {
    const api = window.api;

    target.addEventListener("click", async function (e) {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const row = btn.closest(".rev-card");
      if (!row) return;
      const id = row.dataset.id;

      if (btn.dataset.action === "rv-delete") {
        if (!confirm("Delete this review? This cannot be undone.")) return;
        btn.disabled = true;
        try {
          await api.deleteReview(id);
          row.remove();
        } catch (err) {
          alert("Could not delete review: " + err.message);
          btn.disabled = false;
        }
        return;
      }

      if (btn.dataset.action === "rv-reviewed") {
        btn.disabled = true;
        try {
          await api.updateReview(id, { status: "reviewed" });
          const badge = row.querySelector(".rev-badge");
          if (badge) {
            badge.className = "rev-badge rev-badge--ok";
            badge.textContent = "Reviewed";
          }
          btn.remove();
        } catch (err) {
          alert("Could not update review: " + err.message);
          btn.disabled = false;
        }
      }
    });
  }

  /* ============================================================
     ADMIN ACTIONS
     ============================================================ */
  function wireAdminActions(wrap, target) {
    const api = window.api;

    target.addEventListener("click", async function (e) {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const row  = btn.closest(".admin-row");
      if (!row) return;

      const id   = Number(row.dataset.id);
      const name = row.dataset.name || "";

      if (btn.dataset.action === "adm-edit") {
        openEditAdminModal(row, target);
        return;
      }

      if (btn.dataset.action === "adm-reset") {
        if (!confirm("Reset password for " + name + "?\n\nA new temp password will be generated.")) return;
        btn.disabled = true;
        try {
          const r = await api.resetAdminPassword(id);
          showTempPassword(r.tempPassword || r.password || "(no password returned)");
        } catch (err) {
          alert("Could not reset: " + err.message);
        } finally {
          btn.disabled = false;
        }
        return;
      }

      if (btn.dataset.action === "adm-role") {
        const newRole = btn.dataset.nextRole;
        const verb = newRole === "super" ? "Promote to super admin" : "Demote to admin";
        if (!confirm(verb + "?")) return;
        btn.disabled = true;
        try {
          await api.updateAdmin(id, { role: newRole });
          reloadAdminRows(target);
        } catch (err) {
          alert("Could not update role: " + err.message);
          btn.disabled = false;
        }
        return;
      }

      if (btn.dataset.action === "adm-delete") {
        if (!confirm("Delete " + name + "?\n\nThis cannot be undone.")) return;
        btn.disabled = true;
        try {
          await api.deleteAdmin(id);
          row.remove();
        } catch (err) {
          alert("Could not delete: " + err.message);
          btn.disabled = false;
        }
      }
    });
  }

  /* ============================================================
     ADD ADMIN MODAL LOGIC
     ============================================================ */
  function openNewAdminModal(listTarget) {
    const api = window.api;

    const formWrap = document.createElement("div");
    formWrap.className = "admin-modal-backdrop";
    formWrap.style.zIndex = "1100";
    formWrap.innerHTML =
      '<div class="admin-modal" style="max-width:480px;">' +
        '<button class="admin-modal__close" aria-label="Close">✕</button>' +
        '<h3><i class="fas fa-user-plus"></i> Add new admin</h3>' +
        '<div class="modal-form" style="margin-top:20px;">' +
          '<div class="modal-form__group" style="margin-bottom:15px;">' +
            '<label style="display:block;margin-bottom:5px;">Full name</label>' +
            '<input type="text" id="newAdminName" class="modal-form__input" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:4px;" placeholder="e.g. Jane Doe">' +
          '</div>' +
          '<div class="modal-form__group" style="margin-bottom:15px;">' +
            '<label style="display:block;margin-bottom:5px;">Email</label>' +
            '<input type="email" id="newAdminEmail" class="modal-form__input" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:4px;" placeholder="jane@example.com">' +
          '</div>' +
          '<div class="modal-form__group" style="margin-bottom:15px;">' +
            '<label style="display:block;margin-bottom:5px;">Role</label>' +
            '<select id="newAdminRole" class="modal-form__input" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:4px;">' +
              '<option value="admin">Admin</option>' +
              '<option value="super">Super admin</option>' +
            '</select>' +
          '</div>' +
          '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;">' +
            '<button type="button" class="btn btn--ghost cancel-btn" style="padding:8px 16px;border:1px solid #ccc;background:#fff;border-radius:4px;cursor:pointer;">Cancel</button>' +
            '<button type="button" class="btn btn--primary save-btn" style="padding:8px 16px;border:none;background:#16233f;color:#fff;border-radius:4px;cursor:pointer;">Create admin</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    const closeForm = () => formWrap.remove();
    formWrap.addEventListener("click", (e) => {
      if (e.target === formWrap || e.target.classList.contains("admin-modal__close") || e.target.classList.contains("cancel-btn")) {
        closeForm();
      }
    });

    formWrap.querySelector(".save-btn").addEventListener("click", async () => {
      const name  = formWrap.querySelector("#newAdminName").value.trim();
      const email = formWrap.querySelector("#newAdminEmail").value.trim();
      const role  = formWrap.querySelector("#newAdminRole").value;
      const saveBtn = formWrap.querySelector(".save-btn");

      if (!name || !email) {
        alert("Please fill in both name and email.");
        return;
      }

      saveBtn.disabled = true;
      saveBtn.textContent = "Creating...";

      try {
        const r = await api.createAdmin({ fullName: name, email, role });
        closeForm();
        showTempPassword(r.tempPassword || r.password || "(no password returned)");
        reloadAdminRows(listTarget);
      } catch (err) {
        alert("Could not create admin: " + err.message);
        saveBtn.disabled = false;
        saveBtn.textContent = "Create admin";
      }
    });

    document.body.appendChild(formWrap);
  }

  /* ============================================================
     EDIT ADMIN MODAL LOGIC
     ============================================================ */
  function openEditAdminModal(row, listTarget) {
    const api = window.api;
    const id     = Number(row.dataset.id);
    const name   = row.dataset.name || "";
    const email  = row.dataset.email || "";
    const role   = row.dataset.role || "admin";

    const formWrap = document.createElement("div");
    formWrap.className = "admin-modal-backdrop";
    formWrap.style.zIndex = "1100";
    formWrap.innerHTML =
      '<div class="admin-modal" style="max-width:480px;">' +
        '<button class="admin-modal__close" aria-label="Close">✕</button>' +
        '<h3><i class="fas fa-pencil"></i> Edit admin</h3>' +
        '<div class="modal-form" style="margin-top:20px;">' +
          '<div class="modal-form__group" style="margin-bottom:15px;">' +
            '<label style="display:block;margin-bottom:5px;">Full name</label>' +
            '<input type="text" id="editAdminName" class="modal-form__input" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:4px;" value="' + escapeHtml(name) + '">' +
          '</div>' +
          '<div class="modal-form__group" style="margin-bottom:15px;">' +
            '<label style="display:block;margin-bottom:5px;">Email</label>' +
            '<input type="email" id="editAdminEmail" class="modal-form__input" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:4px;" value="' + escapeHtml(email) + '">' +
          '</div>' +
          '<div class="modal-form__group" style="margin-bottom:15px;">' +
            '<label style="display:block;margin-bottom:5px;">Role</label>' +
            '<select id="editAdminRole" class="modal-form__input" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:4px;">' +
              '<option value="admin"' + (role === "admin" ? " selected" : "") + '>Admin</option>' +
              '<option value="super"' + (role === "super" ? " selected" : "") + '>Super admin</option>' +
            '</select>' +
          '</div>' +
          '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px;">' +
            '<button type="button" class="btn btn--ghost cancel-btn" style="padding:8px 16px;border:1px solid #ccc;background:#fff;border-radius:4px;cursor:pointer;">Cancel</button>' +
            '<button type="button" class="btn btn--primary save-btn" style="padding:8px 16px;border:none;background:#16233f;color:#fff;border-radius:4px;cursor:pointer;">Save changes</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    const closeForm = () => formWrap.remove();
    formWrap.addEventListener("click", (e) => {
      if (e.target === formWrap || e.target.classList.contains("admin-modal__close") || e.target.classList.contains("cancel-btn")) {
        closeForm();
      }
    });

    formWrap.querySelector(".save-btn").addEventListener("click", async () => {
      const newName  = formWrap.querySelector("#editAdminName").value.trim();
      const newEmail = formWrap.querySelector("#editAdminEmail").value.trim();
      const newRole  = formWrap.querySelector("#editAdminRole").value;
      const saveBtn  = formWrap.querySelector(".save-btn");

      if (!newName || !newEmail) {
        alert("Please fill in both name and email.");
        return;
      }

      saveBtn.disabled = true;
      saveBtn.textContent = "Saving...";

      try {
        await api.updateAdmin(id, { fullName: newName, email: newEmail, role: newRole });
        closeForm();
        reloadAdminRows(listTarget);
      } catch (err) {
        alert("Could not update admin: " + err.message);
        saveBtn.disabled = false;
        saveBtn.textContent = "Save changes";
      }
    });

    document.body.appendChild(formWrap);
  }

  async function reloadAdminRows(target) {
    try {
      const rows = await window.api.get("/admin/admins");
      target.innerHTML = rows && rows.length
        ? renderRows("admins", rows)
        : "<em>Nothing here yet.</em>";
    } catch (err) {
      console.warn("[admin-tools] reloadAdmins failed:", err);
    }
  }

  /* ============================================================
     HOUSE NUMBERS ACTIONS
     ============================================================ */
  function wireHouseNumberActions(wrap, target) {
    const api = window.api;

    target.addEventListener("click", async function (e) {
      const btn = e.target.closest('[data-action="hn-save"]');
      if (!btn) return;
      const row = btn.closest(".hn-row");
      const sel = row.querySelector(".hn-select");
      if (!sel) return;

      const id    = sel.dataset.id;
      const value = sel.value;

      btn.disabled = true;
      const orig = btn.innerHTML;

      try {
        await api.setResidentHouseNumber(id, value);

        const prev = sel.dataset.previous || "";
        if (prev)  TAKEN_HOUSE_NUMBERS.delete(prev);
        if (value) TAKEN_HOUSE_NUMBERS.add(value);
        sel.dataset.previous = value;

        btn.classList.add("saved");
        btn.innerHTML = '<i class="fas fa-check"></i>';
        setTimeout(function () {
          btn.classList.remove("saved");
          btn.innerHTML = orig;
        }, 1500);
      } catch (err) {
        alert("Could not save: " + err.message);
      } finally {
        btn.disabled = false;
      }
    });

    target.querySelectorAll(".hn-select").forEach(function (sel) {
      sel.dataset.previous = sel.value || "";
      sel.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          sel.closest(".hn-row")
             .querySelector('[data-action="hn-save"]')
             .click();
        }
      });
    });
  }

  
    /* ============================================================
     TRENDS MODAL LOADER
     Charts are rendered by admin.js which already has the stats
     data cached from page load. We wait for the canvas elements
     to exist in the DOM, then trigger admin.js to render them.
     ============================================================ */
  function loadTrendsModal(wrap) {
    let attempts = 0;
    const maxAttempts = 20; // ~1 second max wait

    function tryRender() {
      // Check that ALL four canvases are in the DOM
      const hasAllCanvases =
        document.getElementById("chart-trend") &&
        document.getElementById("chart-status") &&
        document.getElementById("chart-category") &&
        document.getElementById("chart-weekday");

      if (hasAllCanvases) {
        // Small extra delay to ensure layout has settled (Chart.js needs sized parents)
        setTimeout(() => {
          document.dispatchEvent(new CustomEvent("trends:render"));
        }, 50);
        return;
      }

      attempts++;
      if (attempts < maxAttempts) {
        requestAnimationFrame(tryRender);
      } else {
        console.warn("[admin-tools] Trends canvases never appeared in DOM");
      }
    }

    tryRender();
  }

  /* ============================================================
     TEMP PASSWORD MODAL
     ============================================================ */
  function showTempPassword(pw) {
    document.querySelector(".temp-pw-backdrop")?.remove();

    const wrap = document.createElement("div");
    wrap.className = "admin-modal-backdrop temp-pw-backdrop";
    wrap.innerHTML =
      '<div class="admin-modal" style="max-width:480px;">' +
        '<button class="admin-modal__close" aria-label="Close">✕</button>' +
        '<h3><i class="fas fa-key"></i> Temporary password</h3>' +
        '<p class="muted">Copy this now — it will not be shown again. ' +
        'The admin will be forced to change it on first login.</p>' +
        '<div class="temp-pw-value">' + escapeHtml(pw) + '</div>' +
        '<div class="admin-modal__actions" style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px;">' +
          '<button type="button" class="btn-icon copy-btn" title="Copy">' +
            '<i class="fas fa-copy"></i> Copy</button>' +
          '<button type="button" class="btn btn--primary done-btn">Done</button>' +
        '</div>' +
      '</div>';

    wrap.addEventListener("click", function (e) {
      if (e.target === wrap || e.target.classList.contains("admin-modal__close")
          || e.target.classList.contains("done-btn")) {
        wrap.remove();
      }
      if (e.target.classList.contains("copy-btn") || e.target.closest(".copy-btn")) {
        navigator.clipboard.writeText(pw).then(function () {
          if (typeof toast === "function") toast("Copied!");
        });
      }
    });

    document.body.appendChild(wrap);
  }

  /* ============================================================
     HELPERS
     ============================================================ */
  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /* ============================================================
     SUPER-ADMIN GATING
     ============================================================ */
  function applyAdminLinkGating(user) {
    if (!user || user.role !== "super") {
      document.querySelectorAll(".admin-links [data-super-only]").forEach(function (el) {
        el.remove();
      });
    }
  }

  /* ============================================================
     PUBLIC API
     ============================================================ */
  window.openAdminModal       = openAdminModal;
  window.applyAdminLinkGating = applyAdminLinkGating;
})();