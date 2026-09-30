/* ============================================================
   routes/visitors.js — Visitor Pre-Registration
   2-stage approval: Admin → Security
   Code generated only after both approve.
   Email delivery to visitor + resident.
   ============================================================ */

const express = require("express");
const router  = express.Router();
const { getPool } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { sendMail } = require("../utils/mailer");

/* ------------------------------------------------------------
   Constants
   ------------------------------------------------------------ */
const MIN_LEAD_HOURS   = 48;   // must pre-register at least 48h ahead
const CODE_VALID_HOURS = 24;   // code expires 24h after generation
const MAX_LOOKAHEAD_DAYS = 30; // no more than 30 days ahead

/* ------------------------------------------------------------
   Helpers
   ------------------------------------------------------------ */
function pad(n, w = 2) { return String(n).padStart(w, "0"); }

function fmtDate(d) {
  const dt = new Date(d);
  return `${pad(dt.getDate())} ${["Jan","Feb","Mar","Apr","May","Jun",
          "Jul","Aug","Sep","Oct","Nov","Dec"][dt.getMonth()]} ${dt.getFullYear()}`;
}

async function generateUniqueCode(pool) {
  for (let i = 0; i < 20; i++) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const dup = await pool.request()
      .input("c", code)
      .query("SELECT 1 FROM visitor_groups WHERE access_code = @c");
    if (!dup.recordset.length) return code;
  }
  throw new Error("Could not generate a unique access code.");
}

async function logEvent(pool, groupId, eventType, actorId, actorRole, notes = null) {
  await pool.request()
    .input("g",  groupId)
    .input("t",  eventType)
    .input("ai", actorId || null)
    .input("ar", actorRole || "system")
    .input("n",  notes)
    .query(`
      INSERT INTO visitor_events (group_id, event_type, actor_id, actor_role, notes)
      VALUES (@g, @t, @ai, @ar, @n)
    `);
}

/* Recompute visitor_group_summary row from events */
async function updateSummary(pool, groupId) {
  await pool.request()
    .input("g", groupId)
    .query(`
      MERGE visitor_group_summary AS tgt
      USING (
        SELECT
          @g AS group_id,
          MAX(CASE WHEN event_type='submitted'         THEN created_at END) AS submitted_at,
          MAX(CASE WHEN event_type='approved_admin'    THEN created_at END) AS admin_at,
          MAX(CASE WHEN event_type='approved_security' THEN created_at END) AS security_at,
          MAX(CASE WHEN event_type='code_generated'    THEN created_at END) AS code_sent_at,
          MAX(CASE WHEN event_type='checked_in'        THEN created_at END) AS first_checkin,
          MAX(CASE WHEN event_type='checked_out'       THEN created_at END) AS last_checkout,
          MAX(CASE WHEN event_type='expired'           THEN created_at END) AS expired_at,
          MAX(CASE WHEN event_type LIKE 'cancelled_%'  THEN created_at END) AS cancelled_at
        FROM visitor_events
        WHERE group_id = @g
      ) AS src
      ON tgt.group_id = src.group_id
      WHEN MATCHED THEN UPDATE SET
        submitted_at   = src.submitted_at,
        admin_at       = src.admin_at,
        security_at    = src.security_at,
        code_sent_at   = src.code_sent_at,
        first_checkin  = src.first_checkin,
        last_checkout  = src.last_checkout,
        expired_at     = src.expired_at,
        cancelled_at   = src.cancelled_at,
        admin_minutes    = DATEDIFF(MINUTE, src.submitted_at, src.admin_at),
        security_minutes = DATEDIFF(MINUTE, src.admin_at,     src.security_at),
        approval_minutes = DATEDIFF(MINUTE, src.submitted_at, src.code_sent_at),
        visit_minutes    = DATEDIFF(MINUTE, src.first_checkin, src.last_checkout)
      WHEN NOT MATCHED THEN INSERT
        (group_id, submitted_at, admin_at, security_at, code_sent_at,
         first_checkin, last_checkout, expired_at, cancelled_at,
         admin_minutes, security_minutes, approval_minutes, visit_minutes)
        VALUES
        (src.group_id, src.submitted_at, src.admin_at, src.security_at, src.code_sent_at,
         src.first_checkin, src.last_checkout, src.expired_at, src.cancelled_at,
         DATEDIFF(MINUTE, src.submitted_at, src.admin_at),
         DATEDIFF(MINUTE, src.admin_at,     src.security_at),
         DATEDIFF(MINUTE, src.submitted_at, src.code_sent_at),
         DATEDIFF(MINUTE, src.first_checkin, src.last_checkout));
    `);

  // Update final_status too
  await pool.request()
    .input("g", groupId)
    .query(`
      UPDATE visitor_group_summary
      SET final_status = (SELECT status FROM visitor_groups WHERE id = @g)
      WHERE group_id = @g
    `);
}

/* ------------------------------------------------------------
   GET /api/visitors/config — public config for the form
   ------------------------------------------------------------ */
router.get("/config", (req, res) => {
  res.json({
    minLeadHours:   MIN_LEAD_HOURS,
    codeValidHours: CODE_VALID_HOURS,
    maxLookaheadDays: MAX_LOOKAHEAD_DAYS,
  });
});

/* ============================================================
   RESIDENT ENDPOINTS
   ============================================================ */

/* ------------------------------------------------------------
   POST /api/visitors
   Resident submits a pre-registration.
   Body: {
     visitDate:   'YYYY-MM-DD',
     expectedTime:'HH:MM' (optional),
     purpose:     string,
     visitors: [ { name, phone?, email?, idNumber?, vehicles?:[{type,plate,driver?}] } ],
     notes?:      string
   }
   ------------------------------------------------------------ */
router.post("/", requireAuth, requireRole("resident"), async (req, res, next) => {
  try {
    const { visitDate, expectedTime, purpose, visitors, notes } = req.body;

    if (!visitDate || !Array.isArray(visitors) || !visitors.length) {
      return res.status(400).json({ error: "visitDate and at least one visitor are required." });
    }

    /* Validate visit date */
    const vd = new Date(visitDate);
    if (isNaN(vd)) return res.status(400).json({ error: "Invalid visitDate." });

    const now  = new Date();
    const hours = (vd - now) / 36e5;
    if (hours < MIN_LEAD_HOURS) {
      return res.status(400).json({
        error: `Pre-registration must be at least ${MIN_LEAD_HOURS}h in advance.`,
      });
    }
    if (hours > MAX_LOOKAHEAD_DAYS * 24) {
      return res.status(400).json({
        error: `Pre-registration cannot be more than ${MAX_LOOKAHEAD_DAYS} days ahead.`,
      });
    }

    /* Get the resident's house_number */
    const pool = await getPool();
    const me = await pool.request()
      .input("id", req.user.id)
      .query("SELECT id, full_name, phone, email, house_number FROM Residents WHERE id = @id");
    if (!me.recordset.length) return res.status(404).json({ error: "Resident not found." });

    const resident = me.recordset[0];
    if (!resident.house_number) {
      return res.status(400).json({
        error: "Your house number has not been assigned yet. Contact estate admin.",
      });
    }

    /* Validate each visitor */
    for (const v of visitors) {
      if (!v.name || !String(v.name).trim()) {
        return res.status(400).json({ error: "Each visitor must have a name." });
      }
      if (!v.phone && !v.email) {
        return res.status(400).json({
          error: `Visitor "${v.name}" must have a phone or email so the code can be delivered.`,
        });
      }
    }

    /* Insert group */
    const headcount = visitors.length;
    const inserted = await pool.request()
      .input("rid",       resident.id)
      .input("hno",       resident.house_number)
      .input("vd",        visitDate)
      .input("et",        expectedTime || null)
      .input("p",         purpose || null)
      .input("hc",        headcount)
      .input("n",         notes || null)
      .query(`
        INSERT INTO visitor_groups
          (resident_id, house_number, visit_date, expected_time, purpose,
           headcount, resident_notes, status, created_at)
        OUTPUT INSERTED.id
        VALUES
          (@rid, @hno, @vd, @et, @p, @hc, @n, 'pending_admin', SYSUTCDATETIME())
      `);

    const groupId = inserted.recordset[0].id;

    /* Insert visitors + vehicles */
    for (const v of visitors) {
      const vi = await pool.request()
        .input("g", groupId)
        .input("n", String(v.name).trim())
        .input("p", v.phone || null)
        .input("e", v.email || null)
        .input("id", v.idNumber || null)
        .query(`
          INSERT INTO visitors (group_id, name, phone, email, id_number, status)
          OUTPUT INSERTED.id
          VALUES (@g, @n, @p, @e, @id, 'pending')
        `);
      const visitorId = vi.recordset[0].id;

      if (Array.isArray(v.vehicles)) {
        for (const veh of v.vehicles) {
          if (!veh.plate) continue;
          await pool.request()
            .input("vid", visitorId)
            .input("t",   veh.type || "car")
            .input("pl",  String(veh.plate).trim().toUpperCase())
            .input("d",   veh.driver || null)
            .query(`
              INSERT INTO visitor_vehicles (visitor_id, vehicle_type, plate_number, driver_name)
              VALUES (@vid, @t, @pl, @d)
            `);
        }
      }
    }

    /* Log event + summary */
    await logEvent(pool, groupId, "submitted", resident.id, "resident");
    await updateSummary(pool, groupId);

    res.status(201).json({
      ok: true,
      groupId,
      headcount,
      status: "pending_admin",
      message: "Submitted for admin approval.",
    });
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------
   GET /api/visitors/mine — resident's own pre-registrations
   ------------------------------------------------------------ */
router.get("/mine", requireAuth, requireRole("resident"), async (req, res, next) => {
  try {
    const pool = await getPool();
    const groups = await pool.request()
      .input("rid", req.user.id)
      .query(`
        SELECT g.*,
               (SELECT COUNT(*) FROM visitors v WHERE v.group_id = g.id) AS visitor_count
        FROM visitor_groups g
        WHERE g.resident_id = @rid
        ORDER BY g.visit_date DESC, g.id DESC
      `);

    const out = [];
    for (const g of groups.recordset) {
      const vs = await pool.request()
        .input("gid", g.id)
        .query(`
          SELECT v.*,
                 (SELECT vehicle_type AS [type], plate_number AS [plate], driver_name AS [driver]
                  FROM visitor_vehicles WHERE visitor_id = v.id FOR JSON PATH) AS vehicles_json
          FROM visitors v
          WHERE v.group_id = @gid
        `);
      out.push({
        ...g,
        visitors: vs.recordset.map((v) => ({
          ...v,
          vehicles: v.vehicles_json ? JSON.parse(v.vehicles_json) : [],
        })),
      });
    }
    res.json(out);
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------
   POST /api/visitors/:id/cancel — resident cancels
   Only allowed before check-in.
   ------------------------------------------------------------ */
router.post("/:id/cancel", requireAuth, requireRole("resident"), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { reason } = req.body;
    const pool = await getPool();

    const g = await pool.request()
      .input("id", id)
      .input("rid", req.user.id)
      .query("SELECT * FROM visitor_groups WHERE id = @id AND resident_id = @rid");
    if (!g.recordset.length) return res.status(404).json({ error: "Not found." });
    const row = g.recordset[0];

    if (["cancelled", "completed", "expired", "checked_in"].includes(row.status)) {
      return res.status(400).json({ error: `Cannot cancel a visit with status "${row.status}".` });
    }

    await pool.request()
      .input("id", id)
      .input("by", req.user.id)
      .input("r",  reason || null)
      .query(`
        UPDATE visitor_groups
        SET status = 'cancelled',
            cancelled_by = @by,
            cancelled_at = SYSUTCDATETIME(),
            cancel_role = 'resident',
            cancel_reason = @r,
            updated_at = SYSUTCDATETIME()
        WHERE id = @id
      `);

    await logEvent(pool, id, "cancelled_resident", req.user.id, "resident", reason || null);
    await updateSummary(pool, id);

    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ============================================================
   ADMIN + SECURITY ENDPOINTS
   ============================================================ */

/* ------------------------------------------------------------
   GET /api/visitors/pending-admin
   ------------------------------------------------------------ */
router.get("/pending-admin", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query(`
      SELECT g.*, r.full_name AS resident_name, r.phone AS resident_phone,
             r.email AS resident_email
      FROM visitor_groups g
      JOIN Residents r ON r.id = g.resident_id
      WHERE g.status = 'pending_admin'
      ORDER BY g.visit_date ASC, g.id ASC
    `);
    res.json(r.recordset);
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------
   GET /api/visitors/pending-security
   ------------------------------------------------------------ */
router.get("/pending-security", requireAuth, requireRole("security", "admin"), async (req, res, next) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query(`
      SELECT g.*, r.full_name AS resident_name, r.phone AS resident_phone,
             r.email AS resident_email
      FROM visitor_groups g
      JOIN Residents r ON r.id = g.resident_id
      WHERE g.status = 'pending_security'
      ORDER BY g.visit_date ASC, g.id ASC
    `);
    res.json(r.recordset);
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------
   POST /api/visitors/:id/approve-admin
   ------------------------------------------------------------ */
router.post("/:id/approve-admin", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const pool = await getPool();

    const g = await pool.request().input("id", id)
      .query("SELECT status FROM visitor_groups WHERE id = @id");
    if (!g.recordset.length) return res.status(404).json({ error: "Not found." });
    if (g.recordset[0].status !== "pending_admin") {
      return res.status(400).json({ error: "Not in pending_admin state." });
    }

    await pool.request()
      .input("id", id)
      .input("by", req.user.id)
      .query(`
        UPDATE visitor_groups
        SET status = 'pending_security',
            admin_approved_by = @by,
            admin_approved_at = SYSUTCDATETIME(),
            updated_at = SYSUTCDATETIME()
        WHERE id = @id
      `);

    await logEvent(pool, id, "approved_admin", req.user.id, "admin");
    await updateSummary(pool, id);

    res.json({ ok: true, status: "pending_security" });
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------
   POST /api/visitors/:id/approve-security
   Generates code, sends notifications.
   ------------------------------------------------------------ */
router.post("/:id/approve-security", requireAuth, requireRole("security", "admin"), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const pool = await getPool();

    const g = await pool.request().input("id", id)
      .query(`
        SELECT g.*, r.full_name AS resident_name, r.phone AS resident_phone,
               r.email AS resident_email
        FROM visitor_groups g
        JOIN Residents r ON r.id = g.resident_id
        WHERE g.id = @id
      `);
    if (!g.recordset.length) return res.status(404).json({ error: "Not found." });
    const row = g.recordset[0];
    if (row.status !== "pending_security") {
      return res.status(400).json({ error: "Not in pending_security state." });
    }

    /* Generate code */
    const code = await generateUniqueCode(pool);

    /* Compute expiry = now + 24h */
    const expiresAt = new Date(Date.now() + CODE_VALID_HOURS * 3600e3);

    /* Approve */
    await pool.request()
      .input("id", id)
      .input("by", req.user.id)
      .input("c",  code)
      .input("e",  expiresAt)
      .query(`
        UPDATE visitor_groups
        SET status = 'approved',
            security_approved_by = @by,
            security_approved_at = SYSUTCDATETIME(),
            access_code = @c,
            code_generated_at = SYSUTCDATETIME(),
            expires_at = @e,
            updated_at = SYSUTCDATETIME()
        WHERE id = @id
      `);

    await logEvent(pool, id, "approved_security", req.user.id, "security");
    await logEvent(pool, id, "code_generated", null, "system", code);
    await updateSummary(pool, id);

    /* Notify: visitor + resident (email only — SMS later) */
    const deliveryLog = [];

    /* Visitors */
    const vs = await pool.request().input("g", id)
      .query("SELECT id, name, phone, email FROM visitors WHERE group_id = @g");

    for (const v of vs.recordset) {
      if (v.email) {
        try {
          await sendMail({
            to:      v.email,
            subject: `Your visit code for ${row.house_number} on ${fmtDate(row.visit_date)}`,
            text:
`Hello ${v.name},

You have been pre-registered by the resident of ${row.house_number} to visit
Athi Estate Access on ${fmtDate(row.visit_date)}${row.expected_time ? " at " + row.expected_time : ""}.

Your access code is: ${code}

Show this code at the gate. The code is valid until ${fmtDate(expiresAt)}.

— Athi Estate Management`,
          });
          await pool.request().input("id", id)
            .query("UPDATE visitor_groups SET sent_visitor_email = 1 WHERE id = @id");
          await logEvent(pool, id, "code_sent_visitor_email", null, "system", v.email);
          deliveryLog.push({ to: v.email, channel: "email", status: "sent" });
        } catch (e) {
          deliveryLog.push({ to: v.email, channel: "email", status: "failed", error: e.message });
        }
      }
      if (v.phone) {
        /* SMS not yet enabled (Africa's Talking credentials missing) */
        deliveryLog.push({ to: v.phone, channel: "sms", status: "skipped — no gateway" });
      }
    }

    /* Resident */
    if (row.resident_email) {
      try {
        await sendMail({
          to:      row.resident_email,
          subject: `Visitor approved — code ${code} for ${fmtDate(row.visit_date)}`,
          text:
`Hi ${row.resident_name},

Your visitor pre-registration was approved by security.

Access code: ${code}
Visit date:  ${fmtDate(row.visit_date)}${row.expected_time ? " at " + row.expected_time : ""}
Visitors:    ${vs.recordset.map((v) => v.name).join(", ")}

The visitor has been emailed the code. If they lose it, share this email with them.

— Athi Estate Management`,
        });
        await pool.request().input("id", id)
          .query("UPDATE visitor_groups SET sent_resident_email = 1 WHERE id = @id");
        await logEvent(pool, id, "code_sent_resident_email", null, "system", row.resident_email);
        deliveryLog.push({ to: row.resident_email, channel: "email", status: "sent" });
      } catch (e) {
        deliveryLog.push({ to: row.resident_email, channel: "email", status: "failed", error: e.message });
      }
    }
    if (row.resident_phone) {
      deliveryLog.push({ to: row.resident_phone, channel: "sms", status: "skipped — no gateway" });
    }

    /* Save delivery log */
    await pool.request()
      .input("id", id)
      .input("log", JSON.stringify(deliveryLog))
      .query("UPDATE visitor_groups SET delivery_log = @log WHERE id = @id");

    res.json({
      ok: true,
      status: "approved",
      code,
      expiresAt,
      deliveryLog,
    });
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------
   POST /api/visitors/:id/deny
   Body: { reason }
   Deny at either stage.
   ------------------------------------------------------------ */
router.post("/:id/deny", requireAuth, requireRole("admin", "security"), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { reason } = req.body;
    const role = req.user.role;
    const pool = await getPool();

    const g = await pool.request().input("id", id)
      .query("SELECT status FROM visitor_groups WHERE id = @id");
    if (!g.recordset.length) return res.status(404).json({ error: "Not found." });

    const cur = g.recordset[0].status;
    if (!["pending_admin", "pending_security"].includes(cur)) {
      return res.status(400).json({ error: `Cannot deny in status "${cur}".` });
    }

    const col = role === "admin"
      ? { by: "admin_denied_by",    at: "admin_denied_at",    reason: "admin_deny_reason" }
      : { by: "security_denied_by", at: "security_denied_at", reason: "security_deny_reason" };

    await pool.request()
      .input("id", id)
      .input("by", req.user.id)
      .input("r",  reason || null)
      .query(`
        UPDATE visitor_groups
        SET status = 'denied',
            ${col.by} = @by,
            ${col.at} = SYSUTCDATETIME(),
            ${col.reason} = @r,
            updated_at = SYSUTCDATETIME()
        WHERE id = @id
      `);

    await logEvent(pool, id, `denied_${role}`, req.user.id, role, reason || null);
    await updateSummary(pool, id);

    res.json({ ok: true, status: "denied" });
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------
   GET /api/visitors — full list (admin + security)
   Query: status, date, houseNumber, q, page, limit
   ------------------------------------------------------------ */
router.get("/", requireAuth, requireRole("admin", "security"), async (req, res, next) => {
  try {
    const { status, date, houseNumber, q, page = 1, limit = 50 } = req.query;
    const pageNum  = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const offset   = (pageNum - 1) * limitNum;

    const where = [];
    const bind = (r) => {
      if (status)      { where.push("g.status = @status"); r.input("status", status); }
      if (date)        { where.push("g.visit_date = @date"); r.input("date", date); }
      if (houseNumber) { where.push("g.house_number = @houseNumber"); r.input("houseNumber", houseNumber); }
      if (q && q.trim()) {
        where.push("(r.full_name LIKE @q OR g.house_number LIKE @q OR g.access_code LIKE @q)");
        r.input("q", `%${q.trim()}%`);
      }
    };

    const pool = await getPool();
    const countReq = pool.request(); bind(countReq);
    const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";
    const countRes = await countReq.query(`
      SELECT COUNT(*) AS total FROM visitor_groups g
      JOIN Residents r ON r.id = g.resident_id
      ${whereSql}
    `);
    const total = countRes.recordset[0].total || 0;

    const dataReq = pool.request(); bind(dataReq);
    dataReq.input("offset", offset); dataReq.input("limit", limitNum);
    const dataRes = await dataReq.query(`
      SELECT g.*, r.full_name AS resident_name, r.phone AS resident_phone
      FROM visitor_groups g
      JOIN Residents r ON r.id = g.resident_id
      ${whereSql}
      ORDER BY g.visit_date DESC, g.id DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);

    res.json({
      data:       dataRes.recordset,
      total,
      page:       pageNum,
      limit:      limitNum,
      totalPages: Math.ceil(total / limitNum) || 1,
    });
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------
   GET /api/visitors/register?date=YYYY-MM-DD
   Printable register for a day.
   ------------------------------------------------------------ */
router.get("/register", requireAuth, requireRole("admin", "security"), async (req, res, next) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: "date is required." });

    const pool = await getPool();
    const groups = await pool.request().input("d", date)
      .query(`
        SELECT g.*, r.full_name AS resident_name, r.phone AS resident_phone
        FROM visitor_groups g
        JOIN Residents r ON r.id = g.resident_id
        WHERE g.visit_date = @d
          AND g.status IN ('approved','checked_in','completed')
        ORDER BY g.expected_time ASC, g.id ASC
      `);

    const out = [];
    for (const g of groups.recordset) {
      const vs = await pool.request().input("gid", g.id)
        .query(`
          SELECT v.*,
                 (SELECT vehicle_type AS [type], plate_number AS [plate], driver_name AS [driver]
                  FROM visitor_vehicles WHERE visitor_id = v.id FOR JSON PATH) AS vehicles_json
          FROM visitors v
          WHERE v.group_id = @gid
        `);
      out.push({
        ...g,
        visitors: vs.recordset.map((v) => ({
          ...v,
          vehicles: v.vehicles_json ? JSON.parse(v.vehicles_json) : [],
        })),
      });
    }
    res.json(out);
  } catch (err) { next(err); }
});

/* ============================================================
   GATE — check in / check out
   ============================================================ */

/* ------------------------------------------------------------
   POST /api/visitors/checkin
   Body: { groupId, visitorId?, plateNumber?, gateName? }
   If visitorId omitted → checks in all visitors in the group.
   ------------------------------------------------------------ */
router.post("/checkin", requireAuth, requireRole("security", "admin"), async (req, res, next) => {
  try {
    const { groupId, visitorId, plateNumber, gateName } = req.body;
    if (!groupId) return res.status(400).json({ error: "groupId is required." });

    const pool = await getPool();
    const g = await pool.request().input("id", groupId)
      .query("SELECT * FROM visitor_groups WHERE id = @id");
    if (!g.recordset.length) return res.status(404).json({ error: "Group not found." });
    const grp = g.recordset[0];

    if (grp.status === "cancelled" || grp.status === "denied") {
      return res.status(400).json({ error: `Cannot check in — status is ${grp.status}.` });
    }
    if (grp.status === "expired") {
      return res.status(400).json({ error: "Code has expired." });
    }
    if (grp.expires_at && new Date() > new Date(grp.expires_at) && grp.status === "approved") {
      return res.status(400).json({ error: "Access code has expired." });
    }
    if (grp.status === "pending_admin" || grp.status === "pending_security") {
      return res.status(400).json({ error: "Pre-registration is not yet approved." });
    }

    const updateVisitor = async (vid) => {
      await pool.request()
        .input("vid", vid).input("by", req.user.id)
        .query(`
          UPDATE visitors
          SET status = 'checked_in',
              checked_in_at = SYSUTCDATETIME(),
              checked_in_by = @by
          WHERE id = @vid AND status IN ('pending','approved')
        `);
    };

    const targetVisitors = visitorId
      ? [visitorId]
      : (await pool.request().input("gid", groupId)
           .query("SELECT id FROM visitors WHERE group_id = @gid")).recordset.map((r) => r.id);

    for (const vid of targetVisitors) {
      await updateVisitor(vid);
    }

    await pool.request()
      .input("id", groupId)
      .query(`
        UPDATE visitor_groups
        SET status = CASE WHEN status = 'approved' THEN 'checked_in' ELSE status END,
            updated_at = SYSUTCDATETIME()
        WHERE id = @id
      `);

    await pool.request()
      .input("gid", groupId).input("hno", grp.house_number)
      .input("gate", gateName || null)
      .input("plate", plateNumber || null)
      .input("by", req.user.id)
      .query(`
        INSERT INTO access_log (group_id, house_number, gate_name, action, plate_number, logged_by)
        VALUES (@gid, @hno, @gate, 'entry', @plate, @by)
      `);

    await logEvent(pool, groupId, "checked_in", req.user.id, req.user.role, plateNumber || null);
    await updateSummary(pool, groupId);

    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------
   POST /api/visitors/checkout
   ------------------------------------------------------------ */
router.post("/checkout", requireAuth, requireRole("security", "admin"), async (req, res, next) => {
  try {
    const { groupId, visitorId, gateName } = req.body;
    if (!groupId) return res.status(400).json({ error: "groupId is required." });

    const pool = await getPool();
    const g = await pool.request().input("id", groupId)
      .query("SELECT * FROM visitor_groups WHERE id = @id");
    if (!g.recordset.length) return res.status(404).json({ error: "Group not found." });

    const updateVisitor = async (vid) => {
      await pool.request()
        .input("vid", vid).input("by", req.user.id)
        .query(`
          UPDATE visitors
          SET status = 'checked_out',
              checked_out_at = SYSUTCDATETIME(),
              checked_out_by = @by
          WHERE id = @vid AND status = 'checked_in'
        `);
    };

    const targetVisitors = visitorId
      ? [visitorId]
      : (await pool.request().input("gid", groupId)
           .query("SELECT id FROM visitors WHERE group_id = @gid AND status = 'checked_in'")).recordset.map((r) => r.id);

    for (const vid of targetVisitors) await updateVisitor(vid);

    /* If all visitors checked out, mark group completed */
    const remaining = await pool.request().input("gid", groupId)
      .query("SELECT COUNT(*) AS n FROM visitors WHERE group_id = @gid AND status = 'checked_in'");
    if (remaining.recordset[0].n === 0) {
      await pool.request().input("id", groupId)
        .query(`UPDATE visitor_groups SET status = 'completed', updated_at = SYSUTCDATETIME() WHERE id = @id`);
    }

    await pool.request()
      .input("gid", groupId).input("hno", g.recordset[0].house_number)
      .input("gate", gateName || null)
      .input("by", req.user.id)
      .query(`
        INSERT INTO access_log (group_id, house_number, gate_name, action, logged_by)
        VALUES (@gid, @hno, @gate, 'exit', @by)
      `);

    await logEvent(pool, groupId, "checked_out", req.user.id, req.user.role, null);
    await updateSummary(pool, groupId);

    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ============================================================
   ANALYTICS
   ============================================================ */

/* ------------------------------------------------------------
   GET /api/visitors/analytics?from=&to=
   ------------------------------------------------------------ */
router.get("/analytics", requireAuth, requireRole("admin", "security"), async (req, res, next) => {
  try {
    const to   = req.query.to   || new Date().toISOString().slice(0, 10);
    const from = req.query.from || new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);

    const pool = await getPool();

    const totals = await pool.request()
      .input("f", from).input("t", to)
      .query(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status IN ('approved','checked_in','completed') THEN 1 ELSE 0 END) AS approved,
          SUM(CASE WHEN status = 'denied'    THEN 1 ELSE 0 END) AS denied,
          SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
          SUM(CASE WHEN status = 'expired'   THEN 1 ELSE 0 END) AS expired,
          SUM(CASE WHEN status IN ('checked_in','completed') THEN 1 ELSE 0 END) AS checked_in,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed
        FROM visitor_groups
        WHERE visit_date BETWEEN @f AND @t
      `);

    const daily = await pool.request()
      .input("f", from).input("t", to)
      .query(`
        SELECT visit_date,
               COUNT(*) AS total,
               SUM(CASE WHEN status IN ('checked_in','completed') THEN 1 ELSE 0 END) AS arrived
        FROM visitor_groups
        WHERE visit_date BETWEEN @f AND @t
        GROUP BY visit_date
        ORDER BY visit_date ASC
      `);

    const hourly = await pool.request()
      .input("f", from).input("t", to)
      .query(`
        SELECT DATEPART(HOUR, checked_in_at) AS hour, COUNT(*) AS n
        FROM visitors
        WHERE checked_in_at BETWEEN @f AND DATEADD(DAY, 1, @t)
        GROUP BY DATEPART(HOUR, checked_in_at)
        ORDER BY hour
      `);

    const topHosts = await pool.request()
      .input("f", from).input("t", to)
      .query(`
        SELECT TOP 10 g.house_number, r.full_name,
               COUNT(*) AS visits
        FROM visitor_groups g
        JOIN Residents r ON r.id = g.resident_id
        WHERE g.visit_date BETWEEN @f AND @t
        GROUP BY g.house_number, r.full_name
        ORDER BY visits DESC
      `);

    res.json({
      range:  { from, to },
      totals: totals.recordset[0],
      daily:  daily.recordset,
      hourly: hourly.recordset,
      topHosts: topHosts.recordset,
    });
  } catch (err) { next(err); }
});

/* ============================================================
   EXPIRY — mark stale approved visits as expired
   ============================================================ */
router.post("/expire-stale", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query(`
      UPDATE visitor_groups
      SET status = 'expired', updated_at = SYSUTCDATETIME()
      OUTPUT INSERTED.id
      WHERE status = 'approved'
        AND expires_at IS NOT NULL
        AND expires_at < SYSUTCDATETIME()
    `);

    for (const row of r.recordset) {
      await logEvent(pool, row.id, "expired", null, "system");
      await updateSummary(pool, row.id);
    }

    res.json({ ok: true, expired: r.recordset.length });
  } catch (err) { next(err); }
});
/* ------------------------------------------------------------
   GET /api/visitors/:id — single group with visitors + vehicles
   ------------------------------------------------------------ */
router.get("/:id", requireAuth, requireRole("admin", "security", "resident"), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const pool = await getPool();
    const g = await pool.request().input("id", id)
      .query(`
        SELECT g.*, r.full_name AS resident_name, r.phone AS resident_phone, r.email AS resident_email
        FROM visitor_groups g
        JOIN Residents r ON r.id = g.resident_id
        WHERE g.id = @id
      `);
    if (!g.recordset.length) return res.status(404).json({ error: "Not found." });

    const grp = g.recordset[0];
    if (req.user.role === "resident" && grp.resident_id !== req.user.id) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const vs = await pool.request().input("gid", id)
      .query(`
        SELECT v.*,
               (SELECT vehicle_type AS [type], plate_number AS [plate], driver_name AS [driver]
                FROM visitor_vehicles WHERE visitor_id = v.id FOR JSON PATH) AS vehicles_json
        FROM visitors v
        WHERE v.group_id = @gid
      `);
    const visitors = vs.recordset.map((v) => ({
      ...v,
      vehicles: v.vehicles_json ? JSON.parse(v.vehicles_json) : [],
    }));

    res.json({ ...grp, visitors });
  } catch (err) { next(err); }
});
module.exports = router;