/* ============================================================
   Pooling — new trip form
   Switches between "offer" (driver) and "need" (passenger).
   ============================================================ */

(function () {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const params = new URLSearchParams(window.location.search);
  let mode = params.get("type") === "need" ? "need" : "offer";

  /* ---------- Mode switch ---------- */
  function applyMode() {
    const offerFields = document.getElementById("offer-fields");
    const passengersGroup = document.getElementById("passengers-group");
    const submitBtn = document.getElementById("submit-btn");
    const tabs = $$(".admin-tab-row .tab-btn[data-mode]");

    if (offerFields) offerFields.hidden = mode !== "offer";
    if (passengersGroup) passengersGroup.hidden = mode !== "need";

    // Toggle required on the seats / passengers selects
    const seats = document.getElementById("seats-available");
    const pax   = document.getElementById("passengers");
    if (seats) seats.required = mode === "offer";
    if (pax)   pax.required   = mode === "need";

    if (submitBtn) {
      submitBtn.innerHTML = mode === "offer"
        ? '<i class="fas fa-check"></i> Post seat offer'
        : '<i class="fas fa-check"></i> Post ride request';
    }

    tabs.forEach((t) => t.classList.toggle("is-active", t.dataset.mode === mode));
    document.title = (mode === "offer" ? "Offer a seat" : "Request a ride") + " — Athi Soko Connect";
  }

  function wireTabs() {
    $$(".admin-tab-row .tab-btn[data-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        mode = btn.dataset.mode;
        applyMode();
      });
    });
  }

  /* ---------- Default departure date = today ---------- */
  function setDefaultDate() {
    const d = document.getElementById("depart-date");
    if (d && !d.value) {
      const t = new Date();
      d.value = t.toISOString().slice(0, 10);
    }
  }

  /* ---------- Submit ---------- */
  function showMsg(kind, text) {
    const el = document.getElementById("form-msg");
    if (!el) return;
    el.hidden = false;
    el.className = "msg msg--" + (kind === "error" ? "error" : kind === "warn" ? "warn" : "info");
    el.textContent = text;
  }

  async function submit(e) {
    e.preventDefault();

    const form = e.currentTarget;
    if (!form.reportValidity()) return;

    const payload = {
      kind: mode,
      from: $("#from-stage")?.value.trim(),
      to:   $("#to-stage")?.value.trim(),
      departAt: new Date(
        `${$("#depart-date").value}T${$("#depart-time").value || "00:00"}`
      ).toISOString(),
      notes: $("#notes")?.value.trim() || "",
    };

    if (mode === "offer") {
      payload.vehicle = $("#vehicle-make")?.value.trim() || "";
      payload.plate   = $("#vehicle-plate")?.value.trim() || "";
      payload.seats   = Number($("#seats-available")?.value) || 1;
      payload.price   = $("#price-per-seat")?.value ? Number($("#price-per-seat").value) : null;
    } else {
      payload.seats = Number($("#passengers")?.value) || 1;
    }

    const btn = document.getElementById("submit-btn");
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Posting…';
    showMsg("info", "Posting your trip…");

    try {
      const res = await postJSON("/api/pooling/trips", payload);
      showMsg("info", "Posted! Redirecting…");
      const id = res && (res.id || res.tripId);
      setTimeout(() => {
        window.location.href = id ? `pooling-trip.html?id=${encodeURIComponent(id)}` : "pooling.html";
      }, 600);
    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = original;
      showMsg("error", "Could not post trip: " + err.message);
    }
  }

  async function postJSON(path, body) {
    if (window.API && typeof API.post === "function") return API.post(path, body);
    const res = await fetch(path, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body || {}),
    });
    if (!res.ok) throw new Error(res.status + " " + res.statusText);
    return res.json();
  }

  /* ---------- Bootstrap ---------- */
  document.addEventListener("DOMContentLoaded", () => {
    wireTabs();
    applyMode();
    setDefaultDate();
    const form = document.getElementById("trip-form");
    if (form) form.addEventListener("submit", submit);
  });
})();