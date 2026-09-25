/* ============================================================
   routes/bookings.js — SQL Server version
   ============================================================ */

const express = require("express");
const router = express.Router();
const { getPool } = require("../db");

/* ------------------------------------------------------------
   Helper: DB row → JSON frontend expects
   NOTE: providerName is joined from Providers, not stored.
   ------------------------------------------------------------ */
function bookingToJson(row) {
  return {
    id:           row.id,
    providerId:   row.provider_id,
    providerName: row.provider_name,     // from JOIN
    service:      row.service,
    date:         row.job_date,
    notes:        row.notes || "",
    status:       row.status,
    reviewed:     !!row.reviewed,
    createdAt:    row.created_at,
  };
}

/* ------------------------------------------------------------
   GET /api/bookings
   ------------------------------------------------------------ */
router.get("/", async (req, res, next) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT b.*, p.name AS provider_name
      FROM Bookings b
      LEFT JOIN Providers p ON p.id = b.provider_id
      ORDER BY b.created_at DESC
    `);
    res.json(result.recordset.map(bookingToJson));
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------
   POST /api/bookings
   Body: { providerId, providerName, service, date, notes }
   ------------------------------------------------------------ */
router.post("/", async (req, res, next) => {
  try {
    const { providerId, service, date, notes = "" } = req.body;

    if (!providerId || !service || !date) {
      return res.status(400).json({ error: "Missing required booking fields." });
    }

    const providerIdInt = parseInt(providerId, 10);
    if (isNaN(providerIdInt)) {
      return res.status(400).json({ error: "Invalid provider id" });
    }

    const pool = await getPool();

    // Insert (provider_name comes from JOIN on read)
    const inserted = await pool.request()
      .input("providerId", providerIdInt)
      .input("service",    service)
      .input("job_date",   date)
      .input("notes",      notes)
      .query(`
        INSERT INTO Bookings (provider_id, service, job_date, notes)
        OUTPUT INSERTED.*
        VALUES (@providerId, @service, @job_date, @notes)
      `);

    // Fetch with provider_name so response shape matches GET
    const enriched = await pool.request()
      .input("id", inserted.recordset[0].id)
      .query(`
        SELECT b.*, p.name AS provider_name
        FROM Bookings b
        LEFT JOIN Providers p ON p.id = b.provider_id
        WHERE b.id = @id
      `);

    res.status(201).json(bookingToJson(enriched.recordset[0]));
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------
   PATCH /api/bookings/:id  { status } or { reviewed }
   ------------------------------------------------------------ */
router.patch("/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid booking id" });

    const fields = {
      status:   req.body.status,
      reviewed: req.body.reviewed,
    };

    const request = (await getPool()).request().input("id", id);
    const sets = [];

    for (const [col, val] of Object.entries(fields)) {
      if (val !== undefined) {
        request.input(col, col === "reviewed" ? (val ? 1 : 0) : val);
        sets.push(`${col} = @${col}`);
      }
    }

    if (!sets.length) {
      return res.status(400).json({ error: "No updatable fields provided" });
    }

    const updated = await request.query(`
      UPDATE Bookings SET ${sets.join(", ")}
      OUTPUT INSERTED.*
      WHERE id = @id
    `);

    if (!updated.recordset.length) {
      return res.status(404).json({ error: "Booking not found" });
    }

    // Fetch with provider_name for response consistency
    const enriched = await (await getPool()).request()
      .input("id", id)
      .query(`
        SELECT b.*, p.name AS provider_name
        FROM Bookings b
        LEFT JOIN Providers p ON p.id = b.provider_id
        WHERE b.id = @id
      `);

    res.json(bookingToJson(enriched.recordset[0]));
  } catch (err) {
    next(err);
  }
});

module.exports = router;