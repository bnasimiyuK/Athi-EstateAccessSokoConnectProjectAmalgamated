/* ============================================================
   routes/visitors.js — Visitor Pre-Registration
   2-stage approval: Admin → Security
   Code generated only after both approve.
   Email delivery to visitor + resident.
   + Bulk approval (max 200 per call, batched emails).
   ============================================================ */

const express = require("express");
const router  = express.Router();
const { getPool } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { sendMail } = require("../utils/mailer");

/* ------------------------------------------------------------
   Constants
   ------------------------------------------------------------ */
const MIN_LEAD_HOURS   = 48;
const CODE_VALID_HOURS = 24;
const MAX_LOOKAHEAD_DAYS = 30;
const BULK_MAX         = 200;

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

  await pool.request()
    .input("g", groupId)
    .query(`
      UPDATE visitor_group_summary
      SET final_status = (SELECT status FROM visitor_groups WHERE id = @g)
      WHERE group_id = @g
    `);
}

/* ------------------------------------------------------------
   Bulk helpers
   ------------------------------------------------------------ */

/* Send emails in batches of `batchSize` with `delayMs` between batches */
async function sendBatch(emails, batchSize = 25, delayMs = 1000) {
  const results = { sent: 0, failed: 0, failures: [] };

  for (let i = 0; i < emails.length; i += batchSize) {
    const batch = emails.slice(i, i + batchSize);

    await Promise.all(batch.map(async (e) => {
      try {
        await sendMail({ to: e.to, subject: e.subject, text: e.text });
        results.sent++;
      } catch (err) {
        results.failed++;
        results.failures.push({ to: e.to, subject: e.subject, error: err.message });
      }
    }));

    if (i + batchSize < emails.length) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return results;
}

/* Approve one group at admin stage. Never throws. */
async function approveAdminSingle(pool, groupId, adminId) {
  try {
    const g = await pool.request().input("id", groupId)
      .query("SELECT status FROM visitor_groups WHERE id = @id");
    if (!g.recordset.length) return { ok: false, error: "Not found" };
    if (g.recordset[0].status !== "pending_admin") {
      return { ok: false, error: `Status is ${g.recordset[0].status}, not pending_admin` };
    }

    await pool.request()
      .input("id", groupId)
      .input("by", adminId)
      .query(`
        UPDATE visitor_groups
        SET status = 'pending_security',
            admin_approved_by = @by,
            admin_approved_at = SYSUTCDATETIME(),
            updated_at = SYSUTCDATETIME()
        WHERE id = @id
      `);

    await logEvent(pool, groupId, "approved_admin", adminId, "admin");
    await updateSummary(pool, groupId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/* Approve one group at security stage. Generates code, queues emails. */
async function approveSecuritySingle(pool, groupId, securityId) {
  try {
    const g = await pool.request().input("id", groupId)
      .query(`
        SELECT g.*,
               CONVERT(VARCHAR(5), g.expected_time, 108) AS expected_time_hhmm,
               r.full_name AS resident_name,
               r.phone     AS resident_phone,
               r.email     AS resident_email
        FROM visitor_groups g
        JOIN Residents r ON r.id = g.resident_id
        WHERE g.id = @id
      `);
    if (!g.recordset.length) return { ok: false, error: "Not found" };
    const row = g.recordset[0];
    if (row.status !== "pending_security") {
      return { ok: false, error: `Status is ${row.status}, not pending_security` };
    }

    const code = await generateUniqueCode(pool);
    const expiresAt = new Date(Date.now() + CODE_VALID_HOURS * 3600e3);

    await pool.request()
      .input("id", groupId)
      .input("by", securityId)
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

    await logEvent(pool, groupId, "approved_security", securityId, "security");
    await logEvent(pool, groupId, "code_generated", null, "system", code);
    await updateSummary(pool, groupId);

    const vs = await pool.request().input("g", groupId)
      .query("SELECT id, name, phone, email FROM visitors WHERE group_id = @g");

    const emails = [];

    for (const v of vs.recordset) {
      if (v.email) {
        emails.push({
          to: v.email,
          subject: `Your visit code for ${row.house_number} on ${fmtDate(row.visit_date)}`,
          text:
`Hello ${v.name},

You have been pre-registered by the resident of ${row.house_number} to visit
Athi Estate Access on ${fmtDate(row.visit_date)}${row.expected_time_hhmm ? " at " + row.expected_time_hhmm : ""}.

Your access code is: ${code}

Show this code at the gate. The code is valid until ${fmtDate(expiresAt)}.

— Athi Estate Management`,
        });
      }
    }

    if (row.resident_email) {
      emails.push({
        to: row.resident_email,
        subject: `Visitor approved — code ${code} for ${fmtDate(row.visit_date)}`,
        text:
`Hi ${row.resident_name},

Your visitor pre-registration was approved by security.

Access code: ${code}
Visit date:  ${fmtDate(row.visit_date)}${row.expected_time_hhmm ? " at " + row.expected_time_hhmm : ""}
Visitors:    ${vs.recordset.map((v) => v.name).join(", ")}

The visitor has been emailed the code. If they lose it, share this email with them.

— Athi Estate Management`,
      });
    }

    return { ok: true, code, expiresAt, emails, groupId };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/* ------------------------------------------------------------
   GET /api/visitors/config — public config
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

router.post("/", requireAuth, requireRole("resident"), async (req, res, next) => {
  try {
    const { visitDate, expectedTime, purpose, visitors, notes } = req.body;

    if (!visitDate || !Array.isArray(visitors) || !visitors.length) {
      return res.status(400).json({ error: "visitDate and at least one visitor are required." });
    }

    const vd = new Date(
      expectedTime ? `${visitDate}T${expectedTime}` : `${visitDate}T23:59:59`
    );
    if (isNaN(vd)) return res.status(400).json({ error: "Invalid visitDate." });

    const now  = new Date();
    const hours = (vd - now) / 36e5;
    if (hours < MIN_LEAD_HOURS) {
      return res.status(400).json({
        error: `Pre-registration must be at least ${MIN_LEAD_HOURS}h in advance. Please choose a later date or time.`,
      });
    }
    if (hours > MAX_LOOKAHEAD_DAYS * 24) {
      return res.status(400).json({
        error: `Pre-registration cannot be more than ${MAX_LOOKAHEAD_DAYS} days ahead.`,
      });
    }

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

    const headcount = visitors.length;
    const inserted = await pool.request()
      .input("rid", resident.id)
      .input("hno", resident.house_number)
      .input("vd",  visitDate)
      .input("et",  expectedTime || null)
      .input("p",   purpose || null)
      .input("hc",  headcount)
      .input("n",   notes || null)
      .query(`
        INSERT INTO visitor_groups
          (resident_id, house_number, visit_date, expected_time, purpose,
           headcount, resident_notes, status, created_at)
        OUTPUT INSERTED.id
        VALUES
          (@rid, @hno, @vd, @et, @p, @hc, @n, 'pending_admin', SYSUTCDATETIME())
      `);

    const groupId = inserted.recordset[0].id;

    for (const v of visitors) {
      const vi = await pool.request()
        .input("g",  groupId)
        .input("n",  String(v.name).trim())
        .input("p",  v.phone || null)
        .input("e",  v.email || null)
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

router.get("/mine", requireAuth, requireRole("resident"), async (req, res, next) => {
  try {
    const pool = await getPool();
    const groups = await pool.request()
      .input("rid", req.user.id)
      .query(`
        SELECT g.*,
               CONVERT(VARCHAR(5), g.expected_time, 108) AS expected_time_hhmm,
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
   ADMIN + SECURITY — paginated pending lists
   ============================================================ */

router.get("/pending-admin", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const pageNum  = Math.max(1, parseInt(req.query.page || "1", 10));
    const limitNum = Math.min(200, Math.max(1, parseInt(req.query.limit || "50", 10)));
    const offset   = (pageNum - 1) * limitNum;

    const pool = await getPool();

    const countRes = await pool.request().query(`
      SELECT COUNT(*) AS total FROM visitor_groups WHERE status = 'pending_admin'
    `);
    const total = countRes.recordset[0].total || 0;

    const dataRes = await pool.request()
      .input("offset", offset)
      .input("limit",  limitNum)
      .query(`
        SELECT g.*,
               CONVERT(VARCHAR(5), g.expected_time, 108) AS expected_time_hhmm,
               r.full_name AS resident_name,
               r.phone     AS resident_phone,
               r.email     AS resident_email
        FROM visitor_groups g
        JOIN Residents r ON r.id = g.resident_id
        WHERE g.status = 'pending_admin'
        ORDER BY g.visit_date ASC, g.id ASC
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

router.get("/pending-security", requireAuth, requireRole("security", "admin"), async (req, res, next) => {
  try {
    const pageNum  = Math.max(1, parseInt(req.query.page || "1", 10));
    const limitNum = Math.min(200, Math.max(1, parseInt(req.query.limit || "50", 10)));
    const offset   = (pageNum - 1) * limitNum;

    const pool = await getPool();

    const countRes = await pool.request().query(`
      SELECT COUNT(*) AS total FROM visitor_groups WHERE status = 'pending_security'
    `);
    const total = countRes.recordset[0].total || 0;

    const dataRes = await pool.request()
      .input("offset", offset)
      .input("limit",  limitNum)
      .query(`
        SELECT g.*,
               CONVERT(VARCHAR(5), g.expected_time, 108) AS expected_time_hhmm,
               r.full_name AS resident_name,
               r.phone     AS resident_phone,
               r.email     AS resident_email
        FROM visitor_groups g
        JOIN Residents r ON r.id = g.resident_id
        WHERE g.status = 'pending_security'
        ORDER BY g.visit_date ASC, g.id ASC
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
   GET /api/visitors/pending-counts — tile counts only
   ------------------------------------------------------------ */
router.get("/pending-counts", requireAuth, requireRole("admin", "security"), async (req, res, next) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query(`
      SELECT
        (SELECT COUNT(*) FROM visitor_groups WHERE status = 'pending_admin')    AS pending_admin,
        (SELECT COUNT(*) FROM visitor_groups WHERE status = 'pending_security') AS pending_security
    `);
    res.json(r.recordset[0]);
  } catch (err) { next(err); }
});

/* ============================================================
   BULK APPROVAL ENDPOINTS
   ============================================================ */

router.post("/bulk-approve-admin", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const raw = Array.isArray(req.body.groupIds) ? req.body.groupIds : [];
    const ids = [...new Set(raw.map((x) => parseInt(x, 10)).filter(Number.isFinite))];

    if (!ids.length) return res.status(400).json({ error: "groupIds array is required." });
    if (ids.length > BULK_MAX) {
      return res.status(400).json({ error: `Cannot approve more than ${BULK_MAX} at a time. You selected ${ids.length}.` });
    }

    const pool = await getPool();
    const results = { ok: [], failed: [] };

    for (const id of ids) {
      const r = await approveAdminSingle(pool, id, req.user.id);
      if (r.ok) results.ok.push(id);
      else      results.failed.push({ id, error: r.error });
    }

    res.json({
      ok:       results.ok.length,
      failed:   results.failed.length,
      failures: results.failed,
    });
  } catch (err) { next(err); }
});

router.post("/bulk-approve-all-admin", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const { confirm, max } = req.body;
    if (confirm !== "APPROVE ALL") {
      return res.status(400).json({ error: 'Type "APPROVE ALL" to confirm.' });
    }

    const capNum = Math.min(BULK_MAX, Math.max(1, parseInt(max || BULK_MAX, 10)));

    const pool = await getPool();
    const pending = await pool.request()
      .input("cap", capNum)
      .query(`
        SELECT TOP (@cap) id
        FROM visitor_groups
        WHERE status = 'pending_admin'
        ORDER BY visit_date ASC, id ASC
      `);

    const ids = pending.recordset.map((r) => r.id);
    const results = { ok: [], failed: [] };

    for (const id of ids) {
      const r = await approveAdminSingle(pool, id, req.user.id);
      if (r.ok) results.ok.push(id);
      else      results.failed.push({ id, error: r.error });
    }

    const remainingRes = await pool.request().query(`
      SELECT COUNT(*) AS n FROM visitor_groups WHERE status = 'pending_admin'
    `);

    res.json({
      ok:       results.ok.length,
      failed:   results.failed.length,
      failures: results.failed,
      remaining: remainingRes.recordset[0].n,
    });
  } catch (err) { next(err); }
});

router.post("/bulk-approve-security", requireAuth, requireRole("security", "admin"), async (req, res, next) => {
  try {
    const raw = Array.isArray(req.body.groupIds) ? req.body.groupIds : [];
    const ids = [...new Set(raw.map((x) => parseInt(x, 10)).filter(Number.isFinite))];

    if (!ids.length) return res.status(400).json({ error: "groupIds array is required." });
    if (ids.length > BULK_MAX) {
      return res.status(400).json({ error: `Cannot approve more than ${BULK_MAX} at a time. You selected ${ids.length}.` });
    }

    const pool = await getPool();
    const results = { ok: [], failed: [], emailsQueued: [] };

    for (const id of ids) {
      const r = await approveSecuritySingle(pool, id, req.user.id);
      if (r.ok) {
        results.ok.push({ id, code: r.code });
        results.emailsQueued.push(...(r.emails || []));
      } else {
        results.failed.push({ id, error: r.error });
      }
    }

    const mailResult = await sendBatch(results.emailsQueued, 25, 1000);

    res.json({
      ok:            results.ok.length,
      failed:        results.failed.length,
      failures:      results.failed,
      codes:         results.ok,
      emailsSent:    mailResult.sent,
      emailsFailed:  mailResult.failed,
      emailFailures: mailResult.failures.slice(0, 20),
    });
  } catch (err) { next(err); }
});

router.post("/bulk-approve-all-security", requireAuth, requireRole("security", "admin"), async (req, res, next) => {
  try {
    const { confirm, max } = req.body;
    if (confirm !== "APPROVE ALL") {
      return res.status(400).json({ error: 'Type "APPROVE ALL" to confirm.' });
    }

    const capNum = Math.min(BULK_MAX, Math.max(1, parseInt(max || BULK_MAX, 10)));

    const pool = await getPool();
    const pending = await pool.request()
      .input("cap", capNum)
      .query(`
        SELECT TOP (@cap) id
        FROM visitor_groups
        WHERE status = 'pending_security'
        ORDER BY visit_date ASC, id ASC
      `);

    const ids = pending.recordset.map((r) => r.id);
    const results = { ok: [], failed: [], emailsQueued: [] };

    for (const id of ids) {
      const r = await approveSecuritySingle(pool, id, req.user.id);
      if (r.ok) {
        results.ok.push({ id, code: r.code });
        results.emailsQueued.push(...(r.emails || []));
      } else {
        results.failed.push({ id, error: r.error });
      }
    }

    const mailResult = await sendBatch(results.emailsQueued, 25, 1000);

    const remainingRes = await pool.request().query(`
      SELECT COUNT(*) AS n FROM visitor_groups WHERE status = 'pending_security'
    `);

    res.json({
      ok:            results.ok.length,
      failed:        results.failed.length,
      failures:      results.failed,
      codes:         results.ok,
      emailsSent:    mailResult.sent,
      emailsFailed:  mailResult.failed,
      emailFailures: mailResult.failures.slice(0, 20),
      remaining:     remainingRes.recordset[0].n,
    });
  } catch (err) { next(err); }
});

router.post("/bulk-deny", requireAuth, requireRole("admin", "security"), async (req, res, next) => {
  try {
    const raw = Array.isArray(req.body.groupIds) ? req.body.groupIds : [];
    const ids = [...new Set(raw.map((x) => parseInt(x, 10)).filter(Number.isFinite))];
    const reason = req.body.reason || null;
    const role = req.user.role;

    if (!ids.length) return res.status(400).json({ error: "groupIds array is required." });
    if (ids.length > BULK_MAX) {
      return res.status(400).json({ error: `Cannot deny more than ${BULK_MAX} at a time.` });
    }

    const col = role === "admin"
      ? { by: "admin_denied_by",    at: "admin_denied_at",    reason: "admin_deny_reason" }
      : { by: "security_denied_by", at: "security_denied_at", reason: "security_deny_reason" };

    const pool = await getPool();
    const results = { ok: [], failed: [] };

    for (const id of ids) {
      try {
        const g = await pool.request().input("id", id)
          .query("SELECT status FROM visitor_groups WHERE id = @id");
        if (!g.recordset.length) { results.failed.push({ id, error: "Not found" }); continue; }
        const cur = g.recordset[0].status;
        if (!["pending_admin", "pending_security"].includes(cur)) {
          results.failed.push({ id, error: `Status is ${cur}` });
          continue;
        }

        await pool.request()
          .input("id", id)
          .input("by", req.user.id)
          .input("r",  reason)
          .query(`
            UPDATE visitor_groups
            SET status = 'denied',
                ${col.by} = @by,
                ${col.at} = SYSUTCDATETIME(),
                ${col.reason} = @r,
                updated_at = SYSUTCDATETIME()
            WHERE id = @id
          `);

        await logEvent(pool, id, `denied_${role}`, req.user.id, role, reason);
        await updateSummary(pool, id);
        results.ok.push(id);
      } catch (err) {
        results.failed.push({ id, error: err.message });
      }
    }

    res.json({
      ok:       results.ok.length,
      failed:   results.failed.length,
      failures: results.failed,
    });
  } catch (err) { next(err); }
});

/* ============================================================
   SINGLE-ITEM APPROVAL / DENY (existing)
   ============================================================ */

router.post("/:id/approve-admin", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const pool = await getPool();
    const r = await approveAdminSingle(pool, id, req.user.id);
    if (!r.ok) return res.status(400).json({ error: r.error });
    res.json({ ok: true, status: "pending_security" });
  } catch (err) { next(err); }
});

router.post("/:id/approve-security", requireAuth, requireRole("security", "admin"), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const pool = await getPool();
    const r = await approveSecuritySingle(pool, id, req.user.id);
    if (!r.ok) return res.status(400).json({ error: r.error });

    /* Send emails synchronously for single approval (as before) */
    if (r.emails && r.emails.length) {
      for (const e of r.emails) {
        try { await sendMail({ to: e.to, subject: e.subject, text: e.text }); }
        catch { /* ignore individual failures */ }
      }
    }

    res.json({
      ok: true,
      status: "approved",
      code: r.code,
      expiresAt: r.expiresAt,
    });
  } catch (err) { next(err); }
});

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

/* ============================================================
   FULL LIST + REGISTER
   ============================================================ */

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
      SELECT g.*,
             CONVERT(VARCHAR(5), g.expected_time, 108) AS expected_time_hhmm,
             r.full_name AS resident_name,
             r.phone     AS resident_phone
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

router.get("/register", requireAuth, requireRole("admin", "security"), async (req, res, next) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: "date is required." });

    const pool = await getPool();
    const groups = await pool.request().input("d", date)
      .query(`
        SELECT g.*,
               CONVERT(VARCHAR(5), g.expected_time, 108) AS expected_time_hhmm,
               r.full_name AS resident_name,
               r.phone     AS resident_phone
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
   GATE — CHECK IN / CHECK OUT
   ============================================================ */

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
        .input("vid", vid)
        .input("gid", groupId)
        .input("by", req.user.id)
        .query(`
          UPDATE visitors
          SET status = 'checked_in',
              checked_in_at = SYSUTCDATETIME(),
              checked_in_by = @by
          WHERE id = @vid
            AND group_id = @gid
            AND status IN ('pending','approved')
        `);
    };

    const targetVisitors = visitorId
      ? [visitorId]
      : (await pool.request().input("gid", groupId)
           .query("SELECT id FROM visitors WHERE group_id = @gid")).recordset.map((r) => r.id);

    for (const vid of targetVisitors) await updateVisitor(vid);

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

    const remaining = await pool.request().input("gid", groupId)
      .query("SELECT COUNT(*) AS n FROM visitors WHERE group_id = @gid AND status = 'checked_in'");
    const finalGroup = await pool.request().input("id", groupId)
      .query("SELECT status FROM visitor_groups WHERE id = @id");

    res.json({
      ok: true,
      groupStatus: finalGroup.recordset[0] ? finalGroup.recordset[0].status : null,
      remainingInside: remaining.recordset[0].n,
    });
  } catch (err) { next(err); }
});

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
        .input("vid", vid)
        .input("gid", groupId)
        .input("by", req.user.id)
        .query(`
          UPDATE visitors
          SET status = 'checked_out',
              checked_out_at = SYSUTCDATETIME(),
              checked_out_by = @by
          WHERE id = @vid
            AND group_id = @gid
            AND status = 'checked_in'
        `);
    };

    const targetVisitors = visitorId
      ? [visitorId]
      : (await pool.request().input("gid", groupId)
           .query("SELECT id FROM visitors WHERE group_id = @gid AND status = 'checked_in'")).recordset.map((r) => r.id);

    for (const vid of targetVisitors) await updateVisitor(vid);

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

    const finalGroup = await pool.request().input("id", groupId)
      .query("SELECT status FROM visitor_groups WHERE id = @id");

    res.json({
      ok: true,
      groupStatus: finalGroup.recordset[0] ? finalGroup.recordset[0].status : null,
      remainingInside: remaining.recordset[0].n,
    });
  } catch (err) { next(err); }
});

/* ============================================================
   ANALYTICS + LIVE STATS + EXPIRY
   ============================================================ */

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

router.get("/live-stats", requireAuth, requireRole("admin", "security"), async (req, res, next) => {
  try {
    const pool = await getPool();
    const today = new Date().toISOString().slice(0, 10);

    const r = await pool.request()
      .input("today", today)
      .query(`
        SELECT
          (SELECT COUNT(*) FROM visitor_groups WHERE status = 'pending_security') AS pending_security,
          (SELECT COUNT(*) FROM visitor_groups WHERE status = 'pending_admin')    AS pending_admin,
          (SELECT COUNT(*) FROM visitor_groups
             WHERE visit_date = @today
               AND status IN ('approved','checked_in','completed'))              AS expected_today,
          (SELECT COUNT(*) FROM visitors WHERE status = 'checked_in')            AS currently_on_site,
          (SELECT COUNT(*) FROM visitor_groups
             WHERE visit_date = @today
               AND status = 'completed')                                         AS completed_today
      `);

    res.json(r.recordset[0]);
  } catch (err) { next(err); }
});

/* ============================================================
   SINGLE GROUP — must be the LAST route
   ============================================================ */
router.get("/:id", requireAuth, requireRole("admin", "security", "resident"), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const pool = await getPool();
    const g = await pool.request().input("id", id)
      .query(`
        SELECT g.*,
               CONVERT(VARCHAR(5), g.expected_time, 108) AS expected_time_hhmm,
               r.full_name AS resident_name,
               r.phone     AS resident_phone,
               r.email     AS resident_email
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