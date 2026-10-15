/* ============================================================
   backend/routes/pooling.js — Car Pooling & Hailing
   Athi Soko Connect · Athi Highway Estate
   Database: Microsoft SQL Server (mssql)

   Mounted in server.js as:
     const poolingRouter = require("./routes/pooling");
     app.use("/api/pooling", poolingRouter);

   Auth:
     Uses requireAuth from ../middleware/auth.
     If your middleware exports a default function instead of an
     object, change the import line below to:
        const requireAuth = require("../middleware/auth");
   ============================================================ */

const express = require("express");
const router  = express.Router();

/* ---------- Auth middleware ---------- */
let requireAuth;
try {
  // Named export: module.exports = { requireAuth }
  ({ requireAuth } = require("../middleware/auth"));
} catch (_) {
  // Fallback — some setups export a single function
  requireAuth = require("../middleware/auth");
}
if (typeof requireAuth !== "function") {
  throw new Error(
    "[pooling] requireAuth is not a function. " +
    "Check backend/middleware/auth.js export shape."
  );
}

/* ---------- DB ---------- */
const db = require("../db");

/* ---------- Role gate ---------- */
function requirePooling(req, res, next) {
  const u = req.user;
  if (!u) return res.status(401).json({ error: "Not logged in." });
  if (["resident", "admin", "super-admin"].includes(u.role)) return next();
  return res.status(403).json({ error: "Residents only." });
}

/* ---------- Trip code ---------- */
function newTripCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

/* ------------------------------------------------------------
   runQuery — works with mssql pool OR a mysql2-style db.query.
   Always returns an array of rows (never [rows, fields]).
   ------------------------------------------------------------ */
async function runQuery(sqlText, params = {}) {
  /* --- mssql pool via db.getPool() --- */
  if (typeof db.getPool === "function") {
    const pool    = await db.getPool();
    const request = pool.request();
    for (const [k, v] of Object.entries(params)) request.input(k, v);
    const result  = await request.query(sqlText);
    return result.recordset || [];
  }

  /* --- mssql pool exported directly --- */
  if (typeof db.request === "function") {
    const request = db.request();
    for (const [k, v] of Object.entries(params)) request.input(k, v);
    const result  = await request.query(sqlText);
    return result.recordset || [];
  }

  /* --- mysql2/promise style db.query(sql, [values]) --- */
  if (typeof db.query === "function") {
    const names  = Object.keys(params);
    const values = names.map((n) => params[n]);
    // Convert @foo → ?  in order of first appearance
    let i = 0;
    const seen = new Map();
    const posSql = sqlText.replace(/@(\w+)/g, (_, name) => {
      if (!seen.has(name)) {
        seen.set(name, i++);
      }
      return "?";
    });
    // Reorder values to match parameter encounter order
    const orderedValues = [...seen.keys()].map((k) => params[k]);
    const result = await db.query(posSql, orderedValues);
    // mysql2 returns [rows, fields]; grab rows.
    return Array.isArray(result[0]) ? result[0] : result;
  }

  throw new Error(
    "[pooling] Could not detect DB module shape. " +
    "Open backend/db.js and check its exports."
  );
}

/* ============================================================
   GET /api/pooling/trips
   Query: kind, q, from, to, when, sort, page, perPage
   ============================================================ */
router.get("/trips", requireAuth, requirePooling, async (req, res) => {
  try {
    const kind    = req.query.kind;
    const q       = req.query.q;
    const from    = req.query.from;
    const to      = req.query.to;
    const when    = req.query.when;
    const sort    = req.query.sort || "depart_asc";
    const page    = Math.max(1, parseInt(req.query.page, 10) || 1);
    const perPage = Math.min(50, Math.max(1, parseInt(req.query.perPage, 10) || 12));
    const offset  = (page - 1) * perPage;

    const where  = ["t.status = 'open'"];
    const params = {};

    if (kind === "offer" || kind === "need") {
      where.push("t.kind = @kind");
      params.kind = kind;
    }
    if (from) { where.push("t.from_stage LIKE @from"); params.from = `%${from}%`; }
    if (to)   { where.push("t.to_stage   LIKE @to");   params.to   = `%${to}%`;   }
    if (q) {
      where.push("(t.from_stage LIKE @q OR t.to_stage LIKE @q OR t.notes LIKE @q OR u.full_name LIKE @q)");
      params.q = `%${q}%`;
    }
    if (when === "today") {
      where.push("CAST(t.depart_at AS DATE) = CAST(GETDATE() AS DATE)");
    } else if (when === "tomorrow") {
      where.push("CAST(t.depart_at AS DATE) = CAST(DATEADD(day, 1, GETDATE()) AS DATE)");
    } else if (when === "week") {
      where.push("t.depart_at BETWEEN GETDATE() AND DATEADD(day, 7, GETDATE())");
    }

    const orderBy = {
      depart_asc:  "t.depart_at ASC",
      depart_desc: "t.depart_at DESC",
      price_asc:   "t.price ASC",
      seats_desc:  "t.seats_left DESC",
      newest:      "t.created_at DESC",
    }[sort] || "t.depart_at ASC";

    const whereSql = where.join(" AND ");

    const listSql = `
      SELECT t.id, t.kind,
             t.from_stage AS [from],
             t.to_stage   AS [to],
             t.depart_at  AS departAt,
             t.seats, t.seats_left AS seatsLeft,
             t.price, t.vehicle, t.plate, t.notes,
             t.created_at AS createdAt,
             u.id           AS driverId,
             u.full_name    AS driverName,
             u.house_number AS driverHouse
        FROM dbo.pooling_trips t
        JOIN dbo.residents     u ON u.id = t.user_id
       WHERE ${whereSql}
       ORDER BY ${orderBy}
       OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`;

    const countSql = `
      SELECT COUNT(*) AS total
        FROM dbo.pooling_trips t
        JOIN dbo.residents     u ON u.id = t.user_id
       WHERE ${whereSql}`;

    const listParams = { ...params, offset, limit: perPage };
    const items      = await runQuery(listSql, listParams);
    const countRows  = await runQuery(countSql, params);
    const total      = countRows[0]?.total ?? items.length;

    res.json({ items, total });
  } catch (err) {
    console.error("[pooling] GET /trips failed:", err);
    res.status(500).json({ error: "Could not load trips." });
  }
});

/* ============================================================
   POST /api/pooling/trips
   ============================================================ */
router.post("/trips", requireAuth, requirePooling, async (req, res) => {
  try {
    const kind     = req.body?.kind;
    const from     = req.body?.from;
    const to       = req.body?.to;
    const departAt = req.body?.departAt;
    const seats    = req.body?.seats ?? 1;
    const price    = req.body?.price ?? null;
    const vehicle  = req.body?.vehicle || "";
    const plate    = req.body?.plate   || "";
    const notes    = req.body?.notes   || "";

    if (kind !== "offer" && kind !== "need")
      return res.status(400).json({ error: "kind must be 'offer' or 'need'." });
    if (!from || !to || !departAt)
      return res.status(400).json({ error: "from, to and departAt are required." });

    const seatsNum = Math.max(1, Math.min(6, parseInt(seats, 10) || 1));
    const priceNum = (price == null || price === "")
      ? null
      : Math.max(0, parseInt(price, 10) || 0);
    const code = newTripCode();

    const insertSql = `
      INSERT INTO dbo.pooling_trips
        (user_id, kind, from_stage, to_stage, depart_at, seats, seats_left,
         price, vehicle, plate, notes, trip_code, status)
      OUTPUT INSERTED.id
      VALUES
        (@userId, @kind, @from, @to, @departAt, @seats, @seatsLeft,
         @price, @vehicle, @plate, @notes, @code, 'open')`;

    const rows = await runQuery(insertSql, {
      userId:    req.user.id,
      kind,
      from,
      to,
      departAt:  new Date(departAt),
      seats:     seatsNum,
      seatsLeft: kind === "offer" ? seatsNum : 0,
      price:     priceNum,
      vehicle,
      plate,
      notes,
      code,
    });

    const id = Array.isArray(rows) ? (rows[0]?.id ?? rows.insertId) : rows;
    res.json({ id, tripCode: code });
  } catch (err) {
    console.error("[pooling] POST /trips failed:", err);
    res.status(500).json({ error: "Could not post trip." });
  }
});

/* ============================================================
   GET /api/pooling/trips/:id
   ============================================================ */
router.get("/trips/:id", requireAuth, requirePooling, async (req, res) => {
  try {
    const rows = await runQuery(`
      SELECT t.*,
             u.full_name    AS driverName,
             u.house_number AS driverHouse,
             u.phone        AS driverPhone
        FROM dbo.pooling_trips t
        JOIN dbo.residents     u ON u.id = t.user_id
       WHERE t.id = @id`,
      { id: req.params.id });

    const trip = rows[0];
    if (!trip) return res.status(404).json({ error: "Trip not found." });

    const isDriver = trip.user_id === req.user.id;
    const isAdmin  = ["admin", "super-admin"].includes(req.user.role);

    let accepted = false;
    if (!isDriver && !isAdmin) {
      const reqRows = await runQuery(`
        SELECT 1 AS ok FROM dbo.pooling_requests
         WHERE trip_id = @tripId AND requester_id = @uid AND status = 'accepted'`,
        { tripId: trip.id, uid: req.user.id });
      accepted = reqRows.length > 0;
    }

    const reveal = isDriver || isAdmin || accepted;

    const out = {
      id: trip.id,
      kind: trip.kind,
      from: trip.from_stage,
      to: trip.to_stage,
      departAt: trip.depart_at,
      seats: trip.seats,
      seatsLeft: trip.seats_left,
      price: trip.price,
      vehicle: trip.vehicle,
      plate: trip.plate,
      notes: trip.notes,
      status: trip.status,
      driverId: trip.user_id,
      driverName: trip.driverName,
      driverHouse: trip.driverHouse,
      revealContact: reveal,
    };
    if (reveal) {
      out.tripCode    = trip.trip_code;
      out.driverPhone = trip.driverPhone;
    }
    res.json(out);
  } catch (err) {
    console.error("[pooling] GET /trips/:id failed:", err);
    res.status(500).json({ error: "Could not load trip." });
  }
});

/* ============================================================
   POST /api/pooling/trips/:id/request
   ============================================================ */
router.post("/trips/:id/request", requireAuth, requirePooling, async (req, res) => {
  try {
    const tripRows = await runQuery(
      `SELECT id, user_id, kind, seats_left, status
         FROM dbo.pooling_trips WHERE id = @id`,
      { id: req.params.id });
    const trip = tripRows[0];

    if (!trip)                        return res.status(404).json({ error: "Trip not found." });
    if (trip.kind !== "offer")        return res.status(400).json({ error: "Only seat offers can be requested." });
    if (trip.user_id === req.user.id) return res.status(400).json({ error: "You can't request your own trip." });
    if (trip.status !== "open" || trip.seats_left < 1)
      return res.status(409).json({ error: "This trip is full or closed." });

    const existing = await runQuery(
      `SELECT id, status FROM dbo.pooling_requests
        WHERE trip_id = @tripId AND requester_id = @uid`,
      { tripId: trip.id, uid: req.user.id });
    if (existing.length) {
      return res.json({ requestId: existing[0].id, status: existing[0].status });
    }

    const inserted = await runQuery(`
      INSERT INTO dbo.pooling_requests (trip_id, requester_id, status)
      OUTPUT INSERTED.id
      VALUES (@tripId, @uid, 'pending')`,
      { tripId: trip.id, uid: req.user.id });

    const requestId = Array.isArray(inserted)
      ? (inserted[0]?.id ?? inserted.insertId)
      : inserted;

    res.json({ requestId, status: "pending" });
  } catch (err) {
    console.error("[pooling] POST /request failed:", err);
    res.status(500).json({ error: "Could not send request." });
  }
});

/* ============================================================
   POST /api/pooling/trips/:id/claim
   ============================================================ */
router.post("/trips/:id/claim", requireAuth, requirePooling, async (req, res) => {
  try {
    const tripRows = await runQuery(
      `SELECT id, user_id, kind, status
         FROM dbo.pooling_trips WHERE id = @id`,
      { id: req.params.id });
    const trip = tripRows[0];

    if (!trip)                  return res.status(404).json({ error: "Trip not found." });
    if (trip.kind !== "need")   return res.status(400).json({ error: "Only ride requests can be claimed." });
    if (trip.status !== "open") return res.status(409).json({ error: "Already claimed." });

    const code = newTripCode();
    await runQuery(`
      UPDATE dbo.pooling_trips
         SET status = 'claimed', driver_id = @driverId, trip_code = @code
       WHERE id = @id AND status = 'open'`,
      { driverId: req.user.id, code, id: trip.id });

    res.json({ tripCode: code, status: "claimed" });
  } catch (err) {
    console.error("[pooling] POST /claim failed:", err);
    res.status(500).json({ error: "Could not claim trip." });
  }
});

/* ============================================================
   POST /api/pooling/trips/:id/accept
   ============================================================ */
router.post("/trips/:id/accept", requireAuth, requirePooling, async (req, res) => {
  try {
    const requestId = req.body?.requestId;
    if (!requestId)
      return res.status(400).json({ error: "requestId is required." });

    const tripRows = await runQuery(
      `SELECT id, user_id, seats_left FROM dbo.pooling_trips WHERE id = @id`,
      { id: req.params.id });
    const trip = tripRows[0];

    if (!trip) return res.status(404).json({ error: "Trip not found." });
    if (trip.user_id !== req.user.id && !["admin", "super-admin"].includes(req.user.role))
      return res.status(403).json({ error: "Only the driver can accept." });
    if (trip.seats_left < 1)
      return res.status(409).json({ error: "No seats left." });

    await runQuery(
      `UPDATE dbo.pooling_requests
          SET status = 'accepted'
        WHERE id = @rid AND trip_id = @tid AND status = 'pending'`,
      { rid: requestId, tid: trip.id });

    await runQuery(
      `UPDATE dbo.pooling_trips
          SET seats_left = seats_left - 1
        WHERE id = @id AND seats_left > 0`,
      { id: trip.id });

    res.json({ ok: true });
  } catch (err) {
    console.error("[pooling] POST /accept failed:", err);
    res.status(500).json({ error: "Could not accept request." });
  }
});

/* ============================================================
   POST /api/pooling/trips/:id/decline
   ============================================================ */
router.post("/trips/:id/decline", requireAuth, requirePooling, async (req, res) => {
  try {
    const requestId = req.body?.requestId;
    if (!requestId)
      return res.status(400).json({ error: "requestId is required." });

    const tripRows = await runQuery(
      `SELECT id, user_id FROM dbo.pooling_trips WHERE id = @id`,
      { id: req.params.id });
    const trip = tripRows[0];

    if (!trip) return res.status(404).json({ error: "Trip not found." });
    if (trip.user_id !== req.user.id && !["admin", "super-admin"].includes(req.user.role))
      return res.status(403).json({ error: "Only the driver can decline." });

    await runQuery(
      `UPDATE dbo.pooling_requests
          SET status = 'declined'
        WHERE id = @rid AND trip_id = @tid AND status = 'pending'`,
      { rid: requestId, tid: trip.id });

    res.json({ ok: true });
  } catch (err) {
    console.error("[pooling] POST /decline failed:", err);
    res.status(500).json({ error: "Could not decline request." });
  }
});

/* ============================================================
   POST /api/pooling/trips/:id/report
   Feeds the existing dbo.reports table.
   ============================================================ */
router.post("/trips/:id/report", requireAuth, requirePooling, async (req, res) => {
  try {
    const reason  = req.body?.reason;
    const details = String(req.body?.details || "").slice(0, 1000);
    if (!reason) return res.status(400).json({ error: "reason is required." });

    await runQuery(`
      INSERT INTO dbo.reports
        (reporter_id, target_type, target_id, reason, details, status, created_at)
      VALUES
        (@uid, 'pooling_trip', @tid, @reason, @details, 'open', SYSDATETIME())`,
      { uid: req.user.id, tid: req.params.id, reason, details });

    res.json({ ok: true });
  } catch (err) {
    console.error("[pooling] POST /report failed:", err);
    res.status(500).json({ error: "Could not file report." });
  }
});

/* ============================================================
   POST /api/pooling/trips/:id/rate
   ============================================================ */
router.post("/trips/:id/rate", requireAuth, requirePooling, async (req, res) => {
  try {
    const stars   = Math.max(1, Math.min(5, parseInt(req.body?.stars, 10) || 0));
    const comment = String(req.body?.comment || "").slice(0, 500);
    if (!stars) return res.status(400).json({ error: "stars must be 1–5." });

    const tripRows = await runQuery(
      `SELECT id, user_id, driver_id
         FROM dbo.pooling_trips WHERE id = @id`,
      { id: req.params.id });
    const trip = tripRows[0];

    if (!trip) return res.status(404).json({ error: "Trip not found." });

    const ratee = trip.driver_id || trip.user_id;
    if (ratee === req.user.id)
      return res.status(400).json({ error: "You can't rate yourself." });

    await runQuery(`
      INSERT INTO dbo.pooling_ratings
        (trip_id, rater_id, ratee_id, stars, comment, created_at)
      VALUES
        (@tid, @rater, @ratee, @stars, @comment, SYSDATETIME())`,
      { tid: trip.id, rater: req.user.id, ratee, stars, comment });

    res.json({ ok: true });
  } catch (err) {
    console.error("[pooling] POST /rate failed:", err);
    res.status(500).json({ error: "Could not save rating." });
  }
});

/* ============================================================
   GET /api/pooling/stats
   ============================================================ */
router.get("/stats", requireAuth, requirePooling, async (_req, res) => {
  try {
    const rows = await runQuery(`
      SELECT
        (SELECT COUNT(*) FROM dbo.pooling_trips
          WHERE status = 'open'
            AND created_at >= DATEADD(hour, -24, GETDATE()))    AS activeTrips,
        (SELECT COUNT(*) FROM dbo.pooling_trips
          WHERE kind = 'need' AND status = 'open')              AS openRequests,
        (SELECT COALESCE(SUM(seats_left), 0) FROM dbo.pooling_trips
          WHERE kind = 'offer' AND status = 'open')             AS seatsAvailable,
        (SELECT COUNT(*) FROM dbo.pooling_trips
          WHERE kind = 'offer' AND status = 'open')             AS offerCount,
        (SELECT COUNT(*) FROM dbo.pooling_trips
          WHERE kind = 'need'  AND status = 'open')             AS needCount`);

    res.json(rows[0] || {
      activeTrips: 0, openRequests: 0, seatsAvailable: 0,
      offerCount: 0, needCount: 0,
    });
  } catch (err) {
    console.error("[pooling] GET /stats failed:", err);
    res.status(500).json({ error: "Could not load stats." });
  }
});

/* ============================================================
   GET /api/pooling/my
   Capped at 200 rows to keep the response small.
   ============================================================ */
router.get("/my", requireAuth, requirePooling, async (req, res) => {
  try {
    const mine = await runQuery(`
      SELECT TOP 200 * FROM (
        SELECT t.id, t.kind,
               t.from_stage AS [from], t.to_stage AS [to],
               t.depart_at  AS departAt,
               t.seats, t.seats_left AS seatsLeft,
               t.price, t.status, t.trip_code AS tripCode,
               'driver' AS role
          FROM dbo.pooling_trips t
         WHERE t.user_id = @uid
        UNION ALL
        SELECT t.id, t.kind,
               t.from_stage, t.to_stage,
               t.depart_at, t.seats, t.seats_left,
               t.price, r.status, t.trip_code,
               'passenger' AS role
          FROM dbo.pooling_requests r
          JOIN dbo.pooling_trips t ON t.id = r.trip_id
         WHERE r.requester_id = @uid
      ) AS combined
      ORDER BY departAt DESC`,
      { uid: req.user.id });

    res.json({ items: mine });
  } catch (err) {
    console.error("[pooling] GET /my failed:", err);
    res.status(500).json({ error: "Could not load your trips." });
  }
});

module.exports = router;