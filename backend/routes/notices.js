/* ============================================================
   routes/notices.js — Notice Board CRUD
   Backed by the `Notices` table (id, label, text, active, created_at,
   plus new columns: title, category, pinned, author_id, author_name, updated_at)

     GET    /api/notices          — list (public)
     GET    /api/notices/:id      — one
     POST   /api/notices          — create  (admin / super-admin)
     PATCH  /api/notices/:id      — update  (admin / super-admin)
     DELETE /api/notices/:id      — soft delete (admin / super-admin)
   ============================================================ */
const express                      = require("express");
const { getPool }                  = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

const VALID_CATEGORIES = [
  "security", "utility", "rules", "event",
  "billing", "service", "community",
];

function normalizeCategory(c) {
  if (!c) return null;
  const s = String(c).toLowerCase().trim();
  return VALID_CATEGORIES.includes(s) ? s : null;
}

/* ---------------- GET / — list ---------------- */
router.get("/", async (req, res, next) => {
  try {
    const { category, q, active = "1", limit = 100 } = req.query;
    const lim = Math.min(500, Math.max(1, parseInt(limit, 10) || 100));

    const pool = await getPool();
    const rq   = pool.request();
    const where = [];

    if (active !== "all") {
      where.push("active = @active");
      rq.input("active", active === "0" ? 0 : 1);
    }
    if (category && category !== "all") {
      where.push("category = @category");
      rq.input("category", normalizeCategory(category) || category);
    }
    if (q && q.trim()) {
      where.push("(label LIKE @q OR title LIKE @q OR text LIKE @q)");
      rq.input("q", `%${q.trim()}%`);
    }
    rq.input("lim", lim);

    const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";
    const result = await rq.query(`
      SELECT TOP (@lim)
             id, label, title, text, category, pinned, active,
             author_id, author_name, created_at, updated_at
      FROM   Notices
      ${whereSql}
      ORDER BY pinned DESC, created_at DESC
    `);

    res.json({ data: result.recordset || [] });
  } catch (err) { next(err); }
});

/* ---------------- GET /:id — one ---------------- */
router.get("/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const pool = await getPool();
    const r = await pool.request().input("id", id)
      .query("SELECT * FROM Notices WHERE id = @id");
    if (!r.recordset.length) return res.status(404).json({ error: "Not found." });
    res.json({ data: r.recordset[0] });
  } catch (err) { next(err); }
});

/* ---------------- POST / — create ---------------- */
router.post("/",
  requireAuth, requireRole("admin", "super-admin"),
  async (req, res, next) => {
    try {
      const { label, title, text, category, pinned } = req.body || {};
      const bodyText = text || req.body.body;
      if (!bodyText) return res.status(400).json({ error: "text is required." });

      const pool = await getPool();
      const result = await pool.request()
        .input("label",       String(label || title || "Notice").slice(0, 120))
        .input("title",       title ? String(title).slice(0, 200) : (label ? String(label).slice(0, 200) : null))
        .input("text",        String(bodyText))
        .input("category",    normalizeCategory(category))
        .input("pinned",      pinned ? 1 : 0)
        .input("author_id",   req.user?.id ?? null)
        .input("author_name", req.user?.name || req.user?.full_name || null)
        .query(`
          INSERT INTO Notices (label, title, text, category, pinned, active, author_id, author_name)
          OUTPUT INSERTED.*
          VALUES (@label, @title, @text, @category, @pinned, 1, @author_id, @author_name)
        `);

      res.status(201).json({ data: result.recordset[0] });
    } catch (err) { next(err); }
  });

/* ---------------- PATCH /:id — update ---------------- */
router.patch("/:id",
  requireAuth, requireRole("admin", "super-admin"),
  async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { label, title, text, body, category, pinned, active } = req.body || {};
      const bodyText = text || body;

      const sets = [];
      const rq   = (await getPool()).request().input("id", id);

      if (label    !== undefined) { sets.push("label = @label");       rq.input("label", String(label).slice(0, 120)); }
      if (title    !== undefined) { sets.push("title = @title");       rq.input("title", String(title).slice(0, 200)); }
      if (bodyText !== undefined) { sets.push("text = @text");         rq.input("text",  String(bodyText)); }
      if (category !== undefined) { sets.push("category = @category"); rq.input("category", normalizeCategory(category)); }
      if (pinned   !== undefined) { sets.push("pinned = @pinned");     rq.input("pinned", pinned ? 1 : 0); }
      if (active   !== undefined) { sets.push("active = @active");     rq.input("active", active ? 1 : 0); }

      if (!sets.length) return res.status(400).json({ error: "No fields to update." });
      sets.push("updated_at = SYSUTCDATETIME()");

      const result = await rq.query(`
        UPDATE Notices
        SET ${sets.join(", ")}
        OUTPUT INSERTED.*
        WHERE id = @id
      `);

      if (!result.recordset.length) return res.status(404).json({ error: "Not found." });
      res.json({ data: result.recordset[0] });
    } catch (err) { next(err); }
  });

/* ---------------- DELETE /:id — soft delete ---------------- */
router.delete("/:id",
  requireAuth, requireRole("admin", "super-admin"),
  async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      const pool = await getPool();
      const r = await pool.request().input("id", id)
        .query(`
          UPDATE Notices
          SET active = 0, updated_at = SYSUTCDATETIME()
          OUTPUT INSERTED.id
          WHERE id = @id
        `);
      if (!r.recordset.length) return res.status(404).json({ error: "Not found." });
      res.status(204).end();
    } catch (err) { next(err); }
  });

module.exports = router;