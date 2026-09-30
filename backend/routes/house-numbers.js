/* ============================================================
   routes/house-numbers.js — Assign house numbers to residents
   Format: {CourtName}-{Side}{NN}   e.g. Riverside-A01
   ============================================================ */

const express = require("express");
const router = express.Router();
const { getPool } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");

/* ------------------------------------------------------------
   Helpers
   ------------------------------------------------------------ */
function buildHouseNumber(courtName, side, seq) {
  const s = String(side || "").toUpperCase();
  if (s !== "A" && s !== "B") throw new Error("Side must be A or B");
  const n = parseInt(seq, 10);
  if (!Number.isFinite(n) || n < 1 || n > 99) throw new Error("Sequence must be 1–99");
  const nn = String(n).padStart(2, "0");
  return `${courtName}-${s}${nn}`;
}

/* ------------------------------------------------------------
   GET /api/house-numbers/summary
   Admin — counts of residents with/without house numbers
   ------------------------------------------------------------ */
router.get("/summary", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query(`
      SELECT
        SUM(CASE WHEN house_number IS NOT NULL THEN 1 ELSE 0 END) AS assigned,
        SUM(CASE WHEN house_number IS NULL     THEN 1 ELSE 0 END) AS unassigned,
        COUNT(*) AS total
      FROM Residents
      WHERE verified = 1
    `);
    const row = r.recordset[0];
    res.json({
      assigned:   Number(row.assigned)   || 0,
      unassigned: Number(row.unassigned) || 0,
      total:      Number(row.total)      || 0,
    });
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------
   GET /api/house-numbers/residents
   Admin — list verified residents with house-number status
   Query: q, courtId, status (assigned|unassigned), page, limit
   ------------------------------------------------------------ */
router.get("/residents", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const { q, courtId, status, page = 1, limit = 20 } = req.query;
    const pageNum  = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 20));
    const offset   = (pageNum - 1) * limitNum;

    const where = ["r.verified = 1"];
    const bind  = (r) => {
      if (q && q.trim()) {
        where.push("(r.full_name LIKE @q OR r.phone LIKE @q OR r.house_number LIKE @q)");
        r.input("q", `%${q.trim()}%`);
      }
      if (courtId) { where.push("r.court_id = @courtId"); r.input("courtId", parseInt(courtId, 10)); }
      if (status === "assigned")   where.push("r.house_number IS NOT NULL");
      if (status === "unassigned") where.push("r.house_number IS NULL");
    };

    const pool = await getPool();
    const whereSql = "WHERE " + where.join(" AND ");

    const countReq = pool.request(); bind(countReq);
    const countRes = await countReq.query(`
      SELECT COUNT(*) AS total
      FROM Residents r
      ${whereSql}
    `);
    const total = countRes.recordset[0].total || 0;

    const dataReq = pool.request(); bind(dataReq);
    dataReq.input("offset", offset);
    dataReq.input("limit",  limitNum);
    const dataRes = await dataReq.query(`
      SELECT r.id, r.full_name, r.phone, r.email,
             r.court_id, r.house_number, r.access_blocked,
             c.name AS court_name, c.phase
      FROM Residents r
      JOIN Courts c ON c.id = r.court_id
      ${whereSql}
      ORDER BY c.phase ASC, c.name ASC, r.full_name ASC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

    res.json({
      data: dataRes.recordset.map((row) => ({
        id:            row.id,
        fullName:      row.full_name,
        phone:         row.phone,
        email:         row.email || "",
        courtId:       row.court_id,
        courtName:     row.court_name,
        phase:         row.phase,
        houseNumber:   row.house_number || null,
        accessBlocked: !!row.access_blocked,
      })),
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 1,
    });
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------
   PATCH /api/house-numbers/residents/:id
   Admin — assign or clear a single house number
   Body: { houseNumber }  (empty string → clears)
   ------------------------------------------------------------ */
router.patch("/residents/:id", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    let hno = req.body.houseNumber;
    if (hno === undefined) return res.status(400).json({ error: "houseNumber is required" });
    hno = hno === null || String(hno).trim() === "" ? null : String(hno).trim();

    /* Format validation (only if not clearing) */
    if (hno !== null) {
      const re = /^[A-Za-z][A-Za-z0-9 .'&]*-[AB]\d{2}$/;
      if (!re.test(hno)) {
        return res.status(400).json({
          error: "Format must be {CourtName}-{A|B}{NN}, e.g. Riverside-A01",
        });
      }
    }

    const pool = await getPool();

    /* Confirm resident exists + is approved */
    const existing = await pool.request()
      .input("id", id)
      .query("SELECT id, verified FROM Residents WHERE id = @id");
    if (!existing.recordset.length) {
      return res.status(404).json({ error: "Resident not found" });
    }
    if (!existing.recordset[0].verified) {
      return res.status(400).json({ error: "Resident not yet approved" });
    }

    try {
      await pool.request()
        .input("id", id)
        .input("hno", hno)
        .query(`
          UPDATE Residents
          SET house_number = @hno
          WHERE id = @id
        `);
    } catch (err) {
      if (err.number === 2601 || err.number === 2627) {
        return res.status(409).json({ error: "That house number is already assigned to another resident." });
      }
      throw err;
    }

    res.json({ ok: true, id, houseNumber: hno });
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------
   POST /api/house-numbers/bulk
   Admin — bulk assign via CSV-like JSON
   Body: { rows: [{ phone, houseNumber }, ...] }
   Matches residents by phone (last 9 digits, tolerant of +254/07...)
   ------------------------------------------------------------ */
router.post("/bulk", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const rows = Array.isArray(req.body.rows) ? req.body.rows : null;
    if (!rows || !rows.length) {
      return res.status(400).json({ error: "rows array is required" });
    }

    const pool = await getPool();
    const results = { ok: 0, notFound: [], invalid: [], duplicate: [] };
    const seenHno = new Set();

    const normPhone = (p) => {
      const digits = String(p || "").replace(/\D/g, "");
      return digits.slice(-9);
    };

    /* Preload all approved residents with phone → id + house_number */
    const all = await pool.request().query(`
      SELECT id, phone, house_number
      FROM Residents
      WHERE verified = 1
    `);
    const byPhone = new Map();
    for (const r of all.recordset) {
      byPhone.set(normPhone(r.phone), r);
    }

    for (const row of rows) {
      const phone = String(row.phone || "").trim();
      const hno   = String(row.houseNumber || "").trim();

      if (!phone || !hno) {
        results.invalid.push({ phone, houseNumber: hno, reason: "Missing phone or houseNumber" });
        continue;
      }

      /* Format check */
      const re = /^[A-Za-z][A-Za-z0-9 .'&]*-[AB]\d{2}$/;
      if (!re.test(hno)) {
        results.invalid.push({ phone, houseNumber: hno, reason: "Bad format" });
        continue;
      }

      const resident = byPhone.get(normPhone(phone));
      if (!resident) {
        results.notFound.push({ phone, houseNumber: hno });
        continue;
      }

      /* Same file duplicate check */
      if (seenHno.has(hno)) {
        results.duplicate.push({ phone, houseNumber: hno, reason: "Duplicate within upload" });
        continue;
      }
      seenHno.add(hno);

      try {
        await pool.request()
          .input("id", resident.id)
          .input("hno", hno)
          .query(`UPDATE Residents SET house_number = @hno WHERE id = @id`);
        results.ok++;
      } catch (err) {
        if (err.number === 2601 || err.number === 2627) {
          results.duplicate.push({ phone, houseNumber: hno, reason: "Already assigned to another resident" });
        } else {
          results.invalid.push({ phone, houseNumber: hno, reason: err.message });
        }
      }
    }

    res.json(results);
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------
   GET /api/house-numbers/proposal
   Admin — return a CSV-ready proposal (resident, court, suggestion)
   Format: {CourtName}-{A|B}{NN}  — best-effort guess, admin edits
   ------------------------------------------------------------ */
router.get("/proposal", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query(`
      WITH numbered AS (
        SELECT
          r.id,
          r.full_name,
          r.phone,
          c.id     AS court_id,
          c.name   AS court_name,
          c.phase,
          ROW_NUMBER() OVER (
            PARTITION BY r.court_id, (r.id % 2)
            ORDER BY r.id
          ) AS seq,
          CASE WHEN r.id % 2 = 0 THEN 'A' ELSE 'B' END AS side
        FROM Residents r
        JOIN Courts c ON c.id = r.court_id
        WHERE r.house_number IS NULL AND r.verified = 1
      )
      SELECT
        id,
        full_name AS fullName,
        phone,
        court_name AS courtName,
        phase,
        side,
        court_name + '-' + side + RIGHT('00' + CAST(seq AS NVARCHAR(2)), 2) AS suggestedHouseNumber
      FROM numbered
      ORDER BY phase, court_name, side, seq
    `);

    res.json(r.recordset);
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------
   GET /api/house-numbers/assigned
   List all house numbers currently in use (for dropdown greying).
   ------------------------------------------------------------ */
router.get("/assigned", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query(`
      SELECT house_number, id AS resident_id
      FROM Residents
      WHERE house_number IS NOT NULL
    `);
    res.json(r.recordset);
  } catch (err) { next(err); }
});

module.exports = router;