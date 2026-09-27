/* ============================================================
   routes/providers.js — SQL Server version (resident-linked)
   Vendors are residents with a provider profile.
   ============================================================ */

const express = require("express");
const router = express.Router();
const { getPool } = require("../db");

/* ------------------------------------------------------------
   Helper: DB row → JSON the frontend expects
   ------------------------------------------------------------ */
function providerToJson(row) {
  return {
    id:            row.id,
    name:          row.name,
    category:      row.category_id,
    categoryLabel: row.category_label,
    phase:         row.phase,
    courtId:       row.court_id,
    courtName:     row.court_name,
    phone:         row.phone,
    hours:         row.hours,
    priceFrom:     Number(row.price_from),
    priceUnit:     row.price_unit,
    bio:           row.bio,
    services:      row.services
                     ? row.services.split(",").map((s) => s.trim()).filter(Boolean)
                     : [],
    rating:        row.rating ? Number(row.rating) : 0,
    reviews:       row.reviews || 0,
    verified:      !!row.verified,
    isAvailable:   row.is_available === undefined ? true : !!row.is_available,
    residentId:    row.resident_id,
    createdAt:     row.created_at,
  };
}

/* ------------------------------------------------------------
   Standard SELECT with all joins
   ------------------------------------------------------------ */
const PROVIDER_SELECT = `
  SELECT
    p.*,
    cat.label    AS category_label,
    r.court_id   AS court_id,
    c.name       AS court_name,
    c.phase      AS phase
  FROM Providers p
  LEFT JOIN Categories cat ON cat.id = p.category_id
  LEFT JOIN Residents  r   ON r.id  = p.resident_id
  LEFT JOIN Courts     c   ON c.id  = r.court_id
`;

/* ------------------------------------------------------------
   Helper: apply filter inputs to a request object
   (called twice — once for COUNT, once for the data query)
   ------------------------------------------------------------ */
function applyProviderFilters(request, { category, phase, courtId, maxPrice, search, verified, availableOnly }) {
  const conditions = [];

  if (verified === "true") {
    conditions.push("p.verified = 1");
  } else if (verified === "false") {
    conditions.push("p.verified = 0");
  }

  if (availableOnly === "true") {
    conditions.push("p.is_available = 1");
  }
  if (category) {
    conditions.push("p.category_id = @category");
    request.input("category", parseInt(category, 10));
  }
  if (phase) {
    conditions.push("c.phase = @phase");
    request.input("phase", parseInt(phase, 10));
  }
  if (courtId) {
    conditions.push("r.court_id = @courtId");
    request.input("courtId", parseInt(courtId, 10));
  }
  if (maxPrice) {
    conditions.push("p.price_from <= @maxPrice");
    request.input("maxPrice", parseFloat(maxPrice));
  }
  if (search) {
    conditions.push("(p.name LIKE @search OR p.services LIKE @search OR p.bio LIKE @search)");
    request.input("search", `%${search}%`);
  }

  return conditions.length ? "WHERE " + conditions.join(" AND ") : "";
}

/* ------------------------------------------------------------
   GET /api/providers
   Supports: category, phase, courtId, maxPrice, search,
             verified, availableOnly, page, limit

   - If ?page is passed → returns { data, total, page, limit, totalPages }
   - Otherwise        → returns a plain array (legacy behaviour for
                        home.js, pending.html, provider-dashboard.js)
   ------------------------------------------------------------ */
router.get("/", async (req, res, next) => {
  try {
    const pool = await getPool();
    const filters = req.query;

    /* ============================================================
       PAGINATED MODE (when ?page= is provided)
       ============================================================ */
    if (filters.page !== undefined) {
      const pageNum  = Math.max(1, parseInt(filters.page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(filters.limit, 10) || 20));
      const offset   = (pageNum - 1) * limitNum;

      // ---------- Count query (same WHERE, no pagination) ----------
      const countReq = pool.request();
      const whereClause = applyProviderFilters(countReq, filters);

      const countRes = await countReq.query(`
        SELECT COUNT(*) AS total
        FROM Providers p
        LEFT JOIN Categories cat ON cat.id = p.category_id
        LEFT JOIN Residents  r   ON r.id  = p.resident_id
        LEFT JOIN Courts     c   ON c.id  = r.court_id
        ${whereClause}
      `);
      const total = countRes.recordset[0].total || 0;

      // ---------- Data query (same WHERE + OFFSET/FETCH) ----------
      const dataReq = pool.request();
      applyProviderFilters(dataReq, filters);   // re-bind the same inputs
      dataReq.input("offset", offset);
      dataReq.input("limit",  limitNum);

      const dataRes = await dataReq.query(`
        ${PROVIDER_SELECT}
        ${whereClause}
        ORDER BY p.is_available DESC, p.verified DESC, p.rating DESC, p.reviews DESC
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY
      `);

      return res.json({
        data:       dataRes.recordset.map(providerToJson),
        total,
        page:       pageNum,
        limit:      limitNum,
        totalPages: Math.ceil(total / limitNum) || 1,
      });
    }

    /* ============================================================
       LEGACY MODE (no ?page → plain array, unpaginated)
       ============================================================ */
    const request = pool.request();
    const whereClause = applyProviderFilters(request, filters);

    const result = await request.query(`
      ${PROVIDER_SELECT}
      ${whereClause}
      ORDER BY p.is_available DESC, p.verified DESC, p.rating DESC, p.reviews DESC
    `);

    res.json(result.recordset.map(providerToJson));
  } catch (err) {
    console.error("[providers] list failed:", err);
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
   ------------------------------------------------------------ */
router.post("/", async (req, res, next) => {
  try {
    const {
      residentId,
      name, category, hours,
      priceFrom, priceUnit, bio, services,
    } = req.body;

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

    const already = await pool.request()
      .input("residentId", residentIdInt)
      .query("SELECT id FROM Providers WHERE resident_id = @residentId");
    if (already.recordset.length) {
      return res.status(409).json({
        error: "This resident already has a vendor profile.",
      });
    }

    const inserted = await pool.request()
      .input("residentId",  residentIdInt)
      .input("name",        name)
      .input("category_id", parseInt(category, 10))
      .input("phone",       resident.phone)
      .input("hours",       hours)
      .input("price_from",  Number(priceFrom) || 0)
      .input("price_unit",  priceUnit || "per visit")
      .input("bio",         bio)
      .input("services",    services.join(", "))
      .query(`
        INSERT INTO Providers
          (resident_id, name, category_id, phone, hours, price_from, price_unit, bio, services, verified, is_available)
        OUTPUT INSERTED.*
        VALUES
          (@residentId, @name, @category_id, @phone, @hours, @price_from, @price_unit, @bio, @services, 0, 1)
      `);

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
   ------------------------------------------------------------ */
router.patch("/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid provider id" });

    const map = {
      name:        "name",
      category:    "category_id",
      phone:       "phone",
      hours:       "hours",
      priceFrom:   "price_from",
      priceUnit:   "price_unit",
      bio:         "bio",
      verified:    "verified",
      isAvailable: "is_available",
    };

    const request = (await getPool()).request().input("id", id);
    const sets = [];

    for (const [bodyKey, col] of Object.entries(map)) {
      if (req.body[bodyKey] !== undefined) {
        let val = req.body[bodyKey];
        if (col === "category_id") val = parseInt(val, 10);
        if (col === "verified" || col === "is_available") val = val ? 1 : 0;
        request.input(col, val);
        sets.push(`${col} = @${col}`);
      }
    }

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