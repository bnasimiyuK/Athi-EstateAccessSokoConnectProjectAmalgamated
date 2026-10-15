/* ============================================================
   api.js — thin fetch wrapper around the backend REST API.
   Attaches the JWT (from auth.js) to every request.

   API base URL is auto-discovered at runtime:
     - Desktop browser on localhost  → http://localhost:4050/api
     - Browser on a LAN IP           → http://<same-host>:4050/api
     - Mobile app (Capacitor WebView)→ probes LAN_IP_CANDIDATES
                                       and uses the first that responds.
     - Cloudflare Tunnel             → uses FORCE_API_BASE or localStorage override

   🔧 To override the API base without editing this file (useful for changing
      Cloudflare tunnel URLs), open your browser console and run:
      localStorage.setItem('FORCE_API_BASE', 'https://your-new-url.trycloudflare.com/api')
      Then refresh the page.

   🔧 To add more candidate IPs for the mobile app, edit
      LAN_IP_CANDIDATES below. No rebuild needed for IPs
      already in the list.
   ============================================================ */

/* ------------------------------------------------------------
   SETTINGS
   ------------------------------------------------------------ */
const BACKEND_PORT = 4050;

/* Public tunnel URL — used when the page is not served from localhost/LAN.
   Regenerate when cloudflared restarts (each restart gives a new URL). 
   Can also be overridden via localStorage as noted above. */
const FORCE_API_BASE = "https://informative-mercury-sonic-gifts.trycloudflare.com/api";

/* Candidate LAN IPs to try from the mobile app.
   2s timeout per probe, all probes run in parallel. The first
   one to respond wins. */
const LAN_IP_CANDIDATES = [
  "192.168.100.5",    /* PC on Wi-Fi — current */
  "192.168.51.220",   /* PC on Ethernet 3 — previous */
  "192.168.100.6",
  "192.168.100.7",
  "192.168.100.8",
  "192.168.100.9",
  "192.168.100.10",
  "192.168.100.11",
  "192.168.100.12",
  "192.168.100.15",
  "192.168.100.20",
  "192.168.100.25",
  "192.168.100.50",
  "192.168.0.100",
  "192.168.1.100",
  "192.168.51.1",
  "192.168.51.100",
  "10.0.2.2",
  "10.0.3.2",
];

/* Force a specific IP? null = use auto-discovery. */
const FORCE_LAN_IP = null;   // e.g. "192.168.100.5" to pin it

/* ------------------------------------------------------------
   Detect if we're running inside the Capacitor mobile shell
   ------------------------------------------------------------ */
function isMobileApp() {
  const protocol = window.location.protocol;
  const ua       = navigator.userAgent || "";
  return (
    protocol === "capacitor:" ||
    protocol === "ionic:" ||
    /; wv\)/.test(ua)
  );
}

/* ------------------------------------------------------------
   Probe one candidate IP — resolves to the API base if reachable,
   otherwise resolves to null.
   ------------------------------------------------------------ */
async function probeOne(ip) {
  const base = `http://${ip}:${BACKEND_PORT}/api`;
  try {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2000);
    const res   = await fetch(`${base}/categories`, {
      method: "GET",
      cache: "no-store",
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    return res.ok ? base : null;
  } catch (_) {
    return null;
  }
}

/* ------------------------------------------------------------
   Inner probe function — named differently from the public
   window.discoverApiBase() to avoid self-recursion.
   ------------------------------------------------------------ */
async function _probeDiscoverApiBase() {
  // 1. Check localStorage override first (great for changing Cloudflare tunnels)
  const localOverride = localStorage.getItem('FORCE_API_BASE');
  if (localOverride) {
    console.log("[api] Using localStorage FORCE_API_BASE override:", localOverride);
    return localOverride;
  }

  // 2. If a public tunnel URL is configured in code, use it for ALL hosts
  if (typeof FORCE_API_BASE === "string" && FORCE_API_BASE) {
    return FORCE_API_BASE;
  }

  // 3. Mobile app: probe candidates in parallel
  if (isMobileApp()) {
    if (FORCE_LAN_IP) {
      return `http://${FORCE_LAN_IP}:${BACKEND_PORT}/api`;
    }

    console.log("[api] mobile app detected — probing", LAN_IP_CANDIDATES.length, "candidates");

    const results = await Promise.all(LAN_IP_CANDIDATES.map(probeOne));
    const firstOk = results.find((u) => u);
    if (firstOk) {
      console.log("[api] discovered backend at:", firstOk);
      return firstOk;
    }

    console.warn("[api] no candidate responded; falling back to", LAN_IP_CANDIDATES[0]);
    return `http://${LAN_IP_CANDIDATES[0]}:${BACKEND_PORT}/api`;
  }

  // 4. Desktop browser: use the hostname we're served from
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") {
    return `http://localhost:${BACKEND_PORT}/api`;
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return `http://${host}:${BACKEND_PORT}/api`;
  }

  // 5. Fallback
  return `http://${LAN_IP_CANDIDATES[0]}:${BACKEND_PORT}/api`;
}

/* ------------------------------------------------------------
   Public API base state. `apiBase()` reads the resolved value;
   `window.discoverApiBase()` resolves it once and caches.
   ------------------------------------------------------------ */
let _apiBase         = null;
let _apiReadyPromise = null;

function apiBase() {
  if (!_apiBase) {
    throw new Error(
      "API base not resolved yet. Make sure to await window.discoverApiBase() " +
      "before calling any Api.* method."
    );
  }
  return _apiBase;
}

window.discoverApiBase = function () {
  if (_apiReadyPromise) return _apiReadyPromise;

  _apiReadyPromise = (async () => {
    try {
      _apiBase = await _probeDiscoverApiBase();
    } catch (err) {
      console.error("[api] discovery failed:", err);
      _apiBase = `http://${LAN_IP_CANDIDATES[0]}:${BACKEND_PORT}/api`;
    }
    console.log("[api] API_BASE resolved to:", _apiBase);
    console.log("[api] protocol:", window.location.protocol,
                "| host:", window.location.hostname);
    return _apiBase;
  })();

  return _apiReadyPromise;
};

/* Kick off discovery immediately. */
window.discoverApiBase();

/* ------------------------------------------------------------
   Debug flag — set to false once things are stable
   ------------------------------------------------------------ */
const API_DEBUG = true;

function apiLog(...args) {
  if (API_DEBUG) console.log("[api]", ...args);
}
function apiWarn(...args) {
  if (API_DEBUG) console.warn("[api]", ...args);
}

/* ------------------------------------------------------------
   Decode the JWT payload (no verification, client-side only)
   ------------------------------------------------------------ */
function apiDecodeToken(token) {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------
   Preflight: is the token present AND not obviously expired?
   ------------------------------------------------------------ */
function apiTokenStatus() {
  const token = typeof getToken === "function" ? getToken() : null;
  if (!token) return { ok: false, reason: "no-token" };

  const payload = apiDecodeToken(token);
  if (!payload) return { ok: false, reason: "malformed" };

  if (payload.exp && payload.exp * 1000 < Date.now()) {
    return { ok: false, reason: "expired", payload };
  }
  return { ok: true, payload };
}

/* ------------------------------------------------------------
   Core request helper - attaches Bearer token if present.
   Now accepts a PATH (e.g. '/notices') instead of a full URL.
   ------------------------------------------------------------ */
async function request(path, options = {}) {
  // Ensure the base URL is resolved before we build the final URL
  const base = await window.discoverApiBase();
  const url = `${base}${path}`;

  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  const token = typeof getToken === "function" ? getToken() : null;
  if (token) {
    headers["Authorization"] = "Bearer " + token;
  }
  // Removed the noisy "No token available" warning here. 
  // Public endpoints are fine without tokens. If a protected endpoint is hit,
  // the 401 handler below will catch it and log properly.

  let res;
  try {
    res = await fetch(url, { ...options, headers });
  } catch (err) {
    const el = document.createElement("div");
    el.style.cssText =
      "position:fixed;top:0;left:0;right:0;background:#b00;color:#fff;" +
      "padding:12px;font-size:12px;z-index:99999;white-space:pre-wrap;" +
      "font-family:monospace;line-height:1.4;";
    el.textContent =
      "FETCH FAILED\n" +
      "URL: " + url + "\n" +
      "Error: " + err.message + "\n" +
      "Page origin: " + window.location.origin + "\n" +
      "Page protocol: " + window.location.protocol + "\n" +
      "UA: " + navigator.userAgent.slice(0, 90);
    document.body.appendChild(el);
    throw err;
  }

  // ---- Success ----
  if (res.ok) {
    if (res.status === 204) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("application/json")) return null;
    return res.json();
  }

  // ---- Error ----
  let message = `Request failed (${res.status})`;
  let bodyText = "";
  try {
    bodyText = await res.text();
    if (bodyText) {
      try {
        const body = JSON.parse(bodyText);
        if (body && body.error) message = body.error;
        else if (body && body.message) message = body.message;
      } catch {
        if (bodyText.length < 200) message = bodyText;
      }
    }
  } catch { /* ignore */ }

  console.error("[api] request failed:", {
    url,
    method: options.method || "GET",
    status: res.status,
    statusText: res.statusText,
    body: bodyText,
  });

  if (res.status === 401) {
    const status = apiTokenStatus();
    if (status.reason === "expired") {
      message = "Your session has expired. Please log in again.";
    } else if (status.reason === "malformed" || status.reason === "no-token") {
      message = "You are not logged in.";
    }
    if (typeof logout === "function") {
      apiWarn("401 received — logging out");
      setTimeout(() => logout(), 50);
    }
    const err = new Error(message);
    err.status = 401;
    throw err;
  }

  if (res.status === 403) {
    const status = apiTokenStatus();
    const role = status.payload?.role || "unknown";
    console.error(
      `[api] 403 Forbidden on ${options.method || "GET"} ${url}\n` +
      `  Your role: ${role}\n` +
      `  Token valid: ${status.ok ? "yes" : "no (" + status.reason + ")"}\n` +
      `  → Check the backend's requireRole() on this route.`
    );
    message = "You do not have permission for this action.";
    const err = new Error(message);
    err.status = 403;
    throw err;
  }

  if (res.status === 404) {
    const err = new Error(message || "Not found.");
    err.status = 404;
    throw err;
  }

  const err = new Error(message);
  err.status = res.status;
  throw err;
}

/* ------------------------------------------------------------
   Helper: strip empty params and build a query string
   ------------------------------------------------------------ */
function qsOf(params = {}) {
  const clean = Object.fromEntries(
    Object.entries(params).filter(
      ([, v]) => v !== "" && v !== undefined && v !== null
    )
  );
  const qs = new URLSearchParams(clean).toString();
  return qs ? "?" + qs : "";
}

/* ------------------------------------------------------------
   Helper: safely unwrap an envelope OR plain array
   ------------------------------------------------------------ */
function unwrapList(result) {
  if (Array.isArray(result)) return result;
  if (!result) return [];
  if (Array.isArray(result.data))    return result.data;
  if (Array.isArray(result.items))   return result.items;
  if (Array.isArray(result.rows))    return result.rows;
  if (Array.isArray(result.results)) return result.results;
  return [];
}

/* ============================================================
   Api - every backend endpoint exposed as a method.
   Note: Paths are now passed directly (e.g., `/auth/login`).
   ============================================================ */
const Api = {
  /* ---------- Auth ---------- */
  login: (credentials) =>
    request(`/auth/login`, {
      method: "POST",
      body: JSON.stringify(credentials),
    }),

  registerResident: (data) =>
    request(`/auth/register-resident`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  me: () => request(`/auth/me`),

  changePassword: (payload) =>
    request(`/auth/change-password`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  /* ---------- Announcements ---------- */
  getAnnouncements: (params = {}) =>
    request(`/announcements${qsOf(params)}`),

  createAnnouncement: (payload) =>
    request(`/announcements`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  deleteAnnouncement: (id) =>
    request(`/announcements/${id}`, { method: "DELETE" }),

  updateAnnouncement: (id, patch) =>
    request(`/announcements/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  /* ---------- Admin ---------- */
  getAdminStats: () => request(`/admin/stats`),
  getAdminDashboard: () => request(`/admin/dashboard`),

  downloadAdminReport: async (kind) => {
    const base = await window.discoverApiBase();
    const token = typeof getToken === "function" ? getToken() : null;
    if (!token) throw new Error("Not logged in.");

    const res = await fetch(`${base}/admin/export.${kind}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error("Session expired. Please log in again.");
    }
    if (!res.ok) throw new Error(`Export failed (${res.status})`);
    return res.blob();
  },

  /* ---------- Categories ---------- */
  getCategories: () => request(`/categories`),

  /* ---------- Providers ---------- */
  getProviders: (params = {}) =>
    request(`/providers${qsOf(params)}`),
  getProvider: (id) =>
    request(`/providers/${id}`),
  registerProvider: (data) =>
    request(`/providers`, { method: "POST", body: JSON.stringify(data) }),
  updateProvider: (id, patch) =>
    request(`/providers/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  removeProvider: (id) =>
    request(`/providers/${id}`, { method: "DELETE" }),

  /* ---------- Reviews ---------- */
  getReviews: (providerId) =>
    request(`/reviews/provider/${providerId}`),
  getAllReviews: (params = {}) =>
    request(`/reviews${qsOf(params)}`),
  addReview: (review) =>
    request(`/reviews`, { method: "POST", body: JSON.stringify(review) }),
  deleteReview: (id) =>
    request(`/reviews/${id}`, { method: "DELETE" }),
  updateReview: (id, patch) =>
    request(`/reviews/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),

  /* ---------- Bookings ---------- */
  getBookings: (params = {}) =>
    request(`/bookings${qsOf(params)}`),
  addBooking: (booking) =>
    request(`/bookings`, { method: "POST", body: JSON.stringify(booking) }),
  updateBooking: (id, patch) =>
    request(`/bookings/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),

  /* ---------- Reports ---------- */
  getReports: (params = {}) =>
    request(`/reports${qsOf(params)}`),
  addReport: (report) =>
    request(`/reports`, { method: "POST", body: JSON.stringify(report) }),
  updateReport: (id, patch) =>
    request(`/reports/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),

  /* ---------- Courts ---------- */
  getCourts: (params = {}) =>
    request(`/courts${qsOf(params)}`),
  addCourt: (data) =>
    request(`/courts`, { method: "POST", body: JSON.stringify(data) }),

  /* ---------- Residents ---------- */
  getResidents: (params = {}) =>
    request(`/residents${qsOf(params)}`),
  getResident: (id) =>
    request(`/residents/${id}`),
  addResident: (data) =>
    request(`/residents`, { method: "POST", body: JSON.stringify(data) }),
  updateResident: (id, patch) =>
    request(`/residents/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  removeResident: (id) =>
    request(`/residents/${id}`, { method: "DELETE" }),

  /* ---------- Admin exports ---------- */
  downloadResidentsReport: async (kind, params = {}) => {
    const base = await window.discoverApiBase();
    const token = typeof getToken === "function" ? getToken() : null;
    if (!token) throw new Error("Not logged in.");

    const qs = new URLSearchParams(
      Object.fromEntries(
        Object.entries({ verified: "true", ...params }).filter(
          ([, v]) => v !== "" && v !== undefined && v !== null
        )
      )
    ).toString();

    const res = await fetch(
      `${base}/admin/residents/export.${kind}${qs ? "?" + qs : ""}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (res.status === 401 || res.status === 403) {
      throw new Error("Session expired. Please log in again.");
    }
    if (!res.ok) throw new Error(`Export failed (${res.status})`);
    return res.blob();
  },

  downloadProvidersReport: async (kind, params = {}) => {
    const base = await window.discoverApiBase();
    const token = typeof getToken === "function" ? getToken() : null;
    if (!token) throw new Error("Not logged in.");

    const qs = new URLSearchParams(
      Object.fromEntries(
        Object.entries(params).filter(
          ([, v]) => v !== "" && v !== undefined && v !== null
        )
      )
    ).toString();

    const res = await fetch(
      `${base}/admin/providers/export.${kind}${qs ? "?" + qs : ""}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (res.status === 401 || res.status === 403) {
      throw new Error("Session expired. Please log in again.");
    }
    if (!res.ok) throw new Error(`Export failed (${res.status})`);
    return res.blob();
  },

  /* ============================================================
     BILLING
     ============================================================ */
  getBillingSettings: () =>
    request(`/invoices/settings`),

  getMyInvoices: () =>
    request(`/invoices/mine`),

  getMyOutstanding: () =>
    request(`/residents/outstanding`),

  getMyPayments: () =>
    request(`/payments/mine`),

  selfReportPayment: (payload) =>
    request(`/payments/self-report`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getInvoices: (params = {}) =>
    request(`/invoices${qsOf(params)}`),

  getInvoice: (id) =>
    request(`/invoices/${id}`),

  generateInvoices: (month) =>
    request(`/invoices/generate`, {
      method: "POST",
      body: JSON.stringify({ month }),
    }),

  markInvoicesOverdue: () =>
    request(`/invoices/mark-overdue`, { method: "POST" }),

  setInvoiceStatus: (id, status, reason) =>
    request(`/invoices/${id}/set-status`, {
      method: "POST",
      body: JSON.stringify({ status, reason }),
    }),

  bulkSetInvoiceStatus: (ids, status, reason) =>
    request(`/invoices/bulk-set-status`, {
      method: "POST",
      body: JSON.stringify({ ids, status, reason }),
    }),

  getPayments: (params = {}) =>
    request(`/payments${qsOf(params)}`),

  recordManualPayment: (payload) =>
    request(`/payments/manual`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  verifyPayment: (id) =>
    request(`/payments/${id}/verify`, { method: "POST" }),

  rejectPayment: (id, reason) =>
    request(`/payments/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),

  /* ============================================================
     M-PESA STK
     ============================================================ */
  stkPush: (payload) =>
    request(`/mpesa/stkpush`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  stkQuery: (checkoutRequestId) =>
    request(`/mpesa/query`, {
      method: "POST",
      body: JSON.stringify({ checkoutRequestId }),
    }),

  payInvoice: (payload) =>
    request(`/mpesa/pay-invoice`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  payFor: (payload) =>
    request(`/mpesa/pay-for`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  /* ============================================================
     HOUSE NUMBERS
     ============================================================ */
  getHouseNumberSummary: () =>
    request(`/house-numbers/summary`),

  getHouseNumberResidents: (params = {}) =>
    request(`/house-numbers/residents${qsOf(params)}`),

  getHouseNumberProposal: () =>
    request(`/house-numbers/proposal`),

  setResidentHouseNumber: (id, houseNumber) =>
    request(`/house-numbers/residents/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ houseNumber }),
    }),

  bulkAssignHouseNumbers: (rows) =>
    request(`/house-numbers/bulk`, {
      method: "POST",
      body: JSON.stringify({ rows }),
    }),

  getAssignedHouseNumbers: () =>
    request(`/house-numbers/assigned`),

  /* ============================================================
     VISITORS — resident
     ============================================================ */
  getVisitorConfig: () =>
    request(`/visitors/config`),

  createVisitorGroup: (payload) =>
    request(`/visitors`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getMyVisitorGroups: () =>
    request(`/visitors/mine`),

  cancelVisitorGroup: (id, reason) =>
    request(`/visitors/${id}/cancel`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),

  /* ============================================================
     VISITORS — admin + security
     ============================================================ */
  getVisitorPendingAdmin: (params = {}) =>
    request(`/visitors/pending-admin${qsOf(params)}`),

  getVisitorPendingSecurity: (params = {}) =>
    request(`/visitors/pending-security${qsOf(params)}`),

  getVisitorPendingCounts: () =>
    request(`/visitors/pending-counts`),

  getVisitorGroups: (params = {}) =>
    request(`/visitors${qsOf(params)}`),

  getVisitorGroup: (id) =>
    request(`/visitors/${id}`),

  approveVisitorAdmin: (id) =>
    request(`/visitors/${id}/approve-admin`, { method: "POST" }),

  approveVisitorSecurity: (id) =>
    request(`/visitors/${id}/approve-security`, { method: "POST" }),

  denyVisitor: (id, reason) =>
    request(`/visitors/${id}/deny`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),

  /* ---------- Bulk approval ---------- */
  bulkApproveAdmin: (groupIds) =>
    request(`/visitors/bulk-approve-admin`, {
      method: "POST",
      body: JSON.stringify({ groupIds }),
    }),

  bulkApproveAllAdmin: (confirm, max) =>
    request(`/visitors/bulk-approve-all-admin`, {
      method: "POST",
      body: JSON.stringify({ confirm, max }),
    }),

  bulkApproveSecurity: (groupIds) =>
    request(`/visitors/bulk-approve-security`, {
      method: "POST",
      body: JSON.stringify({ groupIds }),
    }),

  bulkApproveAllSecurity: (confirm, max) =>
    request(`/visitors/bulk-approve-all-security`, {
      method: "POST",
      body: JSON.stringify({ confirm, max }),
    }),

  bulkDenyVisitors: (groupIds, reason) =>
    request(`/visitors/bulk-deny`, {
      method: "POST",
      body: JSON.stringify({ groupIds, reason }),
    }),

  /* ---------- Gate ---------- */
  getVisitorRegister: (date) =>
    request(`/visitors/register${qsOf({ date })}`),

  checkinVisitor: (payload) =>
    request(`/visitors/checkin`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  checkoutVisitor: (payload) =>
    request(`/visitors/checkout`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getVisitorAnalytics: (params = {}) =>
    request(`/visitors/analytics${qsOf(params)}`),

  getVisitorLiveStats: () =>
    request(`/visitors/live-stats`),

  /* ---------- Avatar ---------- */
  async uploadAvatar(formData) {
    const base = await window.discoverApiBase();
    const token = typeof getToken === "function" ? getToken() : null;
    const headers = {};
    if (token) headers.Authorization = "Bearer " + token;
    const res = await fetch(`${base}/auth/me/avatar`, {
      method: "POST",
      headers,
      body: formData,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error("Upload failed: " + res.status + " " + t);
    }
    return res.json();
  },

  /* ============================================================
     DISCOVER-PAGE ENDPOINTS
     ============================================================ */
  getCategoryCounts: () => request(`/categories/counts`),
  getPhaseRange:     () => request(`/phase-range`),
  getNotice:         () => request(`/notice`),
  getGateStatus:     () => request(`/gate/status`),
  getLastSync:       () => request(`/last-sync`),
  getGateRules:      () => request(`/gate/rules`),

  /* ============================================================
     NOTICE BOARD (CRUD)
     ============================================================ */
  getNotices: (params = {}) =>
    request(`/notices${qsOf(params)}`),

  getNoticeById: (id) =>
    request(`/notices/${id}`),

  createNotice: (payload) =>
    request(`/notices`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  updateNotice: (id, patch) =>
    request(`/notices/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  deleteNotice: (id) =>
    request(`/notices/${id}`, { method: "DELETE" }),
};