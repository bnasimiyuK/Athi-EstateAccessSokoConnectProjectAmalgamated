/* ============================================================
   routes/admin.js — admin-only stats & dashboard endpoints
   ============================================================ */

const express = require("express");
const router = express.Router();
const { getPool } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");

/* ------------------------------------------------------------
   GET /api/admin/stats
   Returns counts for the admin dashboard tiles.
   Admin-only.
   ------------------------------------------------------------ */
router.get("/stats",
  requireAuth,
  requireRole("admin"),
  async (req, res, next) => {
    try {
      const pool = await getPool();

      const result = await pool.request().query(`
        SELECT
          (SELECT COUNT(*) FROM Residents WHERE verified = 0) AS pending_residents,
          (SELECT COUNT(*) FROM Residents WHERE verified = 1) AS approved_residents,
          (SELECT COUNT(*) FROM Providers WHERE verified = 0) AS pending_vendors,
          (SELECT COUNT(*) FROM Providers WHERE verified = 1) AS approved_vendors,
          (SELECT COUNT(*) FROM Bookings)                     AS total_bookings,
          (SELECT COUNT(*) FROM Bookings WHERE status = 'requested') AS open_bookings,
          (SELECT COUNT(*) FROM Reports WHERE status = 'open')       AS open_reports,
          (SELECT COUNT(*) FROM Courts)                       AS total_courts
      `);

      const row = result.recordset[0];

      res.json({
        pendingResidents:  row.pending_residents,
        approvedResidents: row.approved_residents,
        pendingVendors:    row.pending_vendors,
        approvedVendors:   row.approved_vendors,
        totalBookings:     row.total_bookings,
        openBookings:      row.open_bookings,
        openReports:       row.open_reports,
        totalCourts:       row.total_courts,
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;