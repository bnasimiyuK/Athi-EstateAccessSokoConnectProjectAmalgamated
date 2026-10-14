/* ============================================================
   routes/courts.js - SQL Server version
   Courts are the primary geographic unit. Each court belongs
   to exactly one phase (1 or 2).
   ============================================================ */

const express = require("express");
const router = express.Router();
const { getPool } = require("../db");

function courtToJson(row) {
  return {
    id:        row.id,
    name:      row.name,
    phase:     row.phase,
    createdAt: row.created_at,
  };
}

/* GET /api/courts?phase= */
router.get("/", async (req, res, next) => {
  try {
    const { phase } = req.query;
    const pool = await getPool();
    const request = pool.request();

    let where = "";
    if (phase) {
      where = "WHERE phase = @phase";
      request.input("phase", parseInt(phase, 10));
    }

    const result = await request.query(`
      SELECT * FROM Courts ${where}
      ORDER BY phase ASC, name ASC
    `);
    res.json(result.recordset.map(courtToJson));
  } catch (err) {
    next(err);
  }
});

/* POST /api/courts  { name, phase } - admin can add new courts */
router.post("/", async (req, res, next) => {
  try {
    const { name, phase } = req.body;

    if (!name || !phase) {
      return res.status(400).json({ error: "name and phase are required" });
    }

    const phaseInt = parseInt(phase, 10);
    if (phaseInt !== 1 && phaseInt !== 2) {
      return res.status(400).json({ error: "phase must be 1 or 2" });
    }

    const pool = await getPool();

    // Check for duplicate (name + phase)
    const existing = await pool.request()
      .input("name",  name.trim())
      .input("phase", phaseInt)
      .query("SELECT id FROM Courts WHERE name = @name AND phase = @phase");
    if (existing.recordset.length) {
      return res.status(409).json({ error: "Court already exists in this phase." });
    }

    const inserted = await pool.request()
      .input("name",  name.trim())
      .input("phase", phaseInt)
      .query(`
        INSERT INTO Courts (name, phase)
        OUTPUT INSERTED.*
        VALUES (@name, @phase)
      `);

    res.status(201).json(courtToJson(inserted.recordset[0]));
  } catch (err) {
    next(err);
  }
});

module.exports = router;