/* ============================================================
   routes/residents.js — SQL Server version (court_id based)
   Residents reference a court; the court's phase is derived.
   Approval (verified: false → true) triggers a welcome email.
   + Paginated GET /
   ============================================================ */

require("dotenv").config();

const express = require("express");
const router = express.Router();
const { getPool } = require("../db");
const { sendMail, residentApprovedEmail } = require("../utils/mailer");

/* ------------------------------------------------------------
   Helper: DB row → JSON (joins court info)
   ------------------------------------------------------------ */
function residentToJson(row) {
  return {
    id:          row.id,
    fullName:    row.full_name,
    phone:       row.phone,
    email:       row.email || "",
    courtId:     row.court_id,
    courtName:   row.court_name,      // from JOIN
    phase:       row.phase,           // from JOIN
    verified:    !!row.verified,
    createdAt:   row.created_at,
  };
}

/* ------------------------------------------------------------
   Helper: build the WHERE clause + bind inputs
   Called twice (COUNT + DATA) since inputs belong to a request
   ------------------------------------------------------------ */
function applyResidentFilters(request, { phase, courtId, q, verified }) {
  const where = [];

  if (phase) {
    where.push("c.phase = @phase");
    request.input("phase", parseInt(phase, 10));
  }
  if (courtId) {
    where.push("r.court_id = @courtId");
    request.input("courtId", parseInt(courtId, 10));
  }
  if (q && q.trim()) {
    where.push("(r.full_name LIKE @q OR r.phone LIKE @q)");
    request.input("q", `%${q.trim()}%`);
  }
  if (verified === "true" || verified === "false") {
    where.push("r.verified = @verified");
    request.input("verified", verified === "true" ? 1 : 0);
  }

  return where.length ? "WHERE " + where.join(" AND ") : "";
}

/* ------------------------------------------------------------
   GET /api/residents?phase=&courtId=&q=&verified=&page=&limit=

   - If ?page present  → { data, total, page, limit, totalPages }
   - Otherwise         → plain array (legacy)
   ------------------------------------------------------------ */
router.get("/", async (req, res, next) => {
  try {
    const pool = await getPool();
    const { phase, courtId, q, verified, page, limit } = req.query;

    const filters = { phase, courtId, q, verified };

    const baseSelect = `
      SELECT r.*, c.name AS court_name, c.phase
      FROM Residents r
      JOIN Courts c ON c.id = r.court_id
    `;

    const orderBy = "ORDER BY c.phase ASC, c.name ASC, r.full_name ASC";

    /* ============================================================
       PAGINATED MODE
       ============================================================ */
    if (page !== undefined) {
      const pageNum  = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
      const offset   = (pageNum - 1) * limitNum;

      // ---------- COUNT ----------
      const countReq = pool.request();
      const whereClause = applyResidentFilters(countReq, filters);

      const countRes = await countReq.query(`
        SELECT COUNT(*) AS total
        FROM Residents r
        JOIN Courts c ON c.id = r.court_id
        ${whereClause}
      `);
      const total = countRes.recordset[0].total || 0;

      // ---------- DATA ----------
      const dataReq = pool.request();
      applyResidentFilters(dataReq, filters);
      dataReq.input("offset", offset);
      dataReq.input("limit",  limitNum);

      const dataRes = await dataReq.query(`
        ${baseSelect}
        ${whereClause}
        ${orderBy}
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY
      `);

      return res.json({
        data:       dataRes.recordset.map(residentToJson),
        total,
        page:       pageNum,
        limit:      limitNum,
        totalPages: Math.ceil(total / limitNum) || 1,
      });
    }

    /* ============================================================
       LEGACY MODE (plain array)
       ============================================================ */
    const request = pool.request();
    const whereClause = applyResidentFilters(request, filters);

    const result = await request.query(`
      ${baseSelect}
      ${whereClause}
      ${orderBy}
    `);

    res.json(result.recordset.map(residentToJson));
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------
   GET /api/residents/:id
   ------------------------------------------------------------ */
router.get("/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const pool = await getPool();
    const result = await pool.request()
      .input("id", id)
      .query(`
        SELECT r.*, c.name AS court_name, c.phase
        FROM Residents r
        JOIN Courts c ON c.id = r.court_id
        WHERE r.id = @id
      `);

    if (!result.recordset.length) {
      return res.status(404).json({ error: "Resident not found" });
    }
    res.json(residentToJson(result.recordset[0]));
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------
   POST /api/residents
   Body: { fullName, phone, email, courtId }
   ------------------------------------------------------------ */
router.post("/", async (req, res, next) => {
  try {
    const { fullName, phone, email, courtId } = req.body;

    if (!fullName || !phone || !courtId) {
      return res.status(400).json({ error: "fullName, phone, and courtId are required." });
    }

    const courtIdInt = parseInt(courtId, 10);
    if (isNaN(courtIdInt)) {
      return res.status(400).json({ error: "Invalid courtId." });
    }

    const pool = await getPool();

    // Verify court exists
    const court = await pool.request()
      .input("courtId", courtIdInt)
      .query("SELECT id FROM Courts WHERE id = @courtId");
    if (!court.recordset.length) {
      return res.status(400).json({ error: "Court not found." });
    }

    // Check phone uniqueness
    const existing = await pool.request()
      .input("phone", phone.trim())
      .query("SELECT id FROM Residents WHERE phone = @phone");
    if (existing.recordset.length) {
      return res.status(409).json({ error: "Phone number already registered." });
    }

    const inserted = await pool.request()
      .input("fullName", fullName.trim())
      .input("phone",    phone.trim())
      .input("email",    email ? email.trim() : null)
      .input("courtId",  courtIdInt)
      .query(`
        INSERT INTO Residents (full_name, phone, email, court_id, verified)
        OUTPUT INSERTED.*
        VALUES (@fullName, @phone, @email, @courtId, 0)
      `);

    // Re-fetch with court info for consistent response shape
    const full = await pool.request()
      .input("id", inserted.recordset[0].id)
      .query(`
        SELECT r.*, c.name AS court_name, c.phase
        FROM Residents r
        JOIN Courts c ON c.id = r.court_id
        WHERE r.id = @id
      `);

    res.status(201).json(residentToJson(full.recordset[0]));
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------
   PATCH /api/residents/:id
   Body: { fullName, phone, email, courtId, verified }
   When verified flips to true, sends a welcome email.
   ------------------------------------------------------------ */
router.patch("/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const map = {
      fullName: "full_name",
      phone:    "phone",
      email:    "email",
      courtId:  "court_id",
      verified: "verified",
    };

    const pool = await getPool();
    const request = pool.request().input("id", id);
    const sets = [];

    for (const [key, col] of Object.entries(map)) {
      if (req.body[key] !== undefined) {
        let val = req.body[key];
        if (col === "court_id") val = parseInt(val, 10);
        if (col === "verified") val = val ? 1 : 0;
        request.input(col, val);
        sets.push(`${col} = @${col}`);
      }
    }

    if (!sets.length) {
      return res.status(400).json({ error: "No updatable fields provided" });
    }

    // Fetch the resident BEFORE update so we can compare old verified state
    const before = await pool.request()
      .input("id", id)
      .query("SELECT * FROM Residents WHERE id = @id");
    if (!before.recordset.length) {
      return res.status(404).json({ error: "Resident not found" });
    }
    const wasVerified = !!before.recordset[0].verified;

    // Perform the update
    const updated = await request.query(`
      UPDATE Residents SET ${sets.join(", ")}
      OUTPUT INSERTED.*
      WHERE id = @id
    `);

    if (!updated.recordset.length) {
      return res.status(404).json({ error: "Resident not found" });
    }

    const updatedRow = updated.recordset[0];
    const isNowVerified = !!updatedRow.verified;

    /* ------------------------------------------------------------
       If verified just flipped from false → true, send welcome email
       ------------------------------------------------------------ */
    if (!wasVerified && isNowVerified) {
      try {
        if (updatedRow.email) {
          const tpl = residentApprovedEmail({
            fullName: updatedRow.full_name,
            phone:    updatedRow.phone,
          });

          await sendMail({
            to:      updatedRow.email,
            subject: tpl.subject,
            text:    tpl.text,
            html:    tpl.html,
          });

          console.log(`[residents] ✅ Approval email sent to ${updatedRow.email}`);
        } else {
          console.log(`[residents] ⚠️  No email on file for resident ${updatedRow.id} — email skipped.`);
        }
      } catch (mailErr) {
        // Do not fail the approval if the email fails
        console.error("[residents] ❌ Approval email failed:", mailErr.message);
      }
    }

    // Re-fetch with court info
    const full = await pool.request()
      .input("id", id)
      .query(`
        SELECT r.*, c.name AS court_name, c.phase
        FROM Residents r
        JOIN Courts c ON c.id = r.court_id
        WHERE r.id = @id
      `);

    res.json(residentToJson(full.recordset[0]));
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------
   DELETE /api/residents/:id
   ------------------------------------------------------------ */
router.delete("/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const pool = await getPool();
    const result = await pool.request()
      .input("id", id)
      .query("DELETE FROM Residents WHERE id = @id");

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: "Resident not found" });
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;