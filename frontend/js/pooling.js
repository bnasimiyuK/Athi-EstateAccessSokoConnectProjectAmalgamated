/* ============================================================
   Car Pooling & Hailing — board page
   Renders destination tiles, trip cards, filters, live counts.

   All API calls go through discoverApiBase() + JWT so they land
   on the Express backend (port 4050), not the frontend dev server.
   ============================================================ */

(function () {
  "use strict";

  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  /* ------------------------------------------------------------
     Fetch helpers — attach JWT + use the resolved API base
     ------------------------------------------------------------ */
  async function fetchJSON(path) {
    const base  = await (window.discoverApiBase ? window.discoverApiBase() : Promise.resolve(""));
    const token = (typeof getToken === "function") ? getToken() : null;

    const res = await fetch(base + path, {
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
    });
    if (!res.ok) throw new Error(res.status + " " + res.statusText);
    return res.json();
  }

  async function postJSON(path, body) {
    const base  = await (window.discoverApiBase ? window.discoverApiBase() : Promise.resolve(""));
    const token = (typeof getToken === "function") ? getToken() : null;

    const res = await fetch(base + path, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      body: JSON.stringify(body || {}),
    });
    if (!res.ok) throw new Error(res.status + " " + res.statusText);
    return res.json();
  }

  /* ---------- State ---------- */
  const state = {
    filter: "all",         // all | offer | need
    q: "",
    from: "",
    to: "",
    when: "",
    sort: "depart_asc",
    page: 1,
    perPage: 12,
    total: 0,
    trips: [],
  };

  /* ---------- Formatting ---------- */
  function initials(name) {
    return String(name || "?").trim().split(/\s+/).slice(0, 2)
      .map((p) => p[0] ? p[0].toUpperCase() : "").join("") || "?";
  }

  function formatDateTime(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    const today = new Date(); today.setHours(0,0,0,0);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    const dayLabel = d.toDateString() === today.toDateString() ? "Today"
                   : d.toDateString() === tomorrow.toDateString() ? "Tomorrow"
                   : d.toLocaleDateString("en-KE", { weekday: "short", day: "numeric", month: "short" });
    const time = d.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" });
    return `${dayLabel} · ${time}`;
  }

  /* ---------- Render trip card ---------- */
  function renderTripCard(t) {
    const kind = t.kind === "need" ? "need" : "offer";
    const seatsLeft = Number(t.seatsLeft ?? t.seats ?? 0);
    const seatsClass = seatsLeft <= 0 ? "trip-card_seats--full"
                     : seatsLeft <= 1 ? "trip-card_seats--low"
                     : "";
    const seatsText = kind === "need"
      ? `${t.seats || 1} passenger${(t.seats || 1) > 1 ? "s" : ""}`
      : seatsLeft > 0
        ? `${seatsLeft} seat${seatsLeft !== 1 ? "s" : ""} left`
        : "Full";

    const priceHtml = kind === "offer" && t.price != null
      ? `<div class="trip-card_price">KES ${Number(t.price).toLocaleString("en-KE")}<small>/seat</small></div>`
      : `<div class="trip-card_price"><small>Fare by arrangement</small></div>`;

    const cta = kind === "offer"
      ? (seatsLeft > 0
          ? `<button class="trip-card_btn" data-action="request" data-id="${esc(t.id)}"><i class="fas fa-hand"></i> Request seat</button>`
          : `<button class="trip-card_btn" disabled><i class="fas fa-ban"></i> Full</button>`)
      : `<button class="trip-card_btn" data-action="claim" data-id="${esc(t.id)}"><i class="fas fa-car"></i> I can drive</button>`;

    return `
      <article class="trip-card" data-id="${esc(t.id)}">
        <span class="trip-card_kind trip-card_kind--${kind}">
          ${kind === "offer" ? "Offering seats" : "Need a ride"}
        </span>

        <div class="trip-card_route">
          <i class="fas fa-circle" style="font-size:0.4rem;"></i>
          ${esc(t.from || "—")}
          <span class="arrow"><i class="fas fa-arrow-right"></i></span>
          ${esc(t.to || "—")}
        </div>

        <div class="trip-card_meta">
          <span><i class="fas fa-clock"></i> ${esc(formatDateTime(t.departAt))}</span>
          ${t.vehicle ? `<span><i class="fas fa-car"></i> ${esc(t.vehicle)}</span>` : ""}
        </div>

        ${t.notes ? `<p class="trip-card_note">${esc(t.notes)}</p>` : ""}

        <div class="trip-card_driver">
          <span class="avatar">${esc(initials(t.driverName))}</span>
          <div>
            <div class="trip-card_driver_name">${esc(t.driverName || "Resident")}</div>
            <div class="trip-card_driver_house">${esc(t.driverHouse || "Verified resident")}</div>
          </div>
        </div>

        <div class="trip-card_footer">
          <span class="trip-card_seats ${seatsClass}">
            <i class="fas fa-chair"></i> ${esc(seatsText)}
          </span>
          ${priceHtml}
        </div>

        <div style="display:flex; justify-content:flex-end; margin-top:4px;">
          ${cta}
        </div>
      </article>
    `;
  }

  /* ---------- Fetch trips ---------- */
  async function loadTrips({ append = false } = {}) {
    const grid = document.getElementById("trip-grid");
    if (!grid) return;

    if (!append) {
      grid.innerHTML = `<div class="empty-state">Loading trips…</div>`;
    }

    const params = new URLSearchParams();
    if (state.filter !== "all") params.set("kind", state.filter);
    if (state.q)    params.set("q", state.q);
    if (state.from) params.set("from", state.from);
    if (state.to)   params.set("to", state.to);
    if (state.when) params.set("when", state.when);
    params.set("sort", state.sort);
    params.set("page", state.page);
    params.set("perPage", state.perPage);

    try {
      const data = await fetchJSON("/pooling/trips?" + params.toString());
      const items = Array.isArray(data) ? data : (data.items || []);
      state.total = (data && data.total) || items.length;

      if (!append) state.trips = items;
      else state.trips = state.trips.concat(items);

      if (state.trips.length === 0) {
        grid.innerHTML = `<div class="empty-state">
          No trips match your filters yet.
          <div style="margin-top:12px;">
            <a href="pooling-new.html?type=offer" class="btn btn--accent btn--small">Offer a seat</a>
            <a href="pooling-new.html?type=need"  class="btn btn--ghost btn--small">Request a ride</a>
          </div>
        </div>`;
      } else {
        grid.innerHTML = state.trips.map(renderTripCard).join("");
        wireCardActions(grid);
      }

      const heading = document.getElementById("results-heading");
      if (heading) {
        heading.textContent =
          state.filter === "offer" ? "Seats offered"
        : state.filter === "need"  ? "Ride requests"
        : "Open trips";
      }
      const countEl = document.getElementById("results-count");
      if (countEl) countEl.textContent = `${state.total} trip${state.total === 1 ? "" : "s"}`;

      const more = document.getElementById("load-more");
      if (more) more.hidden = state.trips.length >= state.total;

    } catch (err) {
      grid.innerHTML = `<div class="empty-state">Could not load trips. ${esc(err.message)}</div>`;
    }
  }

  /* ---------- Card actions ---------- */
  function wireCardActions(grid) {
    grid.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        const action = btn.dataset.action;
        if (action === "request" || action === "claim") {
          window.location.href = `pooling-trip.html?id=${encodeURIComponent(id)}&intent=${action}`;
        }
      });
    });
  }

  /* ---------- Destination tiles ---------- */
  const DESTINATIONS = [
    { label: "Nairobi CBD",   icon: "fa-city",         desc: "Daily commuters" },
    { label: "Westlands",     icon: "fa-briefcase",    desc: "Morning offices" },
    { label: "JKIA",          icon: "fa-plane-departure", desc: "Airport runs" },
    { label: "Kitengela",     icon: "fa-store",        desc: "Weekend errands" },
    { label: "Mombasa Road",  icon: "fa-road",         desc: "Industrial area" },
    { label: "Machakos",      icon: "fa-mountain-sun", desc: "Town trips" },
  ];

  function renderDestinationTiles() {
    const el = document.getElementById("destination-tiles");
    if (!el) return;
    el.innerHTML = DESTINATIONS.map((d) => `
      <button type="button" class="trip-tile" data-dest="${esc(d.label)}">
        <span class="trip-tile_icon"><i class="fas ${d.icon}"></i></span>
        <span class="trip-tile_label">${esc(d.label)}</span>
        <span class="trip-tile_desc">${esc(d.desc)}</span>
      </button>
    `).join("");

    el.querySelectorAll(".trip-tile").forEach((tile) => {
      tile.addEventListener("click", () => {
        const dest = tile.dataset.dest;
        const select = document.getElementById("to-stage");
        if (select) {
          let opt = Array.from(select.options).find((o) => o.value === dest);
          if (!opt) {
            opt = document.createElement("option");
            opt.value = dest; opt.textContent = dest;
            select.appendChild(opt);
          }
          select.value = dest;
        }
        state.to = dest;
        state.page = 1;
        el.querySelectorAll(".trip-tile").forEach((t) => t.classList.remove("is-active"));
        tile.classList.add("is-active");
        document.getElementById("trips")?.scrollIntoView({ behavior: "smooth" });
        loadTrips();
      });
    });
  }

  /* ---------- Stats strip ---------- */
  async function loadStats() {
    try {
      const data = await fetchJSON("/pooling/stats");
      setText("stat-active-trips",   data.activeTrips ?? "—");
      setText("stat-open-requests",  data.openRequests ?? "—");
      setText("stat-seats-available", data.seatsAvailable ?? "—");
      setText("count-offer", data.offerCount ?? "—");
      setText("count-need",  data.needCount  ?? "—");
    } catch (_) { /* silent — placeholders remain */ }
  }

  function setText(id, v) {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  }

  /* ---------- Live clock ---------- */
  function tickClock() {
    const el = document.getElementById("sync-time");
    if (!el) return;
    const d = new Date();
    el.textContent = d.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" });
  }

  /* ---------- Wire filter bar ---------- */
  function wireFilters() {
    const form = document.getElementById("pooling-search");
    if (form) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        state.q    = document.getElementById("q")?.value.trim() || "";
        state.from = document.getElementById("from-stage")?.value || "";
        state.to   = document.getElementById("to-stage")?.value || "";
        state.when = document.getElementById("when")?.value || "";
        state.page = 1;
        loadTrips();
      });
    }

    const reset = document.getElementById("reset-search");
    if (reset) {
      reset.addEventListener("click", () => {
        ["q","from-stage","to-stage","when"].forEach((id) => {
          const el = document.getElementById(id);
          if (el) el.value = "";
        });
        state.q = state.from = state.to = state.when = "";
        state.page = 1;
        loadTrips();
      });
    }

    const sort = document.getElementById("sort-by");
    if (sort) {
      sort.addEventListener("change", () => {
        state.sort = sort.value;
        state.page = 1;
        loadTrips();
      });
    }

    $$(".dx-chip--btn[data-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.filter = btn.dataset.filter;
        state.page = 1;
        $$(".dx-chip--btn[data-filter]").forEach((b) => b.classList.toggle("is-active", b === btn));
        loadTrips();
      });
    });

    const more = document.getElementById("load-more");
    if (more) {
      more.addEventListener("click", () => {
        state.page += 1;
        loadTrips({ append: true });
      });
    }
  }

  /* ---------- Bootstrap ---------- */
  document.addEventListener("DOMContentLoaded", () => {
    wireFilters();
    renderDestinationTiles();
    loadTrips();
    loadStats();
    tickClock();
    setInterval(tickClock, 30000);
  });
})();