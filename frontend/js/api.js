/* ============================================================
   api.js — thin fetch wrapper around the backend REST API.
   Now attaches the JWT (from auth.js) to every request.

   API base URL is resolved dynamically:
     - Browser running at localhost         → http://localhost:4050/api
     - Browser running at LAN IP (192.168..) → http://<same-host>:4050/api
     - Capacitor mobile app (capacitor://)   → falls back to LAN IP

   🔧 TO CHANGE THE LAN IP, EDIT THE `LAN_IP` CONSTANT BELOW.
   ============================================================ */

/* ------------------------------------------------------------
   SETTINGS — edit these two values if your network changes
   ------------------------------------------------------------ */
const BACKEND_PORT = 4050;
const LAN_IP       = "192.168.100.5";   // ← your PC's LAN IP

/* ------------------------------------------------------------
   Resolve API base at runtime
   ------------------------------------------------------------ */
const API_BASE = (() => {
  const protocol = window.location.protocol;
  const host     = window.location.hostname;

  // Capacitor mobile app — runs inside a WebView with a special protocol
  // (capacitor://localhost on iOS, http://localhost on Android)
  // In this case, window.location.hostname is "localhost" but we're on a device,
  // so we must use the LAN_IP.
  // Capacitor on Android (v3+) serves the app from https://localhost.
  // Detect: we're loaded over HTTPS on "localhost" → we're in the app.
  if (
    protocol === "capacitor:" ||
    protocol === "ionic:" ||
    (protocol === "https:" && host === "localhost")
  ) {
    return `http://${LAN_IP}:${BACKEND_PORT}/api`;
  }

  // Browser on PC → use localhost
  if (host === "localhost" || host === "127.0.0.1") {
    return `http://localhost:${BACKEND_PORT}/api`;
  }

  // Browser on LAN IP → use the same host
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return `http://${host}:${BACKEND_PORT}/api`;
  }

  return `http://${LAN_IP}:${BACKEND_PORT}/api`;
})();

// Log it once for debugging
console.log("[api] API_BASE resolved to:", API_BASE);

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

  const res = await fetch(url, { ...options, headers });

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
    request(`${API_BASE}/auth/login`, {
      method: "POST",
      body: JSON.stringify(credentials),
    }),

  registerResident: (data) =>
    request(`${API_BASE}/auth/register-resident`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  me: () => request(`${API_BASE}/auth/me`),

  changePassword: (payload) =>
    request(`${API_BASE}/auth/change-password`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  /* ---------- Admin ---------- */
  getAdminStats: () => request(`${API_BASE}/admin/stats`),
  getAdminDashboard: () => request(`${API_BASE}/admin/dashboard`),

  downloadAdminReport: async (kind) => {
    const token = typeof getToken === "function" ? getToken() : null;
    if (!token) throw new Error("Not logged in.");

    const res = await fetch(`${API_BASE}/admin/export.${kind}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error("Session expired. Please log in again.");
    }
    if (!res.ok) throw new Error(`Export failed (${res.status})`);
    return res.blob();
  },

  /* ---------- Categories ---------- */
  getCategories: () => request(`${API_BASE}/categories`),

  /* ---------- Providers ---------- */
  getProviders: (params = {}) =>
    request(`${API_BASE}/providers${qsOf(params)}`),
  getProvider: (id) =>
    request(`${API_BASE}/providers/${id}`),
  registerProvider: (data) =>
    request(`${API_BASE}/providers`, { method: "POST", body: JSON.stringify(data) }),
  updateProvider: (id, patch) =>
    request(`${API_BASE}/providers/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  removeProvider: (id) =>
    request(`${API_BASE}/providers/${id}`, { method: "DELETE" }),

  /* ---------- Reviews ---------- */
  getReviews: (providerId) =>
    request(`${API_BASE}/reviews/provider/${providerId}`),
  getAllReviews: (params = {}) =>
    request(`${API_BASE}/reviews${qsOf(params)}`),
  addReview: (review) =>
    request(`${API_BASE}/reviews`, { method: "POST", body: JSON.stringify(review) }),
  deleteReview: (id) =>
    request(`${API_BASE}/reviews/${id}`, { method: "DELETE" }),
  updateReview: (id, patch) =>
    request(`${API_BASE}/reviews/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),

  /* ---------- Bookings ---------- */
  getBookings: (params = {}) =>
    request(`${API_BASE}/bookings${qsOf(params)}`),
  addBooking: (booking) =>
    request(`${API_BASE}/bookings`, { method: "POST", body: JSON.stringify(booking) }),
  updateBooking: (id, patch) =>
    request(`${API_BASE}/bookings/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),

  /* ---------- Reports ---------- */
  getReports: (params = {}) =>
    request(`${API_BASE}/reports${qsOf(params)}`),
  addReport: (report) =>
    request(`${API_BASE}/reports`, { method: "POST", body: JSON.stringify(report) }),
  updateReport: (id, patch) =>
    request(`${API_BASE}/reports/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),

  /* ---------- Courts ---------- */
  getCourts: (params = {}) =>
    request(`${API_BASE}/courts${qsOf(params)}`),
  addCourt: (data) =>
    request(`${API_BASE}/courts`, { method: "POST", body: JSON.stringify(data) }),

  /* ---------- Residents ---------- */
  getResidents: (params = {}) =>
    request(`${API_BASE}/residents${qsOf(params)}`),
  getResident: (id) =>
    request(`${API_BASE}/residents/${id}`),
  addResident: (data) =>
    request(`${API_BASE}/residents`, { method: "POST", body: JSON.stringify(data) }),
  updateResident: (id, patch) =>
    request(`${API_BASE}/residents/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  removeResident: (id) =>
    request(`${API_BASE}/residents/${id}`, { method: "DELETE" }),

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
      `${API_BASE}/admin/residents/export.${kind}${qs ? "?" + qs : ""}`,
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
      `${API_BASE}/admin/providers/export.${kind}${qs ? "?" + qs : ""}`,
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
    request(`${API_BASE}/invoices/settings`),

  getMyInvoices: () =>
    request(`${API_BASE}/invoices/mine`),
    getMyOutstanding: () =>
    request(`${API_BASE}/residents/outstanding`),

  getMyPayments: () =>
    request(`${API_BASE}/payments/mine`),

  selfReportPayment: (payload) =>
    request(`${API_BASE}/payments/self-report`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getInvoices: (params = {}) =>
    request(`${API_BASE}/invoices${qsOf(params)}`),

  getInvoice: (id) =>
    request(`${API_BASE}/invoices/${id}`),

  generateInvoices: (month) =>
    request(`${API_BASE}/invoices/generate`, {
      method: "POST",
      body: JSON.stringify({ month }),
    }),

  markInvoicesOverdue: () =>
    request(`${API_BASE}/invoices/mark-overdue`, { method: "POST" }),

  getPayments: (params = {}) =>
    request(`${API_BASE}/payments${qsOf(params)}`),

  recordManualPayment: (payload) =>
    request(`${API_BASE}/payments/manual`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  verifyPayment: (id) =>
    request(`${API_BASE}/payments/${id}/verify`, { method: "POST" }),

  rejectPayment: (id, reason) =>
    request(`${API_BASE}/payments/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),

  /* ============================================================
     M-PESA STK
     ============================================================ */
  stkPush: (payload) =>
    request(`${API_BASE}/mpesa/stkpush`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  stkQuery: (checkoutRequestId) =>
    request(`${API_BASE}/mpesa/query`, {
      method: "POST",
      body: JSON.stringify({ checkoutRequestId }),
    }),

  payInvoice: (payload) =>
    request(`${API_BASE}/mpesa/pay-invoice`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  payFor: (payload) =>
    request(`${API_BASE}/mpesa/pay-for`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  /* ============================================================
     HOUSE NUMBERS
     ============================================================ */
  getHouseNumberSummary: () =>
    request(`${API_BASE}/house-numbers/summary`),

  getHouseNumberResidents: (params = {}) =>
    request(`${API_BASE}/house-numbers/residents${qsOf(params)}`),

  getHouseNumberProposal: () =>
    request(`${API_BASE}/house-numbers/proposal`),

  setResidentHouseNumber: (id, houseNumber) =>
    request(`${API_BASE}/house-numbers/residents/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ houseNumber }),
    }),

  bulkAssignHouseNumbers: (rows) =>
    request(`${API_BASE}/house-numbers/bulk`, {
      method: "POST",
      body: JSON.stringify({ rows }),
    }),

  getAssignedHouseNumbers: () =>
    request(`${API_BASE}/house-numbers/assigned`),
  
  /* ============================================================
     VISITORS — resident
     ============================================================ */
  getVisitorConfig: () =>
    request(`${API_BASE}/visitors/config`),

  createVisitorGroup: (payload) =>
    request(`${API_BASE}/visitors`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getMyVisitorGroups: () =>
    request(`${API_BASE}/visitors/mine`),

  cancelVisitorGroup: (id, reason) =>
    request(`${API_BASE}/visitors/${id}/cancel`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),

  /* ============================================================
     VISITORS — admin + security
     ============================================================ */
  getVisitorPendingAdmin: (params = {}) =>
    request(`${API_BASE}/visitors/pending-admin${qsOf(params)}`),

  getVisitorPendingSecurity: (params = {}) =>
    request(`${API_BASE}/visitors/pending-security${qsOf(params)}`),

  getVisitorPendingCounts: () =>
    request(`${API_BASE}/visitors/pending-counts`),

  getVisitorGroups: (params = {}) =>
    request(`${API_BASE}/visitors${qsOf(params)}`),

  getVisitorGroup: (id) =>
    request(`${API_BASE}/visitors/${id}`),

  approveVisitorAdmin: (id) =>
    request(`${API_BASE}/visitors/${id}/approve-admin`, { method: "POST" }),

  approveVisitorSecurity: (id) =>
    request(`${API_BASE}/visitors/${id}/approve-security`, { method: "POST" }),

  denyVisitor: (id, reason) =>
    request(`${API_BASE}/visitors/${id}/deny`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),

  /* ---------- Bulk approval ---------- */
  bulkApproveAdmin: (groupIds) =>
    request(`${API_BASE}/visitors/bulk-approve-admin`, {
      method: "POST",
      body: JSON.stringify({ groupIds }),
    }),

  bulkApproveAllAdmin: (confirm, max) =>
    request(`${API_BASE}/visitors/bulk-approve-all-admin`, {
      method: "POST",
      body: JSON.stringify({ confirm, max }),
    }),

  bulkApproveSecurity: (groupIds) =>
    request(`${API_BASE}/visitors/bulk-approve-security`, {
      method: "POST",
      body: JSON.stringify({ groupIds }),
    }),

  bulkApproveAllSecurity: (confirm, max) =>
    request(`${API_BASE}/visitors/bulk-approve-all-security`, {
      method: "POST",
      body: JSON.stringify({ confirm, max }),
    }),

  bulkDenyVisitors: (groupIds, reason) =>
    request(`${API_BASE}/visitors/bulk-deny`, {
      method: "POST",
      body: JSON.stringify({ groupIds, reason }),
    }),

  /* ---------- Gate ---------- */
  getVisitorRegister: (date) =>
    request(`${API_BASE}/visitors/register${qsOf({ date })}`),

  checkinVisitor: (payload) =>
    request(`${API_BASE}/visitors/checkin`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  checkoutVisitor: (payload) =>
    request(`${API_BASE}/visitors/checkout`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getVisitorAnalytics: (params = {}) =>
    request(`${API_BASE}/visitors/analytics${qsOf(params)}`),

  getVisitorLiveStats: () =>
    request(`${API_BASE}/visitors/live-stats`),
};