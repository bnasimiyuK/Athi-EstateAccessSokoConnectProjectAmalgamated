/* ============================================================
   routes/adminHealth.js
   Admin diagnostics endpoint that surfaces billing drift.
   Runs the same integrity checks we've been running manually.
   ============================================================ */

const express = require("express");
const router  = express.Router();
const { getPool } = require("../db");
const { requireAuth } = require("../middleware/auth");

/* GET /api/admin/health/billing */
router.get("/billing", requireAuth, async (req, res, next) => {
  try {
    const pool = await getPool();

    /* 1. Orphaned invoices: unpaid + verified payment exists */
    const orphanedInvoices = await pool.request().query(`
      SELECT
        inv.id, inv.resident_id, r.full_name, r.house_number,
        inv.type, inv.status, inv.amount_due, inv.amount_paid,
        (SELECT TOP 1 mpesa_receipt FROM payments p
         WHERE p.resident_id = inv.resident_id
           AND p.type = inv.type AND p.status = 'verified'
         ORDER BY p.id DESC) AS last_receipt
      FROM invoices inv
      JOIN Residents r ON r.id = inv.resident_id
      WHERE inv.status != 'paid'
        AND EXISTS (
          SELECT 1 FROM payments p
          WHERE p.resident_id = inv.resident_id
            AND p.type = inv.type
            AND p.status = 'verified'
        )
      ORDER BY inv.resident_id, inv.id
    `);

    /* 2. Duplicate invoices per (resident, type, month) */
    const duplicates = await pool.request().query(`
      SELECT resident_id, type, billing_month, COUNT(*) AS dupe_count
      FROM invoices
      GROUP BY resident_id, type, billing_month
      HAVING COUNT(*) > 1
      ORDER BY resident_id, type
    `);

    /* 3. Orphaned payments: verified payment with no matching invoice */
    const orphanedPayments = await pool.request().query(`
      SELECT p.id, p.resident_id, r.full_name, r.house_number,
             p.type, p.amount, p.mpesa_receipt, p.payment_date
      FROM payments p
      JOIN Residents r ON r.id = p.resident_id
      WHERE p.status = 'verified'
        AND NOT EXISTS (
          SELECT 1 FROM invoices i
          WHERE i.resident_id = p.resident_id AND i.type = p.type
        )
      ORDER BY p.resident_id, p.id
    `);

    /* 4. Stale pending STK rows (>5 min old) */
    const stalePending = await pool.request().query(`
      SELECT checkout_request_id, phone, amount, purpose,
             DATEDIFF(minute, created_at, SYSUTCDATETIME()) AS age_minutes,
             created_at
      FROM mpesa_pending
      WHERE status = 'pending'
        AND created_at < DATEADD(minute, -5, SYSUTCDATETIME())
      ORDER BY created_at ASC
    `);

    /* 5. Overpaid invoices */
    const overpaid = await pool.request().query(`
      SELECT id, resident_id, type, amount_due, amount_paid, status
      FROM invoices
      WHERE amount_paid > amount_due
      ORDER BY resident_id, id
    `);

    /* 6. Summary counts */
    const summary = await pool.request().query(`
      SELECT
        (SELECT COUNT(*) FROM Residents)                                               AS total_residents,
        (SELECT COUNT(*) FROM invoices WHERE status = 'paid')                          AS paid_invoices,
        (SELECT COUNT(*) FROM invoices WHERE status IN ('unpaid','partial','overdue')) AS unpaid_invoices,
        (SELECT COUNT(*) FROM payments WHERE status = 'verified')                      AS verified_payments,
        (SELECT COUNT(*) FROM mpesa_pending WHERE status = 'pending')                  AS pending_stk,
        (SELECT COUNT(*) FROM mpesa_pending WHERE status = 'failed')                   AS failed_stk,
        (SELECT COUNT(*) FROM mpesa_pending WHERE status = 'paid')                     AS paid_stk,
        (SELECT COUNT(*) FROM mpesa_pending WHERE status = 'abandoned')                AS abandoned_stk
    `);

    const issues = {
      orphanedInvoices: orphanedInvoices.recordset,
      duplicates:       duplicates.recordset,
      orphanedPayments: orphanedPayments.recordset,
      stalePending:     stalePending.recordset,
      overpaid:         overpaid.recordset,
    };

    const totalIssues = Object.values(issues).reduce((s, arr) => s + arr.length, 0);

    res.json({
      checkedAt: new Date().toISOString(),
      summary: summary.recordset[0],
      issues,
      totalIssues,
      healthy: totalIssues === 0,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;