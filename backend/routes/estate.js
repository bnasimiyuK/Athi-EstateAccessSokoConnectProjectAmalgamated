/* ============================================================
   routes/estate.js
   Backend endpoints for the Discover page.
   Mounted at /api/estate in server.js

   Model:
     phases (parent)  ──┐
                        └──► courts (child, has phase_id)
                                └──► providers (has court_id)
   ============================================================ */

const express = require("express");
const router = express.Router();

/* ------------------------------------------------------------
   Load the DB module
   ------------------------------------------------------------ */
let db = null;
try {
  db = require("../db");
} catch (err) {
  console.error("[estate] could not load ../db:", err.message);
}

function getPool() {
  if (!db) return null;
  if (db.pool) return db.pool;
  if (db.default && db.default.pool) return db.default.pool;
  return db;
}

/* ------------------------------------------------------------
   Universal query helper (mssql / mysql2 / sqlite3)
   ------------------------------------------------------------ */
async function query(sql, params = []) {
  const pool = getPool();
  if (!pool) throw new Error("Database module not loaded");

  // mssql (SQL Server)
  if (typeof pool.request === "function") {
    const req = pool.request();
    let i = 0;
    const sqlMssql = sql.replace(/\?/g, () => `@p${i++}`);
    params.forEach((val, idx) => req.input(`p${idx}`, val));
    const result = await req.query(sqlMssql);
    return result.recordset || [];
  }

  // mysql2/promise
  if (typeof pool.query === "function") {
    const [rows] = await pool.query(sql, params);
    return Array.isArray(rows) ? rows : [];
  }

  // sqlite3
  if (typeof pool.all === "function") {
    return await new Promise((resolve, reject) =>
      pool.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])))
    );
  }

  throw new Error("Unsupported db module shape");
}

async function queryOne(sql, params = []) {
  const pool = getPool();
  if (!pool) throw new Error("Database module not loaded");

  if (typeof pool.get === "function"
      && typeof pool.request !== "function"
      && typeof pool.query !== "function") {
    return await new Promise((resolve, reject) =>
      pool.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)))
    );
  }

  const rows = await query(sql, params);
  return rows && rows[0] ? rows[0] : null;
}

/* ============================================================
   GET /api/estate/stats
   ============================================================ */
router.get("/stats", async (req, res) => {
  const out = {
    totalProviders: 0,
    verifiedProviders: 0,
    readyNow: 0,
    distinctCourts: [],
  };

  try {
    const r = await queryOne("SELECT COUNT(*) AS c FROM providers");
    out.totalProviders = Number(r?.c ?? 0);
  } catch (e) { console.error("[stats] total:", e.message); }

  try {
    const r = await queryOne("SELECT COUNT(*) AS c FROM providers WHERE verified = 1");
    out.verifiedProviders = Number(r?.c ?? 0);
  } catch (e) { console.error("[stats] verified:", e.message); }

  try {
    const r = await queryOne(
      `SELECT COUNT(*) AS c FROM providers
       WHERE verified = 1 AND (is_available IS NULL OR is_available = 1)`
    );
    out.readyNow = Number(r?.c ?? 0);
  } catch (e) { console.error("[stats] ready:", e.message); }

  // Distinct courts — join providers → courts to get court names
  try {
    const rows = await query(
      `SELECT DISTINCT c.name AS court_name
         FROM providers p
         JOIN courts c ON c.id = p.court_id
        WHERE c.name IS NOT NULL AND c.name <> ''`
    );
    out.distinctCourts = rows.map((r) => r.court_name);
  } catch (e) { console.error("[stats] courts:", e.message); }

  res.json(out);
});

/* ============================================================
   GET /api/estate/phase-range
   Reads from the parent phases table
   ============================================================ */
router.get("/phase-range", async (req, res) => {
  try {
    const rows = await query(
      `SELECT id, name
         FROM phases
        WHERE name IS NOT NULL
        ORDER BY id`
    );

    const phases = rows.map((r) => ({
      id:   Number(r.id),
      name: String(r.name || ""),
    }));

    res.json({
  min: phases.length ? phases[0].id : null,
  max: phases.length ? phases[phases.length - 1].id : null,
  phases,                         // [{ id, name }]
  phaseIds: phases.map(p => p.id) // [1, 2]  ← legacy shape
});
  } catch (e) {
    console.error("[phase-range]", e.message);
    res.json({ min: null, max: null, phases: [] });
  }
});

/* ============================================================
   GET /api/estate/last-sync
   ============================================================ */
router.get("/last-sync", async (req, res) => {
  let lastSync = null;

  try {
    const r = await queryOne("SELECT MAX(updated_at) AS last FROM providers");
    lastSync = r?.last || null;
  } catch {}

  if (!lastSync) {
    try {
      const r = await queryOne("SELECT MAX(created_at) AS last FROM providers");
      lastSync = r?.last || null;
    } catch {}
  }

  res.json({ lastSync: lastSync || new Date().toISOString() });
});

/* ============================================================
   GET /api/estate/notice
   SQL Server: TOP 1, [key] escaped
   ============================================================ */
router.get("/notice", async (req, res) => {
  try {
    const row = await queryOne(
      `SELECT TOP 1 label, body, updated_at
         FROM estate_settings
        WHERE [key] = 'notice'`
    );
    if (row) {
      return res.json({
        label: row.label || "ATHI HIGHWAY ESTATE NOTICE",
        text: row.body || "",
        updatedAt: row.updated_at,
      });
    }
  } catch {}

  res.json({
    label: "ATHI HIGHWAY ESTATE NOTICE",
    text: "Payment is arranged directly between you and the provider. Verification confirms submitted details, not the quality of work.",
    updatedAt: new Date().toISOString(),
  });
});

/* ============================================================
   GET /api/estate/gate-rules
   ============================================================ */
router.get("/gate-rules", async (req, res) => {
  try {
    const rows = await query(
      `SELECT label, body, sort_order
         FROM gate_rules
        WHERE active = 1
        ORDER BY sort_order ASC`
    );
    if (rows.length) {
      return res.json({
        rules: rows.map((r) => ({ label: r.label, body: r.body })),
        updatedAt: new Date().toISOString(),
      });
    }
  } catch {}

  res.json({
    rules: [
      { label: "Gate 1 (main)", body: "Open 24/7 · Security on duty" },
      { label: "Gate 2 (biometric)", body: "06:00 – 22:00 EAT · All riders must scan" },
      { label: "Delivery riders", body: "Must be pre-registered by resident" },
      { label: "Visiting technicians", body: "National ID + booking code required" },
      { label: "Emergency access", body: "Any gate opens · Notify control desk" },
    ],
    updatedAt: new Date().toISOString(),
  });
});

/* ============================================================
   GET /api/estate/gate-status
   ============================================================ */
router.get("/gate-status", async (req, res) => {
  const nowEAT = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Africa/Nairobi" })
  );
  const hour = nowEAT.getHours();
  const minute = nowEAT.getMinutes();

  const GATE2_OPEN  = 6;
  const GATE2_CLOSE = 22;

  let status, label, shortLabel, nextChangeMinutes;

  if (hour >= GATE2_OPEN && hour < GATE2_CLOSE) {
    status = "live";
    label = "Gate Clearance: Live";
    shortLabel = "Live";
    nextChangeMinutes = ((GATE2_CLOSE - hour) * 60) - minute;
  } else if (hour === GATE2_CLOSE && minute < 30) {
    status = "busy";
    label = "Gate 2 closing soon";
    shortLabel = "Closing";
    nextChangeMinutes = 30 - minute;
  } else {
    status = "closed";
    label = "Gate 2 Closed · Gate 1 Open";
    shortLabel = "Closed";
    nextChangeMinutes = hour >= GATE2_CLOSE
      ? ((24 - hour + GATE2_OPEN) * 60) - minute
      : ((GATE2_OPEN - hour) * 60) - minute;
  }

  res.json({
    status, label, shortLabel,
    schedule: { gate1: "Open 24/7", gate2: "06:00 – 22:00 EAT" },
    nextChangeMinutes, hour, minute,
    at: nowEAT.toISOString(),
  });
});

/* ============================================================
   GET /api/estate/categories/with-counts
   Optional filter: ?phaseId=1  or  ?courtId=5
   ============================================================ */
/* ============================================================
   GET /api/estate/categories/with-counts
   Optional filters: ?phaseId=1  or  ?courtId=5
   providers.category_id → categories.id
   providers.court_id    → courts.id     (adjust if named differently)
   courts.phase_id       → phases.id     (adjust if named differently)
   ============================================================ */
/* ============================================================
   GET /api/estate/categories/with-counts
   Optional filters: ?phaseId=1  ?courtId=5

   Join chain:
     providers.category_id → categories.id
     providers.resident_id → residents.id
     residents.court_id    → courts.id
     courts.phase          → phases.id
   ============================================================ */
router.get("/categories/with-counts", async (req, res) => {
  const phaseId = req.query.phaseId ? Number(req.query.phaseId) : null;
  const courtId = req.query.courtId ? Number(req.query.courtId) : null;

  try {
    let sql = `
      SELECT c.id, c.label,
             COUNT(p.id) AS vendors
        FROM categories c
        LEFT JOIN providers p
          ON p.category_id = c.id
         AND p.verified = 1
    `;
    const params = [];

    if (phaseId || courtId) {
      sql = `
        SELECT c.id, c.label,
               COUNT(p.id) AS vendors
          FROM categories c
          LEFT JOIN providers p
            ON p.category_id = c.id
           AND p.verified = 1
          LEFT JOIN residents r
            ON r.id = p.resident_id
          LEFT JOIN courts co
            ON co.id = r.court_id
      `;

      if (courtId) {
        sql += " AND co.id = ?";
        params.push(courtId);
      } else if (phaseId) {
        sql += " AND co.phase = ?";      // ← corrected: courts.phase (tinyint)
        params.push(phaseId);
      }
    }

    sql += " GROUP BY c.id, c.label ORDER BY c.label";

    const rows = await query(sql, params);

    res.json(rows.map((r) => ({
      id: r.id,
      label: r.label,
      count: Number(r.vendors || 0),
    })));
  } catch (e) {
    console.error("[categories/with-counts]", e.message);
    res.json([]);
  }
});

module.exports = router;