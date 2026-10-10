/* ============================================================
   routes/auth.js — login, me, logout, change-password,
                    avatar upload, forgot / reset password
      Supports roles: admin, super-admin, security, resident, vendor
   ============================================================ */

const express = require("express");
const bcrypt  = require("bcryptjs");
const jwt     = require("jsonwebtoken");
const crypto  = require("crypto");
const router  = express.Router();
const { getPool } = require("../db");
const { requireAuth, JWT_SECRET } = require("../middleware/auth");
const { sendMail, residentApprovedEmail } = require("../utils/mailer");
const {
  normalizePhone,
  validateName,
  validateEmail,
  validatePassword,
} = require("../utils/validators");

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || "10", 10);
const JWT_EXPIRES   = process.env.JWT_EXPIRES_IN || "7d";
const FEE_AHE   = parseInt(process.env.FEE_AHE   || "1", 10);
const FEE_AHEWA = parseInt(process.env.FEE_AHEWA || "1", 10);

/* ------------------------------------------------------------
   Helper: sign a JWT for a user object
   ------------------------------------------------------------ */
function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

/* ------------------------------------------------------------
   POST /api/auth/login
   Body: { role, identifier, password }
   ------------------------------------------------------------ */
router.post("/login", async (req, res, next) => {
  try {
    const { role, identifier, password } = req.body;

    if (!role || !identifier || !password) {
      return res.status(400).json({
        error: "role, identifier, and password are required.",
      });
    }

    if (!["admin", "super-admin", "security", "resident", "vendor"].includes(role)) {
      return res.status(400).json({ error: "Invalid role." });
    }

    /* ---------- Validate identifier format by role ---------- */
    let normalizedIdentifier = identifier.trim();

    if (role === "admin" || role === "super-admin" || role === "security") {
      const emailCheck = validateEmail(normalizedIdentifier, { optional: false });
      if (!emailCheck.valid) {
        return res.status(400).json({ error: emailCheck.reason });
      }
      normalizedIdentifier = emailCheck.normalized;
    } else {
      /* resident or vendor — phone */
      const phoneCheck = normalizePhone(normalizedIdentifier);
      if (!phoneCheck.valid) {
        return res.status(400).json({ error: phoneCheck.reason });
      }
      normalizedIdentifier = phoneCheck.normalized;
    }

    /* Password presence check (don't enforce strength on login — just non-empty) */
    if (typeof password !== "string" || password.length === 0) {
      return res.status(400).json({ error: "Password is required." });
    }

    const pool = await getPool();
    let user = null;
    let mustChange = false;

    /* ---------- SUPER ADMIN ---------- */
    if (role === "super-admin") {
      const r = await pool.request()
        .input("email", normalizedIdentifier.toLowerCase())
        .query("SELECT * FROM SuperAdmins WHERE email = @email");

      if (r.recordset.length) {
        const row = r.recordset[0];
        const ok = await bcrypt.compare(password, row.passwordHash);
        if (ok) {
          user = {
            id:    row.id,
            role:  "super-admin",
            name:  row.name,
            email: row.email,
          };
          mustChange = false;
        }
      }
    }

    /* ---------- ADMIN & SECURITY ---------- */
    if (role === "admin" || role === "security") {
      const result = await pool.request()
        .input("email", normalizedIdentifier.toLowerCase())
        .query("SELECT * FROM Admins WHERE email = @email");

      if (result.recordset.length) {
        const row = result.recordset[0];
        const ok = await bcrypt.compare(password, row.password_hash);
        if (ok) {
          user = {
            id:    row.id,
            role:  row.role,
            name:  row.full_name,
            email: row.email,
          };
          mustChange = !!row.must_change_password;
        }
      }
    }

    /* ---------- RESIDENT ---------- */
    if (role === "resident") {
      const result = await pool.request()
        .input("phone", normalizedIdentifier)
        .query(`
          SELECT r.*, c.name AS court_name, c.phase
          FROM Residents r
          LEFT JOIN Courts c ON c.id = r.court_id
          WHERE r.phone = @phone
        `);

      if (result.recordset.length) {
        const row = result.recordset[0];

        if (!row.verified) {
          return res.status(403).json({
            error: "Your resident account is pending admin approval.",
          });
        }

        if (!row.password_hash) {
          return res.status(403).json({
            error: "No password set for this account. Please contact the admin.",
          });
        }

        if (row.must_change_password && row.temp_password_expires) {
          const now     = new Date();
          const expires = new Date(row.temp_password_expires);
          if (now > expires) {
            return res.status(403).json({
              error: "Your temporary password has expired. Please contact the admin.",
            });
          }
        }

        const ok = await bcrypt.compare(password, row.password_hash);
        if (ok) {
          user = {
            id:    row.id,
            role:  "resident",
            name:  row.full_name,
            phone: row.phone,
            court: row.court_name || null,
            phase: row.phase || null,
          };
          mustChange = !!row.must_change_password;
        }
      }
    }

    /* ---------- VENDOR ---------- */
    if (role === "vendor") {
      const result = await pool.request()
        .input("phone", normalizedIdentifier)
        .query(`
          SELECT
            p.*,
            r.full_name,
            r.phone                AS resident_phone,
            r.password_hash        AS resident_password_hash,
            r.must_change_password,
            r.temp_password_expires,
            r.verified             AS resident_verified,
            c.name                 AS court_name,
            c.phase                AS court_phase
          FROM Providers p
          JOIN Residents r ON r.id = p.resident_id
          LEFT JOIN Courts c ON c.id = r.court_id
          WHERE r.phone = @phone
        `);

      if (result.recordset.length) {
        const row = result.recordset[0];

        if (!row.resident_verified) {
          return res.status(403).json({
            error: "Your resident account is pending approval.",
          });
        }
        if (!row.verified) {
          return res.status(403).json({
            error: "Your vendor application is pending admin approval.",
          });
        }
        if (!row.resident_password_hash) {
          return res.status(403).json({
            error: "No password set for this account. Please contact the admin.",
          });
        }

        const ok = await bcrypt.compare(password, row.resident_password_hash);
        if (ok) {
          user = {
            id:         row.id,
            role:       "vendor",
            name:       row.name,
            residentId: row.resident_id,
            phone:      row.resident_phone,
            court:      row.court_name || null,
            phase:      row.court_phase || null,
          };
          mustChange = !!row.must_change_password;
        }
      }
    }

    if (!user) {
      return res.status(401).json({ error: "Invalid credentials." });
    }

    const token = signToken(user);
    res.json({ token, user, mustChangePassword: mustChange });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------
   POST /api/auth/register-resident
   Public self-registration — fully transactional.
   ------------------------------------------------------------ */
router.post("/register-resident", async (req, res, next) => {
  const pool = await getPool();
  const tx   = pool.transaction();

  try {
    const {
      fullName, phone, email, courtId, password,
      joinAHEWA = false,
      payments = [],
    } = req.body;

    if (!fullName || !phone || !courtId || !password) {
      return res.status(400).json({
        error: "fullName, phone, courtId, and password are required.",
      });
    }

    const nameCheck = validateName(fullName, "Full name");
    if (!nameCheck.valid) return res.status(400).json({ error: nameCheck.reason });

    const phoneCheck = normalizePhone(phone);
    if (!phoneCheck.valid) return res.status(400).json({ error: phoneCheck.reason });

    const emailCheck = validateEmail(email, { optional: true });
    if (!emailCheck.valid) return res.status(400).json({ error: emailCheck.reason });

    const pwCheck = validatePassword(password);
    if (!pwCheck.valid) return res.status(400).json({ error: pwCheck.reason });

    const normalizedFullName = nameCheck.normalized;
    const normalizedPhone    = phoneCheck.normalized;
    const normalizedEmail    = emailCheck.normalized;

    const courtIdInt = parseInt(courtId, 10);
    if (isNaN(courtIdInt)) {
      return res.status(400).json({ error: "Invalid courtId." });
    }

    /* ---------- AHE_REG receipt (mandatory) ---------- */
    const ahePay = payments.find((p) => p && p.type === "AHE_REG");
    if (!ahePay || !ahePay.mpesaReceipt || Number(ahePay.amount) < FEE_AHE) {
      return res.status(400).json({
        error: `AHE registration payment (KSh ${FEE_AHE.toLocaleString()}) with M-Pesa receipt is required.`,
      });
    }

    let ahewaPay = null;
    if (joinAHEWA) {
      ahewaPay = payments.find((p) => p && p.type === "AHEWA_REG");
      if (!ahewaPay || !ahewaPay.mpesaReceipt || Number(ahewaPay.amount) < FEE_AHEWA) {
        return res.status(400).json({
          error: "You selected AHEWA membership, but no AHEWA payment receipt was supplied.",
        });
      }
    }

    const court = await pool.request()
      .input("courtId", courtIdInt)
      .query("SELECT id FROM Courts WHERE id = @courtId");
    if (!court.recordset.length) {
      return res.status(400).json({ error: "Court not found." });
    }

    const existing = await pool.request()
      .input("phone", normalizedPhone)
      .query("SELECT id FROM Residents WHERE phone = @phone");
    if (existing.recordset.length) {
      return res.status(409).json({ error: "Phone number already registered." });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const now   = new Date();
    const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const [y, m]   = month.split("-").map(Number);
    const dueDate  = new Date(Date.UTC(y, m - 1, 5));

    await tx.begin();

    try {
      const inserted = await tx.request()
        .input("fullName",  normalizedFullName)
        .input("phone",     normalizedPhone)
        .input("email",     normalizedEmail)
        .input("courtId",   courtIdInt)
        .input("hash",      passwordHash)
        .input("joinAHEWA", joinAHEWA ? 1 : 0)
        .query(`
          INSERT INTO Residents
            (full_name, phone, email, court_id, password_hash,
             verified, must_change_password, join_ahewa)
          OUTPUT INSERTED.id
          VALUES
            (@fullName, @phone, @email, @courtId, @hash, 0, 0, @joinAHEWA)
        `);
      const residentId = inserted.recordset[0].id;

      const placeholderHouse = `PENDING-${residentId}`;

      async function makeInvoice({ type, amount }) {
        const r = await tx.request()
          .input("rid",  residentId)
          .input("h",    placeholderHouse)
          .input("m",    month)
          .input("amt",  amount)
          .input("due",  dueDate)
          .input("type", type)
          .query(`
            INSERT INTO invoices
              (resident_id, house_number, billing_month, amount_due, due_date, type)
            OUTPUT INSERTED.id
            VALUES (@rid, @h, @m, @amt, @due, @type)
          `);
        return r.recordset[0].id;
      }

      async function makePayment({ type, amount, receipt, phoneUsed, invoiceId }) {
        await tx.request()
          .input("inv",  invoiceId)
          .input("h",    placeholderHouse)
          .input("rid",  residentId)
          .input("amt",  Number(amount))
          .input("rec",  receipt.trim())
          .input("ph",   phoneUsed ? phoneUsed.trim() : null)
          .input("date", now)
          .input("type", type)
          .query(`
            INSERT INTO payments
              (invoice_id, house_number, resident_id, amount, method, status,
               mpesa_receipt, mpesa_phone, payment_date, entered_by, type)
            VALUES
              (@inv, @h, @rid, @amt, 'mpesa', 'pending',
               @rec, @ph, @date, @rid, @type)
          `);
      }

      const aheInvoiceId = await makeInvoice({ type: "AHE_REG", amount: FEE_AHE });
      await makePayment({
        type: "AHE_REG",
        amount: ahePay.amount,
        receipt: ahePay.mpesaReceipt,
        phoneUsed: ahePay.mpesaPhone,
        invoiceId: aheInvoiceId,
      });

      let ahewaInvoiceId = null;
      if (joinAHEWA && ahewaPay) {
        ahewaInvoiceId = await makeInvoice({ type: "AHEWA_REG", amount: FEE_AHEWA });
        await makePayment({
          type: "AHEWA_REG",
          amount: ahewaPay.amount,
          receipt: ahewaPay.mpesaReceipt,
          phoneUsed: ahewaPay.mpesaPhone,
          invoiceId: ahewaInvoiceId,
        });
      }

      await tx.commit();

      res.status(201).json({
        id:        residentId,
        fullName:  normalizedFullName,
        phone:     normalizedPhone,
        email:     normalizedEmail,
        verified:  false,
        joinAHEWA: !!joinAHEWA,
        invoices: {
          ahe:   aheInvoiceId,
          ahewa: ahewaInvoiceId,
        },
        message:
          "Registration submitted. Your AHE payment is pending admin verification. " +
          "You will be approved (and your first monthly service invoice issued) " +
          "once it is confirmed.",
      });
    } catch (inner) {
      await tx.rollback();
      throw inner;
    }
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------
   GET /api/auth/me — return current user from token
   ------------------------------------------------------------ */
router.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

/* ------------------------------------------------------------
   POST /api/auth/change-password
   ------------------------------------------------------------ */
router.post("/change-password", requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        error: "currentPassword and newPassword are required.",
      });
    }

    const pwCheck = validatePassword(newPassword);
    if (!pwCheck.valid) {
      return res.status(400).json({ error: pwCheck.reason });
    }

    const pool = await getPool();
    const { id, role } = req.user;

    let table = "";
    let idForUpdate = id;
    let hashCol = "password_hash";   // most tables use this

    if (role === "admin" || role === "security") table = "Admins";
    if (role === "super-admin") {
      table = "SuperAdmins";
      hashCol = "passwordHash";      // SuperAdmins uses camelCase
    }
    if (role === "resident") table = "Residents";
    if (role === "vendor") {
      table = "Residents";
      idForUpdate = req.user.residentId || id;
    }

    if (!table) {
      return res.status(400).json({ error: "Unknown role." });
    }

    const row = await pool.request()
      .input("id", idForUpdate)
      .query(`SELECT ${hashCol} AS hash FROM ${table} WHERE id = @id`);

    if (!row.recordset.length) {
      return res.status(404).json({ error: "Account not found." });
    }

    const ok = await bcrypt.compare(currentPassword, row.recordset[0].hash);
    if (!ok) {
      return res.status(401).json({ error: "Current password is incorrect." });
    }

    const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    /* SuperAdmins has no must_change_password / temp_password_expires columns */
    if (table === "SuperAdmins") {
      await pool.request()
        .input("id",   idForUpdate)
        .input("hash", newHash)
        .query(`UPDATE SuperAdmins SET passwordHash = @hash WHERE id = @id`);
    } else {
      await pool.request()
        .input("id",   idForUpdate)
        .input("hash", newHash)
        .query(`
          UPDATE ${table}
          SET password_hash         = @hash,
              must_change_password  = 0,
              temp_password_expires = NULL
          WHERE id = @id
        `);
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------
   POST /api/auth/logout
   ------------------------------------------------------------ */
router.post("/logout", (req, res) => {
  res.json({ ok: true });
});


/* ============================================================
   Avatar upload — POST /api/auth/me/avatar
   ============================================================ */
const multer = require("multer");
const path   = require("path");
const fs     = require("fs");

const AVATAR_DIR = path.join(__dirname, "..", "uploads", "avatars");
fs.mkdirSync(AVATAR_DIR, { recursive: true });

const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, AVATAR_DIR),
  filename:    (req, file, cb) => {
    const ext = (path.extname(file.originalname) || ".jpg").toLowerCase();
    const uid = req.user?.id || "anon";
    cb(null, `user-${uid}-${Date.now()}${ext}`);
  },
});

const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error("Only image files are allowed."));
  },
});

const ROLE_TABLE = {
  resident:      "Residents",
  admin:         "Admins",
  "super-admin": "SuperAdmins",
  vendor:        "Providers",
  provider:      "Providers",
};

router.post(
  "/me/avatar",
  requireAuth,
  avatarUpload.single("avatar"),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded." });

      const role  = String(req.user?.role || "").toLowerCase();
      const table = ROLE_TABLE[role];
      if (!table) return res.status(400).json({ error: "Unknown role: " + role });

      const url    = `${req.protocol}://${req.get("host")}/uploads/avatars/${req.file.filename}`;
      const userId = req.user.id;

      const pool = await getPool();

      try {
        const prev = await pool.request()
          .input("id", userId)
          .query(`SELECT avatar FROM ${table} WHERE id = @id`);
        const prevUrl = prev.recordset[0] && prev.recordset[0].avatar;
        if (prevUrl && prevUrl.startsWith("/uploads/")) {
          const oldPath = path.join(__dirname, "..", prevUrl.replace(/^\//, ""));
          fs.unlink(oldPath, () => {});
        }
      } catch (e) {
        console.warn("[avatar] previous-file cleanup skipped:", e.message);
      }

      await pool.request()
        .input("id",     userId)
        .input("avatar", url)
        .query(`UPDATE ${table} SET avatar = @avatar WHERE id = @id`);

      res.json({ avatar: url });
    } catch (err) {
      console.error("[avatar] upload error:", err);
      res.status(500).json({ error: "Could not save avatar." });
    }
  }
);

/* ============================================================
   FORGOT / RESET PASSWORD
   ============================================================ */

const RESET_ROLE_TABLE = {
  resident:      "Residents",
  admin:         "Admins",
  "super-admin": "SuperAdmins",
  vendor:        "Providers",
  provider:      "Providers",
  security:      "Admins",   // security logins are stored in Admins
};

/* ---------- POST /api/auth/forgot-password ---------- */
router.post("/forgot-password", async (req, res, next) => {
  try {
    const { email, role } = req.body;
    if (!email || !role) {
      return res.status(400).json({ error: "Email and role are required." });
    }

    const table = RESET_ROLE_TABLE[role.toLowerCase()];
    if (!table) {
      return res.status(400).json({ error: "Unknown role." });
    }

    const pool = await getPool();

    const found = await pool.request()
      .input("email", email.trim().toLowerCase())
      .query(`SELECT id FROM ${table} WHERE LOWER(email) = @email`);

    // Always return success, even if user not found
    if (!found.recordset.length) {
      return res.json({ ok: true });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await pool.request()
      .input("email",  email.trim().toLowerCase())
      .input("role",   role.toLowerCase())
      .input("token",  token)
      .input("exp",    expiresAt)
      .query(`INSERT INTO password_resets (email, role, token, expires_at)
              VALUES (@email, @role, @token, @exp)`);

    const origin = req.get("origin") || "http://localhost:3000";
    const link = `${origin}/reset-password.html?token=${token}`;

    try {
      await sendMail({
        to: email,
        subject: "Reset your Athi Soko password",
        text:
`Hello,

You requested a password reset for your Athi Soko account.

Open this link to set a new password (valid for 1 hour):
${link}

If you didn't request this, you can ignore this email.

— Athi Highway Estate`,
        html:
`<p>Hello,</p>
<p>You requested a password reset for your Athi Soko account.</p>
<p><a href="${link}" style="background:#c8862a;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;">Reset your password</a></p>
<p>Or copy this URL: <br><code>${link}</code></p>
<p>This link is valid for 1 hour. If you didn't request this, you can ignore this email.</p>
<p>— Athi Highway Estate</p>`,
      });
    } catch (mailErr) {
      console.warn("[forgot-password] email failed:", mailErr.message);
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ---------- POST /api/auth/reset-password ---------- */
router.post("/reset-password", async (req, res, next) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      return res.status(400).json({ error: "Token and password are required." });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters." });
    }

    const pool = await getPool();

    const found = await pool.request()
      .input("token", token)
      .query(`SELECT id, email, role, expires_at, used
              FROM password_resets
              WHERE token = @token`);

    const row = found.recordset[0];
    if (!row) {
      return res.status(400).json({ error: "Invalid or expired reset link." });
    }
    if (row.used) {
      return res.status(400).json({ error: "This reset link has already been used." });
    }
    if (new Date(row.expires_at) < new Date()) {
      return res.status(400).json({ error: "This reset link has expired." });
    }

    const table = RESET_ROLE_TABLE[row.role];
    if (!table) return res.status(400).json({ error: "Unknown role." });

    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    /* SuperAdmins uses passwordHash; all other tables use password_hash */
    const hashCol = table === "SuperAdmins" ? "passwordHash" : "password_hash";

    await pool.request()
      .input("email", row.email)
      .input("hash",  hash)
      .query(`UPDATE ${table} SET ${hashCol} = @hash WHERE LOWER(email) = @email`);

    await pool.request()
      .input("id", row.id)
      .query(`UPDATE password_resets SET used = 1 WHERE id = @id`);

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;