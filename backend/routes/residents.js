/* ============================================================
   routes/residents.js — SQL Server version (court_id based)
   Residents reference a court; the court's phase is derived.
   Approval (verified: false → true) triggers a welcome email.
   + Paginated GET /
   + house_number + access_blocked support
   + GET /outstanding (resident's smart payable list)
   ============================================================ */

require("dotenv").config();

const express = require("express");
const router = express.Router();
const { getPool } = require("../db");
const { sendMail, residentApprovedEmail } = require("../utils/mailer");
const { requireAuth, requireRole } = require("../middleware/auth");

/* ------------------------------------------------------------
   Helper: DB row → JSON
   ------------------------------------------------------------ */
function residentToJson(row) {
  return {
    id:            row.id,
    fullName:      row.full_name,
    phone:         row.phone,
    email:         row.email || "",
    courtId:       row.court_id,
    courtName:     row.court_name,
    phase:         row.phase,
    houseNumber:   row.house_number || null,
    accessBlocked: !!row.access_blocked,
    verified:      !!row.verified,
    createdAt:     row.created_at,
  };
}

/* ------------------------------------------------------------
   Helper: build WHERE clause + bind inputs
   ------------------------------------------------------------ */
function applyResidentFilters(request, { phase, courtId, q, verified, houseNumber }) {
  const where = [];

  if (phase) {
    where.push("c.phase = @phase");
    request.input("phase", parseInt(phase, 10));
  }
  if (courtId) {
    where.push("r.court_id = @courtId");
    request.input("courtId", parseInt(courtId, 10));
  }
  if (houseNumber) {
    where.push("r.house_number = @houseNumber");
    request.input("houseNumber", String(houseNumber).trim());
  }
  if (q && q.trim()) {
    where.push("(r.full_name LIKE @q OR r.phone LIKE @q OR r.house_number LIKE @q)");
    request.input("q", `%${q.trim()}%`);
  }
  if (verified === "true" || verified === "false") {
    where.push("r.verified = @verified");
    request.input("verified", verified === "true" ? 1 : 0);
  }

  return where.length ? "WHERE " + where.join(" AND ") : "";
}

/* ------------------------------------------------------------
   GET /api/residents/outstanding   (resident, auth)
   MUST be declared BEFORE GET /:id, otherwise Express treats
   "outstanding" as an :id and this route never fires.
   ------------------------------------------------------------ */
/* ------------------------------------------------------------
   GET /api/residents/outstanding   (resident, auth)
   ------------------------------------------------------------ */
router.get("/outstanding", requireAuth, async (req, res, next) => {
  try {
    const pool = await getPool();
    const residentId = req.user.id;

    /* ---- Resident state ---- */
    const me = await pool.request()
      .input("id", residentId)
      .query(`
        SELECT id, verified, house_number, join_ahewa, phone
        FROM Residents WHERE id = @id
      `);
    if (!me.recordset.length) return res.status(404).json({ error: "Resident not found." });
    const r = me.recordset[0];

    /* ---- SELF-HEAL: flip any unpaid invoice to paid if a verified payment exists ---- */
    await pool.request()
      .input("rid", residentId)
      .query(`
        UPDATE inv
        SET inv.amount_paid = inv.amount_due,
            inv.status      = 'paid',
            inv.paid_at     = COALESCE(inv.paid_at, SYSUTCDATETIME())
        FROM invoices inv
        WHERE inv.resident_id = @rid
          AND inv.status != 'paid'
          AND EXISTS (
            SELECT 1 FROM payments p
            WHERE p.resident_id = inv.resident_id
              AND p.type        = inv.type
              AND p.status      = 'verified'
          )
      `);

    /* ---- All outstanding invoices (post self-heal) ---- */
    const invs = await pool.request()
      .input("rid", residentId)
      .query(`
        SELECT id, type, billing_month, amount_due, amount_paid,
               (amount_due - amount_paid) AS balance, due_date, status
        FROM invoices
        WHERE resident_id = @rid
          AND status IN ('unpaid','partial','overdue')
          AND (amount_due - amount_paid) > 0
        ORDER BY due_date ASC
      `);

    /* ---- Has the resident ever paid AHE_REG? (payments is source of truth) ---- */
    const ahePaid = await pool.request()
      .input("rid", residentId)
      .query(`
        SELECT TOP 1 1 FROM payments
        WHERE resident_id = @rid AND type = 'AHE_REG' AND status = 'verified'
      `);

    /* ---- Has the resident ever paid AHEWA_REG? ---- */
    const ahewaPaid = await pool.request()
      .input("rid", residentId)
      .query(`
        SELECT TOP 1 1 FROM payments
        WHERE resident_id = @rid AND type = 'AHEWA_REG' AND status = 'verified'
      `);

    /* ---- Fees from env ---- */
    const feeAhe   = parseInt(process.env.FEE_AHE   || "1", 10);
    const feeAhewa = parseInt(process.env.FEE_AHEWA || "1", 10);

    const now   = new Date();
    const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

    /* ---- Build the payable list ---- */
    const payable = [];

    /* 1. AHE_REG — only if never paid */
    if (!ahePaid.recordset.length) {
      payable.push({
        type: "AHE_REG",
        label: "AHE registration (one-off)",
        amount: feeAhe,
        invoiceId: null,
        reason: "not_paid",
      });
    }

    /* 2. Every outstanding invoice by type */
    for (const inv of invs.recordset) {
      const t = (inv.type || "SERVICE").toUpperCase();
      if (t === "AHE_REG") continue;                                  // handled above
      if (t === "AHEWA_REG" && ahewaPaid.recordset.length) continue;  // already paid

      payable.push({
        type: t,
            label: t === "AHEWA_EVENT" 
          ? `AHEWA event: ${inv.notes || "Contribution"}`
          : ({
              SERVICE:     "Monthly service charge",
              AHEWA_REG:   "AHEWA registration (one-off)",
            }[t] || t),
        amount: Number(inv.balance),
        invoiceId: inv.id,
        billingMonth: inv.billing_month,
        reason: "outstanding_invoice",
      });
    }

    /* 3. AHEWA_REG — if not a member and no verified payment exists */
    const isAhewaMember = !!r.join_ahewa || ahewaPaid.recordset.length > 0;
    const hasAhewaInv = payable.some((p) => p.type === "AHEWA_REG");
    if (!isAhewaMember && !hasAhewaInv) {
      payable.push({
        type: "AHEWA_REG",
        label: "AHEWA registration (one-off)",
        amount: feeAhewa,
        invoiceId: null,
        reason: "not_a_member",
      });
    }

    /* ---- Totals ---- */
    const total   = payable.reduce((s, p) => s + Number(p.amount), 0);
    const overdue = invs.recordset
      .filter((i) => i.status === "overdue")
      .reduce((s, i) => s + Number(i.balance), 0);

    res.json({
      residentId,
      houseNumber:        r.house_number || null,
      isAhewaMember,
      verified:           !!r.verified,
      payable,
      totalOutstanding:   total,
      overdueOutstanding: overdue,
      billingMonth:       month,
    });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------
   GET /api/residents?phase=&courtId=&q=&verified=&houseNumber=&page=&limit=
   ------------------------------------------------------------ */
router.get("/", async (req, res, next) => {
  try {
    const pool = await getPool();
    const { phase, courtId, q, verified, houseNumber, page, limit } = req.query;

    const filters = { phase, courtId, q, verified, houseNumber };

    const baseSelect = `
      SELECT r.*, c.name AS court_name, c.phase
      FROM Residents r
      JOIN Courts c ON c.id = r.court_id
    `;

    const orderBy = "ORDER BY c.phase ASC, c.name ASC, r.full_name ASC";

    /* ---------- PAGINATED ---------- */
    if (page !== undefined) {
      const pageNum  = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
      const offset   = (pageNum - 1) * limitNum;

      const countReq = pool.request();
      const whereClause = applyResidentFilters(countReq, filters);

      const countRes = await countReq.query(`
        SELECT COUNT(*) AS total
        FROM Residents r
        JOIN Courts c ON c.id = r.court_id
        ${whereClause}
      `);
      const total = countRes.recordset[0].total || 0;

      const dataReq = pool.request();
      applyResidentFilters(dataReq, filters);
      dataReq.input("offset", offset);
      dataReq.input("limit",  limitNum);

      const dataRes = await dataReq.query(`
        ${baseSelect}
        ${whereClause}
        ${orderBy}
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY
      `);

      return res.json({
        data:       dataRes.recordset.map(residentToJson),
        total,
        page:       pageNum,
        limit:      limitNum,
        totalPages: Math.ceil(total / limitNum) || 1,
      });
    }

    /* ---------- LEGACY (plain array) ---------- */
    const request = pool.request();
    const whereClause = applyResidentFilters(request, filters);

    const result = await request.query(`
      ${baseSelect}
      ${whereClause}
      ${orderBy}
    `);

    res.json(result.recordset.map(residentToJson));
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------
   GET /api/residents/:id
   ------------------------------------------------------------ */
router.get("/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const pool = await getPool();
    const result = await pool.request()
      .input("id", id)
      .query(`
        SELECT r.*, c.name AS court_name, c.phase
        FROM Residents r
        JOIN Courts c ON c.id = r.court_id
        WHERE r.id = @id
      `);

    if (!result.recordset.length) {
      return res.status(404).json({ error: "Resident not found" });
    }
    res.json(residentToJson(result.recordset[0]));
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------
   POST /api/residents
   Body: { fullName, phone, email, courtId }
   ------------------------------------------------------------ */
router.post("/", async (req, res, next) => {
  try {
    const { fullName, phone, email, courtId } = req.body;

    if (!fullName || !phone || !courtId) {
      return res.status(400).json({ error: "fullName, phone, and courtId are required." });
    }

    const courtIdInt = parseInt(courtId, 10);
    if (isNaN(courtIdInt)) {
      return res.status(400).json({ error: "Invalid courtId." });
    }

    const pool = await getPool();

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

    const inserted = await pool.request()
      .input("fullName", fullName.trim())
      .input("phone",    phone.trim())
      .input("email",    email ? email.trim() : null)
      .input("courtId",  courtIdInt)
      .query(`
        INSERT INTO Residents (full_name, phone, email, court_id, verified)
        OUTPUT INSERTED.*
        VALUES (@fullName, @phone, @email, @courtId, 0)
      `);

    const full = await pool.request()
      .input("id", inserted.recordset[0].id)
      .query(`
        SELECT r.*, c.name AS court_name, c.phase
        FROM Residents r
        JOIN Courts c ON c.id = r.court_id
        WHERE r.id = @id
      `);

    res.status(201).json(residentToJson(full.recordset[0]));
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------
   PATCH /api/residents/:id
   Body: { fullName, phone, email, courtId, verified, houseNumber, accessBlocked }
   When verified flips true → welcome email.
   When houseNumber is set → uniqueness enforced by DB index.
   ------------------------------------------------------------ */
router.patch("/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const map = {
      fullName:      "full_name",
      phone:         "phone",
      email:         "email",
      courtId:       "court_id",
      verified:      "verified",
      houseNumber:   "house_number",
      accessBlocked: "access_blocked",
    };

    const pool = await getPool();
    const request = pool.request().input("id", id);
    const sets = [];

    for (const [key, col] of Object.entries(map)) {
      if (req.body[key] !== undefined) {
        let val = req.body[key];
        if (col === "court_id")       val = parseInt(val, 10);
        if (col === "verified")       val = val ? 1 : 0;
        if (col === "access_blocked") val = val ? 1 : 0;
        if (col === "house_number")   val = val ? String(val).trim() : null;
        request.input(col, val);
        sets.push(`${col} = @${col}`);
      }
    }

    if (!sets.length) {
      return res.status(400).json({ error: "No updatable fields provided" });
    }

    const before = await pool.request()
      .input("id", id)
      .query("SELECT * FROM Residents WHERE id = @id");
    if (!before.recordset.length) {
      return res.status(404).json({ error: "Resident not found" });
    }
    const wasVerified = !!before.recordset[0].verified;

    let updated;
    try {
      updated = await request.query(`
        UPDATE Residents SET ${sets.join(", ")}
        OUTPUT INSERTED.*
        WHERE id = @id
      `);
    } catch (err) {
      // Catch unique-index violation on house_number
      if (err.number === 2601 || err.number === 2627) {
        return res.status(409).json({ error: "That house number is already assigned to another resident." });
      }
      throw err;
    }

    if (!updated.recordset.length) {
      return res.status(404).json({ error: "Resident not found" });
    }

    const updatedRow = updated.recordset[0];
    const isNowVerified = !!updatedRow.verified;

    /* ---------- Welcome email on approval ---------- */
    if (!wasVerified && isNowVerified) {
      try {
        if (updatedRow.email) {
          const tpl = residentApprovedEmail({
            fullName: updatedRow.full_name,
            phone:    updatedRow.phone,
          });

          await sendMail({
            to:      updatedRow.email,
            subject: tpl.subject,
            text:    tpl.text,
            html:    tpl.html,
          });

          console.log(`[residents] ✅ Approval email sent to ${updatedRow.email}`);
        } else {
          console.log(`[residents] ⚠️  No email on file for resident ${updatedRow.id} — email skipped.`);
        }
      } catch (mailErr) {
        console.error("[residents] ❌ Approval email failed:", mailErr.message);
      }
    }

    const full = await pool.request()
      .input("id", id)
      .query(`
        SELECT r.*, c.name AS court_name, c.phase
        FROM Residents r
        JOIN Courts c ON c.id = r.court_id
        WHERE r.id = @id
      `);

    res.json(residentToJson(full.recordset[0]));
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------
   DELETE /api/residents/:id
   ------------------------------------------------------------ */
router.delete("/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const pool = await getPool();
    const result = await pool.request()
      .input("id", id)
      .query("DELETE FROM Residents WHERE id = @id");

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: "Resident not found" });
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;