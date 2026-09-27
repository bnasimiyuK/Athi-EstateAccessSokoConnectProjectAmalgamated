/* ============================================================
   routes/reports.js — SQL Server version
   ============================================================ */

const express = require("express");
const router = express.Router();
const { getPool } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");   // ← ADDED

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
   GET /api/reports  — ADMIN ONLY
   ------------------------------------------------------------ */
router.get("/",
  requireAuth,
  requireRole("admin"),
  async (req, res, next) => {
    try {
      const pool = await getPool();
      const result = await pool.request().query(`
        SELECT r.*, p.name AS provider_name
        FROM Reports r
        LEFT JOIN Providers p ON p.id = r.provider_id
        ORDER BY r.created_at DESC
      `);
      res.json(result.recordset.map(reportToJson));
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