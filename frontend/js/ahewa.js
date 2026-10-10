/* ============================================================
   ahewa.js — Welfare Portal home
   Renders: signatories strip, member roster, events list,
            and the "Create event" modal.
   ============================================================ */

const API = API_BASE;   // from api.js

/* ------------------------------------------------------------ */
async function authFetch(path, options = {}) {
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

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" });
}

function fmtMoney(n) {
  return "KSh " + Number(n || 0).toLocaleString();
}

/* ============================================================
   SIGNATORIES STRIP
   ============================================================ */
async function loadSignatories(members) {
  const el = document.getElementById("signatories-strip");
  const sigs = members.filter(m => m.is_signatory);

  if (!sigs.length) {
    el.innerHTML = `<div class="empty-state">No signatories designated.</div>`;
    return;
  }

  el.innerHTML = sigs.map(s => `
    <div class="signatory-pill">
      <div class="signatory-pill__role">${escapeHtml(s.signatory_role || "Signatory")}</div>
      <div class="signatory-pill__name">${escapeHtml(s.full_name)}</div>
      <div class="signatory-pill__house">${escapeHtml(s.house_number || "—")}</div>
    </div>
  `).join("");
}

/* ============================================================
   MEMBERS TABLE
   ============================================================ */
function renderMembers(members) {
  const el = document.getElementById("members-table-wrap");

  if (!members.length) {
    el.innerHTML = `<div class="empty-state">No AHEWA members yet.</div>`;
    return;
  }

  const totalCollected = members.reduce((s, m) => s + Number(m.total_contributed || 0), 0);
  const totalOutstanding = members.reduce((s, m) => s + Number(m.outstanding || 0), 0);

  document.getElementById("stat-members").textContent = members.length;
  document.getElementById("stat-collected").textContent = totalCollected.toLocaleString();
  document.getElementById("stat-outstanding").textContent = totalOutstanding.toLocaleString();

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
        ${members.map((m, i) => `
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
   ============================================================ */
function renderEvents(events) {
  const el = document.getElementById("events-table-wrap");

  document.getElementById("stat-events").textContent =
    events.filter(e => !e.is_closed).length;

  if (!events.length) {
    el.innerHTML = `<div class="empty-state">No welfare events yet. Click "Create welfare event" to start.</div>`;
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
          const expected = Number(e.expected || 0);
          const collected = Number(e.collected || 0);
          const pct = expected ? Math.round((collected / expected) * 100) : 0;
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
   CREATE EVENT MODAL
   ============================================================ */
function setupCreateModal(members) {
  const modal = document.getElementById("modal-new-event");
  const openBtn = document.getElementById("btn-new-event");
  const closeBtn = document.getElementById("btn-cancel-event");
  const form = document.getElementById("form-new-event");
  const affectedSel = document.getElementById("ev-affected");
  const typeSel = document.getElementById("ev-type");
  const titleInput = document.getElementById("ev-title");
  const dateInput = document.getElementById("ev-date");
  const preview = document.getElementById("ev-preview");

  // Populate affected member dropdown
  affectedSel.innerHTML =
    `<option value="">Select AHEWA member…</option>` +
    members.map(m => `<option value="${m.id}">${escapeHtml(m.full_name)} — ${escapeHtml(m.house_number || "—")}</option>`).join("");

  // Default date = today
  dateInput.value = new Date().toISOString().slice(0, 10);

  openBtn.addEventListener("click", () => {
    modal.classList.add("is-open");
    form.reset();
    dateInput.value = new Date().toISOString().slice(0, 10);
    preview.style.display = "none";
    // Refresh member list in case one was added
    loadAll();
  });

  closeBtn.addEventListener("click", () => modal.classList.remove("is-open"));
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.remove("is-open");
  });

  // Live preview of amount + recipient count
  function updatePreview() {
    const affectedId = parseInt(affectedSel.value, 10);
    const type = typeSel.value;
    if (!affectedId || !type) { preview.style.display = "none"; return; }

    const amount = type === "PRINCIPAL" ? 1200 : 700;
    const billingCount = members.length - 1;  // exclude affected member
    const total = amount * billingCount;

    const affectedName = affectedSel.options[affectedSel.selectedIndex].textContent;

    // Auto-fill title if empty
    if (!titleInput.value || titleInput.dataset.autofilled === "1") {
      const firstName = affectedName.split(" — ")[0];
      titleInput.value = `AHEWA Welfare contributions update for ${firstName}`;
      titleInput.dataset.autofilled = "1";
    }

    preview.style.display = "block";
    preview.innerHTML = `
      <b>Preview:</b> ${billingCount} members billed × ${fmtMoney(amount)} =
      <b>${fmtMoney(total)}</b> expected.
      <br><small>Affected member (${escapeHtml(affectedName)}) is excluded.</small>
    `;
  }

  affectedSel.addEventListener("change", updatePreview);
  typeSel.addEventListener("change", updatePreview);

  // Clear autofill flag when user manually edits
  titleInput.addEventListener("input", () => { titleInput.dataset.autofilled = "0"; });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("btn-submit-event");
    btn.disabled = true;
    btn.textContent = "Creating…";

    try {
      const payload = {
        affected_member_id: parseInt(affectedSel.value, 10),
        event_type: typeSel.value,
        event_title: titleInput.value.trim(),
        description: document.getElementById("ev-description").value.trim() || null,
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
      btn.disabled = false;
      btn.textContent = "Create & invoice members";
    }
  });
}

/* ============================================================
   MAIN LOAD
   ============================================================ */
async function loadAll() {
  try {
    const [members, events] = await Promise.all([
      authFetch("/ahewa/members"),
      authFetch("/ahewa/events"),
    ]);

    await loadSignatories(members);
    renderMembers(members);
    renderEvents(events);

    // Keep the affected member dropdown fresh
    const affectedSel = document.getElementById("ev-affected");
    if (affectedSel) {
      const current = affectedSel.value;
      affectedSel.innerHTML =
        `<option value="">Select AHEWA member…</option>` +
        members.map(m => `<option value="${m.id}">${escapeHtml(m.full_name)} — ${escapeHtml(m.house_number || "—")}</option>`).join("");
      affectedSel.value = current;
    }
  } catch (err) {
    console.error("[ahewa] load failed:", err);
    document.getElementById("members-table-wrap").innerHTML =
      `<div class="empty-state" style="color:var(--clay);">Failed to load: ${escapeHtml(err.message)}</div>`;
  }
}

/* ============================================================
   INIT
   ============================================================ */
document.addEventListener("DOMContentLoaded", async () => {
  if (typeof requireRole === "function" &&
    !requireRole("admin", "super-admin")) return;

  try {
    const members = await authFetch("/ahewa/members");
    setupCreateModal(members);
  } catch (err) {
    console.error("[ahewa] init failed:", err);
  }

  await loadAll();
});