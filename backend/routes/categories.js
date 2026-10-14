/* ============================================================
   routes/categories.js — SQL Server version
   Returns id, label, icon for each category.
   ============================================================ */

const express = require("express");
const router = express.Router();
const { getPool } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");

/* ------------------------------------------------------------
   GET /api/categories
   Public. Returns all categories with vendor counts.
   ------------------------------------------------------------ */
router.get("/", async (req, res, next) => {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .query("SELECT id, label, icon FROM Categories ORDER BY label");
    res.json(result.recordset);
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------
   POST /api/categories  (super only)
   Body: { label, icon? }
   ------------------------------------------------------------ */
router.post(
  "/",
  requireAuth,
  requireRole("admin", "super"),
  async (req, res, next) => {
    try {
      const label = (req.body.label || "").trim();
      const icon  = (req.body.icon  || "").trim() || null;

      if (!label) {
        return res.status(400).json({ error: "label is required." });
      }
      if (label.length > 60) {
        return res.status(400).json({ error: "label is too long (max 60 chars)." });
      }
      if (icon && icon.length > 20) {
        return res.status(400).json({ error: "icon is too long (max 20 chars)." });
      }

      const pool = await getPool();

      // Case-insensitive duplicate check
      const dup = await pool.request()
        .input("label", label)
        .query("SELECT id FROM Categories WHERE LOWER(label) = LOWER(@label)");
      if (dup.recordset.length) {
        return res.status(409).json({ error: "That category already exists." });
      }

      const ins = await pool.request()
        .input("label", label)
        .input("icon",  icon)
        .query(`
          INSERT INTO Categories (label, icon)
          OUTPUT INSERTED.id, INSERTED.label, INSERTED.icon
          VALUES (@label, @icon)
        `);

      res.status(201).json({ ...ins.recordset[0], vendors: 0 });
    } catch (err) {
      next(err);
    }
  }
);

/* ------------------------------------------------------------
   PATCH /api/categories/:id  (super only)
   Body: { label?, icon? }
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

      const pool = await getPool();
      const sets = [];
      const request = pool.request().input("id", id);

      /* ---- optional label update ---- */
      if (req.body.label !== undefined) {
        const label = String(req.body.label || "").trim();
        if (!label) {
          return res.status(400).json({ error: "label cannot be empty." });
        }
        if (label.length > 60) {
          return res.status(400).json({ error: "label is too long (max 60 chars)." });
        }

        // Duplicate check excluding this row
        const dup = await pool.request()
          .input("label", label)
          .input("id", id)
          .query("SELECT id FROM Categories WHERE LOWER(label) = LOWER(@label) AND id <> @id");
        if (dup.recordset.length) {
          return res.status(409).json({ error: "Another category already uses that name." });
        }

        request.input("label", label);
        sets.push("label = @label");
      }

      /* ---- optional icon update ---- */
      if (req.body.icon !== undefined) {
        const icon = String(req.body.icon || "").trim() || null;
        if (icon && icon.length > 20) {
          return res.status(400).json({ error: "icon is too long (max 20 chars)." });
        }
        request.input("icon", icon);
        sets.push("icon = @icon");
      }

      if (!sets.length) {
        return res.status(400).json({ error: "No fields to update." });
      }

      const r = await request.query(`
        UPDATE Categories SET ${sets.join(", ")}
        OUTPUT INSERTED.id, INSERTED.label, INSERTED.icon
        WHERE id = @id
      `);

      if (!r.recordset.length) {
        return res.status(404).json({ error: "Category not found." });
      }
      res.json({ ...r.recordset[0], vendors: 0 });
    } catch (err) {
      next(err);
    }
  }
);

/* ------------------------------------------------------------
   DELETE /api/categories/:id  (super only)
   Refuses if any provider still uses this category.
   ------------------------------------------------------------ */
router.delete(
  "/:id",
  requireAuth,
  requireRole("super"),
  async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id." });

      const pool = await getPool();

      const used = await pool.request()
        .input("id", id)
        .query("SELECT COUNT(*) AS n FROM Providers WHERE category_id = @id");
      const n = used.recordset[0].n;
      if (n > 0) {
        return res.status(409).json({
          error: `Cannot delete: ${n} vendor${n === 1 ? "" : "s"} still use this category.`,
        });
      }

      const r = await pool.request()
        .input("id", id)
        .query("DELETE FROM Categories WHERE id = @id");

      if (!r.rowsAffected[0]) {
        return res.status(404).json({ error: "Category not found." });
      }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;