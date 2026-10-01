/* ============================================================
   routes/invoices.js — Monthly household invoices
   - Generate invoices for a month (admin)
   - List invoices (admin filters, resident self-view)
   - Get one invoice
   - Auto-flags overdue invoices
   ============================================================ */

const express = require("express");
const router = express.Router();
const { getPool } = require("../db");

/* ------------------------------------------------------------
   Auth middleware (import yours — adjust path if needed)
   ------------------------------------------------------------ */
const { requireAuth, requireRole } = require("../middleware/auth");

/* ------------------------------------------------------------
   Helper: row → JSON
   ------------------------------------------------------------ */
function invoiceToJson(row) {
  return {
    id:            row.id,
    residentId:    row.resident_id,
    houseNumber:   row.house_number,
    billingMonth:  row.billing_month,
    type:          row.type || "SERVICE",
    amountDue:     Number(row.amount_due),
    amountPaid:    Number(row.amount_paid),
    balance:       Number(row.amount_due) - Number(row.amount_paid),
    status:        row.status,
    dueDate:       row.due_date,
    issuedAt:      row.issued_at,
    paidAt:        row.paid_at,
    residentName:  row.resident_name || null,
    phone:         row.phone || null,
    phase:         row.phase || null,
    courtName:     row.court_name || null,
  };
}

/* ------------------------------------------------------------
   Helper: get billing settings (singleton row)
   ------------------------------------------------------------ */
async function getBillingSettings(pool) {
  const r = await pool.request().query(`
    SELECT TOP 1 * FROM billing_settings ORDER BY id ASC
  `);
  return r.recordset[0] || {
    monthly_fee: 2000,
    due_day_of_month: 5,
    paybill_number: "1024162",
    paybill_bank: "Co-operative Bank",
    paybill_shortcode: "400200",
    bank_account: "01101767192001",
  };
}

/* ============================================================
   GET /api/invoices/settings   (public — displayed on billing page)
   ============================================================ */
router.get("/settings", async (req, res, next) => {
  try {
    const pool = await getPool();
    const s = await getBillingSettings(pool);
    res.json({
      monthlyFee:      Number(s.monthly_fee),
      dueDayOfMonth:   s.due_day_of_month,
      paybillNumber:   s.paybill_number,
      paybillBank:     s.paybill_bank,
      paybillShortcode: s.paybill_shortcode,
      bankAccount:     s.bank_account,
    });
  } catch (err) {
    next(err);
  }
});

/* ============================================================
   POST /api/invoices/generate   (admin only)
   Body: { month: "2026-04" }
   Creates one invoice per approved, numbered resident.
   Idempotent — skips existing (house_number, billing_month).
   ============================================================ */
router.post("/generate", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const { month } = req.body;
    if (!/^\d{4}-\d{2}$/.test(month || "")) {
      return res.status(400).json({ error: 'month is required in format "YYYY-MM"' });
    }

    const [year, mon] = month.split("-").map(Number);
    const dueDate = new Date(Date.UTC(year, mon - 1, 5));

    const pool = await getPool();
    const settings = await getBillingSettings(pool);
    const fee = Number(settings.monthly_fee);

    // Eligible: approved residents with a house number
    const eligible = await pool.request().query(`
      SELECT id, full_name, house_number
      FROM Residents
      WHERE verified = 1
        AND house_number IS NOT NULL
    `);

    let created = 0, skipped = 0;
    const errors = [];

    for (const r of eligible.recordset) {
      try {
        const dup = await pool.request()
  .input("h", r.house_number)
  .input("m", month)
  .query(`
    SELECT 1 FROM invoices
    WHERE house_number = @h
      AND billing_month = @m
      AND type = 'SERVICE'
  `);
if (dup.recordset.length) { skipped++; continue; }

          await pool.request()
          .input("rid", r.id)
          .input("h",   r.house_number)
          .input("m",   month)
          .input("amt", fee)
          .input("due", dueDate)
          .query(`
            INSERT INTO invoices
              (resident_id, house_number, billing_month, amount_due, due_date, type)
            VALUES (@rid, @h, @m, @amt, @due, 'SERVICE')
          `);
        created++;
      } catch (rowErr) {
        errors.push({ house: r.house_number, message: rowErr.message });
      }
    }

    res.json({
      month,
      eligible: eligible.recordset.length,
      created,
      skipped,
      errors,
    });
  } catch (err) {
    next(err);
  }
});

/* ============================================================
   POST /api/invoices/mark-overdue   (admin only)
   Flips status=overdue for invoices past due_date, unpaid.
   Also sets residents.access_blocked = 1 for those units.
   ============================================================ */
router.post("/mark-overdue", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const pool = await getPool();

    const result = await pool.request().query(`
      UPDATE invoices
      SET status = 'overdue'
      WHERE status IN ('unpaid', 'partial')
        AND due_date < CAST(SYSUTCDATETIME() AS DATE)
    `);

    // Block residents with overdue invoices
    await pool.request().query(`
      UPDATE Residents
      SET access_blocked = 1,
          access_blocked_reason = 'Overdue invoice'
      WHERE house_number IN (
        SELECT DISTINCT house_number FROM invoices WHERE status = 'overdue'
      )
      AND verified = 1
    `);

    // Unblock residents with no overdue invoices
    await pool.request().query(`
      UPDATE Residents
      SET access_blocked = 0,
          access_blocked_reason = NULL
      WHERE house_number NOT IN (
        SELECT DISTINCT house_number FROM invoices WHERE status = 'overdue'
      )
    `);

    res.json({ updated: result.rowsAffected[0] });
  } catch (err) {
    next(err);
  }
});

/* ============================================================
   GET /api/invoices   (admin — full list with filters + pagination)
   ============================================================ */
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const {
      month, status, houseNumber, q,
      page = 1, limit = 20,
    } = req.query;

    const pageNum  = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset   = (pageNum - 1) * limitNum;

    const where = [];
    const bind = (reqObj) => {
      if (month)       { where.push("i.billing_month = @month");     reqObj.input("month", month); }
      if (status)      { where.push("i.status = @status");           reqObj.input("status", status); }
      if (houseNumber) { where.push("i.house_number = @houseNumber"); reqObj.input("houseNumber", houseNumber); }
      if (q && q.trim()) {
        where.push("(r.full_name LIKE @q OR i.house_number LIKE @q OR r.phone LIKE @q)");
        reqObj.input("q", `%${q.trim()}%`);
      }
    };

    const pool = await getPool();
    const countReq = pool.request();
    bind(countReq);
    const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";

    const countRes = await countReq.query(`
      SELECT COUNT(*) AS total
      FROM invoices i
      JOIN Residents r ON r.id = i.resident_id
      ${whereSql}
    `);
    const total = countRes.recordset[0].total || 0;

    const dataReq = pool.request();
    bind(dataReq);
    dataReq.input("offset", offset);
    dataReq.input("limit",  limitNum);

    const dataRes = await dataReq.query(`
      SELECT i.*, r.full_name AS resident_name, r.phone,
             c.phase, c.name AS court_name
      FROM invoices i
      JOIN Residents r ON r.id = i.resident_id
      JOIN Courts c    ON c.id = r.court_id
      ${whereSql}
      ORDER BY i.billing_month DESC, i.house_number ASC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

    res.json({
      data:       dataRes.recordset.map(invoiceToJson),
      total,
      page:       pageNum,
      limit:      limitNum,
      totalPages: Math.ceil(total / limitNum) || 1,
    });
  } catch (err) {
    next(err);
  }
});

/* ============================================================
   GET /api/invoices/mine   (resident — own invoices)
   ============================================================ */
router.get("/mine", requireAuth, async (req, res, next) => {
  try {
    const pool = await getPool();
    const residentId = req.user.id;

    const result = await pool.request()
      .input("rid", residentId)
      .query(`
        SELECT i.*, r.full_name AS resident_name, r.phone,
               c.phase, c.name AS court_name
        FROM invoices i
        JOIN Residents r ON r.id = i.resident_id
        JOIN Courts c    ON c.id = r.court_id
        WHERE i.resident_id = @rid
        ORDER BY i.billing_month DESC
      `);

    res.json(result.recordset.map(invoiceToJson));
  } catch (err) {
    next(err);
  }
});

/* ============================================================
   GET /api/invoices/:id   (admin or owner)
   ============================================================ */
router.get("/:id", requireAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const pool = await getPool();
    const result = await pool.request()
      .input("id", id)
      .query(`
        SELECT i.*, r.full_name AS resident_name, r.phone,
               c.phase, c.name AS court_name
        FROM invoices i
        JOIN Residents r ON r.id = i.resident_id
        JOIN Courts c    ON c.id = r.court_id
        WHERE i.id = @id
      `);

    if (!result.recordset.length) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    const inv = result.recordset[0];

    // Only owner or admin
    if (req.user.role !== "admin" && req.user.id !== inv.resident_id) {
      return res.status(403).json({ error: "Forbidden" });
    }

    res.json(invoiceToJson(inv));
  } catch (err) {
    next(err);
  }
});

module.exports = router;