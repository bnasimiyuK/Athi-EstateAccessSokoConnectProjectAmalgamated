/* ============================================================
   routes/reviews.js — SQL Server version
   ============================================================ */

const express = require("express");
const router = express.Router();
const { getPool } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");

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
    status:       row.status || "pending",
    date:         row.created_at,
  };
}

/* ------------------------------------------------------------
   GET /api/reviews/provider/:providerId  — PUBLIC
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
   GET /api/reviews  — ADMIN ONLY (Paginated)
   Query params: ?page=1&limit=20
   Response: { data, total, page, limit, totalPages }
   ------------------------------------------------------------ */
router.get("/",
  requireAuth,
  requireRole("admin"),
  async (req, res, next) => {
    try {
      // Parse + clamp pagination params
      const page  = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
      const offset = (page - 1) * limit;

      const pool = await getPool();

      // Total row count
      const countRes = await pool.request().query(`
        SELECT COUNT(*) AS total FROM Reviews
      `);
      const total = countRes.recordset[0].total;

      // Fetch the requested page
      const result = await pool.request()
        .input("offset", offset)
        .input("limit",  limit)
        .query(`
          SELECT r.*, p.name AS provider_name
          FROM Reviews r
          LEFT JOIN Providers p ON r.provider_id = p.id
          ORDER BY r.created_at DESC
          OFFSET @offset ROWS
          FETCH NEXT @limit ROWS ONLY
        `);

      res.json({
        data:       result.recordset.map(reviewToJson),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      });
    } catch (err) {
      next(err);
    }
  }
);

/* ------------------------------------------------------------
   POST /api/reviews  — any logged-in user
   ------------------------------------------------------------ */
router.post("/",
  requireAuth,
  async (req, res, next) => {
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

      const exists = await pool.request()
        .input("id", providerIdInt)
        .query("SELECT id FROM Providers WHERE id = @id");
      if (!exists.recordset.length) {
        return res.status(404).json({ error: "Provider not found" });
      }

      const inserted = await pool.request()
        .input("providerId", providerIdInt)
        .input("bookingId",  bookingId ? parseInt(bookingId, 10) : null)
        .input("author",     author)
        .input("rating",     parseInt(rating, 10))
        .input("text",       text)
        .query(`
          INSERT INTO Reviews (provider_id, booking_id, author, rating, text, status)
          OUTPUT INSERTED.*
          VALUES (@providerId, @bookingId, @author, @rating, @text, 'pending')
        `);

      await pool.request()
        .input("id", providerIdInt)
        .query(`
          UPDATE Providers SET
            rating  = (SELECT AVG(CAST(rating AS DECIMAL(3,2))) FROM Reviews WHERE provider_id = @id),
            reviews = (SELECT COUNT(*) FROM Reviews WHERE provider_id = @id)
          WHERE id = @id
        `);

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
  }
);

/* ------------------------------------------------------------
   PATCH /api/reviews/:id  — ADMIN ONLY
   ------------------------------------------------------------ */
router.patch("/:id",
  requireAuth,
  requireRole("admin"),
  async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid review id" });

      const { status } = req.body;
      const VALID = ["pending", "reviewed"];
      if (!status || !VALID.includes(status)) {
        return res.status(400).json({ error: "Invalid status. Must be 'pending' or 'reviewed'." });
      }

      const pool = await getPool();
      const result = await pool.request()
        .input("id", id)
        .input("status", status)
        .query(`
          UPDATE Reviews SET status = @status
          OUTPUT INSERTED.*
          WHERE id = @id
        `);

      if (!result.recordset.length) {
        return res.status(404).json({ error: "Review not found" });
      }

      const enriched = await pool.request()
        .input("id", id)
        .query(`
          SELECT r.*, p.name AS provider_name
          FROM Reviews r
          LEFT JOIN Providers p ON r.provider_id = p.id
          WHERE r.id = @id
        `);

      res.json(reviewToJson(enriched.recordset[0]));
    } catch (err) {
      next(err);
    }
  }
);

/* ------------------------------------------------------------
   DELETE /api/reviews/:id — ADMIN ONLY
   ------------------------------------------------------------ */
router.delete("/:id",
  requireAuth,
  requireRole("admin"),
  async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid review id" });

      const pool = await getPool();

      const row = await pool.request()
        .input("id", id)
        .query("SELECT provider_id FROM Reviews WHERE id = @id");
      if (!row.recordset.length) {
        return res.status(404).json({ error: "Review not found" });
      }
      const providerId = row.recordset[0].provider_id;

      await pool.request()
        .input("id", id)
        .query("DELETE FROM Reviews WHERE id = @id");

      await pool.request()
        .input("id", providerId)
        .query(`
          UPDATE Providers SET
            rating  = ISNULL((SELECT AVG(CAST(rating AS DECIMAL(3,2))) FROM Reviews WHERE provider_id = @id), 0),
            reviews = (SELECT COUNT(*) FROM Reviews WHERE provider_id = @id)
          WHERE id = @id
        `);

      res.status(204).end();
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;