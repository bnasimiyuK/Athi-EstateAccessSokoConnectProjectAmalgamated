/* ============================================================
   routes/reviews.js — SQL Server version
   ============================================================ */

const express = require("express");
const router = express.Router();
const { getPool } = require("../db");

/* ------------------------------------------------------------
   Helper: DB row → JSON frontend expects
   ------------------------------------------------------------ */
function reviewToJson(row) {
  return {
    id:           row.id,
    providerId:   row.provider_id,
    providerName: row.provider_name || "Unknown Vendor",
    bookingId:    row.booking_id,
    author:       row.author,
    rating:       row.rating,
    text:         row.text,
    date:         row.created_at,
  };
}

/* ------------------------------------------------------------
   GET /api/reviews/provider/:providerId
   ------------------------------------------------------------ */
router.get("/provider/:providerId", async (req, res, next) => {
  try {
    const providerId = parseInt(req.params.providerId, 10);
    if (isNaN(providerId)) {
      return res.status(400).json({ error: "Invalid provider id" });
    }

    const pool = await getPool();
    const result = await pool.request()
      .input("providerId", providerId)
      .query(`
        SELECT r.*, p.name AS provider_name
        FROM Reviews r
        LEFT JOIN Providers p ON r.provider_id = p.id
        WHERE r.provider_id = @providerId
        ORDER BY r.created_at DESC
      `);

    res.json(result.recordset.map(reviewToJson));
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------
   GET /api/reviews
   Admin: Fetch ALL reviews across all providers
   ------------------------------------------------------------ */
router.get("/", async (req, res, next) => {
  try {
    const pool = await getPool();
    
    const result = await pool.request().query(`
      SELECT r.*, p.name AS provider_name
      FROM Reviews r
      LEFT JOIN Providers p ON r.provider_id = p.id
      ORDER BY r.created_at DESC
    `);

    res.json(result.recordset.map(reviewToJson));
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------
   POST /api/reviews  { providerId, bookingId, author, rating, text }
   ------------------------------------------------------------ */
router.post("/", async (req, res, next) => {
  try {
    const { providerId, bookingId, author, rating, text } = req.body;

    if (!providerId || !author || !rating || !text) {
      return res.status(400).json({ error: "Missing required review fields." });
    }

    const providerIdInt = parseInt(providerId, 10);
    if (isNaN(providerIdInt)) {
      return res.status(400).json({ error: "Invalid provider id" });
    }

    const pool = await getPool();

    // Confirm provider exists
    const exists = await pool.request()
      .input("id", providerIdInt)
      .query("SELECT id FROM Providers WHERE id = @id");
    if (!exists.recordset.length) {
      return res.status(404).json({ error: "Provider not found" });
    }

    // Insert the review with the booking link
    const inserted = await pool.request()
      .input("providerId", providerIdInt)
      .input("bookingId",  bookingId ? parseInt(bookingId, 10) : null)
      .input("author",     author)
      .input("rating",     parseInt(rating, 10))
      .input("text",       text)
      .query(`
        INSERT INTO Reviews (provider_id, booking_id, author, rating, text)
        OUTPUT INSERTED.*
        VALUES (@providerId, @bookingId, @author, @rating, @text)
      `);

    // Recompute the provider's aggregate rating + review count
    await pool.request()
      .input("id", providerIdInt)
      .query(`
        UPDATE Providers SET
          rating  = (SELECT AVG(CAST(rating AS DECIMAL(3,2))) FROM Reviews WHERE provider_id = @id),
          reviews = (SELECT COUNT(*) FROM Reviews WHERE provider_id = @id)
        WHERE id = @id
      `);

    // Fetch the enriched row with the provider name for the response
    const enriched = await pool.request()
      .input("id", inserted.recordset[0].id)
      .query(`
        SELECT r.*, p.name AS provider_name
        FROM Reviews r
        LEFT JOIN Providers p ON r.provider_id = p.id
        WHERE r.id = @id
      `);

    res.status(201).json(reviewToJson(enriched.recordset[0]));
  } catch (err) {
    next(err);
  }
});

module.exports = router;