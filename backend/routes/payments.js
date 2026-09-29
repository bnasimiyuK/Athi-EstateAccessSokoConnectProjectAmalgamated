/* ============================================================
   routes/payments.js — Manual payment entry + verify/reject
   (M-Pesa API integration will plug into the same table later.)
   ============================================================ */

const express = require("express");
const router = express.Router();
const { getPool } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");

/* ------------------------------------------------------------
   Row → JSON
   ------------------------------------------------------------ */
function paymentToJson(row) {
  return {
    id:              row.id,
    invoiceId:       row.invoice_id,
    houseNumber:     row.house_number,
    residentId:      row.resident_id,
    amount:          Number(row.amount),
    method:          row.method,
    status:          row.status,
    mpesaReceipt:    row.mpesa_receipt,
    mpesaPhone:      row.mpesa_phone,
    paymentDate:     row.payment_date,
    notes:           row.notes,
    verifiedBy:      row.verified_by,
    verifiedAt:      row.verified_at,
    rejectionReason: row.rejection_reason,
    createdAt:       row.created_at,
    residentName:    row.resident_name || null,
    invoiceMonth:    row.billing_month || null,
  };
}

/* ------------------------------------------------------------
   Helper: allocate an amount to oldest unpaid invoice of a house
   Returns the invoice id and new status.
   ------------------------------------------------------------ */
async function allocateToInvoice(pool, houseNumber, amount, txReq) {
  const reqObj = txReq || pool.request();
  const r = await reqObj
    .input("h", houseNumber)
    .query(`
      SELECT TOP 1 id, amount_due, amount_paid
      FROM invoices
      WHERE house_number = @h
        AND status IN ('unpaid','partial','overdue')
      ORDER BY billing_month ASC
    `);

  if (!r.recordset.length) return null;

  const inv = r.recordset[0];
  const newPaid = Number(inv.amount_paid) + Number(amount);
  const newStatus = newPaid >= Number(inv.amount_due) ? "paid" : "partial";

  await (txReq || pool.request())
    .input("p", newPaid)
    .input("s", newStatus)
    .input("id", inv.id)
    .query(`
      UPDATE invoices
      SET amount_paid = @p,
          status      = @s,
          paid_at     = CASE WHEN @s = 'paid' THEN SYSUTCDATETIME() ELSE paid_at END
      WHERE id = @id
    `);

  return { invoiceId: inv.id, newStatus };
}

/* ============================================================
   POST /api/payments/manual   (admin)
   Body: { houseNumber, amount, mpesaReceipt?, mpesaPhone?, paymentDate?, notes? }
   Creates payment with status=pending (admin still verifies).
   ============================================================ */
router.post("/manual", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const {
      houseNumber, amount, mpesaReceipt, mpesaPhone,
      paymentDate, notes,
    } = req.body;

    if (!houseNumber || !amount) {
      return res.status(400).json({ error: "houseNumber and amount are required." });
    }

    const amt = Number(amount);
    if (isNaN(amt) || amt <= 0) {
      return res.status(400).json({ error: "amount must be a positive number." });
    }

    const pool = await getPool();

    // Find resident by house
    const resident = await pool.request()
      .input("h", houseNumber.trim())
      .query("SELECT id FROM Residents WHERE house_number = @h AND verified = 1");
    if (!resident.recordset.length) {
      return res.status(404).json({ error: "No approved resident with that house number." });
    }

    const inserted = await pool.request()
      .input("h",     houseNumber.trim())
      .input("rid",   resident.recordset[0].id)
      .input("amt",   amt)
      .input("rec",   mpesaReceipt ? mpesaReceipt.trim() : null)
      .input("ph",    mpesaPhone ? mpesaPhone.trim() : null)
      .input("date",  paymentDate ? new Date(paymentDate) : new Date())
      .input("notes", notes || null)
      .input("by",    req.user.id)
      .query(`
        INSERT INTO payments
          (house_number, resident_id, amount, method, status,
           mpesa_receipt, mpesa_phone, payment_date, notes, entered_by)
        OUTPUT INSERTED.*
        VALUES (@h, @rid, @amt, 'mpesa', 'pending',
                @rec, @ph, @date, @notes, @by)
      `);

    res.status(201).json(paymentToJson(inserted.recordset[0]));
  } catch (err) {
    next(err);
  }
});

/* ============================================================
   POST /api/payments/self-report   (resident)
   Resident reports "I have paid" with receipt — created as pending.
   ============================================================ */
router.post("/self-report", requireAuth, async (req, res, next) => {
  try {
    const { amount, mpesaReceipt, mpesaPhone, paymentDate, notes } = req.body;

    if (!amount || !mpesaReceipt) {
      return res.status(400).json({ error: "amount and mpesaReceipt are required." });
    }

    const pool = await getPool();

    const me = await pool.request()
      .input("id", req.user.id)
      .query("SELECT house_number FROM Residents WHERE id = @id");
    if (!me.recordset.length || !me.recordset[0].house_number) {
      return res.status(400).json({ error: "Your account has no house number yet." });
    }

    const inserted = await pool.request()
      .input("h",     me.recordset[0].house_number)
      .input("rid",   req.user.id)
      .input("amt",   Number(amount))
      .input("rec",   mpesaReceipt.trim())
      .input("ph",    mpesaPhone ? mpesaPhone.trim() : null)
      .input("date",  paymentDate ? new Date(paymentDate) : new Date())
      .input("notes", notes || null)
      .query(`
        INSERT INTO payments
          (house_number, resident_id, amount, method, status,
           mpesa_receipt, mpesa_phone, payment_date, notes, entered_by)
        OUTPUT INSERTED.*
        VALUES (@h, @rid, @amt, 'mpesa', 'pending',
                @rec, @ph, @date, @notes, @rid)
      `);

    res.status(201).json(paymentToJson(inserted.recordset[0]));
  } catch (err) {
    next(err);
  }
});

/* ============================================================
   GET /api/payments   (admin — filter + paginate)
   Query: status, houseNumber, month, q, page, limit
   ============================================================ */
router.get("/", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const { status, houseNumber, month, q, page = 1, limit = 20 } = req.query;

    const pageNum  = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset   = (pageNum - 1) * limitNum;

    const where = [];
    const bind = (r) => {
      if (status)      { where.push("p.status = @status"); r.input("status", status); }
      if (houseNumber) { where.push("p.house_number = @houseNumber"); r.input("houseNumber", houseNumber); }
      if (month)       { where.push("i.billing_month = @month"); r.input("month", month); }
      if (q && q.trim()) {
        where.push("(r.full_name LIKE @q OR p.house_number LIKE @q OR p.mpesa_receipt LIKE @q)");
        r.input("q", `%${q.trim()}%`);
      }
    };

    const pool = await getPool();
    const countReq = pool.request();
    bind(countReq);
    const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";

    const countRes = await countReq.query(`
      SELECT COUNT(*) AS total
      FROM payments p
      LEFT JOIN Residents r  ON r.id = p.resident_id
      LEFT JOIN invoices i   ON i.id = p.invoice_id
      ${whereSql}
    `);
    const total = countRes.recordset[0].total || 0;

    const dataReq = pool.request();
    bind(dataReq);
    dataReq.input("offset", offset);
    dataReq.input("limit",  limitNum);

    const dataRes = await dataReq.query(`
      SELECT p.*, r.full_name AS resident_name, i.billing_month
      FROM payments p
      LEFT JOIN Residents r ON r.id = p.resident_id
      LEFT JOIN invoices i  ON i.id = p.invoice_id
      ${whereSql}
      ORDER BY p.created_at DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

    res.json({
      data:       dataRes.recordset.map(paymentToJson),
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
   GET /api/payments/mine   (resident)
   ============================================================ */
router.get("/mine", requireAuth, async (req, res, next) => {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input("rid", req.user.id)
      .query(`
        SELECT p.*, i.billing_month
        FROM payments p
        LEFT JOIN invoices i ON i.id = p.invoice_id
        WHERE p.resident_id = @rid
        ORDER BY p.created_at DESC
      `);
    res.json(result.recordset.map(paymentToJson));
  } catch (err) {
    next(err);
  }
});

/* ============================================================
   POST /api/payments/:id/verify   (admin)
   Marks payment verified + allocates it to oldest unpaid invoice.
   ============================================================ */
router.post("/:id/verify", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const pool = await getPool();
    const tx = pool.transaction();
    await tx.begin();

    try {
      const pre = await tx.request()
        .input("id", id)
        .query("SELECT * FROM payments WHERE id = @id");
      if (!pre.recordset.length) {
        await tx.rollback();
        return res.status(404).json({ error: "Payment not found" });
      }
      const p = pre.recordset[0];
      if (p.status === "verified") {
        await tx.rollback();
        return res.status(400).json({ error: "Already verified." });
      }

      const alloc = await allocateToInvoice(pool, p.house_number, p.amount, tx.request());

      await tx.request()
        .input("id", id)
        .input("inv", alloc ? alloc.invoiceId : null)
        .input("by", req.user.id)
        .query(`
          UPDATE payments
          SET status = 'verified',
              invoice_id = @inv,
              verified_by = @by,
              verified_at = SYSUTCDATETIME(),
              rejection_reason = NULL
          WHERE id = @id
        `);

      await tx.commit();

      res.json({
        ok: true,
        invoiceId: alloc ? alloc.invoiceId : null,
        invoiceStatus: alloc ? alloc.newStatus : null,
      });
    } catch (inner) {
      await tx.rollback();
      throw inner;
    }
  } catch (err) {
    next(err);
  }
});

/* ============================================================
   POST /api/payments/:id/reject   (admin)
   Body: { reason }
   ============================================================ */
router.post("/:id/reject", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const { reason } = req.body;

    const pool = await getPool();
    const result = await pool.request()
      .input("id", id)
      .input("reason", reason || null)
      .input("by", req.user.id)
      .query(`
        UPDATE payments
        SET status = 'rejected',
            rejection_reason = @reason,
            verified_by = @by,
            verified_at = SYSUTCDATETIME()
        WHERE id = @id AND status = 'pending'
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: "Payment not found or not pending." });
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;