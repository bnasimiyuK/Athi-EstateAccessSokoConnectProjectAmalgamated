/* ============================================================
   routes/categories.js — SQL Server version
   ============================================================ */

const express = require("express");
const router = express.Router();
const { getPool } = require("../db");

// GET /api/categories
router.get("/", async (req, res, next) => {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .query("SELECT id, label FROM Categories ORDER BY label");
    res.json(result.recordset);
  } catch (err) {
    next(err);
  }
});

module.exports = router;