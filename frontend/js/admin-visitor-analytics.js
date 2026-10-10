/* ============================================================
   admin-visitor-analytics.js â€” charts + totals
   ============================================================ */

const charts = {};

function destroyChart(id) {
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
}

async function loadAnalytics() {
  const from = document.getElementById("an-from").value;
  const to   = document.getElementById("an-to").value;

  let data;
  try {
    data = await Api.getVisitorAnalytics({ from, to });
  } catch (err) {
    toast(err.message || "Could not load analytics.");
    return;
  }

  const t = data.totals || {};
  document.getElementById("an-total").textContent     = t.total || 0;
  document.getElementById("an-approved").textContent  = t.approved || 0;
  document.getElementById("an-denied").textContent    = t.denied || 0;
  document.getElementById("an-cancelled").textContent = t.cancelled || 0;
  document.getElementById("an-expired").textContent   = t.expired || 0;
  document.getElementById("an-checkedin").textContent = t.checked_in || 0;

  /* Daily line chart */
  destroyChart("chart-daily");
  charts["chart-daily"] = new Chart(document.getElementById("chart-daily"), {
    type: "line",
    data: {
      labels: data.daily.map((r) => {
  const d = new Date(r.visit_date);
  return d.toLocaleDateString("en-KE", { day: "2-digit", month: "short" });
}),
      datasets: [
        { label: "Registered", data: data.daily.map((r) => r.total), borderColor: "#16233f", backgroundColor: "rgba(22,35,63,0.08)", fill: true, tension: 0.3 },
        { label: "Arrived",    data: data.daily.map((r) => r.arrived), borderColor: "#2f6f5e", backgroundColor: "rgba(47,111,94,0.08)", fill: true, tension: 0.3 },
      ],
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } },
  });

  /* Hourly bar chart */
  destroyChart("chart-hourly");
  charts["chart-hourly"] = new Chart(document.getElementById("chart-hourly"), {
    type: "bar",
    data: {
      labels: data.hourly.map((r) => `${String(r.hour).padStart(2, "0")}:00`),
      datasets: [{ label: "Check-ins", data: data.hourly.map((r) => r.n), backgroundColor: "#c8862a" }],
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
  });

  /* Top hosts */
  destroyChart("chart-hosts");
  charts["chart-hosts"] = new Chart(document.getElementById("chart-hosts"), {
    type: "bar",
    data: {
      labels: data.topHosts.map((r) => r.house_number),
      datasets: [{ label: "Visits", data: data.topHosts.map((r) => r.visits), backgroundColor: "#4a7ba7" }],
    },
    options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
  });

  /* Outcomes doughnut */
  destroyChart("chart-outcome");
  charts["chart-outcome"] = new Chart(document.getElementById("chart-outcome"), {
    type: "doughnut",
    data: {
      labels: ["Approved", "Denied", "Cancelled", "Expired"],
      datasets: [{
        data: [t.approved || 0, t.denied || 0, t.cancelled || 0, t.expired || 0],
        backgroundColor: ["#2f6f5e", "#b0472e", "#666", "#c8862a"],
        borderWidth: 0,
      }],
    },
    options: { responsive: true, maintainAspectRatio: false, cutout: "60%", plugins: { legend: { position: "bottom" } } },
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  if (typeof requireRole === "function" && !requireRole("admin", "security", "super-admin")) return;

  const now = new Date();
  const from30 = new Date(Date.now() - 30 * 864e5);
  document.getElementById("an-from").value = from30.toISOString().slice(0, 10);
  document.getElementById("an-to").value   = now.toISOString().slice(0, 10);

  document.getElementById("an-refresh").addEventListener("click", loadAnalytics);

  await loadAnalytics();
});