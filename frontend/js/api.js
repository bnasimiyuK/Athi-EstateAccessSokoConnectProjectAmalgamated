/* ============================================================
   api.js — thin fetch wrapper around the backend REST API.
   Attaches the JWT (from auth.js) to every request.

   API base URL is auto-discovered at runtime:
     - Desktop browser on localhost  → http://localhost:4050/api
     - Browser on a LAN IP           → http://<same-host>:4050/api
     - Mobile app (Capacitor WebView)→ probes LAN_IP_CANDIDATES
                                       and uses the first that responds.

   🔧 To add more candidate IPs for the mobile app, edit
      LAN_IP_CANDIDATES below. No rebuild needed for IPs
      already in the list.

   🔧 To force a specific IP (skip auto-discovery), set FORCE_LAN_IP
      to a string like "192.168.51.220". Set to null to use discovery.
   ============================================================ */

/* ------------------------------------------------------------
   SETTINGS
   ------------------------------------------------------------ */
const BACKEND_PORT = 4050;

/* Candidate LAN IPs to try from the mobile app.
   2s timeout per probe, all probes run in parallel. The first
   one to respond wins. */
const LAN_IP_CANDIDATES = [
  "192.168.51.220",   /* PC's current IP on Ethernet 3 */
  "192.168.100.5",    /* old Wi-Fi network */
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
  "192.168.51.1",     /* possible gateway on current net */
  "192.168.51.100",
  "10.0.2.2",         /* Android emulator host alias */
  "10.0.3.2",         /* Genymotion host alias */
];

/* Force a specific IP? null = use auto-discovery. */
const FORCE_LAN_IP = null;   // e.g. "192.168.51.220" to pin it


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
  // ---- 1. Mobile app: probe candidates in parallel ----
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

  // ---- 2. Desktop browser: use the hostname we're served from ----
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") {
    return `http://localhost:${BACKEND_PORT}/api`;
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return `http://${host}:${BACKEND_PORT}/api`;
  }

  // ---- 3. Fallback ----
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
   Core request helper — attaches Bearer token if present
   ------------------------------------------------------------ */
async function request(url, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  const token = typeof getToken === "function" ? getToken() : null;
  if (token) {
    headers["Authorization"] = "Bearer " + token;
  }

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

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body.error) message = body.error;
    } catch { /* no JSON body */ }
    throw new Error(message);
  }

  if (res.status === 204) return null;
  return res.json();
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
   Api — every backend endpoint exposed as a method
   ------------------------------------------------------------ */
const Api = {
  /* ---------- Auth ---------- */
  login: (credentials) =>
    request(`${apiBase()}/auth/login`, {
      method: "POST",
      body: JSON.stringify(credentials),
    }),

  registerResident: (data) =>
    request(`${apiBase()}/auth/register-resident`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  me: () => request(`${apiBase()}/auth/me`),

  changePassword: (payload) =>
    request(`${apiBase()}/auth/change-password`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  /* ---------- Admin ---------- */
  getAdminStats: () => request(`${apiBase()}/admin/stats`),
  getAdminDashboard: () => request(`${apiBase()}/admin/dashboard`),

  downloadAdminReport: async (kind) => {
    const token = typeof getToken === "function" ? getToken() : null;
    if (!token) throw new Error("Not logged in.");

    const res = await fetch(`${apiBase()}/admin/export.${kind}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error("Session expired. Please log in again.");
    }
    if (!res.ok) throw new Error(`Export failed (${res.status})`);
    return res.blob();
  },

  /* ---------- Categories ---------- */
  getCategories: () => request(`${apiBase()}/categories`),

  /* ---------- Providers ---------- */
  getProviders: (params = {}) =>
    request(`${apiBase()}/providers${qsOf(params)}`),
  getProvider: (id) =>
    request(`${apiBase()}/providers/${id}`),
  registerProvider: (data) =>
    request(`${apiBase()}/providers`, { method: "POST", body: JSON.stringify(data) }),
  updateProvider: (id, patch) =>
    request(`${apiBase()}/providers/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  removeProvider: (id) =>
    request(`${apiBase()}/providers/${id}`, { method: "DELETE" }),

  /* ---------- Reviews ---------- */
  getReviews: (providerId) =>
    request(`${apiBase()}/reviews/provider/${providerId}`),
  getAllReviews: (params = {}) =>
    request(`${apiBase()}/reviews${qsOf(params)}`),
  addReview: (review) =>
    request(`${apiBase()}/reviews`, { method: "POST", body: JSON.stringify(review) }),
  deleteReview: (id) =>
    request(`${apiBase()}/reviews/${id}`, { method: "DELETE" }),
  updateReview: (id, patch) =>
    request(`${apiBase()}/reviews/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),

  /* ---------- Bookings ---------- */
  getBookings: (params = {}) =>
    request(`${apiBase()}/bookings${qsOf(params)}`),
  addBooking: (booking) =>
    request(`${apiBase()}/bookings`, { method: "POST", body: JSON.stringify(booking) }),
  updateBooking: (id, patch) =>
    request(`${apiBase()}/bookings/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),

  /* ---------- Reports ---------- */
  getReports: (params = {}) =>
    request(`${apiBase()}/reports${qsOf(params)}`),
  addReport: (report) =>
    request(`${apiBase()}/reports`, { method: "POST", body: JSON.stringify(report) }),
  updateReport: (id, patch) =>
    request(`${apiBase()}/reports/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),

  /* ---------- Courts ---------- */
  getCourts: (params = {}) =>
    request(`${apiBase()}/courts${qsOf(params)}`),
  addCourt: (data) =>
    request(`${apiBase()}/courts`, { method: "POST", body: JSON.stringify(data) }),

  /* ---------- Residents ---------- */
  getResidents: (params = {}) =>
    request(`${apiBase()}/residents${qsOf(params)}`),
  getResident: (id) =>
    request(`${apiBase()}/residents/${id}`),
  addResident: (data) =>
    request(`${apiBase()}/residents`, { method: "POST", body: JSON.stringify(data) }),
  updateResident: (id, patch) =>
    request(`${apiBase()}/residents/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  removeResident: (id) =>
    request(`${apiBase()}/residents/${id}`, { method: "DELETE" }),

  /* ---------- Admin exports ---------- */
  downloadResidentsReport: async (kind, params = {}) => {
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
      `${apiBase()}/admin/residents/export.${kind}${qs ? "?" + qs : ""}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (res.status === 401 || res.status === 403) {
      throw new Error("Session expired. Please log in again.");
    }
    if (!res.ok) throw new Error(`Export failed (${res.status})`);
    return res.blob();
  },

  downloadProvidersReport: async (kind, params = {}) => {
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
      `${apiBase()}/admin/providers/export.${kind}${qs ? "?" + qs : ""}`,
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
    request(`${apiBase()}/invoices/settings`),

  getMyInvoices: () =>
    request(`${apiBase()}/invoices/mine`),

  getMyOutstanding: () =>
    request(`${apiBase()}/residents/outstanding`),

  getMyPayments: () =>
    request(`${apiBase()}/payments/mine`),

  selfReportPayment: (payload) =>
    request(`${apiBase()}/payments/self-report`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getInvoices: (params = {}) =>
    request(`${apiBase()}/invoices${qsOf(params)}`),

  getInvoice: (id) =>
    request(`${apiBase()}/invoices/${id}`),

  generateInvoices: (month) =>
    request(`${apiBase()}/invoices/generate`, {
      method: "POST",
      body: JSON.stringify({ month }),
    }),

  markInvoicesOverdue: () =>
    request(`${apiBase()}/invoices/mark-overdue`, { method: "POST" }),

  setInvoiceStatus: (id, status, reason) =>
    request(`${apiBase()}/invoices/${id}/set-status`, {
      method: "POST",
      body: JSON.stringify({ status, reason }),
    }),

  bulkSetInvoiceStatus: (ids, status, reason) =>
    request(`${apiBase()}/invoices/bulk-set-status`, {
      method: "POST",
      body: JSON.stringify({ ids, status, reason }),
    }),

  getPayments: (params = {}) =>
    request(`${apiBase()}/payments${qsOf(params)}`),

  recordManualPayment: (payload) =>
    request(`${apiBase()}/payments/manual`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  verifyPayment: (id) =>
    request(`${apiBase()}/payments/${id}/verify`, { method: "POST" }),

  rejectPayment: (id, reason) =>
    request(`${apiBase()}/payments/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),

  /* ============================================================
     M-PESA STK
     ============================================================ */
  stkPush: (payload) =>
    request(`${apiBase()}/mpesa/stkpush`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  stkQuery: (checkoutRequestId) =>
    request(`${apiBase()}/mpesa/query`, {
      method: "POST",
      body: JSON.stringify({ checkoutRequestId }),
    }),

  payInvoice: (payload) =>
    request(`${apiBase()}/mpesa/pay-invoice`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  payFor: (payload) =>
    request(`${apiBase()}/mpesa/pay-for`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  /* ============================================================
     HOUSE NUMBERS
     ============================================================ */
  getHouseNumberSummary: () =>
    request(`${apiBase()}/house-numbers/summary`),

  getHouseNumberResidents: (params = {}) =>
    request(`${apiBase()}/house-numbers/residents${qsOf(params)}`),

  getHouseNumberProposal: () =>
    request(`${apiBase()}/house-numbers/proposal`),

  setResidentHouseNumber: (id, houseNumber) =>
    request(`${apiBase()}/house-numbers/residents/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ houseNumber }),
    }),

  bulkAssignHouseNumbers: (rows) =>
    request(`${apiBase()}/house-numbers/bulk`, {
      method: "POST",
      body: JSON.stringify({ rows }),
    }),

  getAssignedHouseNumbers: () =>
    request(`${apiBase()}/house-numbers/assigned`),

  /* ============================================================
     VISITORS — resident
     ============================================================ */
  getVisitorConfig: () =>
    request(`${apiBase()}/visitors/config`),

  createVisitorGroup: (payload) =>
    request(`${apiBase()}/visitors`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getMyVisitorGroups: () =>
    request(`${apiBase()}/visitors/mine`),

  cancelVisitorGroup: (id, reason) =>
    request(`${apiBase()}/visitors/${id}/cancel`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),

  /* ============================================================
     VISITORS — admin + security
     ============================================================ */
  getVisitorPendingAdmin: (params = {}) =>
    request(`${apiBase()}/visitors/pending-admin${qsOf(params)}`),

  getVisitorPendingSecurity: (params = {}) =>
    request(`${apiBase()}/visitors/pending-security${qsOf(params)}`),

  getVisitorPendingCounts: () =>
    request(`${apiBase()}/visitors/pending-counts`),

  getVisitorGroups: (params = {}) =>
    request(`${apiBase()}/visitors${qsOf(params)}`),

  getVisitorGroup: (id) =>
    request(`${apiBase()}/visitors/${id}`),

  approveVisitorAdmin: (id) =>
    request(`${apiBase()}/visitors/${id}/approve-admin`, { method: "POST" }),

  approveVisitorSecurity: (id) =>
    request(`${apiBase()}/visitors/${id}/approve-security`, { method: "POST" }),

  denyVisitor: (id, reason) =>
    request(`${apiBase()}/visitors/${id}/deny`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),

  /* ---------- Bulk approval ---------- */
  bulkApproveAdmin: (groupIds) =>
    request(`${apiBase()}/visitors/bulk-approve-admin`, {
      method: "POST",
      body: JSON.stringify({ groupIds }),
    }),

  bulkApproveAllAdmin: (confirm, max) =>
    request(`${apiBase()}/visitors/bulk-approve-all-admin`, {
      method: "POST",
      body: JSON.stringify({ confirm, max }),
    }),

  bulkApproveSecurity: (groupIds) =>
    request(`${apiBase()}/visitors/bulk-approve-security`, {
      method: "POST",
      body: JSON.stringify({ groupIds }),
    }),

  bulkApproveAllSecurity: (confirm, max) =>
    request(`${apiBase()}/visitors/bulk-approve-all-security`, {
      method: "POST",
      body: JSON.stringify({ confirm, max }),
    }),

  bulkDenyVisitors: (groupIds, reason) =>
    request(`${apiBase()}/visitors/bulk-deny`, {
      method: "POST",
      body: JSON.stringify({ groupIds, reason }),
    }),

  /* ---------- Gate ---------- */
  getVisitorRegister: (date) =>
    request(`${apiBase()}/visitors/register${qsOf({ date })}`),

  checkinVisitor: (payload) =>
    request(`${apiBase()}/visitors/checkin`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  checkoutVisitor: (payload) =>
    request(`${apiBase()}/visitors/checkout`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getVisitorAnalytics: (params = {}) =>
    request(`${apiBase()}/visitors/analytics${qsOf(params)}`),

  getVisitorLiveStats: () =>
    request(`${apiBase()}/visitors/live-stats`),

  /* ---------- Avatar ---------- */
  async uploadAvatar(formData) {
    const token = typeof getToken === "function" ? getToken() : null;
    const headers = {};
    if (token) headers.Authorization = "Bearer " + token;
    const res = await fetch(apiBase() + "/auth/me/avatar", {
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
  getCategoryCounts: () => request(`${apiBase()}/categories/counts`),
  getPhaseRange:     () => request(`${apiBase()}/phase-range`),
  getNotice:         () => request(`${apiBase()}/notice`),
  getGateStatus:     () => request(`${apiBase()}/gate/status`),
  getLastSync:       () => request(`${apiBase()}/last-sync`),
  getGateRules:      () => request(`${apiBase()}/gate/rules`),

  /* ============================================================
     NOTICE BOARD (CRUD)
     ============================================================ */
  getNotices: (params = {}) =>
    request(`${apiBase()}/notices${qsOf(params)}`),

  getNoticeById: (id) =>
    request(`${apiBase()}/notices/${id}`),

  createNotice: (payload) =>
    request(`${apiBase()}/notices`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  updateNotice: (id, patch) =>
    request(`${apiBase()}/notices/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  deleteNotice: (id) =>
    request(`${apiBase()}/notices/${id}`, { method: "DELETE" }),
};