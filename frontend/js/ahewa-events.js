/* ============================================================
   ahewa-events.js — AHEWA Events list page
   Shows all welfare events with filters + create modal.
   ============================================================ */

const API = API_BASE;

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

function currentRole() {
  try {
    const token = localStorage.getItem("asc_token");
    if (!token) return null;
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.role || null;
  } catch { return null; }
}

/* ---------------- state ---------------- */
let ALL_EVENTS = [];
let ALL_MEMBERS = [];

/* ---------------- filters ---------------- */
function applyFilters(events) {
  const status = document.getElementById("filter-status").value;
  const q = (document.getElementById("filter-search").value || "").toLowerCase().trim();

  return events.filter((e) => {
    if (status) {
      if (status === "open" && (e.is_disbursed || e.approvals_count >= 3)) return false;
      if (status === "approved" && (!(e.approvals_count >= 3) || e.is_disbursed)) return false;
      if (status === "disbursed" && !e.is_disbursed) return false;
    }
    if (q) {
      const hay = (e.event_title + " " + e.affected_member_name).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/* ---------------- render events ---------------- */
function renderEvents() {
  const el = document.getElementById("events-table-wrap");
  const events = applyFilters(ALL_EVENTS);

  if (!ALL_EVENTS.length) {
    el.innerHTML = `<div class="empty-state">No welfare events yet. Click "Create welfare event" to start.</div>`;
    return;
  }
  if (!events.length) {
    el.innerHTML = `<div class="empty-state">No events match your filters.</div>`;
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
        ${events.map((e) => {
          const expected = Number(e.expected || 0);
          const collected = Number(e.collected || 0);
          const pct = expected ? Math.round((collected / expected) * 100) : 0;
          const typeLabel = e.event_type === "PRINCIPAL" ? "Principal" : "Dependant";
          const statusBadge = e.is_disbursed
            ? `<span class="badge" style="background:#d1fae5;color:#065f46;">Disbursed</span>`
            : (e.approvals_count >= 3
              ? `<span class="badge" style="background:#fef3c7;color:#92400e;">Approved</span>`
              : `<span class="badge badge--pending">Open</span>`);

          return `
            <tr class="clickable-row" data-href="ahewa-event.html?id=${e.id}" style="cursor:pointer;">
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

  el.querySelectorAll(".clickable-row").forEach((row) => {
    row.addEventListener("click", (ev) => {
      if (ev.target.closest("a")) return;
      window.location.href = row.dataset.href;
    });
  });
}

/* ---------------- create event modal ---------------- */
function setupCreateModal() {
  const modal = document.getElementById("modal-new-event");
  const openBtn = document.getElementById("btn-new-event");
  const closeBtn = document.getElementById("btn-cancel-event");
  const form = document.getElementById("form-new-event");
  const affectedSel = document.getElementById("ev-affected");
  const typeSel = document.getElementById("ev-type");
  const titleInput = document.getElementById("ev-title");
  const dateInput = document.getElementById("ev-date");
  const preview = document.getElementById("ev-preview");

  // Hide "Create" button for non-admins
  if (currentRole() !== "admin") {
    openBtn.style.display = "none";
    return;
  }

  affectedSel.innerHTML =
    `<option value="">Select AHEWA member…</option>` +
    ALL_MEMBERS.map((m) => `<option value="${m.id}">${escapeHtml(m.full_name)} — ${escapeHtml(m.house_number || "—")}</option>`).join("");

  dateInput.value = new Date().toISOString().slice(0, 10);

  openBtn.addEventListener("click", () => {
    modal.classList.add("is-open");
    form.reset();
    dateInput.value = new Date().toISOString().slice(0, 10);
    preview.style.display = "none";
    loadAll();
  });

  closeBtn.addEventListener("click", () => modal.classList.remove("is-open"));
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.remove("is-open");
  });

  function updatePreview() {
    const affectedId = parseInt(affectedSel.value, 10);
    const type = typeSel.value;
    if (!affectedId || !type) { preview.style.display = "none"; return; }

    const amount = type === "PRINCIPAL" ? 1200 : 700;
    const billingCount = ALL_MEMBERS.length - 1;
    const total = amount * billingCount;
    const affectedName = affectedSel.options[affectedSel.selectedIndex].textContent;

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
      console.error("[ahewa-events] create failed:", err);
      alert("Could not create event: " + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "Create & invoice members";
    }
  });
}

/* ---------------- load ---------------- */
async function loadAll() {
  try {
    const [events, members] = await Promise.all([
      authFetch("/ahewa/events"),
      authFetch("/ahewa/members"),
    ]);
    ALL_EVENTS = events;
    ALL_MEMBERS = members;
    renderEvents();
  } catch (err) {
    console.error("[ahewa-events] load failed:", err);
    document.getElementById("events-table-wrap").innerHTML =
      `<div class="empty-state" style="color:var(--clay);">Failed to load: ${escapeHtml(err.message)}</div>`;
  }
}

/* ---------------- init ---------------- */
document.addEventListener("DOMContentLoaded", async () => {
  if (typeof requireAuth === "function" && !requireAuth()) return;

  await loadAll();
  setupCreateModal();

  document.getElementById("events-filter").addEventListener("submit", (e) => {
    e.preventDefault();
    renderEvents();
  });

  document.getElementById("filter-status").addEventListener("change", renderEvents);

  let timer = null;
  document.getElementById("filter-search").addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(renderEvents, 200);
  });

  document.getElementById("filter-clear").addEventListener("click", () => {
    document.getElementById("filter-status").value = "";
    document.getElementById("filter-search").value = "";
    renderEvents();
  });
});