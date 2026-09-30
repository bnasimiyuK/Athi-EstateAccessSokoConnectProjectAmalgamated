/* ============================================================
   visitors.js — resident pre-registration page
   - Submit single or group visit
   - Add vehicles per visitor
   - List own visits with status
   - Cancel before check-in
   - View access code once approved
   ============================================================ */

let VISITOR_TEMPLATE_COUNT = 0;
let CONFIG = { minLeadHours: 48, codeValidHours: 24, maxLookaheadDays: 30 };

/* ------------------------------------------------------------
   Escape helper
   ------------------------------------------------------------ */
function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function statusBadge(s) {
  const map = {
    pending_admin:    `<span class="badge" style="background:#c8862a;color:#fff;">Awaiting admin</span>`,
    pending_security: `<span class="badge" style="background:#4a7ba7;color:#fff;">Awaiting security</span>`,
    approved:         `<span class="badge badge--verified">Approved</span>`,
    denied:           `<span class="badge" style="background:#b0472e;color:#fff;">Denied</span>`,
    cancelled:        `<span class="badge" style="background:#666;color:#fff;">Cancelled</span>`,
    checked_in:       `<span class="badge" style="background:#2f6f5e;color:#fff;">Checked in</span>`,
    completed:        `<span class="badge" style="background:#2f6f5e;color:#fff;">Completed</span>`,
    expired:          `<span class="badge" style="background:#b0472e;color:#fff;">Expired</span>`,
  };
  return map[s] || escapeHtml(s);
}

function fmtDate(s) {
  if (!s) return "—";
  const d = new Date(s);
  return d.toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" });
}

/* ------------------------------------------------------------
   Visitor template
   ------------------------------------------------------------ */
function newVisitorBlock(index) {
  const el = document.createElement("div");
  el.className = "visitor-block";
  el.style.cssText = "border:1px solid var(--line);border-radius:6px;padding:12px;margin-bottom:12px;";
  el.dataset.index = index;
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <b>Visitor #${index + 1}</b>
      <button type="button" class="btn btn--ghost btn--small" data-remove>Remove</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
      <label style="grid-column:1/-1;">Name *<input type="text" class="input vf-name" required /></label>
      <label>Phone<input type="tel" class="input vf-phone" placeholder="+254…" /></label>
      <label>Email<input type="email" class="input vf-email" placeholder="optional" /></label>
      <label>ID number (optional)<input type="text" class="input vf-id" /></label>
    </div>
    <div class="vehicles-container" style="margin-top:10px;"></div>
    <button type="button" class="btn btn--ghost btn--small" data-add-vehicle>🚗 Add vehicle</button>
  `;

  el.querySelector("[data-remove]").addEventListener("click", () => {
    if (document.querySelectorAll(".visitor-block").length > 1) {
      el.remove();
      renumberVisitorBlocks();
    } else {
      toast("At least one visitor is required.");
    }
  });

  el.querySelector("[data-add-vehicle]").addEventListener("click", () => {
    addVehicleRow(el.querySelector(".vehicles-container"));
  });

  return el;
}

function renumberVisitorBlocks() {
  document.querySelectorAll(".visitor-block").forEach((el, i) => {
    el.dataset.index = i;
    el.querySelector("b").textContent = `Visitor #${i + 1}`;
  });
}

function addVisitorBlock() {
  const container = document.getElementById("visitors-container");
  const el = newVisitorBlock(VISITOR_TEMPLATE_COUNT++);
  container.appendChild(el);
  return el;
}

function addVehicleRow(container) {
  const row = document.createElement("div");
  row.className = "vehicle-row";
  row.style.cssText = "display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:6px;margin-top:6px;";
  row.innerHTML = `
    <select class="input vh-type">
      <option value="car">Car</option>
      <option value="motorcycle">Motorcycle</option>
      <option value="other">Other</option>
    </select>
    <input type="text" class="input vh-plate" placeholder="Plate e.g. KDA 123X" />
    <input type="text" class="input vh-driver" placeholder="Driver name" />
    <button type="button" class="btn btn--ghost btn--small" data-remove-vehicle>✕</button>
  `;
  row.querySelector("[data-remove-vehicle]").addEventListener("click", () => row.remove());
  container.appendChild(row);
}

/* ------------------------------------------------------------
   Collect form data
   ------------------------------------------------------------ */
function collectForm() {
  const visitDate    = document.getElementById("vf-date").value;
  const expectedTime = document.getElementById("vf-time").value || null;
  const purpose      = document.getElementById("vf-purpose").value.trim() || null;
  const notes        = document.getElementById("vf-notes").value.trim() || null;

  const visitors = [];
  document.querySelectorAll(".visitor-block").forEach((block) => {
    const name  = block.querySelector(".vf-name").value.trim();
    const phone = block.querySelector(".vf-phone").value.trim() || null;
    const email = block.querySelector(".vf-email").value.trim() || null;
    const idNumber = block.querySelector(".vf-id").value.trim() || null;

    const vehicles = [];
    block.querySelectorAll(".vehicle-row").forEach((row) => {
      const plate = row.querySelector(".vh-plate").value.trim();
      if (!plate) return;
      vehicles.push({
        type:   row.querySelector(".vh-type").value,
        plate,
        driver: row.querySelector(".vh-driver").value.trim() || null,
      });
    });

    visitors.push({ name, phone, email, idNumber, vehicles });
  });

  return { visitDate, expectedTime, purpose, notes, visitors };
}

function validateForm(data) {
  if (!data.visitDate) return "Please choose a visit date.";
  for (const v of data.visitors) {
    if (!v.name)               return "Every visitor must have a name.";
    if (!v.phone && !v.email)  return `Visitor "${v.name}" needs a phone or email.`;
  }
  return null;
}

/* ------------------------------------------------------------
   Submit
   ------------------------------------------------------------ */
async function submitVisit(e) {
  e.preventDefault();
  const btn = document.getElementById("vf-submit");
  const data = collectForm();
  const err = validateForm(data);
  if (err) { toast(err); return; }

  btn.disabled = true; btn.textContent = "Submitting…";
  try {
    const r = await Api.createVisitorGroup(data);
    toast("✅ Submitted for admin approval.");
    closeVisitModal();
    await loadVisits();
  } catch (e2) {
    toast(e2.message || "Could not submit.");
  } finally {
    btn.disabled = false; btn.textContent = "Submit for approval";
  }
}

/* ------------------------------------------------------------
   List visits
   ------------------------------------------------------------ */
async function loadVisits() {
  const wrap = document.getElementById("visits-wrap");
  wrap.innerHTML = `<div class="empty-state">Loading your visitors…</div>`;

  let rows;
  try {
    rows = await Api.getMyVisitorGroups();
  } catch (e) {
    wrap.innerHTML = `<div class="empty-state" style="color:var(--clay)">Could not load: ${escapeHtml(e.message)}</div>`;
    return;
  }

  if (!rows.length) {
    wrap.innerHTML = `<div class="empty-state">You have not pre-registered any visitors yet.</div>`;
    return;
  }

  wrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Visit date</th>
          <th>Time</th>
          <th>Purpose</th>
          <th>Visitors</th>
          <th>Code</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((g) => `
          <tr data-id="${g.id}">
            <td>${escapeHtml(fmtDate(g.visit_date))}</td>
            <td>${escapeHtml(g.expected_time ? String(g.expected_time).slice(0,5) : "—")}</td>
            <td>${escapeHtml(g.purpose || "—")}</td>
            <td>${g.headcount} ${g.headcount === 1 ? "visitor" : "visitors"}</td>
            <td><b style="font-family:monospace;">${escapeHtml(g.access_code || "—")}</b></td>
            <td>${statusBadge(g.status)}</td>
            <td>
              <button class="btn btn--ghost btn--small" data-view="${g.id}">View</button>
              ${canCancel(g.status) ? `<button class="btn btn--danger btn--small" data-cancel="${g.id}">Cancel</button>` : ""}
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  wrap.querySelectorAll("[data-view]").forEach((b) =>
    b.addEventListener("click", () => showDetails(b.dataset.view))
  );
  wrap.querySelectorAll("[data-cancel]").forEach((b) =>
    b.addEventListener("click", () => cancelVisit(b.dataset.cancel))
  );
}

function canCancel(status) {
  return ["pending_admin", "pending_security", "approved"].includes(status);
}

async function cancelVisit(id) {
  const reason = prompt("Reason for cancellation (optional):");
  if (reason === null) return;
  try {
    await Api.cancelVisitorGroup(id, reason);
    toast("Visit cancelled.");
    await loadVisits();
  } catch (e) {
    toast(e.message || "Could not cancel.");
  }
}

/* ------------------------------------------------------------
   Show details modal
   ------------------------------------------------------------ */
async function showDetails(id) {
  const body = document.getElementById("details-body");
  body.innerHTML = `<div class="empty-state">Loading…</div>`;
  document.getElementById("details-modal").style.display = "flex";

  try {
    const rows = await Api.getMyVisitorGroups();
    const g = rows.find((r) => String(r.id) === String(id));
    if (!g) { body.innerHTML = `<div class="empty-state">Not found.</div>`; return; }

    body.innerHTML = `
      <div style="margin-bottom:12px;">
        <b>Visit date:</b> ${escapeHtml(fmtDate(g.visit_date))}
        ${g.expected_time ? " at " + escapeHtml(String(g.expected_time).slice(0,5)) : ""}
        <br>
        <b>Purpose:</b> ${escapeHtml(g.purpose || "—")}
        <br>
        <b>Status:</b> ${statusBadge(g.status)}
        ${g.access_code ? `<br><b>Access code:</b> <span style="font-family:monospace;font-size:1.2rem;">${escapeHtml(g.access_code)}</span>` : ""}
        ${g.expires_at ? `<br><b>Code expires:</b> ${escapeHtml(new Date(g.expires_at).toLocaleString("en-KE"))}` : ""}
        ${g.admin_deny_reason ? `<br><b>Admin reason:</b> ${escapeHtml(g.admin_deny_reason)}` : ""}
        ${g.security_deny_reason ? `<br><b>Security reason:</b> ${escapeHtml(g.security_deny_reason)}` : ""}
        ${g.cancel_reason ? `<br><b>Cancellation reason:</b> ${escapeHtml(g.cancel_reason)}` : ""}
      </div>
      <h3>Visitors</h3>
      <ul style="padding-left:20px;">
        ${g.visitors.map((v) => `
          <li style="margin-bottom:8px;">
            <b>${escapeHtml(v.name)}</b>
            ${v.phone ? `· ${escapeHtml(v.phone)}` : ""}
            ${v.email ? `· ${escapeHtml(v.email)}` : ""}
            ${v.vehicles && v.vehicles.length ? `
              <div style="margin-left:16px;font-size:0.9rem;color:var(--ink-70);">
                ${v.vehicles.map((veh) =>
                  `${escapeHtml(veh.type)}: ${escapeHtml(veh.plate)}${veh.driver ? " (" + escapeHtml(veh.driver) + ")" : ""}`
                ).join("<br>")}
              </div>
            ` : ""}
          </li>
        `).join("")}
      </ul>
    `;
  } catch (e) {
    body.innerHTML = `<div class="empty-state" style="color:var(--clay)">${escapeHtml(e.message)}</div>`;
  }
}

/* ------------------------------------------------------------
   Modal controls
   ------------------------------------------------------------ */
function openVisitModal() {
  document.getElementById("visit-form").reset();
  document.getElementById("visitors-container").innerHTML = "";
  VISITOR_TEMPLATE_COUNT = 0;
  addVisitorBlock();

  /* Default visit date = today + 48h rounded to next day */
  const min = new Date(Date.now() + CONFIG.minLeadHours * 3600e3);
  const minStr = min.toISOString().slice(0, 10);
  const dateInput = document.getElementById("vf-date");
  dateInput.min = minStr;
  dateInput.value = minStr;

  document.getElementById("visit-modal").style.display = "flex";
}

function closeVisitModal() {
  document.getElementById("visit-modal").style.display = "none";
}

/* ------------------------------------------------------------
   Init
   ------------------------------------------------------------ */
document.addEventListener("DOMContentLoaded", async () => {
  if (typeof requireRole === "function" && !requireRole("resident")) return;

  /* Load config */
  try {
    const cfg = await Api.getVisitorConfig();
    CONFIG = { ...CONFIG, ...cfg };
  } catch { /* use defaults */ }

  /* Init modal */
  document.getElementById("btn-new-visit").addEventListener("click", openVisitModal);
  document.getElementById("vf-cancel").addEventListener("click", closeVisitModal);
  document.getElementById("btn-add-visitor").addEventListener("click", () => addVisitorBlock());
  document.getElementById("visit-form").addEventListener("submit", submitVisit);
  document.getElementById("dm-close").addEventListener("click", () => {
    document.getElementById("details-modal").style.display = "none";
  });

  await loadVisits();
});