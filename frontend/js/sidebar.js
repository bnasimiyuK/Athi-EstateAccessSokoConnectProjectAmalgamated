/* sidebar.js — GLOBAL sidebar injector + top-right profile chip */
(function () {
  "use strict";

  const SKIP_PAGES = ["login.html", "social-callback.html", "change-password.html"];

  const MAIN_LINKS = [
    { href: "index.html",     label: "Discover",          icon: "fa-compass" },
    { href: "register.html",  label: "Become a provider", icon: "fa-user-plus" },
    { href: "dashboard.html", label: "My bookings",       icon: "fa-calendar-check" },
    { href: "billing.html",   label: "My billing",        icon: "fa-file-invoice" },
    { href: "visitors.html",  label: "My visitors",       icon: "fa-address-book" },
    { href: "residents.html", label: "Sign Up",           icon: "fa-user-friends" },
  ];

  const GROUPS = [
    {
      key: "ahewa", label: "AHEWA", icon: "fa-chart-pie",
      items: [
        { href: "ahewa.html",        label: "Dashboard", icon: "fa-tachometer-alt" },
        { href: "ahewa-events.html", label: "Events",    icon: "fa-calendar-alt" },
        { href: "ahewa-event.html",  label: "Event",     icon: "fa-calendar-day" },
      ],
    },
    {
      key: "admin", label: "Admin", icon: "fa-shield-alt",
      items: [
        { href: "admin.html",                    label: "Dashboard",          icon: "fa-chart-line" },
        { href: "pending.html",                  label: "Pending approvals",  icon: "fa-clock" },
        { href: "admin-reviews.html",            label: "All Reviews",        icon: "fa-star" },
        { href: "admin-residents.html",          label: "Approved residents", icon: "fa-users" },
        { href: "admin-house-numbers.html",      label: "House numbers",      icon: "fa-home" },
        { href: "admin-invoices.html",           label: "Invoices",           icon: "fa-file-invoice-dollar" },
        { href: "admin-payments.html",           label: "Payments",           icon: "fa-credit-card" },
        { href: "admin-visitors.html",           label: "Visitors",           icon: "fa-user-tag" },
        { href: "admin-visitor-analytics.html",  label: "Visitor analytics",  icon: "fa-chart-bar" },
        { href: "admin-providers.html",          label: "All vendors",        icon: "fa-store" },
        { href: "admin-health.html",             label: "System health",      icon: "fa-heartbeat" },
      ],
    },
        {
      key: "super-admin", label: "Super Admin", icon: "fa-crown",
      items: [
        { href: "super-admin.html",              label: "Overview",        icon: "fa-tachometer-alt" },
        { href: "super-admin-admins.html",       label: "Manage admins",   icon: "fa-user-shield" },
        { href: "super-admin-categories.html",   label: "Categories",      icon: "fa-tags" },
        { href: "super-admin-providers.html",    label: "All providers",   icon: "fa-store" },
        { href: "super-admin-residents.html",    label: "All residents",   icon: "fa-users" },
      ],
    },
  ];

  const BRAND_NAME   = "Athi Soko";
  const BRAND_ACCENT = "Access";
  const FOOTER_TEXT  = "© 2025 Athi Highway Estate";

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function currentPage() {
    const p = window.location.pathname.split("/").pop();
    return p && p.length ? p : "index.html";
  }

  /* ----------------------------------------------------------
     SIDEBAR
     ---------------------------------------------------------- */
  function buildSidebar() {
    const current = currentPage();

    const linkHtml = (l) => {
      const active = l.href === current ? " is-active" : "";
      return '<a href="' + esc(l.href) + '" class="sidebar__link' + active + '">' +
        '<i class="fas ' + esc(l.icon) + '"></i> ' + esc(l.label) +
        '</a>';
    };

    const mainHtml = MAIN_LINKS.map(linkHtml).join("");
const currentUser = (typeof getUser === "function")
  ? getUser()
  : (function () {
      try { return JSON.parse(localStorage.getItem("asc_user") || "null"); }
      catch (e) { return null; }
    })();
 
const isSuper = currentUser && currentUser.role === "super-admin";

const groupsHtml = GROUPS
  .filter((g) => g.key !== "super-admin" || isSuper)
  .map((g) => {
    const open = g.items.some((it) => it.href === current) ? " open" : "";
    // ...existing logic
  }).join("");

    return '<aside class="sidebar" id="sidebar">' +
      '<div class="sidebar__header">' +
        '<a href="index.html" class="sidebar__logo">' +
          esc(BRAND_NAME) + ' <span>' + esc(BRAND_ACCENT) + '</span> <small>estate</small>' +
        '</a>' +
      '</div>' +
      '<nav class="sidebar__nav">' + mainHtml + groupsHtml + '</nav>' +
      '<div class="sidebar__footer">' + esc(FOOTER_TEXT) + '</div>' +
    '</aside>';
  }

  function injectSidebar() {
    const body = document.body;
    if (!body || document.getElementById("sidebar")) return;

    const existing = Array.from(body.childNodes).filter((n) => {
      if (n.nodeType !== 1) return true;
      if (n.tagName === "SCRIPT") return false;
      if (n.id === "sidebar" || n.id === "sidebarOverlay") return false;
      if (n.id === "authChip") return false;
      if (n.classList && (n.classList.contains("topbar") || n.classList.contains("main"))) return false;
      return true;
    });

    const w = document.createElement("div");
    w.innerHTML = buildSidebar().trim();
    const sidebar = w.firstElementChild;

    const overlay = document.createElement("div");
    overlay.className = "sidebar-overlay";
    overlay.id = "sidebarOverlay";

    const main = document.createElement("div");
    main.className = "main";
    existing.forEach((n) => main.appendChild(n));

    const topbar = document.createElement("div");
    topbar.className = "topbar";
    topbar.innerHTML =
      '<button class="topbar__toggle" id="sidebarToggle" aria-label="Toggle sidebar">' +
        '<i class="fas fa-bars"></i>' +
      '</button>' +
      '<span class="topbar__title">' + esc(BRAND_NAME) + '</span>' +
      '<span style="width:32px;"></span>';
    main.insertBefore(topbar, main.firstChild);

    body.insertBefore(sidebar, body.firstChild);
    body.insertBefore(overlay, sidebar.nextSibling);
    body.insertBefore(main, overlay.nextSibling);
  }

  function wireSidebar() {
    const sidebar = document.getElementById("sidebar");
    const overlay = document.getElementById("sidebarOverlay");
    const toggle  = document.getElementById("sidebarToggle");

    const open  = () => {
      if (sidebar) sidebar.classList.add("open");
      if (overlay) overlay.classList.add("active");
      document.body.style.overflow = "hidden";
    };
    const close = () => {
      if (sidebar) sidebar.classList.remove("open");
      if (overlay) overlay.classList.remove("active");
      document.body.style.overflow = "";
    };

    if (toggle)  toggle.addEventListener("click", open);
    if (overlay) overlay.addEventListener("click", close);

    document.querySelectorAll(".sidebar__link").forEach((l) =>
      l.addEventListener("click", () => {
        if (window.innerWidth <= 820) close();
      })
    );

    document.querySelectorAll(".sidebar__group-header").forEach((h) =>
      h.addEventListener("click", function (e) {
        e.preventDefault();
        const sub = document.getElementById("group-" + this.dataset.group);
        if (!sub) return;
        sub.classList.toggle("open");
        this.classList.toggle("open");
      })
    );
  }

  /* ----------------------------------------------------------
     TOP-RIGHT AUTH CHIP
     ---------------------------------------------------------- */
  function injectAuthChip() {
    if (document.getElementById("authChip")) return;

    const chip = document.createElement("div");
    chip.id = "authChip";
    chip.className = "auth-chip";

    document.body.appendChild(chip);

    renderAuthChip();

    // Re-render every 3 s in case the user logs in/out in another tab
    if (injectAuthChip._id) clearInterval(injectAuthChip._id);
    injectAuthChip._id = setInterval(renderAuthChip, 3000);
  }

  function renderAuthChip() {
  const chip = document.getElementById("authChip");
  if (!chip) return;

  const loggedIn = typeof isLoggedIn === "function" ? isLoggedIn() : false;

  // Read fresh from storage so avatar changes take effect immediately
  let user = null;
  try { user = JSON.parse(localStorage.getItem("user") || "null"); } catch (e) {}
  if (!user && typeof getUser === "function") user = getUser();

    if (loggedIn && user) {
      const role = user.role
        ? user.role.charAt(0).toUpperCase() + user.role.slice(1)
        : "User";
      const roleColor = {
        admin:    "#b0472e",
        resident: "#2f6f5e",
        vendor:   "#c8862a",
        security: "#4a7ba7",
      }[user.role] || "#4a5670";

      const name = user.name || "User";
      const initials = name
        .split(/\s+/).filter(Boolean)
        .map((n) => n[0])
        .slice(0, 2)
        .join("")
        .toUpperCase();

      const photo =
        user.avatar || user.photo || user.image || user.profilePhoto || null;

      let avatarInner;
      if (photo) {
        avatarInner =
          '<img class="auth-chip__avatar-img" src="' + esc(photo) + '" ' +
          'alt="' + esc(name) + '" ' +
          'onerror="this.style.display=\'none\'; this.parentNode.classList.add(\'auth-chip__avatar--initials\'); this.parentNode.textContent=\'' + esc(initials) + '\';" />';
      } else {
        avatarInner = esc(initials);
      }

      const avatarHtml =
        '<button type="button" class="auth-chip__avatar" id="authChipAvatar" ' +
        'title="Click to upload a profile photo" ' +
        'style="background:' + roleColor + ';">' +
          avatarInner +
          '<span class="auth-chip__avatar-overlay"><i class="fas fa-camera"></i></span>' +
        '</button>' +
        '<input type="file" id="authChipAvatarInput" accept="image/*" hidden />';

      chip.innerHTML =
        avatarHtml +
        '<span class="auth-chip__greet">Signed in as</span>' +
        '<span class="auth-chip__name">' + esc(name) + '</span>' +
        '<span class="auth-chip__role" style="background:' + roleColor + ';">' +
          esc(role) +
        '</span>' +
        '<a href="#" id="authChipLogout" class="auth-chip__logout">' +
          '<i class="fas fa-sign-out-alt"></i> Logout' +
        '</a>';

      /* --- Logout --- */
      const btn = document.getElementById("authChipLogout");
      if (btn) {
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          if (typeof logout === "function") logout();
          else {
            localStorage.removeItem("token");
            localStorage.removeItem("user");
            window.location.href = "login.html";
          }
        });
      }

      /* --- Avatar upload --- */
      const av   = document.getElementById("authChipAvatar");
      const file = document.getElementById("authChipAvatarInput");
      if (av && file) {
        av.addEventListener("click", () => file.click());

        file.addEventListener("change", async () => {
          const f = file.files && file.files[0];
          if (!f) return;

          if (!/^image\//.test(f.type)) {
            if (typeof toast === "function") toast("Please choose an image file.");
            return;
          }
          if (f.size > 3 * 1024 * 1024) {
            if (typeof toast === "function") toast("Image must be under 3 MB.");
            return;
          }

          const fd = new FormData();
          fd.append("avatar", f);

          try {
            if (typeof toast === "function") toast("Uploading…");

            // Fallback if Api.uploadAvatar isn't defined yet
            let newUrl = null;
            if (typeof Api !== "undefined" && typeof Api.uploadAvatar === "function") {
              const res = await Api.uploadAvatar(fd);
              newUrl = res && (res.avatar || res.url);
            } else {
              // --- Local preview only (no backend yet) ---
              newUrl = await new Promise((resolve, reject) => {
                const r = new FileReader();
                r.onload = () => resolve(r.result);
                r.onerror = reject;
                r.readAsDataURL(f);
              });
            }

            if (!newUrl) throw new Error("No URL returned from upload.");

            // Update local user object + re-render chip
            const u = (typeof getUser === "function" ? getUser() : {}) || {};
            u.avatar = newUrl;
            localStorage.setItem("user", JSON.stringify(u));

            if (typeof toast === "function") toast("Photo updated.");
            renderAuthChip();
          } catch (err) {
            console.error("[avatar] upload failed:", err);
            if (typeof toast === "function") toast("Could not upload photo.");
          }
        });
      }
    } else {
      chip.innerHTML =
        '<a href="login.html" class="auth-chip__link">' +
          '<i class="fas fa-sign-in-alt"></i> Log in' +
        '</a>' +
        '<a href="residents.html" class="auth-chip__link">' +
          '<i class="fas fa-user-plus"></i> Register' +
        '</a>';
    }
  }

  /* ----------------------------------------------------------
     RUN
     ---------------------------------------------------------- */
  function run() {
    if (SKIP_PAGES.includes(currentPage())) {
      console.info("[sidebar] Skipping on " + currentPage());
      return;
    }
    injectSidebar();
    wireSidebar();
    injectAuthChip();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();