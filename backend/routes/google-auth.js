/* ============================================================
   backend/routes/google-auth.js
   Google OAuth 2.0 login for residents.

   Mounted at /auth (NOT /api/auth) to match the redirect URI
   registered in Google Cloud Console:

     http://127.0.0.1:4050/auth/google/callback

   Flow:
     GET /auth/google           → redirect to Google
     GET /auth/google/callback  → exchange code, sign JWT,
                                  redirect to /social-callback.html
   ============================================================ */

const express = require("express");
const axios   = require("axios");
const crypto  = require("crypto");
const jwt     = require("jsonwebtoken");
const router  = express.Router();
const { getPool }    = require("../db");
const { JWT_SECRET } = require("../middleware/auth");

const FRONTEND_BASE = process.env.FRONTEND_BASE || "http://localhost:3000";
const JWT_EXPIRES   = process.env.JWT_EXPIRES_IN || "7d";

/* ---------- helpers ---------- */
function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

function redirectToFrontend(res, { token, user, error }) {
  const params = new URLSearchParams();
  if (token) params.set("token", token);
  if (user)  params.set("user", encodeURIComponent(JSON.stringify(user)));
  if (error) params.set("error", error);
  res.redirect(`${FRONTEND_BASE}/social-callback.html#${params.toString()}`);
}

/* In-memory state store (dev / single-process) */
const STATE_STORE  = new Map();
const STATE_TTL_MS = 10 * 60 * 1000;

function putState(key, value) {
  STATE_STORE.set(key, { ...value, expiresAt: Date.now() + STATE_TTL_MS });
  for (const [k, v] of STATE_STORE) {
    if (v.expiresAt < Date.now()) STATE_STORE.delete(k);
  }
}

function takeState(key) {
  const v = STATE_STORE.get(key);
  STATE_STORE.delete(key);
  if (!v || v.expiresAt < Date.now()) return null;
  return v;
}

/* ============================================================
   GET /auth/google  → kick off the flow
   ============================================================ */
router.get("/google", (req, res) => {
  const clientId    = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return res.status(500).send("Google OAuth not configured (.env).");
  }

  const state = crypto.randomBytes(16).toString("hex");
  putState(state, { provider: "google" });

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id",     clientId);
  url.searchParams.set("redirect_uri",  redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope",         "openid email profile");
  url.searchParams.set("state",         state);
  url.searchParams.set("access_type",   "online");
  url.searchParams.set("prompt",        "select_account");

  res.redirect(url.toString());
});

/* ============================================================
   GET /auth/google/callback  → exchange code, issue JWT
   ============================================================ */
router.get("/google/callback", async (req, res) => {
  try {
    const { code, state, error } = req.query;
    if (error) return redirectToFrontend(res, { error: `Google: ${error}` });

    const stored = takeState(state);
    if (!stored || stored.provider !== "google") {
      return redirectToFrontend(res, { error: "Invalid or expired state." });
    }

    const redirectUri = process.env.GOOGLE_REDIRECT_URI;

    /* ---- 1. Exchange code for access token ---- */
    const tokenRes = await axios.post(
      "https://oauth2.googleapis.com/token",
      new URLSearchParams({
        code,
        client_id:     process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri:  redirectUri,
        grant_type:    "authorization_code",
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
    const { access_token } = tokenRes.data;

    /* ---- 2. Fetch profile ---- */
    const profileRes = await axios.get(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      { headers: { Authorization: `Bearer ${access_token}` } }
    );
    const profile = profileRes.data; /* { id, email, name, ... } */

    /* ---- 3. Find or create the resident ---- */
    const user = await findOrCreateGoogleUser(profile);

    /* ---- 4. Sign JWT and redirect back to frontend ---- */
    const token = signToken(user);
    redirectToFrontend(res, { token, user });
  } catch (err) {
    console.error("[google callback]", err.response?.data || err.message);
    redirectToFrontend(res, { error: "Google sign-in failed." });
  }
});

/* ============================================================
   Find or create a resident from a Google profile
   ============================================================ */
async function findOrCreateGoogleUser(profile) {
  const pool = await getPool();

  /* 1. Existing social link? */
  const existing = await pool.request()
    .input("provider",   "google")
    .input("providerId", profile.id)
    .query("SELECT resident_id FROM SocialAccounts WHERE provider = @provider AND provider_id = @providerId");

  if (existing.recordset.length) {
    return await loadResident(existing.recordset[0].resident_id);
  }

  /* 2. Existing resident with same email? */
  const byEmail = await pool.request()
    .input("email", profile.email.toLowerCase())
    .query("SELECT id FROM Residents WHERE email = @email");

  if (byEmail.recordset.length) {
    const residentId = byEmail.recordset[0].id;
    await linkSocial(residentId, "google", profile.id);
    return await loadResident(residentId);
  }

  /* 3. Create new resident */
  const cleanName = (profile.name || "Google User").trim();
  const phonePlaceholder = `SOCIAL-google-${profile.id}`.slice(0, 60);

  const inserted = await pool.request()
    .input("name",  cleanName)
    .input("phone", phonePlaceholder)
    .input("email", profile.email.toLowerCase())
    .query(`
      INSERT INTO Residents (full_name, phone, email, verified, must_change_password)
      OUTPUT INSERTED.id
      VALUES (@name, @phone, @email, 1, 0)
    `);

  const residentId = inserted.recordset[0].id;
  await linkSocial(residentId, "google", profile.id);
  return await loadResident(residentId);
}

async function linkSocial(residentId, provider, providerId) {
  const pool = await getPool();
  await pool.request()
    .input("rid",      residentId)
    .input("provider", provider)
    .input("pid",      providerId)
    .query(`
      IF NOT EXISTS (SELECT * FROM SocialAccounts WHERE provider = @provider AND provider_id = @pid)
      INSERT INTO SocialAccounts (resident_id, provider, provider_id)
      VALUES (@rid, @provider, @pid)
    `);
}

async function loadResident(id) {
  const pool = await getPool();
  const r = await pool.request()
    .input("id", id)
    .query("SELECT id, full_name, phone, email FROM Residents WHERE id = @id");

  if (!r.recordset.length) throw new Error("Resident not found.");
  const row = r.recordset[0];
  return { id: row.id, role: "resident", name: row.full_name, phone: row.phone };
}

module.exports = router;