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
    id:         row.id,
    providerId: row.provider_id,
    author:     row.author,
    rating:     row.rating,
    text:       row.text,
    date:       row.created_at,
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
        SELECT * FROM Reviews
        WHERE provider_id = @providerId
        ORDER BY created_at DESC
      `);

    res.json(result.recordset.map(reviewToJson));
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------
   POST /api/reviews  { providerId, author, rating, text }
   ------------------------------------------------------------ */
router.post("/", async (req, res, next) => {
  try {
    const { providerId, author, rating, text } = req.body;

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

    // Insert the review
    const inserted = await pool.request()
      .input("providerId", providerIdInt)
      .input("author",     author)
      .input("rating",     parseInt(rating, 10))
      .input("text",       text)
      .query(`
        INSERT INTO Reviews (provider_id, author, rating, text)
        OUTPUT INSERTED.*
        VALUES (@providerId, @author, @rating, @text)
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

    res.status(201).json(reviewToJson(inserted.recordset[0]));
  } catch (err) {
    next(err);
  }
});

module.exports = router;