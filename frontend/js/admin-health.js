const API_BASE = "http://localhost:4050";

async function load() {
  const token = localStorage.getItem("asc_token");
  try {
    const res = await fetch(API_BASE + "/api/admin/health/billing", {
      headers: { Authorization: "Bearer " + (token || "") }
    });
    if (!res.ok) {
      document.getElementById("overall").textContent =
        "Error " + res.status + " — " + (res.status === 401 ? "sign in as admin" : res.statusText);
      document.getElementById("overallCard").className = "card bad";
      return;
    }
    const data = await res.json();
    render(data);
  } catch (err) {
    document.getElementById("overall").textContent = "Network error: " + err.message;
    document.getElementById("overallCard").className = "card bad";
  }
}

function render(d) {
  document.getElementById("checkedAt").textContent =
    "Checked at " + new Date(d.checkedAt).toLocaleString();

  const card = document.getElementById("overallCard");
  const headline = document.getElementById("overall");

  if (d.healthy) {
    headline.textContent = "✅ All systems healthy — no drift detected";
    card.className = "card ok";
  } else {
    headline.textContent = "⚠️ " + d.totalIssues + " issue(s) detected";
    card.className = "card bad";
  }

  const s = d.summary;
  document.getElementById("summary").innerHTML = Object.entries(s).map(([k, v]) =>
    `<div><div class="count">${v}</div><div class="label">${k.replace(/_/g,' ')}</div></div>`
  ).join("");

  const labels = {
    orphanedInvoices: "Orphaned invoices — unpaid but a verified payment exists",
    duplicates:       "Duplicate invoices",
    orphanedPayments: "Orphaned payments — verified but no matching invoice",
    stalePending:     "Stale pending STK — awaiting callback >5 min",
    overpaid:         "Overpaid invoices (amount_paid > amount_due)",
  };

  const container = document.getElementById("issues");
  const sections = Object.entries(d.issues).map(([key, rows]) => {
    if (!rows.length) return "";
    const headers = Object.keys(rows[0]);
    return `<div class="card bad">
      <h3>${labels[key] || key} — ${rows.length} row(s)</h3>
      <table>
        <thead><tr>${headers.map(h => `<th>${h.replace(/_/g,' ')}</th>`).join("")}</tr></thead>
        <tbody>
          ${rows.map(r => `<tr>${headers.map(h => {
            let v = r[h];
            if (v === null || v === undefined) v = "";
            if (typeof v === "string" && v.includes("T") && v.includes("Z")) {
              v = new Date(v).toLocaleString();
            }
            return `<td>${v}</td>`;
          }).join("")}</tr>`).join("")}
        </tbody>
      </table>
    </div>`;
  }).join("");

  container.innerHTML = sections || '<div class="card ok"><span class="empty">No issues to display.</span></div>';
}

load();
setInterval(load, 30000);