/* ============================================================
   routes/events.js — AHEWA welfare events
   Admin creates an event (title, month, amount, due date).
   Generating invoices bills ONLY residents with join_ahewa = 1.
   Non-members are never billed for AHEWA events.
   ============================================================ */

const express = require("express");
const router = express.Router();
const { getPool } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");

/* ------------------------------------------------------------
   Helper: row → JSON
   ------------------------------------------------------------ */
function eventToJson(r) {
  return {
    id:         r.id,
    title:      r.title,
    eventMonth: r.event_month,
    amount:     Number(r.amount),
    dueDate:    r.due_date,
    createdBy:  r.created_by,
    createdAt:  r.created_at,
  };
}

/* ============================================================
   GET /api/events   (admin)
   List all events, newest first.
   ============================================================ */
router.get("/", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query(`
      SELECT * FROM events
      ORDER BY event_month DESC, id DESC
    `);
    res.json(r.recordset.map(eventToJson));
  } catch (err) {
    next(err);
  }
});

/* ============================================================
   POST /api/events   (admin)
   Body: { title, eventMonth: "YYYY-MM", amount, dueDate: "YYYY-MM-DD" }
   ============================================================ */
router.post("/", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const { title, eventMonth, amount, dueDate } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: "title is required." });
    }
    if (!/^\d{4}-\d{2}$/.test(eventMonth || "")) {
      return res.status(400).json({ error: 'eventMonth is required in format "YYYY-MM".' });
    }
    const amt = Number(amount);
    if (isNaN(amt) || amt <= 0) {
      return res.status(400).json({ error: "amount must be a positive number." });
    }
    if (!dueDate || isNaN(Date.parse(dueDate))) {
      return res.status(400).json({ error: "dueDate is required (YYYY-MM-DD)." });
    }

    const pool = await getPool();
    const inserted = await pool.request()
      .input("title", title.trim())
      .input("month", eventMonth)
      .input("amount", amt)
      .input("due", new Date(dueDate))
      .input("by", req.user.id)
      .query(`
        INSERT INTO events (title, event_month, amount, due_date, created_by)
        OUTPUT INSERTED.*
        VALUES (@title, @month, @amount, @due, @by)
      `);

    res.status(201).json(eventToJson(inserted.recordset[0]));
  } catch (err) {
    next(err);
  }
});

/* ============================================================
   POST /api/events/:id/generate-invoices   (admin)
   Creates one AHEWA_EVENT invoice per active AHEWA member
   for the event's billing month. Idempotent — skips residents
   who already have an AHEWA_EVENT invoice for this event.

   NOTE: We tag invoices with a marker in `billing_month` that
   combines the event month with the event id, so we can tell
   two events in the same month apart:
       billing_month = 'YYYY-MM'   (unchanged)
       type          = 'AHEWA_EVENT'
       house_number  = '<resident house or PENDING-<id>>'
   To avoid duplicate inserts per event, we check whether an
   invoice with this event's "title-month" already exists for
   that house by looking for type='AHEWA_EVENT' + matching amount.
   Better: use a dedicated events_invoices link table (future).
   For now: skip if the resident already has an AHEWA_EVENT
   invoice with the same amount in the same billing_month.
   ============================================================ */
router.post("/:id/generate-invoices", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const eventId = parseInt(req.params.id, 10);
    if (isNaN(eventId)) return res.status(400).json({ error: "Invalid event id." });

    const pool = await getPool();

    /* ---- Load the event ---- */
    const evRes = await pool.request()
      .input("id", eventId)
      .query("SELECT * FROM events WHERE id = @id");
    if (!evRes.recordset.length) {
      return res.status(404).json({ error: "Event not found." });
    }
    const ev = evRes.recordset[0];

    /* ---- Eligible residents: AHEWA members, verified, verified = 1 ---- */
    const eligible = await pool.request().query(`
      SELECT id, full_name, house_number, join_ahewa
      FROM Residents
      WHERE verified = 1
        AND join_ahewa = 1
    `);

    let created = 0, skipped = 0;
    const errors = [];

    for (const r of eligible.recordset) {
      try {
        /* ---- Duplicate check: same resident, same month, same amount ---- */
        const dup = await pool.request()
          .input("rid", r.id)
          .input("m",   ev.event_month)
          .input("amt", ev.amount)
          .query(`
            SELECT 1 FROM invoices
            WHERE resident_id = @rid
              AND billing_month = @m
              AND type = 'AHEWA_EVENT'
              AND amount_due = @amt
          `);
        if (dup.recordset.length) {
          skipped++;
          continue;
        }

        const house = r.house_number || `PENDING-${r.id}`;

        await pool.request()
          .input("rid",   r.id)
          .input("h",     house)
          .input("m",     ev.event_month)
          .input("amt",   ev.amount)
          .input("due",   new Date(ev.due_date))
          .query(`
            INSERT INTO invoices
              (resident_id, house_number, billing_month, amount_due, due_date, type)
            VALUES (@rid, @h, @m, @amt, @due, 'AHEWA_EVENT')
          `);

        created++;
      } catch (rowErr) {
        errors.push({ residentId: r.id, message: rowErr.message });
      }
    }

    res.json({
      eventId:  ev.id,
      title:    ev.title,
      month:    ev.event_month,
      amount:   Number(ev.amount),
      eligible: eligible.recordset.length,
      created,
      skipped,
      errors,
    });
  } catch (err) {
    next(err);
  }
});

/* ============================================================
   GET /api/events/:id   (admin)
   ============================================================ */
router.get("/:id", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id." });

    const pool = await getPool();
    const r = await pool.request()
      .input("id", id)
      .query("SELECT * FROM events WHERE id = @id");

    if (!r.recordset.length) {
      return res.status(404).json({ error: "Event not found." });
    }
    res.json(eventToJson(r.recordset[0]));
  } catch (err) {
    next(err);
  }
});

/* ============================================================
   DELETE /api/events/:id   (admin)
   Deletes the event. Does NOT delete invoices already generated —
   those are the residents' liabilities once billed.
   ============================================================ */
router.delete("/:id", requireAuth, requireRole("admin"), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id." });

    const pool = await getPool();
    const r = await pool.request()
      .input("id", id)
      .query("DELETE FROM events WHERE id = @id");

    if (r.rowsAffected[0] === 0) {
      return res.status(404).json({ error: "Event not found." });
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;