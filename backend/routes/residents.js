/* ============================================================
   routes/residents.js — SQL Server version (court_id based)
   Residents reference a court; the court's phase is derived.
   ============================================================ */

const express = require("express");
const router = express.Router();
const { getPool } = require("../db");

/* ------------------------------------------------------------
   Helper: DB row → JSON (joins court info)
   ------------------------------------------------------------ */
function residentToJson(row) {
  return {
    id:          row.id,
    fullName:    row.full_name,
    phone:       row.phone,
    email:       row.email || "",
    courtId:     row.court_id,
    courtName:   row.court_name,      // from JOIN
    phase:       row.phase,           // from JOIN
    verified:    !!row.verified,
    createdAt:   row.created_at,
  };
}

/* ------------------------------------------------------------
   GET /api/residents?phase=&courtId=&q=&verified=
   ------------------------------------------------------------ */
router.get("/", async (req, res, next) => {
  try {
    const { phase, courtId, q, verified } = req.query;
    const pool = await getPool();
    const request = pool.request();
    const where = [];

    if (phase) {
      where.push("c.phase = @phase");
      request.input("phase", parseInt(phase, 10));
    }
    if (courtId) {
      where.push("r.court_id = @courtId");
      request.input("courtId", parseInt(courtId, 10));
    }
    if (q && q.trim()) {
      where.push("(r.full_name LIKE @q OR r.phone LIKE @q)");
      request.input("q", `%${q.trim()}%`);
    }
    if (verified === "true" || verified === "false") {
      where.push("r.verified = @verified");
      request.input("verified", verified === "true" ? 1 : 0);
    }

    const sqlText = `
      SELECT r.*, c.name AS court_name, c.phase
      FROM Residents r
      JOIN Courts c ON c.id = r.court_id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY c.phase ASC, c.name ASC, r.full_name ASC
    `;

    const result = await request.query(sqlText);
    res.json(result.recordset.map(residentToJson));
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------
   GET /api/residents/:id
   ------------------------------------------------------------ */
router.get("/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const pool = await getPool();
    const result = await pool.request()
      .input("id", id)
      .query(`
        SELECT r.*, c.name AS court_name, c.phase
        FROM Residents r
        JOIN Courts c ON c.id = r.court_id
        WHERE r.id = @id
      `);

    if (!result.recordset.length) {
      return res.status(404).json({ error: "Resident not found" });
    }
    res.json(residentToJson(result.recordset[0]));
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------
   POST /api/residents
   Body: { fullName, phone, email, courtId }
   ------------------------------------------------------------ */
router.post("/", async (req, res, next) => {
  try {
    const { fullName, phone, email, courtId } = req.body;

    if (!fullName || !phone || !courtId) {
      return res.status(400).json({ error: "fullName, phone, and courtId are required." });
    }

    const courtIdInt = parseInt(courtId, 10);
    if (isNaN(courtIdInt)) {
      return res.status(400).json({ error: "Invalid courtId." });
    }

    const pool = await getPool();

    // Verify court exists
    const court = await pool.request()
      .input("courtId", courtIdInt)
      .query("SELECT id FROM Courts WHERE id = @courtId");
    if (!court.recordset.length) {
      return res.status(400).json({ error: "Court not found." });
    }

    // Check phone uniqueness
    const existing = await pool.request()
      .input("phone", phone.trim())
      .query("SELECT id FROM Residents WHERE phone = @phone");
    if (existing.recordset.length) {
      return res.status(409).json({ error: "Phone number already registered." });
    }

    const inserted = await pool.request()
      .input("fullName", fullName.trim())
      .input("phone",    phone.trim())
      .input("email",    email ? email.trim() : null)
      .input("courtId",  courtIdInt)
      .query(`
        INSERT INTO Residents (full_name, phone, email, court_id, verified)
        OUTPUT INSERTED.*
        VALUES (@fullName, @phone, @email, @courtId, 0)
      `);

    // Re-fetch with court info for consistent response shape
    const full = await pool.request()
      .input("id", inserted.recordset[0].id)
      .query(`
        SELECT r.*, c.name AS court_name, c.phase
        FROM Residents r
        JOIN Courts c ON c.id = r.court_id
        WHERE r.id = @id
      `);

    res.status(201).json(residentToJson(full.recordset[0]));
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------
   PATCH /api/residents/:id
   Body: { fullName, phone, email, courtId, verified }
   ------------------------------------------------------------ */
router.patch("/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const map = {
      fullName: "full_name",
      phone:    "phone",
      email:    "email",
      courtId:  "court_id",
      verified: "verified",
    };

    const request = (await getPool()).request().input("id", id);
    const sets = [];

    for (const [key, col] of Object.entries(map)) {
      if (req.body[key] !== undefined) {
        let val = req.body[key];
        if (col === "court_id") val = parseInt(val, 10);
        if (col === "verified") val = val ? 1 : 0;
        request.input(col, val);
        sets.push(`${col} = @${col}`);
      }
    }

    if (!sets.length) {
      return res.status(400).json({ error: "No updatable fields provided" });
    }

    const updated = await request.query(`
      UPDATE Residents SET ${sets.join(", ")}
      OUTPUT INSERTED.*
      WHERE id = @id
    `);

    if (!updated.recordset.length) {
      return res.status(404).json({ error: "Resident not found" });
    }

    // Re-fetch with court info
    const full = await (await getPool()).request()
      .input("id", id)
      .query(`
        SELECT r.*, c.name AS court_name, c.phase
        FROM Residents r
        JOIN Courts c ON c.id = r.court_id
        WHERE r.id = @id
      `);

    res.json(residentToJson(full.recordset[0]));
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------
   DELETE /api/residents/:id
   ------------------------------------------------------------ */
router.delete("/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const pool = await getPool();
    const result = await pool.request()
      .input("id", id)
      .query("DELETE FROM Residents WHERE id = @id");

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: "Resident not found" });
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;