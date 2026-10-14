/* ============================================================
   routes/announcements.js
   Estate notice board — read for everyone, write for admins.
   ============================================================ */

const express = require("express");
const router  = express.Router();
const { getPool } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");

/* ------------------------------------------------------------
   Helper: DB row → JSON the frontend expects
   ------------------------------------------------------------ */
function announcementToJson(row) {
  return {
    id:        row.id,
    title:     row.title,
    category:  row.category || "service",
    body:      row.body,
    pinned:    !!row.pinned,
    author:    row.created_by_name || "Estate Admin",
    authorId:  row.created_by || null,
    createdAt: row.created_at,
  };
}

/* ------------------------------------------------------------
   GET /api/announcements
   Query: ?limit=20&page=1&q=...&category=...
   Supports both paginated (?page=) and legacy (plain array) modes.
   Public — no auth required (estate-wide communications).
   ------------------------------------------------------------ */
router.get("/", async (req, res, next) => {
  try {
    const { q, category, page, limit } = req.query;

    const filters = [];
    const request = () => pool.request();

    const pool = await getPool();

    /* ---------- PAGINATED MODE ---------- */
    if (page !== undefined) {
      const pageNum  = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
      const offset   = (pageNum - 1) * limitNum;

      // Count
      const countReq = pool.request();
      applyFilters(countReq, { q, category });
      const whereClause = buildWhere({ q, category });

      const countRes = await countReq.query(`
        SELECT COUNT(*) AS total
        FROM Announcements a
        ${whereClause}
      `);
      const total = countRes.recordset[0].total || 0;

      // Data
      const dataReq = pool.request();
      applyFilters(dataReq, { q, category });
      dataReq.input("offset", offset);
      dataReq.input("limit",  limitNum);

      const dataRes = await dataReq.query(`
        SELECT
          a.id, a.title, a.category, a.body, a.pinned, a.created_at, a.created_by,
          adm.full_name AS created_by_name
        FROM Announcements a
        LEFT JOIN Admins adm ON adm.id = a.created_by
        ${whereClause}
        ORDER BY a.pinned DESC, a.created_at DESC
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY
      `);

      return res.json({
        data:       dataRes.recordset.map(announcementToJson),
        total,
        page:       pageNum,
        limit:      limitNum,
        totalPages: Math.ceil(total / limitNum) || 1,
      });
    }

    /* ---------- LEGACY MODE (plain array) ---------- */
    const limitNum = Math.min(parseInt(limit, 10) || 10, 50);
    const legacyReq = pool.request();
    applyFilters(legacyReq, { q, category });
    legacyReq.input("limit", limitNum);
    const whereClause = buildWhere({ q, category });

    const result = await legacyReq.query(`
      SELECT TOP (@limit)
        a.id, a.title, a.category, a.body, a.pinned, a.created_at, a.created_by,
        adm.full_name AS created_by_name
      FROM Announcements a
      LEFT JOIN Admins adm ON adm.id = a.created_by
      ${whereClause}
      ORDER BY a.pinned DESC, a.created_at DESC
    `);

    res.json(result.recordset.map(announcementToJson));
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------
   Filter helpers (shared by count + data queries)
   ------------------------------------------------------------ */
function buildWhere({ q, category }) {
  const conditions = [];
  if (q && q.trim())      conditions.push("(a.title LIKE @q OR a.body LIKE @q)");
  if (category && category.trim()) conditions.push("a.category = @category");
  return conditions.length ? "WHERE " + conditions.join(" AND ") : "";
}

function applyFilters(request, { q, category }) {
  if (q && q.trim())       request.input("q", `%${q.trim()}%`);
  if (category && category.trim()) request.input("category", category.trim());
}

/* ------------------------------------------------------------
   POST /api/announcements  (admin or super)
   Body: { title, category, body, pinned }
   ------------------------------------------------------------ */
router.post(
  "/",
  requireAuth,
  requireRole("admin", "super"),
  async (req, res, next) => {
    try {
      const { title, category, body, pinned } = req.body;

      if (!title || !body) {
        return res.status(400).json({ error: "title and body are required." });
      }
      if (title.length > 200) {
        return res.status(400).json({ error: "title is too long (max 200 chars)." });
      }
      if (body.length > 2000) {
        return res.status(400).json({ error: "body is too long (max 2000 chars)." });
      }

      const validCategories = ["utility","security","rules","event","billing","service","community"];
      const cat = validCategories.includes(category) ? category : "service";

      const pool = await getPool();
      const r = await pool.request()
        .input("title",    title.trim())
        .input("category", cat)
        .input("body",     body.trim())
        .input("pinned",   pinned ? 1 : 0)
        .input("by",       req.user.id)
        .query(`
          INSERT INTO Announcements (title, category, body, pinned, created_by)
          OUTPUT INSERTED.id, INSERTED.title, INSERTED.category,
                 INSERTED.body, INSERTED.pinned, INSERTED.created_at
          VALUES (@title, @category, @body, @pinned, @by)
        `);

      res.status(201).json(announcementToJson(r.recordset[0]));
    } catch (err) {
      next(err);
    }
  }
);
/* ------------------------------------------------------------
   PATCH /api/announcements/:id  (admin or super)
   Body: { title?, category?, body?, pinned? }
   Only fields provided are updated.
   ------------------------------------------------------------ */
router.patch(
  "/:id",
  requireAuth,
  requireRole("admin", "super"),
  async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id." });

      const allowed = ["title", "category", "body", "pinned"];
      const sets = [];
      const request = (await getPool()).request().input("id", id);

      for (const key of allowed) {
        if (req.body[key] !== undefined) {
          let val = req.body[key];
          if (key === "pinned") val = val ? 1 : 0;
          if (key === "title" || key === "body") val = String(val).trim();
          if (key === "title" && val.length > 200) {
            return res.status(400).json({ error: "Title too long (max 200 chars)." });
          }
          if (key === "body" && val.length > 2000) {
            return res.status(400).json({ error: "Body too long (max 2000 chars)." });
          }
          request.input(key, val);
          sets.push(`${key} = @${key}`);
        }
      }

      if (!sets.length) {
        return res.status(400).json({ error: "No fields to update." });
      }

      const r = await request.query(`
        UPDATE Announcements
        SET ${sets.join(", ")}
        OUTPUT INSERTED.id, INSERTED.title, INSERTED.category,
               INSERTED.body, INSERTED.pinned, INSERTED.created_at
        WHERE id = @id
      `);

      if (!r.recordset.length) {
        return res.status(404).json({ error: "Announcement not found." });
      }
      res.json(announcementToJson(r.recordset[0]));
    } catch (err) {
      next(err);
    }
  }
);
/* ------------------------------------------------------------
   DELETE /api/announcements/:id  (admin or super)
   ------------------------------------------------------------ */
router.delete(
  "/:id",
  requireAuth,
  requireRole("admin", "super"),
  async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id." });

      const pool = await getPool();
      const r = await pool.request()
        .input("id", id)
        .query("DELETE FROM Announcements WHERE id = @id");

      if (!r.rowsAffected[0]) {
        return res.status(404).json({ error: "Announcement not found." });
      }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;