/* ============================================================
   frontend/js/provider.js — Provider profile + booking + report + refer
   Reads ?id=N, renders profile, submits booking, opens modal.
   ============================================================ */

/* ---------------- helpers ---------------- */
function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function initialsOf(name) {
  return String(name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function servicesArray(services) {
  if (Array.isArray(services)) return services;
  if (!services) return [];
  return String(services)
    .split(/,\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function stars(rating) {
  const r = Math.round(Number(rating) || 0);
  const clamped = Math.max(0, Math.min(5, r));
  return "⭐".repeat(clamped);
}

function formatDate(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-KE", {
      day: "numeric", month: "short", year: "numeric",
    });
  } catch { return "—"; }
}

function todayPlusDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function getProviderId() {
  const params = new URLSearchParams(window.location.search);
  const id = parseInt(params.get("id"), 10);
  return isNaN(id) ? null : id;
}

function getCurrentUser() {
  try {
    const raw = localStorage.getItem("asc_user");
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function isLoggedIn() {
  return typeof getToken === "function" && !!getToken();
}

/* ---------------- render states ---------------- */
function renderLoading() {
  document.getElementById("provider-root").innerHTML =
    `<div class="empty-state" style="margin-top:40px;">Loading provider…</div>`;
}

function renderError(msg) {
  document.getElementById("provider-root").innerHTML = `
    <div class="empty-state" style="margin-top:40px;">
      <h3>${escapeHtml(msg)}</h3>
      <p><a href="index.html">← Back to Discover</a></p>
    </div>`;
}

/* ---------------- header ---------------- */
function headerHtml(p) {
  const initials = initialsOf(p.name);
  const locParts = [];
  if (p.courtName) locParts.push(escapeHtml(p.courtName));
  if (p.phase != null) locParts.push(`Phase ${p.phase}`);
  const loc = locParts.join(" · ");

  const rating  = Number(p.rating || 0);
  const reviews = Number(p.reviews || 0);
  const price   = Number(p.priceFrom || 0);
  const cat     = p.categoryLabel || "—";

  return `
    <div class="provider-header">
      <div class="avatar avatar--lg">${escapeHtml(initials)}</div>
      <div>
        <h1 style="margin:0 0 4px;">${escapeHtml(p.name)}</h1>
        <div class="meta" style="color:var(--ink-70);">
          ${escapeHtml(cat)}${loc ? " · " + loc : ""}
        </div>
        <div class="rating" style="margin-top:6px;color:var(--ochre-dark);">
          ${stars(rating)} ${rating.toFixed(1)}
          ${reviews ? `<span style="color:var(--ink-40);">(${reviews} review${reviews === 1 ? "" : "s"})</span>` : ""}
          <span style="color:var(--ink-40);">·</span>
          <span style="color:var(--ink-70);">
            From KSh ${price.toLocaleString()} ${escapeHtml(p.priceUnit || "")}
          </span>
        </div>
      </div>
      <div>
        ${p.verified
          ? `<span class="badge badge--verified">Verified</span>`
          : `<span class="badge badge--pending">Pending</span>`}
      </div>
    </div>`;
}

/* ---------------- left column ---------------- */
function leftColumnHtml(p, reviews) {
  const services = servicesArray(p.services);
  const showPhone = isLoggedIn();

  const reviewsHtml = reviews.length
    ? reviews.map((r) => `
        <div class="review">
          <div class="review-head">
            <b>${escapeHtml(r.author || "Anonymous")}</b>
            <span>${formatDate(r.date)}</span>
          </div>
          <div class="rating" style="color:var(--ochre-dark);margin-bottom:4px;">
            ${stars(r.rating)} ${Number(r.rating).toFixed(1)}
          </div>
          ${r.text ? `<p style="margin:6px 0 0;">${escapeHtml(r.text)}</p>` : ""}
        </div>`).join("")
    : `<div class="empty-state" style="padding:20px;">No reviews yet.</div>`;

  return `
    <div>
      ${p.bio ? `<h2>About</h2><p>${escapeHtml(p.bio)}</p>` : ""}

      ${services.length ? `
        <h2 style="margin-top:28px;">Services</h2>
        <ul class="service-list">
          ${services.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}
        </ul>` : ""}

      <h2 style="margin-top:28px;">Details</h2>
      <ul class="info-list">
        <li><span>Hours</span><span>${escapeHtml(p.hours || "—")}</span></li>
        <li>
          <span>Starting price</span>
          <span>KSh ${Number(p.priceFrom || 0).toLocaleString()} ${escapeHtml(p.priceUnit || "")}</span>
        </li>
        <li><span>Court</span><span>${escapeHtml(p.courtName || "—")}</span></li>
        <li><span>Phase</span><span>${p.phase != null ? "Phase " + p.phase : "—"}</span></li>
        <li>
          <span>Phone</span>
          <span>
            ${showPhone
              ? `<a href="tel:${escapeHtml(p.phone)}">${escapeHtml(p.phone)}</a>`
              : `<span style="color:var(--ink-40);">Log in to view</span>`}
          </span>
        </li>
      </ul>

      <h2 style="margin-top:28px;">Reviews (${reviews.length})</h2>
      ${reviewsHtml}

      <div style="margin-top:32px;padding-top:20px;border-top:1px solid var(--line);">
        <h3 style="margin:0 0 12px;">Share with a neighbor</h3>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button type="button" class="btn btn--accent btn--small" id="refer-provider">
            🔗 Refer this provider
          </button>
          <button type="button" class="btn btn--ghost btn--small" id="open-report">
            Report this provider
          </button>
        </div>

        <!-- Refer inline panel (hidden by default) -->
        <div id="refer-panel" style="
          display:none; margin-top:12px; padding:14px;
          border:1px solid var(--line); border-radius:8px;
          background:var(--paper);
        ">
          <p style="margin:0 0 10px; font-size:0.9rem;">
            Help your neighbors find <b>${escapeHtml(p.name)}</b>:
          </p>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button type="button" class="btn btn--primary btn--small" id="refer-copy">
              📋 Copy link
            </button>
            <button type="button" class="btn btn--ghost btn--small" id="refer-whatsapp">
              💬 Share on WhatsApp
            </button>
            <button type="button" class="btn btn--ghost btn--small" id="refer-close">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>`;
}

/* ---------------- right column (booking form) ---------------- */
function bookingFormHtml(p) {
  if (!isLoggedIn()) {
    const next = encodeURIComponent("provider.html?id=" + p.id);
    return `
      <div class="booking-box" id="booking-box">
        <h3 style="margin-top:0;">Request a booking</h3>
        <p style="font-size:0.9rem;">
          Please log in as a resident to send a booking request.
        </p>
        <a class="btn btn--primary" href="login.html?next=${next}">Log in to book</a>
      </div>`;
  }

  const user = getCurrentUser() || {};
  const name  = user.name  || "";
  const phone = user.phone || "";

  return `
    <div class="booking-box" id="booking-box">
      <h3 style="margin-top:0;">Request a booking</h3>
      <p style="font-size:0.9rem;">
        Send a request to ${escapeHtml(p.name)}. They'll confirm shortly.
      </p>

      <form id="booking-form">
        <div class="field">
          <label for="bf-name">Your name</label>
          <input id="bf-name" type="text" required value="${escapeHtml(name)}" />
        </div>

        <div class="field">
          <label for="bf-phone">Your phone</label>
          <input id="bf-phone" type="tel" required
                 value="${escapeHtml(phone)}" placeholder="+2547…" />
        </div>

        <div class="field">
          <label for="bf-date">Date</label>
          <input id="bf-date" type="date" required value="${todayPlusDays(1)}" />
        </div>

        <div class="field">
          <label for="bf-service">What do you need?</label>
          <input id="bf-service" type="text" required
                 placeholder="e.g. 2 bags of laundry, pickup" />
        </div>

        <div class="field">
          <label for="bf-notes">
            Notes <span style="color:var(--ink-40);font-weight:400;">(optional)</span>
          </label>
          <textarea id="bf-notes" rows="3" placeholder="Any details the provider should know"></textarea>
        </div>

        <button type="submit" class="btn btn--accent" style="width:100%;">
          Request booking
        </button>

        <p id="booking-msg"
           style="font-size:0.85rem;margin:8px 0 0;display:none;"></p>
      </form>
    </div>`;
}

/* ---------------- booking success ---------------- */
function renderBookingSuccess(p) {
  const box = document.getElementById("booking-box");
  if (!box) return;

  box.innerHTML = `
    <h3 style="margin-top:0;">Request sent ✓</h3>
    <p style="font-size:0.92rem;">
      Your request has been sent to <b>${escapeHtml(p.name)}</b>.
      They'll confirm shortly. Track it from your bookings page.
    </p>
    <div style="display:flex; gap:8px; flex-wrap:wrap;">
      <a class="btn btn--primary" href="dashboard.html">View my bookings</a>
      <button type="button" class="btn btn--ghost" id="book-again">Book another</button>
    </div>`;

  document.getElementById("book-again").addEventListener("click", () => {
    box.outerHTML = bookingFormHtml(p);
    wireBookingForm(p);
  });
}

/* ---------------- wire booking form ---------------- */
function wireBookingForm(p) {
  const form = document.getElementById("booking-form");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const msg = document.getElementById("booking-msg");
    const btn = form.querySelector("button[type=submit]");

    const name    = document.getElementById("bf-name").value.trim();
    const phone   = document.getElementById("bf-phone").value.trim();
    const date    = document.getElementById("bf-date").value;
    const service = document.getElementById("bf-service").value.trim();
    const notes   = document.getElementById("bf-notes").value.trim();

    if (!name || !phone || !date || !service) {
      msg.textContent = "Please fill in your name, phone, date, and what you need.";
      msg.style.color = "var(--clay)";
      msg.style.display = "block";
      return;
    }

    btn.disabled = true;
    btn.textContent = "Sending…";
    msg.style.display = "none";

    try {
      await Api.addBooking({
        providerId:    p.id,
        service,
        date,
        notes,
        residentName:  name,
        residentPhone: phone,
      });
      renderBookingSuccess(p);
    } catch (err) {
      console.error("[provider] booking failed:", err);
      msg.textContent = err.message || "Could not send booking. Please try again.";
      msg.style.color = "var(--clay)";
      msg.style.display = "block";
      btn.disabled = false;
      btn.textContent = "Request booking";
    }
  });
}

/* ---------------- wire report modal ---------------- */
function wireReportModal(provider) {
  const openBtn = document.getElementById("open-report");
  const modal   = document.getElementById("report-modal");
  const cancel  = document.getElementById("report-cancel");
  const form    = document.getElementById("report-form");

  if (!openBtn || !modal || !cancel || !form) return;

  openBtn.addEventListener("click", () => modal.classList.add("is-open"));
  cancel.addEventListener("click",   () => modal.classList.remove("is-open"));
  modal.addEventListener("click",    (e) => {
    if (e.target === modal) modal.classList.remove("is-open");
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const reason  = document.getElementById("report-reason").value;
    const details = document.getElementById("report-details").value.trim();
    if (!details) return;

    try {
      await Api.addReport({ providerId: provider.id, reason, details });
      modal.classList.remove("is-open");
      form.reset();
      alert("Report submitted. The estate admin will review it.");
    } catch (err) {
      console.error("[provider] report failed:", err);
      alert(err.message || "Could not submit report.");
    }
  });
}

/* ---------------- wire refer panel ---------------- */
function wireReferPanel(provider) {
  const referBtn    = document.getElementById("refer-provider");
  const panel       = document.getElementById("refer-panel");
  const copyBtn     = document.getElementById("refer-copy");
  const whatsappBtn = document.getElementById("refer-whatsapp");
  const closeBtn    = document.getElementById("refer-close");

  if (!referBtn || !panel || !copyBtn || !whatsappBtn || !closeBtn) return;

  // Build the sharable URL and message
  const providerUrl = `${window.location.origin}${window.location.pathname}?id=${provider.id}`;
  const shareMessage =
    `Check out ${provider.name} on Athi Soko Connect — ` +
    `${provider.categoryLabel || "a service provider"} in Phase ${provider.phase || "?"}. ` +
    `Book them here: ${providerUrl}`;

  // Toggle the panel
  referBtn.addEventListener("click", () => {
    panel.style.display = panel.style.display === "none" ? "block" : "none";
  });

  // Copy link to clipboard
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(providerUrl);
      toast("Link copied! Share it with your neighbors.");
      panel.style.display = "none";
    } catch (err) {
      // Fallback for older browsers / http contexts
      const tempInput = document.createElement("input");
      tempInput.value = providerUrl;
      document.body.appendChild(tempInput);
      tempInput.select();
      try { document.execCommand("copy"); toast("Link copied!"); }
      catch { alert("Could not copy. Here is the link:\n\n" + providerUrl); }
      document.body.removeChild(tempInput);
      panel.style.display = "none";
    }
  });

  // Share on WhatsApp
  whatsappBtn.addEventListener("click", () => {
    const waUrl = `https://wa.me/?text=${encodeURIComponent(shareMessage)}`;
    window.open(waUrl, "_blank");
    panel.style.display = "none";
  });

  // Close panel
  closeBtn.addEventListener("click", () => {
    panel.style.display = "none";
  });
}

/* ---------------- main ---------------- */
async function initProviderPage() {
  const root = document.getElementById("provider-root");
  if (!root) return;

  const id = getProviderId();
  if (!id) return renderError("No provider specified.");

  renderLoading();

  let provider, reviews;
  try {
    [provider, reviews] = await Promise.all([
      Api.getProvider(id),
      Api.getReviews(id).catch(() => []),
    ]);
  } catch (err) {
    console.error("[provider] load failed:", err);
    return renderError("Could not load this provider.");
  }

  if (!provider) return renderError("Provider not found.");

  root.innerHTML = `
    ${headerHtml(provider)}
    <div class="detail-grid">
      ${leftColumnHtml(provider, reviews || [])}
      ${bookingFormHtml(provider)}
    </div>`;

  wireBookingForm(provider);
  wireReportModal(provider);
  wireReferPanel(provider);  // <-- NEW: Wires up the refer panel
}

document.addEventListener("DOMContentLoaded", initProviderPage);