/* ============================================================
   announcements.js — bell icon + dropdown panel
   Loaded on every page that includes the header.
   ============================================================ */

/* localStorage key for "last read announcement id" — per user */
function annReadKey() {
  const user = (typeof getUser === "function") ? getUser() : null;
  return user ? `asc_ann_read_${user.id}` : "asc_ann_read_guest";
}

function getLastReadAnnouncementId() {
  const v = localStorage.getItem(annReadKey());
  return v ? parseInt(v, 10) : 0;
}

function setLastReadAnnouncementId(id) {
  localStorage.setItem(annReadKey(), String(id));
}

/* ------------------------------------------------------------
   Build the bell element and inject it into the nav
   ------------------------------------------------------------ */
function mountBell() {
  const nav = document.querySelector("nav.main-nav");
  if (!nav) return;

  /* Don't duplicate */
  if (nav.querySelector(".bell")) return;

  const bell = document.createElement("button");
  bell.type = "button";
  bell.className = "bell";
  bell.setAttribute("aria-label", "Announcements");
  bell.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
      <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
    </svg>
    <span class="bell__badge" id="bellBadge">0</span>
  `;
  bell.addEventListener("click", togglePanel);
  nav.appendChild(bell);

  /* Panel container */
  let panel = document.getElementById("annPanel");
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "annPanel";
    panel.className = "ann-panel";
    panel.innerHTML = `
      <div class="ann-panel__head">
        <h3>Announcements</h3>
        <button type="button" class="ann-panel__close" id="annPanelClose">✕</button>
      </div>
      <div class="ann-panel__body" id="annPanelBody">
        <div class="ann-empty">Loading…</div>
      </div>
    `;
    document.body.appendChild(panel);

    document.getElementById("annPanelClose").addEventListener("click", closePanel);
    document.addEventListener("click", (e) => {
      if (!e.target.closest("#annPanel") && !e.target.closest(".bell")) closePanel();
    });
  }
}

function openPanel() {
  const panel = document.getElementById("annPanel");
  if (panel) panel.classList.add("is-open");
}

function closePanel() {
  const panel = document.getElementById("annPanel");
  if (panel) panel.classList.remove("is-open");
}

function togglePanel() {
  const panel = document.getElementById("annPanel");
  if (!panel) return;
  if (panel.classList.contains("is-open")) closePanel();
  else {
    openPanel();
    loadAnnouncements();
  }
}

/* ------------------------------------------------------------
   Fetch + render
   ------------------------------------------------------------ */
async function loadAnnouncements() {
  const body = document.getElementById("annPanelBody");
  if (!body) return;

  let items;
  try {
    items = await Api.getAnnouncements({ limit: 20 });
  } catch (err) {
    body.innerHTML = `<div class="ann-empty">Could not load announcements.</div>`;
    return;
  }

  if (!items.length) {
    body.innerHTML = `<div class="ann-empty">No announcements yet.</div>`;
    updateBadge(0);
    return;
  }

  const lastRead = getLastReadAnnouncementId();
  const unreadCount = items.filter((a) => a.id > lastRead).length;

  const html = items.map((a) => {
    const isUnread = a.id > lastRead;
    const when     = new Date(a.created_at).toLocaleDateString("en-KE", {
      day: "numeric", month: "short", year: "numeric",
    });

    return `
      <div class="ann-item ${isUnread ? "is-unread" : ""}">
        <div class="ann-item__title">
          ${isUnread ? '<span class="ann-item__unread-dot"></span>' : ""}
          ${escapeAnn(a.title)}
        </div>
        <div class="ann-item__body">${escapeAnn(a.body)}</div>
        <div class="ann-item__meta">
          ${when}${a.created_by_name ? " · " + escapeAnn(a.created_by_name) : ""}
        </div>
      </div>
    `;
  }).join("");

  body.innerHTML = html;

  /* Mark as read immediately when the panel is opened */
  const maxId = Math.max(...items.map((a) => a.id));
  setLastReadAnnouncementId(maxId);
  updateBadge(0);
}

/* ------------------------------------------------------------
   Badge update
   ------------------------------------------------------------ */
function updateBadge(count) {
  const badge = document.getElementById("bellBadge");
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 9 ? "9+" : String(count);
    badge.classList.add("is-visible");
  } else {
    badge.classList.remove("is-visible");
  }
}

/* ------------------------------------------------------------
   Peek on load — count unread WITHOUT opening the panel
   ------------------------------------------------------------ */
async function peekAnnouncements() {
  let items;
  try {
    items = await Api.getAnnouncements({ limit: 20 });
  } catch (err) {
    return;   /* silent failure — user isn't logged in or API is down */
  }
  if (!items.length) return;

  const lastRead = getLastReadAnnouncementId();
  const unread = items.filter((a) => a.id > lastRead).length;
  updateBadge(unread);
}

/* ------------------------------------------------------------
   Small escape helper
   ------------------------------------------------------------ */
function escapeAnn(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/* ------------------------------------------------------------
   Init
   ------------------------------------------------------------ */
document.addEventListener("DOMContentLoaded", () => {
  /* Only show the bell if the user is logged in */
  if (typeof isLoggedIn !== "function" || !isLoggedIn()) return;

  mountBell();
  peekAnnouncements();
});