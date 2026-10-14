/* ============================================================
   backend/routes/admins.js
   Super-admin only: manage other admin accounts.

   All routes require requireAuth + requireRole(["super"]).

   Safeguards:
     - You can't demote yourself.
     - You can't delete yourself.
     - You can't demote the last remaining super admin.
     - You can't delete the last remaining super admin.
   ============================================================ */

const express = require("express");
const bcrypt  = require("bcryptjs");
const crypto  = require("crypto");
const router  = express.Router();
const { getPool }                  = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || "10", 10);

/* Every route in this file is super-admin only */
router.use(requireAuth, requireRole("super"));

/* ------------------------------------------------------------
   Helper: does at least one OTHER super admin exist?
   ------------------------------------------------------------ */
async function otherSuperAdminsExist(pool, excludeId) {
  const r = await pool.request()
    .input("id", excludeId)
    .query(`
      SELECT COUNT(*) AS n
      FROM Admins
      WHERE role = 'super' AND id <> @id
    `);
  return r.recordset[0].n > 0;
}

/* ------------------------------------------------------------
   GET /api/admins - list all admins
   ------------------------------------------------------------ */
router.get("/", async (req, res, next) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query(`
      SELECT id, email, full_name, role, must_change_password, created_at
      FROM Admins
      ORDER BY created_at DESC
    `);
    res.json(r.recordset);
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------
   POST /api/admins - create a new admin
   Body: { email, fullName, role }
   Returns the temp password once.
   ------------------------------------------------------------ */
router.post("/", async (req, res, next) => {
  try {
    const { email, fullName, role = "admin" } = req.body;

    if (!email || !fullName) {
      return res.status(400).json({ error: "email and fullName are required." });
    }
    if (!["admin", "super"].includes(role)) {
      return res.status(400).json({ error: "role must be 'admin' or 'super'." });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanName  = fullName.trim();

    const pool = await getPool();

    const exists = await pool.request()
      .input("email", cleanEmail)
      .query("SELECT id FROM Admins WHERE email = @email");
    if (exists.recordset.length) {
      return res.status(409).json({ error: "That email is already an admin." });
    }

    const tempPassword = "Aa1-" + crypto.randomBytes(4).toString("hex");
    const hash         = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);
    const expires      = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const r = await pool.request()
      .input("email", cleanEmail)
      .input("name",  cleanName)
      .input("hash",  hash)
      .input("role",  role)
      .input("exp",   expires)
      .query(`
        INSERT INTO Admins
          (email, full_name, password_hash, role,
           must_change_password, temp_password_expires)
        OUTPUT INSERTED.id
        VALUES
          (@email, @name, @hash, @role, 1, @exp)
      `);

    res.status(201).json({
      id:           r.recordset[0].id,
      email:        cleanEmail,
      fullName:     cleanName,
      role,
      tempPassword,
      expiresAt:    expires,
    });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------
   PATCH /api/admins/:id - update name or role
   ------------------------------------------------------------ */
router.patch("/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { fullName, role } = req.body;

    if (isNaN(id)) return res.status(400).json({ error: "Invalid id." });

    /* Cannot demote yourself */
    if (id === req.user.id && role && role !== "super") {
      return res.status(400).json({ error: "You can't remove your own super-admin role." });
    }

    /* Cannot demote the last remaining super admin */
    if (role && role !== "super") {
      const pool = await getPool();
      const target = await pool.request()
        .input("id", id)
        .query("SELECT role FROM Admins WHERE id = @id");

      if (target.recordset.length && target.recordset[0].role === "super") {
        if (!(await otherSuperAdminsExist(pool, id))) {
          return res.status(400).json({
            error: "You can't demote the last super admin. Promote another admin first.",
          });
        }
      }
    }

    const pool  = await getPool();
    const sets  = [];
    const req2  = pool.request().input("id", id);

    if (fullName) {
      sets.push("full_name = @name");
      req2.input("name", fullName.trim());
    }
    if (role) {
      if (!["admin", "super"].includes(role)) {
        return res.status(400).json({ error: "Invalid role." });
      }
      sets.push("role = @role");
      req2.input("role", role);
    }

    if (!sets.length) {
      return res.status(400).json({ error: "Nothing to update." });
    }

    await req2.query(`UPDATE Admins SET ${sets.join(", ")} WHERE id = @id`);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------
   POST /api/admins/:id/reset-password
   ------------------------------------------------------------ */
router.post("/:id/reset-password", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id." });

    const pool = await getPool();

    const tempPassword = "Aa1-" + crypto.randomBytes(4).toString("hex");
    const hash         = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);
    const expires      = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const r = await pool.request()
      .input("id",   id)
      .input("hash", hash)
      .input("exp",  expires)
      .query(`
        UPDATE Admins
        SET password_hash         = @hash,
            must_change_password  = 1,
            temp_password_expires = @exp
        WHERE id = @id
      `);

    if (!r.rowsAffected[0]) {
      return res.status(404).json({ error: "Admin not found." });
    }
    res.json({ tempPassword, expiresAt: expires });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------
   DELETE /api/admins/:id
   ------------------------------------------------------------ */
router.delete("/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id." });

    /* Cannot delete yourself */
    if (id === req.user.id) {
      return res.status(400).json({ error: "You can't delete your own account." });
    }

    /* Cannot delete the last remaining super admin */
    const pool = await getPool();
    const target = await pool.request()
      .input("id", id)
      .query("SELECT role FROM Admins WHERE id = @id");

    if (target.recordset.length && target.recordset[0].role === "super") {
      if (!(await otherSuperAdminsExist(pool, id))) {
        return res.status(400).json({
          error: "You can't delete the last super admin. Promote another admin first.",
        });
      }
    }

    const r = await pool.request()
      .input("id", id)
      .query("DELETE FROM Admins WHERE id = @id");

    if (!r.rowsAffected[0]) {
      return res.status(404).json({ error: "Admin not found." });
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;