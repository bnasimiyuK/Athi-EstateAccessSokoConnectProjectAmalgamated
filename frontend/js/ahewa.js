/* ============================================================
   ahewa.js — Welfare Portal home
   Renders: signatories strip, member roster, events list,
            and the "Create event" modal.

   Access control:
     - Signatories, admins, super-admins see the full roster.
     - Regular AHEWA members see ONLY their own financial row
       and personal stats. The create-event button is hidden.
   ============================================================ */

/* API base is resolved asynchronously by api.js at page load. */
let API = null;
if (window.__apiReady) {
  window.__apiReady.then((base) => { API = base; });
}

/* ------------------------------------------------------------ */
async function authFetch(path, options = {}) {
  if (!API && typeof window.discoverApiBase === "function") {
    API = await window.discoverApiBase();
  }

  const token = localStorage.getItem("asc_token");
  const headers = {
    "Content-Type": "application/json",
    Authorization: "Bearer " + (token || ""),
    ...(options.headers || {}),
  };
  const res = await fetch(API + path, { ...options, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }
  return res.json();
}

/* ---------------- identity helpers ---------------- */
function getCurrentUser() {
  try {
    const raw = localStorage.getItem("asc_user");
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function normaliseRole(role) {
  return String(role || "").toLowerCase().replace(/[_\s]/g, "-");
}

function isAdminUser(user) {
  const r = normaliseRole(user && user.role);
  return r === "admin" || r === "super-admin";
}

/**
 * Try to find this user's AHEWA member record.
 * We try several common identifiers so this works whether the
 * backend exposes resident_id, user_id, phone, or just a name.
 */
function findMyMember(members, user) {
  if (!user || !Array.isArray(members)) return null;

  // Preferred: match by stable id fields
  if (user.residentId != null) {
    const m = members.find(x =>
      String(x.resident_id ?? x.residentId) === String(user.residentId));
    if (m) return m;
  }
  if (user.id != null) {
    const m = members.find(x =>
      String(x.user_id ?? x.userId ?? x.id) === String(user.id));
    if (m) return m;
  }

  // Fallback: phone
  if (user.phone) {
    const digits = String(user.phone).replace(/\D/g, "");
    const m = members.find(x => {
      const p = String(x.phone || "").replace(/\D/g, "");
      return p && p === digits;
    });
    if (m) return m;
  }

  // Last resort: name match (case-insensitive)
  if (user.name) {
    const n = String(user.name).trim().toLowerCase();
    const m = members.find(x =>
      String(x.full_name || "").trim().toLowerCase() === n);
    if (m) return m;
  }

  return null;
}

/**
 * Privileged = admin / super-admin, OR the matched member is a
 * designated signatory (chairperson, secretary, treasurer).
 */
function isPrivileged(user, myMember) {
  if (isAdminUser(user)) return true;
  return !!(myMember && myMember.is_signatory);
}

/* ---------------- formatting ---------------- */
function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-KE", {
    year: "numeric", month: "short", day: "numeric",
  });
}

function fmtMoney(n) {
  return "KSh " + Number(n || 0).toLocaleString();
}

/* ============================================================
   SIGNATORIES STRIP — visible to all AHEWA members
   ============================================================ */
async function loadSignatories(members) {
  const el = document.getElementById("signatories-strip");
  if (!el) return;
  const sigs = members.filter(m => m.is_signatory);

  if (!sigs.length) {
    el.innerHTML = `<div class="empty-state">No signatories designated.</div>`;
    return;
  }

  el.innerHTML = sigs.map(s => `
    <div class="signatory-pill">
      <div class="signatory-pill_role">${escapeHtml(s.signatory_role || "Signatory")}</div>
      <div class="signatory-pill_name">${escapeHtml(s.full_name)}</div>
      <div class="signatory-pill_house">${escapeHtml(s.house_number || "—")}</div>
    </div>
  `).join("");
}

/* ============================================================
   MEMBERS TABLE
   ------------------------------------------------------------
   viewAll = true   → full roster + group totals (privileged)
   viewAll = false  → only the signed-in member's own row +
                      personal stats
   ============================================================ */
function renderMembers(members, viewAll, myMember) {
  const el = document.getElementById("members-table-wrap");
  if (!el) return;

  /* ---------- stat tiles ---------- */
  const tileMembers     = document.getElementById("stat-members");
  const tileCollected   = document.getElementById("stat-collected");
  const tileOutstanding = document.getElementById("stat-outstanding");
  const tileEvents      = document.getElementById("stat-events");

  const labelMembers     = tileMembers     && tileMembers.parentElement.querySelector(".stat-tile__label");
  const labelCollected   = tileCollected   && tileCollected.parentElement.querySelector(".stat-tile__label");
  const labelOutstanding = tileOutstanding && tileOutstanding.parentElement.querySelector(".stat-tile__label");

  if (viewAll) {
    /* -------- privileged: group-wide totals -------- */
    const totalCollected   = members.reduce((s, m) => s + Number(m.total_contributed || 0), 0);
    const totalOutstanding = members.reduce((s, m) => s + Number(m.outstanding || 0), 0);

    if (tileMembers)     tileMembers.textContent     = members.length;
    if (tileCollected)   tileCollected.textContent   = totalCollected.toLocaleString();
    if (tileOutstanding) tileOutstanding.textContent = totalOutstanding.toLocaleString();
    if (labelMembers)     labelMembers.textContent     = "Total members";
    if (labelCollected)   labelCollected.textContent   = "Total collected (KSh)";
    if (labelOutstanding) labelOutstanding.textContent = "Total outstanding (KSh)";
  } else {
    /* -------- regular member: personal stats -------- */
    if (!myMember) {
      if (tileMembers)     tileMembers.textContent     = "—";
      if (tileCollected)   tileCollected.textContent   = "—";
      if (tileOutstanding) tileOutstanding.textContent = "—";
      if (labelMembers)     labelMembers.textContent     = "My membership";
      if (labelCollected)   labelCollected.textContent   = "My contribution (KSh)";
      if (labelOutstanding) labelOutstanding.textContent = "My outstanding (KSh)";
    } else {
      if (tileMembers)     tileMembers.textContent     = 1;
      if (tileCollected)   tileCollected.textContent   = Number(myMember.total_contributed || 0).toLocaleString();
      if (tileOutstanding) tileOutstanding.textContent = Number(myMember.outstanding || 0).toLocaleString();
      if (labelMembers)     labelMembers.textContent     = "My membership";
      if (labelCollected)   labelCollected.textContent   = "My contribution (KSh)";
      if (labelOutstanding) labelOutstanding.textContent = "My outstanding (KSh)";
    }
  }

  /* ---------- table rows ---------- */
  const rows = viewAll
    ? members
    : (myMember ? [myMember] : []);

  if (!rows.length) {
    el.innerHTML = `<div class="empty-state">You are not registered as an AHEWA member yet.</div>`;
    return;
  }

  el.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Name</th>
          <th>House</th>
          <th>Court</th>
          <th>Joined</th>
          <th>Role</th>
          <th>Contributed</th>
          <th>Outstanding</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((m, i) => `
          <tr>
            <td>${i + 1}</td>
            <td>${escapeHtml(m.full_name)}</td>
            <td>${escapeHtml(m.house_number || "—")}</td>
            <td>${escapeHtml(m.court_name || "—")}${m.phase ? ` · Phase ${m.phase}` : ""}</td>
            <td>${fmtDate(m.joined_at)}</td>
            <td>${m.is_signatory
              ? `<span class="badge badge--verified">${escapeHtml(m.signatory_role || "Signatory")}</span>`
              : `<span class="meta">Member</span>`}</td>
            <td>${fmtMoney(m.total_contributed)}</td>
            <td>${Number(m.outstanding) > 0
              ? `<span style="color:var(--clay); font-weight:600;">${fmtMoney(m.outstanding)}</span>`
              : `<span style="color:var(--teal);">—</span>`}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

/* ============================================================
   EVENTS TABLE
   ------------------------------------------------------------
   Community-wide welfare events are shown to everyone (this
   is a mutual-aid ledger, not private data), but only privileged
   users can create new ones. The "View →" link is available to
   all so members can see the event they are contributing to.
   ============================================================ */
function renderEvents(events) {
  const el = document.getElementById("events-table-wrap");
  if (!el) return;

  const tileEvents = document.getElementById("stat-events");
  if (tileEvents) {
    tileEvents.textContent = events.filter(e => !e.is_closed).length;
  }

  if (!events.length) {
    el.innerHTML = `<div class="empty-state">No welfare events yet.</div>`;
    return;
  }

  el.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Event</th>
          <th>Affected member</th>
          <th>Type</th>
          <th>Per member</th>
          <th>Billed / Paid</th>
          <th>Collected</th>
          <th>Status</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${events.map(e => {
          const expected  = Number(e.expected || 0);
          const collected = Number(e.collected || 0);
          const pct       = expected ? Math.round((collected / expected) * 100) : 0;
          const typeLabel = e.event_type === "PRINCIPAL" ? "Principal" : "Dependant";
          const statusBadge = e.is_disbursed
            ? `<span class="badge" style="background:#d1fae5;color:#065f46;">Disbursed</span>`
            : (e.approvals_count >= 3
              ? `<span class="badge" style="background:#fef3c7;color:#92400e;">Approved — pending disbursement</span>`
              : `<span class="badge badge--pending">Open</span>`);

          return `
            <tr>
              <td>${fmtDate(e.event_date)}</td>
              <td>${escapeHtml(e.event_title)}</td>
              <td>${escapeHtml(e.affected_member_name)} <span class="meta">(${escapeHtml(e.affected_member_house || "—")})</span></td>
              <td>${typeLabel}</td>
              <td>${fmtMoney(e.contribution_amount)}</td>
              <td>${e.members_paid} / ${e.members_billed}</td>
              <td>${fmtMoney(collected)} <span class="meta">of ${fmtMoney(expected)} (${pct}%)</span></td>
              <td>${statusBadge}</td>
              <td><a class="btn btn--ghost btn--small" href="ahewa-event.html?id=${e.id}">View →</a></td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;
}

/* ============================================================
   CREATE EVENT MODAL — only wired for privileged users
   ============================================================ */
function setupCreateModal(members, canCreate) {
  const modal       = document.getElementById("modal-new-event");
  const openBtn     = document.getElementById("btn-new-event");
  const closeBtn    = document.getElementById("btn-cancel-event");
  const form        = document.getElementById("form-new-event");
  const affectedSel = document.getElementById("ev-affected");
  const typeSel     = document.getElementById("ev-type");
  const titleInput  = document.getElementById("ev-title");
  const dateInput   = document.getElementById("ev-date");
  const preview     = document.getElementById("ev-preview");

  /* ---------- hide the trigger for non-privileged users ---------- */
  if (!canCreate) {
    if (openBtn) openBtn.style.display = "none";
    if (modal)   modal.classList.remove("is-open");
    // Don't bind any listeners; the modal is unreachable.
    return;
  }

  if (!modal || !openBtn || !form || !affectedSel) return;
  if (openBtn) openBtn.style.display = "";

  // Populate affected member dropdown
  affectedSel.innerHTML =
    `<option value="">Select AHEWA member…</option>` +
    members.map(m =>
      `<option value="${m.id}">${escapeHtml(m.full_name)} — ${escapeHtml(m.house_number || "—")}</option>`
    ).join("");

  // Default date = today
  if (dateInput) dateInput.value = new Date().toISOString().slice(0, 10);

  openBtn.addEventListener("click", () => {
    modal.classList.add("is-open");
    form.reset();
    if (dateInput) dateInput.value = new Date().toISOString().slice(0, 10);
    if (preview) preview.style.display = "none";
    loadAll();
  });

  closeBtn && closeBtn.addEventListener("click", () => modal.classList.remove("is-open"));
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.remove("is-open");
  });

  /* Live preview of amount + recipient count */
  function updatePreview() {
    const affectedId = parseInt(affectedSel.value, 10);
    const type = typeSel.value;
    if (!affectedId || !type) { if (preview) preview.style.display = "none"; return; }

    const amount = type === "PRINCIPAL" ? 1200 : 700;
    const billingCount = members.length - 1;   // exclude affected member
    const total = amount * billingCount;

    const affectedName = affectedSel.options[affectedSel.selectedIndex].textContent;

    if (!titleInput.value || titleInput.dataset.autofilled === "1") {
      const firstName = affectedName.split(" — ")[0];
      titleInput.value = `AHEWA Welfare contributions update for ${firstName}`;
      titleInput.dataset.autofilled = "1";
    }

    if (preview) {
      preview.style.display = "block";
      preview.innerHTML = `
        <b>Preview:</b> ${billingCount} members billed × ${fmtMoney(amount)} =
        <b>${fmtMoney(total)}</b> expected.
        <br><small>Affected member (${escapeHtml(affectedName)}) is excluded.</small>
      `;
    }
  }

  affectedSel.addEventListener("change", updatePreview);
  typeSel && typeSel.addEventListener("change", updatePreview);
  titleInput && titleInput.addEventListener("input", () => {
    titleInput.dataset.autofilled = "0";
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("btn-submit-event");
    if (btn) { btn.disabled = true; btn.textContent = "Creating…"; }

    try {
      const payload = {
        affected_member_id: parseInt(affectedSel.value, 10),
        event_type: typeSel.value,
        event_title: titleInput.value.trim(),
        description: (document.getElementById("ev-description").value || "").trim() || null,
        event_date: dateInput.value,
      };

      const r = await authFetch("/ahewa/events", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      toast(`Event created — ${r.members_billed} members billed, ${fmtMoney(r.total_expected)} expected.`);
      modal.classList.remove("is-open");
      await loadAll();
    } catch (err) {
      console.error("[ahewa] create failed:", err);
      alert("Could not create event: " + err.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Create & invoice members"; }
    }
  });
}

/* ============================================================
   MAIN LOAD
   ============================================================ */
async function loadAll() {
  const user = getCurrentUser();

  try {
    const [members, events] = await Promise.all([
      authFetch("/ahewa/members"),
      authFetch("/ahewa/events"),
    ]);

    /* Identify the logged-in user's own member record + permissions */
    const myMember  = findMyMember(members, user);
    const viewAll   = isPrivileged(user, myMember);

    /* Signatories strip is fine to show to everyone */
    await loadSignatories(members);

    /* Roster: full for privileged users, single-row for members */
    renderMembers(members, viewAll, myMember);

    /* Events ledger stays visible to everyone */
    renderEvents(events);

    /* Only privileged users can create new events.
       Non-privileged users get the button hidden and no listeners. */
    const createBtn = document.getElementById("btn-new-event");
    if (createBtn && !viewAll) createBtn.style.display = "none";

    /* Keep the affected-member dropdown fresh (only populated for
       privileged users — regular members have no modal). */
    if (viewAll) {
      const affectedSel = document.getElementById("ev-affected");
      if (affectedSel) {
        const current = affectedSel.value;
        affectedSel.innerHTML =
          `<option value="">Select AHEWA member…</option>` +
          members.map(m =>
            `<option value="${m.id}">${escapeHtml(m.full_name)} — ${escapeHtml(m.house_number || "—")}</option>`
          ).join("");
        affectedSel.value = current;
      }
    }
  } catch (err) {
    console.error("[ahewa] load failed:", err);
    const wrap = document.getElementById("members-table-wrap");
    if (wrap) {
      wrap.innerHTML =
        `<div class="empty-state" style="color:var(--clay);">Failed to load: ${escapeHtml(err.message)}</div>`;
    }
  }
}

/* ============================================================
   INIT
   ------------------------------------------------------------
   Access control (who can open this page at all) is enforced
   by access.js via <body data-requires="auth ahewa">.
   Per-user visibility of member data is enforced here.
   ============================================================ */
document.addEventListener("DOMContentLoaded", async () => {
  try {
    const user = getCurrentUser();
    const members = await authFetch("/ahewa/members");
    const myMember = findMyMember(members, user);
    const canCreate = isPrivileged(user, myMember);

    setupCreateModal(members, canCreate);
  } catch (err) {
    console.error("[ahewa] init failed:", err);
    // Even if init partially fails, loadAll() below can still
    // render whatever the user is allowed to see.
  }

  await loadAll();
});