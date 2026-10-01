/* ============================================================
   routes/auth.js — login, me, logout, change-password
      Supports 4 roles: admin, security, resident, vendor
   ============================================================ */

const express = require("express");
const bcrypt  = require("bcryptjs");
const jwt     = require("jsonwebtoken");
const router  = express.Router();
const { getPool } = require("../db");
const { requireAuth, JWT_SECRET } = require("../middleware/auth");
const { sendMail, residentApprovedEmail } = require("../utils/mailer");
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
   role:       "admin" | "resident" | "vendor"
   identifier: email (admin) OR phone (resident/vendor)
   ------------------------------------------------------------ */
router.post("/login", async (req, res, next) => {
  try {
    const { role, identifier, password } = req.body;

    if (!role || !identifier || !password) {
      return res.status(400).json({
        error: "role, identifier, and password are required.",
      });
    }

    if (!["admin", "security", "resident", "vendor"].includes(role)) {
      return res.status(400).json({ error: "Invalid role." });
    }

    const pool = await getPool();
    let user = null;
    let mustChange = false;

    /* ---------- ADMIN & SECURITY ---------- */
    if (role === "admin" || role === "security") {
      const result = await pool.request()
        .input("email", identifier.trim().toLowerCase())
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
        .input("phone", identifier.trim())
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
        .input("phone", identifier.trim())
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

   Body:
     {
          Body:
     {
       fullName, phone, email, courtId, password,
       joinAHEWA: bool,
       payments: [
         { type: "AHE_REG",   amount: <FEE_AHE>,   mpesaReceipt: "...", mpesaPhone?: "..." },
         { type: "AHEWA_REG", amount: <FEE_AHEWA>, mpesaReceipt: "...", mpesaPhone?: "..." }
       ]
     }

   Flow (all inside ONE SQL Server transaction):
     - Insert resident (verified = 0, join_ahewa flag).
     - Insert AHE_REG invoice (2,000)  — MANDATORY.
     - Insert AHEWA_REG invoice (500)  — only if joinAHEWA.
     - Insert one pending payment row per submitted receipt.

   Any failure → full ROLLBACK. No partial writes.

   Placeholder house number is now 'PENDING-<residentId>' so two pending
   residents in the same month do not collide on the unique constraint
   (house_number, billing_month, type). Admin later assigns the real
   house number, at which point the placeholder is replaced.

   NOTE: The first monthly SERVICE invoice (KSh 2,000) is NOT created here —
         it is created in POST /api/payments/:id/verify when the admin verifies
         the AHE_REG payment and the resident is auto-approved. That way billing
         starts in the month of approval.
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

    /* ---------- Basic validation ---------- */
    if (!fullName || !phone || !courtId || !password) {
      return res.status(400).json({
        error: "fullName, phone, courtId, and password are required.",
      });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters." });
    }
    if (!/[A-Z]/.test(password)) {
      return res.status(400).json({ error: "Password must contain an uppercase letter." });
    }
    if (!/[a-z]/.test(password)) {
      return res.status(400).json({ error: "Password must contain a lowercase letter." });
    }
    if (!/[0-9]/.test(password)) {
      return res.status(400).json({ error: "Password must contain a number." });
    }

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

    /* ---------- Pre-flight checks (outside the tx — read-only) ---------- */
    const court = await pool.request()
      .input("courtId", courtIdInt)
      .query("SELECT id FROM Courts WHERE id = @courtId");
    if (!court.recordset.length) {
      return res.status(400).json({ error: "Court not found." });
    }

    const existing = await pool.request()
      .input("phone", phone.trim())
      .query("SELECT id FROM Residents WHERE phone = @phone");
    if (existing.recordset.length) {
      return res.status(409).json({ error: "Phone number already registered." });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    /* ---------- Compute billing month + due date once ---------- */
    const now   = new Date();
    const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const [y, m]   = month.split("-").map(Number);
    const dueDate  = new Date(Date.UTC(y, m - 1, 5));

    /* ---------- BEGIN TRANSACTION ---------- */
    await tx.begin();

    try {
      /* ---- 1. Insert resident ---- */
      const inserted = await tx.request()
        .input("fullName",  fullName.trim())
        .input("phone",     phone.trim())
        .input("email",     email ? email.trim() : null)
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

      /* ---- 2. Per-resident placeholder house number ----
         Prevents collisions with other pending residents in the same
         (billing_month, type) slot until the admin assigns a real house. */
      const placeholderHouse = `PENDING-${residentId}`;

      /* ---- 3. Helper: insert invoice, return id ---- */
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

      /* ---- 4. Helper: insert payment ---- */
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

      /* ---- 5. AHE_REG invoice + payment (mandatory) ---- */
            const aheInvoiceId = await makeInvoice({ type: "AHE_REG", amount: FEE_AHE });
      await makePayment({
        type: "AHE_REG",
        amount: ahePay.amount,
        receipt: ahePay.mpesaReceipt,
        phoneUsed: ahePay.mpesaPhone,
        invoiceId: aheInvoiceId,
      });

      /* ---- 6. AHEWA_REG invoice + payment (optional) ---- */
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

      /* ---- 7. COMMIT ---- */
      await tx.commit();

      res.status(201).json({
        id:        residentId,
        fullName:  fullName.trim(),
        phone:     phone.trim(),
        email:     email ? email.trim() : null,
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
   Body: { currentPassword, newPassword }
   Works for admins, residents, and vendors.
   ------------------------------------------------------------ */
router.post("/change-password", requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        error: "currentPassword and newPassword are required.",
      });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({
        error: "New password must be at least 8 characters.",
      });
    }

    const pool = await getPool();
    const { id, role } = req.user;

    let table = "";
    let idForUpdate = id;

    if (role === "admin" || role === "security") table = "Admins";
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
      .query(`SELECT password_hash AS hash FROM ${table} WHERE id = @id`);

    if (!row.recordset.length) {
      return res.status(404).json({ error: "Account not found." });
    }

    const ok = await bcrypt.compare(currentPassword, row.recordset[0].hash);
    if (!ok) {
      return res.status(401).json({ error: "Current password is incorrect." });
    }

    const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

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

module.exports = router;