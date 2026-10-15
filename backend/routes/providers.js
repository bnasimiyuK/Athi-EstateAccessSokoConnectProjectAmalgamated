/* ============================================================
   routes/providers.js — SQL Server version (resident-linked)
   Vendors are residents with a provider profile.

   Multi-category support:
     - Providers table keeps a "primary" category (for legacy
       sorting, filtering, and quick display).
     - ProviderOfferings holds every (category, price, unit,
       services) tuple the vendor offers. One row per category.

   Legacy fields on Providers (category_id, price_from,
   price_unit, services) continue to be maintained whenever the
   primary offering is written, so nothing downstream breaks.
   ============================================================ */

const express = require("express");
const router = express.Router();
const { getPool } = require("../db");
const { requireAuth } = require("../middleware/auth");

/* ------------------------------------------------------------
   Helpers
   ------------------------------------------------------------ */
function toNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function toIntOrNull(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function splitServices(v) {
  if (Array.isArray(v)) {
    return v.map((s) => String(s).trim()).filter(Boolean);
  }
  if (typeof v === "string") {
    return v.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function rowToOffering(r) {
  return {
    id:            r.id,
    providerId:    r.provider_id,
    category:      r.category_id,
    categoryLabel: r.category_label || null,
    priceFrom:     toNumber(r.price_from, 0),
    priceUnit:     r.price_unit || "per visit",
    services:      r.services
                     ? r.services.split(",").map((s) => s.trim()).filter(Boolean)
                     : [],
    sortOrder:     r.sort_order || 0,
    createdAt:     r.created_at,
  };
}

/* ------------------------------------------------------------
   DB row → JSON the frontend expects
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
    priceFrom:     toNumber(row.price_from, 0),
    priceUnit:     row.price_unit,
    bio:           row.bio,
    services:      row.services
                     ? row.services.split(",").map((s) => s.trim()).filter(Boolean)
                     : [],
    rating:        row.rating ? toNumber(row.rating, 0) : 0,
    reviews:       row.reviews || 0,
    verified:      !!row.verified,
    isAvailable:   row.is_available === undefined ? true : !!row.is_available,
    residentId:    row.resident_id,
    createdAt:     row.created_at,
    unavailableUntil: row.unavailable_until
      ? new Date(row.unavailable_until).toISOString()
      : null,
    /* Populated later by attachOfferings() */
    offerings:     [],
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
   Batch-load offerings for a set of providers
   ------------------------------------------------------------ */
async function attachOfferings(pool, providers) {
  if (!Array.isArray(providers) || !providers.length) return;

  const ids = providers.map((p) => p.id).filter((v) => Number.isFinite(v));
  if (!ids.length) return;

  const req = pool.request();
  const placeholders = ids.map((v, i) => {
    req.input("pid" + i, v);
    return "@pid" + i;
  }).join(",");

  const q = await req.query(`
    SELECT
      o.*,
      cat.label AS category_label
    FROM ProviderOfferings o
    LEFT JOIN Categories cat ON cat.id = o.category_id
    WHERE o.provider_id IN (${placeholders})
    ORDER BY o.sort_order ASC, o.id ASC
  `);

  const byProvider = new Map();
  for (const r of q.recordset) {
    if (!byProvider.has(r.provider_id)) byProvider.set(r.provider_id, []);
    byProvider.get(r.provider_id).push(rowToOffering(r));
  }
  for (const p of providers) {
    p.offerings = byProvider.get(p.id) || [];
  }
}

/* ------------------------------------------------------------
   Sort map
   ------------------------------------------------------------ */
const SORT_MAP = {
  default:      "p.is_available DESC, p.verified DESC, p.rating DESC, p.reviews DESC",
  name_asc:     "p.name ASC",
  name_desc:    "p.name DESC",
  rating:       "p.is_available DESC, p.verified DESC, p.rating DESC, p.reviews DESC",
  rating_desc:  "p.rating DESC, p.reviews DESC",
  reviews:      "p.reviews DESC, p.rating DESC",
  reviews_desc: "p.reviews DESC, p.rating DESC",
  price_asc:    "p.price_from ASC, p.name ASC",
  price_desc:   "p.price_from DESC, p.name ASC",
  newest:       "p.created_at DESC",
  oldest:       "p.created_at ASC",
  verified:     "p.verified DESC, p.rating DESC",
};

function resolveOrderBy(sortKey) {
  if (!sortKey) return SORT_MAP.default;
  const key = String(sortKey).toLowerCase().trim();
  return SORT_MAP[key] || SORT_MAP.default;
}

/* ------------------------------------------------------------
   Filter builder
   ------------------------------------------------------------ */
function applyProviderFilters(request, {
  category,
  phase,
  courtId,
  maxPrice,
  search,
  q,
  verified,
  availableOnly,
}) {
  const conditions = [];

  if (verified === "true")  conditions.push("p.verified = 1");
  if (verified === "false") conditions.push("p.verified = 0");
  if (availableOnly === "true") conditions.push("p.is_available = 1");

  if (category) {
    const cid = parseInt(category, 10);
    conditions.push(`(
      p.category_id = @category
      OR EXISTS (
        SELECT 1 FROM ProviderOfferings o
        WHERE o.provider_id = p.id AND o.category_id = @category
      )
    )`);
    request.input("category", cid);
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
    conditions.push(`(
      p.price_from <= @maxPrice
      OR EXISTS (
        SELECT 1 FROM ProviderOfferings o
        WHERE o.provider_id = p.id AND o.price_from <= @maxPrice
      )
    )`);
    request.input("maxPrice", parseFloat(maxPrice));
  }

  const textQuery = (search || q || "").trim();
  if (textQuery) {
    conditions.push(`(
      p.name        LIKE @search
      OR p.services LIKE @search
      OR p.bio      LIKE @search
      OR cat.label  LIKE @search
      OR p.phone    LIKE @search
      OR EXISTS (
        SELECT 1 FROM ProviderOfferings o
        LEFT JOIN Categories oc ON oc.id = o.category_id
        WHERE o.provider_id = p.id
          AND (o.services LIKE @search OR oc.label LIKE @search)
      )
    )`);
    request.input("search", `%${textQuery}%`);
  }

  return conditions.length ? "WHERE " + conditions.join(" AND ") : "";
}

/* ============================================================
   GET /api/providers
   ============================================================ */
router.get("/", async (req, res, next) => {
  try {
    const pool = await getPool();
    const filters = req.query;
    const orderBy = resolveOrderBy(filters.sort);

    /* ---------- PAGINATED MODE ---------- */
    if (filters.page !== undefined) {
      const pageNum  = Math.max(1, parseInt(filters.page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(filters.limit, 10) || 20));
      const offset   = (pageNum - 1) * limitNum;

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

      const dataReq = pool.request();
      applyProviderFilters(dataReq, filters);
      dataReq.input("offset", offset);
      dataReq.input("limit",  limitNum);

      const dataRes = await dataReq.query(`
        ${PROVIDER_SELECT}
        ${whereClause}
        ORDER BY ${orderBy}
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY
      `);

      const providers = dataRes.recordset.map(providerToJson);
      await attachOfferings(pool, providers);

      return res.json({
        data:       providers,
        total,
        page:       pageNum,
        limit:      limitNum,
        totalPages: Math.ceil(total / limitNum) || 1,
      });
    }

    /* ---------- LEGACY MODE ---------- */
    const request = pool.request();
    const whereClause = applyProviderFilters(request, filters);

    const result = await request.query(`
      ${PROVIDER_SELECT}
      ${whereClause}
      ORDER BY ${orderBy}
    `);

    const providers = result.recordset.map(providerToJson);
    await attachOfferings(pool, providers);

    res.json(providers);
  } catch (err) {
    console.error("[providers] list failed:", err);
    next(err);
  }
});

/* ============================================================
   GET /api/providers/mine
   ------------------------------------------------------------
   MUST be declared before /:id so "mine" isn't parsed as an id.
   ============================================================ */
router.get("/mine", requireAuth, async (req, res, next) => {
  try {
    const residentId = req.user?.id ?? req.user?.residentId ?? req.user?.userId;
    if (!residentId) return res.status(401).json({ error: "Not authenticated." });

    const pool = await getPool();
    const result = await pool.request()
      .input("rid", residentId)
      .query(`${PROVIDER_SELECT} WHERE p.resident_id = @rid`);

    if (!result.recordset.length) {
      return res.status(404).json({ error: "No vendor profile for this account." });
    }

    const provider = providerToJson(result.recordset[0]);
    await attachOfferings(pool, [provider]);

    res.json(provider);
  } catch (err) {
    next(err);
  }
});

/* ============================================================
   ---- GET /api/providers/offerings-all ----
   ------------------------------------------------------------
   Flat list of every offering across every provider.
   Admin / super-admin only.
   MUST be declared before /:id.
   ============================================================ */
router.get("/offerings-all", requireAuth, async (req, res, next) => {
  try {
    const role = String(req.user?.role || "").toLowerCase().replace(/[_\s]/g, "-");
    if (role !== "admin" && role !== "super-admin") {
      return res.status(403).json({ error: "Admins only." });
    }

    const pool = await getPool();
    const q = await pool.request().query(`
      SELECT
        o.id            AS offering_id,
        o.provider_id,
        p.name          AS provider_name,
        p.verified      AS provider_verified,
        p.is_available  AS provider_available,
        o.category_id,
        cat.label       AS category_label,
        o.price_from,
        o.price_unit,
        o.services,
        o.sort_order
      FROM ProviderOfferings o
      JOIN Providers p        ON p.id = o.provider_id
      LEFT JOIN Categories cat ON cat.id = o.category_id
      ORDER BY p.name ASC, o.sort_order ASC, o.id ASC
    `);

    res.json(q.recordset.map((r) => ({
      id:                r.offering_id,
      providerId:        r.provider_id,
      providerName:      r.provider_name,
      providerVerified:  !!r.provider_verified,
      providerAvailable: r.provider_available !== false,
      category:          r.category_id,
      categoryLabel:     r.category_label,
      priceFrom:         toNumber(r.price_from, 0),
      priceUnit:         r.price_unit || "per visit",
      services:          r.services
                           ? r.services.split(",").map((s) => s.trim()).filter(Boolean)
                           : [],
      sortOrder:         r.sort_order || 0,
    })));
  } catch (err) {
    console.error("[providers] offerings-all failed:", err);
    next(err);
  }
});

/* ============================================================
   GET /api/providers/:id
   ============================================================ */
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

    const provider = providerToJson(result.recordset[0]);
    await attachOfferings(pool, [provider]);

    res.json(provider);
  } catch (err) {
    next(err);
  }
});

/* ============================================================
   POST /api/providers — vendor application
   ============================================================ */
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const residentId =
      req.user?.id ?? req.user?.residentId ?? req.user?.userId;

    if (!residentId) {
      return res.status(401).json({
        error: "Not authenticated. Please sign in as a resident.",
      });
    }

    const b = req.body || {};

    const name      = typeof b.name === "string" ? b.name.trim() : "";
    const hours     = typeof b.hours === "string" ? b.hours.trim() : "";
    const bio       = typeof b.bio === "string" ? b.bio.trim() : "";

    let offerings = Array.isArray(b.offerings) ? b.offerings : [];

    if (!offerings.length) {
      const legacyCategoryId = toIntOrNull(
        b.category ?? b.categoryId ?? b.category_id
      );
      const legacyServices = splitServices(b.services);

      if (legacyCategoryId && legacyServices.length) {
        offerings = [{
          category:  legacyCategoryId,
          priceFrom: toNumber(b.priceFrom ?? b.price_from, 0),
          priceUnit: b.priceUnit || b.price_unit || "per visit",
          services:  legacyServices,
        }];
      }
    }

    offerings = offerings.map((o, idx) => {
      const categoryId = toIntOrNull(o.category ?? o.categoryId ?? o.category_id);
      const services = splitServices(o.services);
      return {
        category:  categoryId,
        priceFrom: toNumber(o.priceFrom ?? o.price_from, 0),
        priceUnit: o.priceUnit || o.price_unit || "per visit",
        services,
        sortOrder: toIntOrNull(o.sortOrder ?? o.sort_order) ?? idx,
      };
    }).filter((o) => o.category && o.services.length);

    const missing = [];
    if (!name)             missing.push("name");
    if (!hours)            missing.push("hours");
    if (!bio)              missing.push("bio");
    if (!offerings.length) missing.push("offerings (category + services)");

    if (missing.length) {
      return res.status(400).json({
        error: `Missing required vendor fields: ${missing.join(", ")}.`,
        missing,
      });
    }

    const pool = await getPool();

    const residentCheck = await pool.request()
      .input("residentId", residentId)
      .query(`
        SELECT r.id, r.phone, r.verified
        FROM Residents r
        WHERE r.id = @residentId
      `);

    if (!residentCheck.recordset.length) {
      return res.status(404).json({ error: "Resident not found." });
    }

    const resident = residentCheck.recordset[0];
    if (resident.verified === false || resident.verified === 0) {
      return res.status(403).json({
        error: "Your resident account must be verified before you can apply as a vendor.",
      });
    }

    const already = await pool.request()
      .input("residentId", residentId)
      .query("SELECT id FROM Providers WHERE resident_id = @residentId");
    if (already.recordset.length) {
      /* Log so the admin team can see when multi-business demand appears */
  console.warn(
    `[providers] duplicate application blocked — resident ${residentId} already has provider ${already.recordset[0].id}`
  );
      return res.status(409).json({
        error: "This resident already has a vendor profile.",
      });
    }

    const catIds = [...new Set(offerings.map((o) => o.category))];
    const catPlaceholders = catIds.map((_, i) => `@cid${i}`).join(",");
    const catReq = pool.request();
    catIds.forEach((cid, i) => catReq.input("cid" + i, cid));
    const catCheck = await catReq.query(
      `SELECT id FROM Categories WHERE id IN (${catPlaceholders})`
    );
    const validCatIds = new Set(catCheck.recordset.map((r) => r.id));

    const invalid = catIds.filter((id) => !validCatIds.has(id));
    if (invalid.length) {
      return res.status(400).json({
        error: `Invalid category id(s): ${invalid.join(", ")}`,
        invalid,
      });
    }

    const tx = pool.transaction();
    await tx.begin();

    try {
      const primary = [...offerings].sort((a, b) => a.sortOrder - b.sortOrder)[0];

      const inserted = await tx.request()
        .input("residentId", residentId)
        .input("name",       name)
        .input("categoryId", primary.category)
        .input("phone",      resident.phone || null)
        .input("hours",      hours)
        .input("priceFrom",  primary.priceFrom)
        .input("priceUnit",  primary.priceUnit)
        .input("bio",        bio)
        .input("services",   primary.services.join(", "))
        .query(`
          INSERT INTO Providers
            (resident_id, name, category_id, phone, hours,
             price_from, price_unit, bio, services,
             verified, is_available)
          OUTPUT INSERTED.id
          VALUES
            (@residentId, @name, @categoryId, @phone, @hours,
             @priceFrom, @priceUnit, @bio, @services,
             0, 1)
        `);

      const newId = inserted.recordset[0].id;

      for (const o of offerings) {
        await tx.request()
          .input("pid",         newId)
          .input("categoryId",  o.category)
          .input("priceFrom",   o.priceFrom)
          .input("priceUnit",   o.priceUnit)
          .input("services",    o.services.join(", "))
          .input("sortOrder",   o.sortOrder)
          .query(`
            INSERT INTO ProviderOfferings
              (provider_id, category_id, price_from, price_unit, services, sort_order)
            VALUES (@pid, @categoryId, @priceFrom, @priceUnit, @services, @sortOrder)
          `);
      }

      await tx.commit();

      const full = await pool.request()
        .input("id", newId)
        .query(`${PROVIDER_SELECT} WHERE p.id = @id`);

      const provider = providerToJson(full.recordset[0]);
      await attachOfferings(pool, [provider]);

      res.status(201).json(provider);
    } catch (err) {
      try { await tx.rollback(); } catch (_) { /* noop */ }
      throw err;
    }
  } catch (err) {
    console.error("[providers] create failed:", err);
    next(err);
  }
});

/* ============================================================
   PATCH /api/providers/:id
   ============================================================ */
router.patch("/:id", requireAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid provider id" });

    const pool = await getPool();

    const ownQ = await pool.request()
      .input("id", id)
      .query("SELECT resident_id FROM Providers WHERE id = @id");
    if (!ownQ.recordset.length) {
      return res.status(404).json({ error: "Provider not found" });
    }

    const ownerId = ownQ.recordset[0].resident_id;
    const myId    = req.user?.id ?? req.user?.residentId ?? req.user?.userId;
    const myRole  = String(req.user?.role || "").toLowerCase().replace(/[_\s]/g, "-");
    const isAdmin = myRole === "admin" || myRole === "super-admin";

    if (!isAdmin && String(myId) !== String(ownerId)) {
      return res.status(403).json({ error: "You can only edit your own profile." });
    }

    const map = {
      name:             "name",
      category:         "category_id",
      phone:            "phone",
      hours:            "hours",
      priceFrom:        "price_from",
      priceUnit:        "price_unit",
      bio:              "bio",
      verified:         "verified",
      isAvailable:      "is_available",
      unavailableUntil: "unavailable_until",
    };

    const request = pool.request().input("id", id);
    const sets = [];

    for (const [bodyKey, col] of Object.entries(map)) {
      if (req.body[bodyKey] !== undefined) {
        let val = req.body[bodyKey];
        if (col === "category_id")                        val = parseInt(val, 10);
        if (col === "verified" || col === "is_available") val = val ? 1 : 0;
        if (col === "unavailable_until")                  val = val ? new Date(val) : null;
        request.input(col, val);
        sets.push(`${col} = @${col}`);
      }
    }

    let primaryServicesString = null;
    if (Array.isArray(req.body.services)) {
      primaryServicesString = req.body.services.join(", ");
      request.input("services", primaryServicesString);
      sets.push("services = @services");
    } else if (typeof req.body.services === "string") {
      primaryServicesString = req.body.services;
      request.input("services", primaryServicesString);
      sets.push("services = @services");
    }

    const touchedOfferings = Array.isArray(req.body.offerings);

    if (!sets.length && !touchedOfferings) {
      return res.status(400).json({ error: "No updatable fields provided" });
    }

    if (sets.length) {
      await request.query(`
        UPDATE Providers SET ${sets.join(", ")}
        WHERE id = @id
      `);
    }

    if (primaryServicesString !== null && !touchedOfferings) {
      await pool.request()
        .input("pid", id)
        .input("services", primaryServicesString)
        .query(`
          UPDATE ProviderOfferings
          SET services = @services
          WHERE provider_id = @pid
            AND id = (
              SELECT TOP 1 id FROM ProviderOfferings
              WHERE provider_id = @pid
              ORDER BY sort_order ASC, id ASC
            )
        `);
    }

    if (touchedOfferings) {
      const incoming = req.body.offerings.map((o, idx) => {
        const categoryId = toIntOrNull(o.category ?? o.categoryId ?? o.category_id);
        const services   = splitServices(o.services);
        return {
          id:        toIntOrNull(o.id),
          category:  categoryId,
          priceFrom: toNumber(o.priceFrom ?? o.price_from, 0),
          priceUnit: o.priceUnit || o.price_unit || "per visit",
          services,
          sortOrder: toIntOrNull(o.sortOrder ?? o.sort_order) ?? idx,
        };
      }).filter((o) => o.category && o.services.length);

      if (!incoming.length) {
        return res.status(400).json({
          error: "offerings must contain at least one { category, services } entry.",
        });
      }

      const catIds = [...new Set(incoming.map((o) => o.category))];
      const catReq = pool.request();
      const catPlaceholders = catIds.map((_, i) => {
        catReq.input("cid" + i, catIds[i]);
        return "@cid" + i;
      }).join(",");
      const catCheck = await catReq.query(
        `SELECT id FROM Categories WHERE id IN (${catPlaceholders})`
      );
      const validCatIds = new Set(catCheck.recordset.map((r) => r.id));
      const invalid = catIds.filter((c) => !validCatIds.has(c));
      if (invalid.length) {
        return res.status(400).json({
          error: `Invalid category id(s): ${invalid.join(", ")}`,
          invalid,
        });
      }

      const tx = pool.transaction();
      await tx.begin();
      try {
        const keepIds = incoming.map((o) => o.id).filter(Boolean);
        if (keepIds.length) {
          const delReq = tx.request().input("pid", id);
          const ph = keepIds.map((_, i) => {
            delReq.input("kid" + i, keepIds[i]);
            return "@kid" + i;
          }).join(",");
          await delReq.query(`
            DELETE FROM ProviderOfferings
            WHERE provider_id = @pid AND id NOT IN (${ph})
          `);
        } else {
          await tx.request().input("pid", id)
            .query("DELETE FROM ProviderOfferings WHERE provider_id = @pid");
        }

        for (const o of incoming) {
          if (o.id) {
            await tx.request()
              .input("oid",        o.id)
              .input("pid",        id)
              .input("categoryId", o.category)
              .input("priceFrom",  o.priceFrom)
              .input("priceUnit",  o.priceUnit)
              .input("services",   o.services.join(", "))
              .input("sortOrder",  o.sortOrder)
              .query(`
                UPDATE ProviderOfferings
                SET category_id = @categoryId,
                    price_from  = @priceFrom,
                    price_unit  = @priceUnit,
                    services    = @services,
                    sort_order  = @sortOrder
                WHERE id = @oid AND provider_id = @pid
              `);
          } else {
            await tx.request()
              .input("pid",        id)
              .input("categoryId", o.category)
              .input("priceFrom",  o.priceFrom)
              .input("priceUnit",  o.priceUnit)
              .input("services",   o.services.join(", "))
              .input("sortOrder",  o.sortOrder)
              .query(`
                INSERT INTO ProviderOfferings
                  (provider_id, category_id, price_from, price_unit, services, sort_order)
                VALUES (@pid, @categoryId, @priceFrom, @priceUnit, @services, @sortOrder)
              `);
          }
        }

        const primary = [...incoming].sort((a, b) => a.sortOrder - b.sortOrder)[0];
        await tx.request()
          .input("pid",        id)
          .input("categoryId", primary.category)
          .input("priceFrom",  primary.priceFrom)
          .input("priceUnit",  primary.priceUnit)
          .input("services",   primary.services.join(", "))
          .query(`
            UPDATE Providers
            SET category_id = @categoryId,
                price_from  = @priceFrom,
                price_unit  = @priceUnit,
                services    = @services
            WHERE id = @pid
          `);

        await tx.commit();
      } catch (err) {
        try { await tx.rollback(); } catch (_) { /* noop */ }
        throw err;
      }
    }

    const full = await pool.request()
      .input("id", id)
      .query(`${PROVIDER_SELECT} WHERE p.id = @id`);

    const provider = providerToJson(full.recordset[0]);
    await attachOfferings(pool, [provider]);

    res.json(provider);
  } catch (err) {
    console.error("[providers] patch failed:", err);
    next(err);
  }
});

/* ============================================================
   DELETE /api/providers/:id
   ============================================================ */
router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid provider id" });

    const pool = await getPool();
    const ownQ = await pool.request()
      .input("id", id)
      .query("SELECT resident_id FROM Providers WHERE id = @id");
    if (!ownQ.recordset.length) {
      return res.status(404).json({ error: "Provider not found" });
    }

    const ownerId = ownQ.recordset[0].resident_id;
    const myId    = req.user?.id ?? req.user?.residentId ?? req.user?.userId;
    const myRole  = String(req.user?.role || "").toLowerCase().replace(/[_\s]/g, "-");
    const isAdmin = myRole === "admin" || myRole === "super-admin";

    if (!isAdmin && String(myId) !== String(ownerId)) {
      return res.status(403).json({ error: "You can only delete your own profile." });
    }

    await pool.request().input("id", id).query("DELETE FROM Providers WHERE id = @id");
    res.status(204).end();
  } catch (err) {
    console.error("[providers] delete failed:", err);
    next(err);
  }
});

/* ============================================================
   GET /api/providers/:id/offerings
   ============================================================ */
router.get("/:id/offerings", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid provider id" });

    const pool = await getPool();

    const check = await pool.request().input("id", id)
      .query("SELECT id FROM Providers WHERE id = @id");
    if (!check.recordset.length) {
      return res.status(404).json({ error: "Provider not found" });
    }

    const q = await pool.request()
      .input("pid", id)
      .query(`
        SELECT o.*, cat.label AS category_label
        FROM ProviderOfferings o
        LEFT JOIN Categories cat ON cat.id = o.category_id
        WHERE o.provider_id = @pid
        ORDER BY o.sort_order ASC, o.id ASC
      `);

    res.json(q.recordset.map(rowToOffering));
  } catch (err) {
    next(err);
  }
});

/* ============================================================
   POST /api/providers/:id/offerings
   ============================================================ */
router.post("/:id/offerings", requireAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid provider id" });

    const pool = await getPool();

    const ownQ = await pool.request().input("id", id)
      .query("SELECT resident_id FROM Providers WHERE id = @id");
    if (!ownQ.recordset.length) return res.status(404).json({ error: "Provider not found" });

    const ownerId = ownQ.recordset[0].resident_id;
    const myId    = req.user?.id ?? req.user?.residentId ?? req.user?.userId;
    const myRole  = String(req.user?.role || "").toLowerCase().replace(/[_\s]/g, "-");
    const isAdmin = myRole === "admin" || myRole === "super-admin";

    if (!isAdmin && String(myId) !== String(ownerId)) {
      return res.status(403).json({ error: "You can only edit your own offerings." });
    }

    const b = req.body || {};
    const categoryId = toIntOrNull(b.category ?? b.category_id ?? b.categoryId);
    if (!categoryId) {
      return res.status(400).json({ error: "A valid category is required." });
    }

    const services = splitServices(b.services);
    if (!services.length) {
      return res.status(400).json({ error: "At least one service is required." });
    }

    const priceFrom = toNumber(b.priceFrom ?? b.price_from, 0);
    const priceUnit = b.priceUnit || b.price_unit || "per visit";
    const sortOrder = toIntOrNull(b.sortOrder ?? b.sort_order) ?? 0;

    const catCheck = await pool.request().input("cid", categoryId)
      .query("SELECT id FROM Categories WHERE id = @cid");
    if (!catCheck.recordset.length) {
      return res.status(400).json({ error: "Invalid category." });
    }

    const inserted = await pool.request()
      .input("pid",        id)
      .input("categoryId", categoryId)
      .input("priceFrom",  priceFrom)
      .input("priceUnit",  priceUnit)
      .input("services",   services.join(", "))
      .input("sortOrder",  sortOrder)
      .query(`
        INSERT INTO ProviderOfferings
          (provider_id, category_id, price_from, price_unit, services, sort_order)
        OUTPUT INSERTED.id
        VALUES (@pid, @categoryId, @priceFrom, @priceUnit, @services, @sortOrder)
      `);

    const newId = inserted.recordset[0].id;

    const full = await pool.request()
      .input("oid", newId)
      .query(`
        SELECT o.*, cat.label AS category_label
        FROM ProviderOfferings o
        LEFT JOIN Categories cat ON cat.id = o.category_id
        WHERE o.id = @oid
      `);

    res.status(201).json(rowToOffering(full.recordset[0]));
  } catch (err) {
    console.error("[providers] add offering failed:", err);
    next(err);
  }
});

/* ============================================================
   PATCH /api/providers/offerings/:offeringId
   ============================================================ */
router.patch("/offerings/:offeringId", requireAuth, async (req, res, next) => {
  try {
    const oid = parseInt(req.params.offeringId, 10);
    if (isNaN(oid)) return res.status(400).json({ error: "Invalid offering id" });

    const pool = await getPool();

    const oQ = await pool.request().input("oid", oid)
      .query(`
        SELECT o.id, o.provider_id, p.resident_id
        FROM ProviderOfferings o
        JOIN Providers p ON p.id = o.provider_id
        WHERE o.id = @oid
      `);
    if (!oQ.recordset.length) return res.status(404).json({ error: "Offering not found" });

    const row     = oQ.recordset[0];
    const myId    = req.user?.id ?? req.user?.residentId ?? req.user?.userId;
    const myRole  = String(req.user?.role || "").toLowerCase().replace(/[_\s]/g, "-");
    const isAdmin = myRole === "admin" || myRole === "super-admin";

    if (!isAdmin && String(myId) !== String(row.resident_id)) {
      return res.status(403).json({ error: "You can only edit your own offerings." });
    }

    const b = req.body || {};
    const sets = [];
    const req2 = pool.request().input("oid", oid);

    if (b.category !== undefined || b.category_id !== undefined || b.categoryId !== undefined) {
      const cid = toIntOrNull(b.category ?? b.category_id ?? b.categoryId);
      if (!cid) return res.status(400).json({ error: "Invalid category." });

      const catCheck = await pool.request().input("cid", cid)
        .query("SELECT id FROM Categories WHERE id = @cid");
      if (!catCheck.recordset.length) return res.status(400).json({ error: "Invalid category." });

      req2.input("category_id", cid);
      sets.push("category_id = @category_id");
    }

    if (b.priceFrom !== undefined || b.price_from !== undefined) {
      req2.input("price_from", toNumber(b.priceFrom ?? b.price_from, 0));
      sets.push("price_from = @price_from");
    }

    if (b.priceUnit !== undefined || b.price_unit !== undefined) {
      req2.input("price_unit", b.priceUnit || b.price_unit || "per visit");
      sets.push("price_unit = @price_unit");
    }

    if (b.services !== undefined) {
      const svc = splitServices(b.services);
      if (!svc.length) return res.status(400).json({ error: "At least one service is required." });
      req2.input("services", svc.join(", "));
      sets.push("services = @services");
    }

    if (b.sortOrder !== undefined || b.sort_order !== undefined) {
      req2.input("sort_order", toIntOrNull(b.sortOrder ?? b.sort_order) ?? 0);
      sets.push("sort_order = @sort_order");
    }

    if (!sets.length) {
      return res.status(400).json({ error: "No updatable fields provided." });
    }

    await req2.query(`
      UPDATE ProviderOfferings SET ${sets.join(", ")}
      WHERE id = @oid
    `);

    const full = await pool.request().input("oid", oid).query(`
      SELECT o.*, cat.label AS category_label
      FROM ProviderOfferings o
      LEFT JOIN Categories cat ON cat.id = o.category_id
      WHERE o.id = @oid
    `);

    res.json(rowToOffering(full.recordset[0]));
  } catch (err) {
    console.error("[providers] patch offering failed:", err);
    next(err);
  }
});

/* ============================================================
   DELETE /api/providers/offerings/:offeringId
   ============================================================ */
router.delete("/offerings/:offeringId", requireAuth, async (req, res, next) => {
  try {
    const oid = parseInt(req.params.offeringId, 10);
    if (isNaN(oid)) return res.status(400).json({ error: "Invalid offering id" });

    const pool = await getPool();

    const oQ = await pool.request().input("oid", oid)
      .query(`
        SELECT o.id, o.provider_id, p.resident_id
        FROM ProviderOfferings o
        JOIN Providers p ON p.id = o.provider_id
        WHERE o.id = @oid
      `);
    if (!oQ.recordset.length) return res.status(404).json({ error: "Offering not found" });

    const row     = oQ.recordset[0];
    const myId    = req.user?.id ?? req.user?.residentId ?? req.user?.userId;
    const myRole  = String(req.user?.role || "").toLowerCase().replace(/[_\s]/g, "-");
    const isAdmin = myRole === "admin" || myRole === "super-admin";

    if (!isAdmin && String(myId) !== String(row.resident_id)) {
      return res.status(403).json({ error: "You can only delete your own offerings." });
    }

    await pool.request().input("oid", oid)
      .query("DELETE FROM ProviderOfferings WHERE id = @oid");

    res.status(204).end();
  } catch (err) {
    console.error("[providers] delete offering failed:", err);
    next(err);
  }
});

module.exports = router;