/* ============================================================
   routes/discover.js — Discover-page live data endpoints
     GET /api/categories/counts
     GET /api/phase-range
     GET /api/notice
     GET /api/gate/status
     GET /api/last-sync
     GET /api/gate/rules
   ============================================================ */

const express = require("express");
const router  = express.Router();
const { getPool } = require("../db");

/* ------------------------------------------------------------
   GET /api/categories/counts
   Returns each category with a live count of verified providers.
   ------------------------------------------------------------ */
/* ------------------------------------------------------------
   GET /api/categories/counts
   Robust: detects the real column names in Categories / Providers.
   ------------------------------------------------------------ */
router.get("/categories/counts", async (_req, res, next) => {
  try {
    const pool = await getPool();

    /* Step 1 — figure out the column names in Categories */
    const catCols = await pool.request().query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'Categories'
    `);
    const catSet = new Set(catCols.recordset.map((r) => r.COLUMN_NAME));

    // Pick the label column that exists
    const labelCol =
      catSet.has("label") ? "label" :
      catSet.has("name")  ? "name"  :
      catSet.has("title") ? "title" : null;

    // Pick the icon column (icon / emoji / symbol)
    const iconCol =
      catSet.has("icon")   ? "icon"   :
      catSet.has("emoji")  ? "emoji"  :
      catSet.has("symbol") ? "symbol" : null;

    if (!labelCol) {
      return res.json([]);
    }

    /* Step 2 — figure out the verified / status column in Providers */
    const provCols = await pool.request().query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'Providers'
    `);
    const provSet = new Set(provCols.recordset.map((r) => r.COLUMN_NAME));

    const categoryCol = provSet.has("category")   ? "category"   :
                        provSet.has("category_id") ? "category_id" : null;

    const verifiedCol = provSet.has("verified")   ? "verified"   :
                        provSet.has("is_verified") ? "is_verified" :
                        provSet.has("status")      ? "status"      : null;

    if (!categoryCol) {
      // Can't join — just return the categories without counts
      const r = await pool.request().query(`
        SELECT id, ${labelCol} AS label ${iconCol ? `, ${iconCol} AS icon` : ", NULL AS icon"}
        FROM Categories
        ORDER BY ${labelCol}
      `);
      return res.json(r.recordset.map((x) => ({
        id: x.id,
        label: x.label,
        icon: x.icon || null,
        count: 0,
      })));
    }

    /* Step 3 — build the count query with the columns we found */
    const verifiedFilter = verifiedCol === "status"
      ? `AND p.[status] = 'verified'`
      : verifiedCol
        ? `AND p.[${verifiedCol}] = 1`
        : "";

    const iconSelect = iconCol ? `, c.[${iconCol}] AS icon` : `, NULL AS icon`;

    const sql = `
      SELECT
        c.id,
        c.[${labelCol}] AS label
        ${iconSelect},
        COUNT(p.id) AS count
      FROM Categories c
      LEFT JOIN Providers p
        ON p.[${categoryCol}] = c.id
       ${verifiedFilter}
      GROUP BY c.id, c.[${labelCol}]${iconCol ? `, c.[${iconCol}]` : ""}
      ORDER BY c.[${labelCol}]
    `;

    const r = await pool.request().query(sql);

    res.json(r.recordset.map((x) => ({
      id: x.id,
      label: x.label,
      icon: x.icon || null,
      count: Number(x.count) || 0,
    })));
  } catch (err) {
    console.error("[discover] /categories/counts error:", err);
    next(err);
  }
});
/* ------------------------------------------------------------
   GET /api/phase-range
   Smallest and largest phase present in the Courts table.
   ------------------------------------------------------------ */
router.get("/phase-range", async (_req, res, next) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query(
      "SELECT MIN(phase) AS min, MAX(phase) AS max FROM Courts"
    );
    const row = r.recordset[0] || {};
    res.json({
      min: row.min != null ? Number(row.min) : null,
      max: row.max != null ? Number(row.max) : null,
    });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------
   GET /api/notice
   Most recent active notice. If there is no Notices table,
   falls back to a hardcoded welcome message.
   ------------------------------------------------------------ */
router.get("/notice", async (_req, res, next) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query(`
      SELECT TOP 1 label, text
      FROM Notices
      WHERE active = 1
      ORDER BY created_at DESC
    `);
    const row = r.recordset[0];
    if (row) {
      return res.json({ label: row.label, text: row.text });
    }
    return res.json(null);
  } catch (err) {
    // Notices table may not exist yet — don't crash, return null.
    console.warn("[discover] /notice fallback:", err.message);
    res.json(null);
  }
});

/* ------------------------------------------------------------
   GET /api/gate/status
   Live gate status derived from EAT time.
     Gate 1 — open 24/7
     Gate 2 — open 06:00 – 22:00 EAT daily
   ------------------------------------------------------------ */
router.get("/gate/status", (_req, res) => {
  const nowEAT = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Africa/Nairobi" })
  );
  const h   = nowEAT.getHours();
  const m   = nowEAT.getMinutes();
  const live = h >= 6 && h < 22;

  // Minutes until next change
  let nextChangeMinutes;
  if (live) {
    // closes at 22:00
    nextChangeMinutes = (22 - h) * 60 - m;
  } else {
    // reopens at 06:00 tomorrow (or today if before 6am)
    nextChangeMinutes = h < 6
      ? (6 - h) * 60 - m
      : (24 - h + 6) * 60 - m;
  }

  res.json({
    status: live ? "live" : "closed",
    label:  live ? "Gate: Live" : "Gate 2 Closed",
    nextChangeMinutes,
    nowEAT: nowEAT.toISOString(),
  });
});

/* ------------------------------------------------------------
   GET /api/last-sync
   Timestamp of the most recent write to a providers / residents
   table. Used by the "Live <time>" chip in the notice bar.
   ------------------------------------------------------------ */
router.get("/last-sync", async (_req, res, next) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query(`
      SELECT MAX(latest) AS latest FROM (
        SELECT MAX(updated_at) AS latest FROM Providers
        UNION ALL
        SELECT MAX(updated_at) AS latest FROM Residents
        UNION ALL
        SELECT MAX(updated_at) AS latest FROM Payments
      ) t
    `);
    const row = r.recordset[0];
    const iso = row && row.latest ? new Date(row.latest).toISOString()
                                  : new Date().toISOString();
    res.json(iso);
  } catch (err) {
    // Tables may lack an updated_at column — fall back to "now"
    console.warn("[discover] /last-sync fallback:", err.message);
    res.json(new Date().toISOString());
  }
});

/* ------------------------------------------------------------
   GET /api/gate/rules
   Policy list shown in the Gate Rules modal.
   ------------------------------------------------------------ */
router.get("/gate/rules", async (_req, res, next) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query(`
      SELECT TOP 20 label, body
      FROM GateRules
      WHERE active = 1
      ORDER BY sort_order
    `);
    if (r.recordset.length) {
      return res.json({
        updatedAt: new Date().toISOString(),
        rules: r.recordset.map((x) => ({ label: x.label, body: x.body })),
      });
    }
  } catch (err) {
    // GateRules table may not exist — fall back below
  }

  // Fallback — same rules the frontend would have shown
  res.json({
    updatedAt: new Date().toISOString(),
    rules: [
      { label: "Gate 1",   body: "Open 24/7 for residents and registered visitors." },
      { label: "Gate 2",   body: "Open 06:00 – 22:00 EAT daily." },
      { label: "Visitors", body: "Must be pre-registered or announced at the control desk." },
    ],
  });
});

module.exports = router;