/* ============================================================
   api.js — thin fetch wrapper around the backend REST API.
   Now attaches the JWT (from auth.js) to every request.
   ============================================================ */

const API_BASE = "http://localhost:4050/api";

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

  /* ---------- Admin: dashboard + exports ---------- */
  getAdminDashboard: () => request(`${API_BASE}/admin/dashboard`),

  /**
   * Download the admin report as a binary file.
   * @param {"xlsx"|"pdf"} kind
   * @returns {Promise<Blob>}
   */
  downloadAdminReport: async (kind) => {
    const token = typeof getToken === "function" ? getToken() : null;
    if (!token) throw new Error("Not logged in.");

    const res = await fetch(`${API_BASE}/admin/export.${kind}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error("Session expired. Please log in again.");
    }
    if (!res.ok) {
      throw new Error(`Export failed (${res.status})`);
    }
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

  /* ---------- Bookings ---------- */
  getBookings: (params = {}) => request(`${API_BASE}/bookings${qsOf(params)}`),
  addBooking: (booking) =>
    request(`${API_BASE}/bookings`, { method: "POST", body: JSON.stringify(booking) }),
  updateBooking: (id, patch) =>
    request(`${API_BASE}/bookings/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),

  /* ---------- Reports ---------- */
  // CHANGED: Now accepts pagination params
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

  updateReview: (id, patch) =>
    request(`${API_BASE}/reviews/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
};