/* ============================================================
   routes/providers.js — SQL Server version
   ============================================================ */

const express = require("express");
const router = express.Router();
const { getPool } = require("../db");

/* ------------------------------------------------------------
   Helper: convert a DB row → JSON the frontend expects
   ------------------------------------------------------------ */
function providerToJson(row) {
  return {
    id:         row.id,
    name:       row.name,
    category:   row.category_id,          // frontend does categoryLabel(p.category)
    zone:       row.zone,
    phone:      row.phone,
    hours:      row.hours,
    priceFrom:  Number(row.price_from),
    priceUnit:  row.price_unit,
    bio:        row.bio,
    services:   row.services
                  ? row.services.split(",").map((s) => s.trim()).filter(Boolean)
                  : [],
    rating:     row.rating ? Number(row.rating) : 0,
    reviews:    row.reviews || 0,
    verified:   !!row.verified,
    createdAt:  row.created_at,
  };
}

/* ------------------------------------------------------------
   GET /api/providers?q=&category=&zone=
   ------------------------------------------------------------ */
router.get("/", async (req, res, next) => {
  try {
    const pool = await getPool();
    const { q, category, zone } = req.query;

    const request = pool.request();
    const where = [];

    if (q && q.trim()) {
      where.push("(name LIKE @q OR bio LIKE @q OR services LIKE @q)");
      request.input("q", `%${q.trim()}%`);
    }
    if (category) {
      where.push("category_id = @category");
      request.input("category", parseInt(category, 10));
    }
    if (zone) {
      where.push("zone = @zone");
      request.input("zone", zone);
    }

    const sqlText = `
      SELECT * FROM Providers
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY verified DESC, rating DESC, name ASC
    `;

    const result = await request.query(sqlText);
    res.json(result.recordset.map(providerToJson));
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------
   GET /api/providers/:id
   ------------------------------------------------------------ */
router.get("/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid provider id" });

    const pool = await getPool();
    const result = await pool.request()
      .input("id", id)
      .query("SELECT * FROM Providers WHERE id = @id");

    if (!result.recordset.length) {
      return res.status(404).json({ error: "Provider not found" });
    }
    res.json(providerToJson(result.recordset[0]));
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------
   POST /api/providers  (self-registration — starts unverified)
   ------------------------------------------------------------ */
router.post("/", async (req, res, next) => {
  try {
    const {
      name, category, zone, phone, hours,
      priceFrom, priceUnit, bio, services,
    } = req.body;

    if (!name || !category || !zone || !phone || !hours || !bio ||
        !Array.isArray(services) || !services.length) {
      return res.status(400).json({ error: "Missing required provider fields." });
    }

    const pool = await getPool();
    const result = await pool.request()
      .input("name",       name)
      .input("category_id", parseInt(category, 10))
      .input("zone",       zone)
      .input("phone",      phone)
      .input("hours",      hours)
      .input("price_from", Number(priceFrom) || 0)
      .input("price_unit", priceUnit || "per visit")
      .input("bio",        bio)
      .input("services",   services.join(", "))
      .query(`
        INSERT INTO Providers
          (name, category_id, zone, phone, hours, price_from, price_unit, bio, services, verified)
        OUTPUT INSERTED.*
        VALUES
          (@name, @category_id, @zone, @phone, @hours, @price_from, @price_unit, @bio, @services, 0)
      `);

    res.status(201).json(providerToJson(result.recordset[0]));
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------
   PATCH /api/providers/:id  (admin verify OR provider edits)
   ------------------------------------------------------------ */
router.patch("/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid provider id" });

    // Map camelCase body fields → SQL columns
    const fieldMap = {
      name:       "name",
      category:   "category_id",
      zone:       "zone",
      phone:      "phone",
      hours:      "hours",
      priceFrom:  "price_from",
      priceUnit:  "price_unit",
      bio:        "bio",
      verified:   "verified",
    };

    const request = (await getPool()).request().input("id", id);
    const sets = [];

    for (const [bodyKey, col] of Object.entries(fieldMap)) {
      if (req.body[bodyKey] !== undefined) {
        let val = req.body[bodyKey];
        if (col === "category_id") val = parseInt(val, 10);
        if (col === "verified")    val = val ? 1 : 0;
        request.input(col, val);
        sets.push(`${col} = @${col}`);
      }
    }

    // services is an array on the frontend, string in DB
    if (Array.isArray(req.body.services)) {
      request.input("services", req.body.services.join(", "));
      sets.push("services = @services");
    } else if (typeof req.body.services === "string") {
      request.input("services", req.body.services);
      sets.push("services = @services");
    }

    if (!sets.length) {
      return res.status(400).json({ error: "No updatable fields provided" });
    }

    const result = await request.query(`
      UPDATE Providers
      SET ${sets.join(", ")}
      OUTPUT INSERTED.*
      WHERE id = @id
    `);

    if (!result.recordset.length) {
      return res.status(404).json({ error: "Provider not found" });
    }
    res.json(providerToJson(result.recordset[0]));
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------
   DELETE /api/providers/:id
   ------------------------------------------------------------ */
router.delete("/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid provider id" });

    const pool = await getPool();
    const result = await pool.request()
      .input("id", id)
      .query("DELETE FROM Providers WHERE id = @id");

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: "Provider not found" });
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;