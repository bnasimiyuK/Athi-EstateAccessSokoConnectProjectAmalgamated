/* ============================================================
   routes/bookings.js — SQL Server version
   ============================================================ */

const express = require("express");
const router = express.Router();
const { getPool } = require("../db");
const { requireAuth } = require("../middleware/auth");

/* ------------------------------------------------------------
   Helper: DB row → JSON frontend expects
   ------------------------------------------------------------ */
function bookingToJson(row) {
  return {
    id:                 row.id,
    providerId:         row.provider_id,
    providerName:       row.provider_name,
    service:            row.service,
    date:               row.job_date,
    notes:              row.notes || "",
    residentName:       row.resident_name,
    residentPhone:      row.resident_phone,
    status:             row.status,
    reviewed:           !!row.reviewed,
    createdAt:          row.created_at,
    cancellationReason: row.cancellation_reason || null,
    rating:             row.review_rating || null, // <--- THIS MUST BE HERE
  };
}

/* ------------------------------------------------------------
   GET /api/bookings
   ------------------------------------------------------------ */
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const pool = await getPool();
    const { role, id } = req.user;
    const request = pool.request();
    let sqlText;

    // We MUST join Reviews to get the star rating
    const baseSelect = `
      SELECT b.*, p.name AS provider_name, r.rating AS review_rating
      FROM Bookings b
      LEFT JOIN Providers p ON p.id = b.provider_id
      LEFT JOIN Reviews r ON r.booking_id = b.id
    `;

    if (role === "admin") {
      sqlText = `${baseSelect} ORDER BY b.created_at DESC`;
    } else if (role === "vendor") {
      sqlText = `${baseSelect} WHERE b.provider_id = @providerId ORDER BY b.created_at DESC`;
      request.input("providerId", id);
    } else {
      /* Resident — look up their phone from Residents */
      const me = await pool.request()
        .input("id", id)
        .query("SELECT phone FROM Residents WHERE id = @id");
      const phone = me.recordset[0]?.phone;
      if (!phone) return res.json([]);

      sqlText = `${baseSelect} WHERE b.resident_phone = @phone ORDER BY b.created_at DESC`;
      request.input("phone", phone);
    }

    const result = await request.query(sqlText);
    res.json(result.recordset.map(bookingToJson));
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------
   POST /api/bookings
   ------------------------------------------------------------ */
router.post("/", async (req, res, next) => {
  try {
    const {
      providerId, service, date, notes = "",
      residentName = null, residentPhone = null,
    } = req.body;

    if (!providerId || !service || !date) {
      return res.status(400).json({ error: "Missing required booking fields." });
    }

    const providerIdInt = parseInt(providerId, 10);
    if (isNaN(providerIdInt)) {
      return res.status(400).json({ error: "Invalid provider id" });
    }

    const pool = await getPool();

    const inserted = await pool.request()
      .input("providerId",    providerIdInt)
      .input("service",       service)
      .input("job_date",      date)
      .input("notes",         notes)
      .input("residentName",  residentName)
      .input("residentPhone", residentPhone)
      .query(`
        INSERT INTO Bookings
          (provider_id, service, job_date, notes,
           resident_name, resident_phone, status, reviewed)
        OUTPUT INSERTED.*
        VALUES
          (@providerId, @service, @job_date, @notes,
           @residentName, @residentPhone, 'requested', 0)
      `);

    const enriched = await pool.request()
      .input("id", inserted.recordset[0].id)
      .query(`
        SELECT b.*, p.name AS provider_name, NULL AS review_rating
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
   PATCH /api/bookings/:id  { status, reviewed, cancellationReason }
   ------------------------------------------------------------ */
router.patch("/:id", requireAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid booking id" });

    const VALID_STATUSES = ['requested', 'confirmed', 'in_progress', 'completed', 'cancelled'];
    if (req.body.status && !VALID_STATUSES.includes(req.body.status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
    }

    const pool = await getPool();

    /* 1. Load the booking to check ownership */
    const row = await pool.request()
      .input("id", id)
      .query("SELECT provider_id, resident_phone FROM Bookings WHERE id = @id");
    if (!row.recordset.length) {
      return res.status(404).json({ error: "Booking not found" });
    }
    const booking = row.recordset[0];
    const { role, id: uid } = req.user;

    const isAdmin        = role === "admin";
    const isOwnerVendor  = role === "vendor" && booking.provider_id === uid;

    let isOwnerResident = false;
    if (role === "resident") {
      const me = await pool.request()
        .input("id", uid)
        .query("SELECT phone FROM Residents WHERE id = @id");
      const myPhone = me.recordset[0]?.phone;
      isOwnerResident = myPhone && booking.resident_phone === myPhone;
    }

    if (!isAdmin && !isOwnerVendor && !isOwnerResident) {
      return res.status(403).json({ error: "You cannot modify this booking." });
    }

    /* 2. Build the UPDATE from allowed fields */
    const fields = {
      status:              req.body.status,
      reviewed:            req.body.reviewed,
      cancellation_reason: req.body.cancellationReason,
    };

    const request = pool.request().input("id", id);
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

    /* 3. Run the update */
    await request.query(`
      UPDATE Bookings SET ${sets.join(", ")}
      WHERE id = @id
    `);

    /* 4. Return the enriched row */
    const enriched = await pool.request()
      .input("id", id)
      .query(`
        SELECT b.*, p.name AS provider_name, r.rating AS review_rating
        FROM Bookings b
        LEFT JOIN Providers p ON p.id = b.provider_id
        LEFT JOIN Reviews r ON r.booking_id = b.id
        WHERE b.id = @id
      `);

    res.json(bookingToJson(enriched.recordset[0]));
  } catch (err) {
    next(err);
  }
});

module.exports = router;