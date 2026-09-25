/* ============================================================
   routes/providers.js — SQL Server version (resident-linked)
   Vendors are residents with a provider profile.
   POST requires a verified resident_id.
   ============================================================ */

const express = require("express");
const router = express.Router();
const { getPool } = require("../db");

/* ------------------------------------------------------------
   Helper: DB row → JSON the frontend expects
   Note: `zone` is now derived from the resident's court.
   ------------------------------------------------------------ */
function providerToJson(row) {
  return {
    id:         row.id,
    name:       row.name,
    category:   row.category_id,
    zone:       row.court_name,      // from JOIN with Courts (via Residents)
    phase:      row.phase,           // from JOIN
    courtId:    row.court_id,        // from JOIN
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
    residentId: row.resident_id,
    createdAt:  row.created_at,
  };
}

/* ------------------------------------------------------------
   SQL fragment: standard provider + resident + court join
   ------------------------------------------------------------ */
const PROVIDER_SELECT = `
  SELECT
    p.*,
    r.court_id   AS court_id,
    c.name       AS court_name,
    c.phase      AS phase
  FROM Providers p
  LEFT JOIN Residents r ON r.id = p.resident_id
  LEFT JOIN Courts    c ON c.id = r.court_id
`;

/* ------------------------------------------------------------
   GET /api/providers?q=&category=&zone=&phase=&verified=
   ------------------------------------------------------------ */
router.get("/", async (req, res, next) => {
  try {
    const { q, category, zone, phase, verified } = req.query;
    const pool = await getPool();
    const request = pool.request();
    const where = [];

    if (q && q.trim()) {
      where.push("(p.name LIKE @q OR p.bio LIKE @q OR p.services LIKE @q)");
      request.input("q", `%${q.trim()}%`);
    }
    if (category) {
      where.push("p.category_id = @category");
      request.input("category", parseInt(category, 10));
    }
    if (zone) {
      where.push("c.name = @zone");
      request.input("zone", zone);
    }
    if (phase) {
      where.push("c.phase = @phase");
      request.input("phase", parseInt(phase, 10));
    }
    if (verified === "true" || verified === "false") {
      where.push("p.verified = @verified");
      request.input("verified", verified === "true" ? 1 : 0);
    }

    const sqlText = `
      ${PROVIDER_SELECT}
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY p.verified DESC, p.rating DESC, p.name ASC
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
      .query(`${PROVIDER_SELECT} WHERE p.id = @id`);

    if (!result.recordset.length) {
      return res.status(404).json({ error: "Provider not found" });
    }
    res.json(providerToJson(result.recordset[0]));
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------
   POST /api/providers — vendor application
   Requires: residentId (must be a verified resident)
   ------------------------------------------------------------ */
router.post("/", async (req, res, next) => {
  try {
    const {
      residentId,
      name, category, hours,
      priceFrom, priceUnit, bio, services,
    } = req.body;

    // Validate presence
    if (!residentId || !name || !category || !hours || !bio ||
        !Array.isArray(services) || !services.length) {
      return res.status(400).json({
        error: "Missing required vendor fields (residentId, name, category, hours, bio, services).",
      });
    }

    const residentIdInt = parseInt(residentId, 10);
    if (isNaN(residentIdInt)) {
      return res.status(400).json({ error: "Invalid residentId." });
    }

    const pool = await getPool();

    // 1. Verify the resident exists and is verified
    const residentCheck = await pool.request()
      .input("residentId", residentIdInt)
      .query(`
        SELECT r.*, c.name AS court_name, c.phase
        FROM Residents r
        JOIN Courts c ON c.id = r.court_id
        WHERE r.id = @residentId
      `);

    if (!residentCheck.recordset.length) {
      return res.status(404).json({ error: "Resident not found." });
    }

    const resident = residentCheck.recordset[0];
    if (!resident.verified) {
      return res.status(403).json({
        error: "Your resident account must be verified before you can apply as a vendor.",
      });
    }

    // 2. Check if this resident already has a provider profile
    const already = await pool.request()
      .input("residentId", residentIdInt)
      .query("SELECT id FROM Providers WHERE resident_id = @residentId");
    if (already.recordset.length) {
      return res.status(409).json({
        error: "This resident already has a vendor profile.",
      });
    }

    // 3. Insert the provider
    const inserted = await pool.request()
      .input("residentId", residentIdInt)
      .input("name",       name)
      .input("category_id", parseInt(category, 10))
      .input("phone",      resident.phone)
      .input("hours",      hours)
      .input("price_from", Number(priceFrom) || 0)
      .input("price_unit", priceUnit || "per visit")
      .input("bio",        bio)
      .input("services",   services.join(", "))
      .query(`
        INSERT INTO Providers
          (resident_id, name, category_id, phone, hours, price_from, price_unit, bio, services, verified)
        OUTPUT INSERTED.*
        VALUES
          (@residentId, @name, @category_id, @phone, @hours, @price_from, @price_unit, @bio, @services, 0)
      `);

    // 4. Re-fetch with joins for the full response shape
    const full = await pool.request()
      .input("id", inserted.recordset[0].id)
      .query(`${PROVIDER_SELECT} WHERE p.id = @id`);

    res.status(201).json(providerToJson(full.recordset[0]));
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------
   PATCH /api/providers/:id
   Admin verifies; provider edits own profile.
   ------------------------------------------------------------ */
router.patch("/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid provider id" });

    const map = {
      name:       "name",
      category:   "category_id",
      phone:      "phone",
      hours:      "hours",
      priceFrom:  "price_from",
      priceUnit:  "price_unit",
      bio:        "bio",
      verified:   "verified",
    };

    const request = (await getPool()).request().input("id", id);
    const sets = [];

    for (const [bodyKey, col] of Object.entries(map)) {
      if (req.body[bodyKey] !== undefined) {
        let val = req.body[bodyKey];
        if (col === "category_id") val = parseInt(val, 10);
        if (col === "verified")    val = val ? 1 : 0;
        request.input(col, val);
        sets.push(`${col} = @${col}`);
      }
    }

    // services may arrive as array or string
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

    const updated = await request.query(`
      UPDATE Providers SET ${sets.join(", ")}
      OUTPUT INSERTED.*
      WHERE id = @id
    `);

    if (!updated.recordset.length) {
      return res.status(404).json({ error: "Provider not found" });
    }

    // Re-fetch with joins
    const full = await (await getPool()).request()
      .input("id", id)
      .query(`${PROVIDER_SELECT} WHERE p.id = @id`);

    res.json(providerToJson(full.recordset[0]));
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