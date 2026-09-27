/* ============================================================
   routes/reports.js — SQL Server version
   ============================================================ */

const express = require("express");
const router = express.Router();
const { getPool } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");

/* ------------------------------------------------------------
   Helper: DB row → JSON frontend expects
   ------------------------------------------------------------ */
function reportToJson(row) {
  return {
    id:           row.id,
    providerId:   row.provider_id,
    providerName: row.provider_name,
    reason:       row.reason,
    details:      row.details || "",
    status:       row.status,
    createdAt:    row.created_at,
  };
}

/* ------------------------------------------------------------
   GET /api/reports  — ADMIN ONLY (Paginated)
   Query: ?page=1&limit=20
   Returns: { data, total, openCount, page, limit, totalPages }
   ------------------------------------------------------------ */
router.get("/",
  requireAuth,
  requireRole("admin"),
  async (req, res, next) => {
    try {
      const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
      const offset = (page - 1) * limit;

      const pool = await getPool();

      // Get total + open count for the tab badge
      const countsRes = await pool.request().query(`
        SELECT
          COUNT(*)                                          AS total,
          SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END)  AS open_count
        FROM Reports
      `);
      const total     = countsRes.recordset[0].total || 0;
      const openCount = countsRes.recordset[0].open_count || 0;

      // Fetch just this page
      const result = await pool.request()
        .input("offset", offset)
        .input("limit",  limit)
        .query(`
          SELECT r.*, p.name AS provider_name
          FROM Reports r
          LEFT JOIN Providers p ON p.id = r.provider_id
          ORDER BY r.created_at DESC
          OFFSET @offset ROWS
          FETCH NEXT @limit ROWS ONLY
        `);

      res.json({
        data:       result.recordset.map(reportToJson),
        total,
        openCount,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      });
    } catch (err) {
      next(err);
    }
  }
);

/* ------------------------------------------------------------
   POST /api/reports  — any logged-in user
   Body: { providerId, reason, details }
   ------------------------------------------------------------ */
router.post("/",
  requireAuth,
  async (req, res, next) => {
    try {
      const { providerId, reason, details } = req.body;

      if (!providerId || !reason || !details) {
        return res.status(400).json({ error: "Missing required report fields." });
      }

      const providerIdInt = parseInt(providerId, 10);
      if (isNaN(providerIdInt)) {
        return res.status(400).json({ error: "Invalid provider id" });
      }

      const pool = await getPool();

      const inserted = await pool.request()
        .input("providerId", providerIdInt)
        .input("reason",     reason)
        .input("details",    details)
        .query(`
          INSERT INTO Reports (provider_id, reason, details)
          OUTPUT INSERTED.*
          VALUES (@providerId, @reason, @details)
        `);

      const enriched = await pool.request()
        .input("id", inserted.recordset[0].id)
        .query(`
          SELECT r.*, p.name AS provider_name
          FROM Reports r
          LEFT JOIN Providers p ON p.id = r.provider_id
          WHERE r.id = @id
        `);

      res.status(201).json(reportToJson(enriched.recordset[0]));
    } catch (err) {
      next(err);
    }
  }
);

/* ------------------------------------------------------------
   PATCH /api/reports/:id  { status } — ADMIN ONLY
   ------------------------------------------------------------ */
router.patch("/:id",
  requireAuth,
  requireRole("admin"),
  async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid report id" });

      if (!req.body.status) {
        return res.status(400).json({ error: "status is required" });
      }

      const pool = await getPool();
      const updated = await pool.request()
        .input("id",     id)
        .input("status", req.body.status)
        .query(`
          UPDATE Reports SET status = @status
          OUTPUT INSERTED.*
          WHERE id = @id
        `);

      if (!updated.recordset.length) {
        return res.status(404).json({ error: "Report not found" });
      }

      const enriched = await pool.request()
        .input("id", id)
        .query(`
          SELECT r.*, p.name AS provider_name
          FROM Reports r
          LEFT JOIN Providers p ON p.id = r.provider_id
          WHERE r.id = @id
        `);

      res.json(reportToJson(enriched.recordset[0]));
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;