/* ============================================================
   routes/ahewa.js — AHEWA
   Handles welfare events, contributions, and disbursement
   co-authorization by the three signatories.
   ============================================================ */

const express = require("express");
const router  = express.Router();
const { getPool } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { notifyEventOpened, notifyEventClosed } = require("../utils/ahewaSms");
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");

/* ------------------------------------------------------------
   Helpers
   ------------------------------------------------------------ */
function currentMonth() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/* Amount rules: PRINCIPAL = 1200, DEPENDANT = 700 */
function amountFor(eventType) {
  if (eventType === "PRINCIPAL") return 1200;
  if (eventType === "DEPENDANT") return 700;
  throw new Error("Invalid event type. Must be PRINCIPAL or DEPENDANT.");
}

/* ============================================================
   GET /api/ahewa/members
   Live roster of all AHEWA members with contribution totals.
   ============================================================ */
router.get("/members", requireAuth, async (req, res, next) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT
        r.id, r.full_name, r.house_number,
        c.name AS court_name, c.phase,
        r.created_at AS joined_at,
        COALESCE((SELECT SUM(amount_paid) FROM AhewaContributions WHERE resident_id = r.id), 0) AS total_contributed,
        COALESCE((SELECT SUM(amount_due - amount_paid) FROM AhewaContributions WHERE resident_id = r.id), 0) AS outstanding,
        CASE WHEN EXISTS (SELECT 1 FROM AhewaSignatories WHERE resident_id = r.id)
             THEN 1 ELSE 0 END AS is_signatory,
        (SELECT TOP 1 role FROM AhewaSignatories WHERE resident_id = r.id) AS signatory_role
      FROM Residents r
      LEFT JOIN Courts c ON c.id = r.court_id
      WHERE r.verified = 1 AND r.join_ahewa = 1
      ORDER BY r.full_name ASC
    `);
    res.json(result.recordset);
  } catch (err) {
    next(err);
  }
});

/* ============================================================
   GET /api/ahewa/events
   List all welfare events with contribution summary.
   ============================================================ */
router.get("/events", requireAuth, async (req, res, next) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT
        e.id, e.event_type, e.event_title, e.description,
        e.contribution_amount, e.event_date, e.is_closed,
        e.is_disbursed, e.disbursed_at,
        e.created_at,
        r.id AS affected_member_id,
        r.full_name AS affected_member_name,
        r.house_number AS affected_member_house,
        (SELECT COUNT(*) FROM AhewaContributions WHERE event_id = e.id) AS members_billed,
        (SELECT COUNT(*) FROM AhewaContributions WHERE event_id = e.id AND status = 'paid') AS members_paid,
        (SELECT COALESCE(SUM(amount_paid), 0) FROM AhewaContributions WHERE event_id = e.id) AS collected,
        (SELECT COALESCE(SUM(amount_due), 0) FROM AhewaContributions WHERE event_id = e.id) AS expected,
        (SELECT COUNT(*) FROM AhewaDisbursementApprovals WHERE event_id = e.id) AS approvals_count
      FROM AhewaEvents e
      JOIN Residents r ON r.id = e.affected_member_id
      ORDER BY e.event_date DESC, e.id DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    next(err);
  }
});

/* ============================================================
   GET /api/ahewa/events/:id
   Returns:
     - Admins & Signatories: full event + contribution matrix + approvals
     - Regular Residents    : event header + their own contribution only
   ============================================================ */
router.get("/events/:id", requireAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid event id" });

    const pool = await getPool();
    const userId = req.user.id;
    const userRole = req.user.role;

    /* ---- Determine access level ---- */
    const isAdmin = userRole === "admin";

    let isSignatory = false;
    if (userRole === "resident") {
      const sigQ = await pool.request()
        .input("rid", userId)
        .query("SELECT 1 FROM AhewaSignatories WHERE resident_id = @rid AND is_active = 1");
      isSignatory = sigQ.recordset.length > 0;
    }

    const fullAccess = isAdmin || isSignatory;

    /* ---- Event header (always returned) ---- */
    const evQ = await pool.request()
      .input("id", id)
      .query(`
        SELECT
          e.*,
          r.full_name AS affected_member_name,
          r.house_number AS affected_member_house,
          c.name AS affected_member_court
        FROM AhewaEvents e
        JOIN Residents r ON r.id = e.affected_member_id
        LEFT JOIN Courts c ON c.id = r.court_id
        WHERE e.id = @id
      `);
    if (!evQ.recordset.length) return res.status(404).json({ error: "Event not found" });

    /* ---- If full access: return the entire matrix ---- */
    if (fullAccess) {
      const contribQ = await pool.request()
        .input("id", id)
        .query(`
          SELECT
            c.id, c.resident_id, r.full_name, r.house_number,
            c.amount_due, c.amount_paid, c.status, c.paid_at,
            c.invoice_id,
            (SELECT TOP 1 mpesa_receipt FROM payments p
             WHERE p.invoice_id = c.invoice_id
               AND p.type = 'AHEWA_EVENT'
             ORDER BY p.id DESC) AS last_receipt
          FROM AhewaContributions c
          JOIN Residents r ON r.id = c.resident_id
          WHERE c.event_id = @id
          ORDER BY r.full_name ASC
        `);

      const apprQ = await pool.request()
        .input("id", id)
        .query(`
          SELECT
            a.id, a.signatory_id, r.full_name AS signatory_name,
            s.role AS signatory_role, a.approved_at, a.notes
          FROM AhewaDisbursementApprovals a
          JOIN Residents r ON r.id = a.signatory_id
          LEFT JOIN AhewaSignatories s ON s.resident_id = a.signatory_id
          WHERE a.event_id = @id
          ORDER BY a.approved_at ASC
        `);

      const sigQ = await pool.request().query(`
        SELECT s.id, s.resident_id, r.full_name, s.role
        FROM AhewaSignatories s
        JOIN Residents r ON r.id = s.resident_id
        WHERE s.is_active = 1
        ORDER BY s.id
      `);

      const approvals = apprQ.recordset;
      const allSigs = sigQ.recordset;
      const approvedIds = new Set(approvals.map(a => a.signatory_id));
      const pendingSigs = allSigs.filter(s => !approvedIds.has(s.resident_id));

      return res.json({
        access: "full",
        is_admin: isAdmin,
        is_signatory: isSignatory,
        event: evQ.recordset[0],
        contributions: contribQ.recordset,
        approvals,
        all_signatories: allSigs,
        pending_signatories: pendingSigs,
        is_fully_approved: pendingSigs.length === 0 && allSigs.length > 0,
      });
    }

    /* ---- Limited access: resident who is not a signatory ---- */
    const ownQ = await pool.request()
      .input("id", id)
      .input("rid", userId)
      .query(`
        SELECT
          c.id, c.resident_id,
          c.amount_due, c.amount_paid, c.status, c.paid_at,
          c.invoice_id,
          (SELECT TOP 1 mpesa_receipt FROM payments p
           WHERE p.invoice_id = c.invoice_id
             AND p.type = 'AHEWA_EVENT'
           ORDER BY p.id DESC) AS last_receipt
        FROM AhewaContributions c
        WHERE c.event_id = @id AND c.resident_id = @rid
      `);

    // Did this resident even get billed? (i.e. they're an AHEWA member and not the affected member)
    const ownContribution = ownQ.recordset.length ? ownQ.recordset[0] : null;

    // Is this resident the affected member?
    const isAffectedMember = evQ.recordset[0].affected_member_id === userId;

    return res.json({
      access: "limited",
      is_affected_member: isAffectedMember,
      event: evQ.recordset[0],
      my_contribution: ownContribution,
    });
  } catch (err) {
    next(err);
  }
});

/* ============================================================
   POST /api/ahewa/events
   Create a welfare event and generate contribution invoices
   for every AHEWA member (excluding the affected member).
   Body: { affected_member_id, event_type, event_title, description, event_date }
   ============================================================ */
router.post("/events", requireAuth, async (req, res, next) => {
  const pool = await getPool();
  const tx = pool.transaction();
  await tx.begin();

  try {
    const { affected_member_id, event_type, event_title, description, event_date } = req.body;

    if (!affected_member_id || !event_type || !event_title || !event_date) {
      await tx.rollback();
      return res.status(400).json({ error: "Missing required fields" });
    }

    const amount = amountFor(event_type);
    const affectedId = parseInt(affected_member_id, 10);

    // Verify affected member is an AHEWA member
    const memQ = await tx.request()
      .input("id", affectedId)
      .query("SELECT id, full_name FROM Residents WHERE id = @id AND join_ahewa = 1 AND verified = 1");
    if (!memQ.recordset.length) {
      await tx.rollback();
      return res.status(400).json({ error: "Affected member is not an active AHEWA member." });
    }

    // Insert the event
    const evR = await tx.request()
      .input("mid",    affectedId)
      .input("type",   event_type)
      .input("title",  event_title)
      .input("desc",   description || null)
      .input("amt",    amount)
      .input("edate",  event_date)
      .input("by",     req.user.id)
      .query(`
        INSERT INTO AhewaEvents
          (affected_member_id, event_type, event_title, description,
           contribution_amount, event_date, created_by)
        OUTPUT INSERTED.id
        VALUES (@mid, @type, @title, @desc, @amt, @edate, @by)
      `);
    const eventId = evR.recordset[0].id;

    // Snapshot AHEWA members (exclude affected member)
       // Snapshot AHEWA members (exclude affected member)
    // Fetch phone + name too so we can SMS them after commit
        // Snapshot AHEWA members (exclude affected member)
    // Fetch phone + name so we can SMS them after commit
    const membersQ = await tx.request()
      .input("mid", affectedId)
      .query(`
        SELECT id, phone, full_name, email FROM Residents
        WHERE verified = 1 AND join_ahewa = 1 AND id != @mid
      `);

    const memberIds = membersQ.recordset.map(r => r.id);

    // Identify signatories among the billed members (they get an email too)
    const signatoriesQ = await tx.request()
      .input("mid", affectedId)
      .query(`
        SELECT r.id, r.full_name, r.phone, r.email, s.role
        FROM AhewaSignatories s
        JOIN Residents r ON r.id = s.resident_id
        WHERE s.is_active = 1 AND r.id != @mid
      `);
    const signatories = signatoriesQ.recordset;

    // Insert a contribution row for each member
       // Insert a contribution row AND a matching invoice for each member
    // so the debt shows up on their billing page.
    const month = currentMonth();
    const [y, m] = month.split("-").map(Number);
    const dueDate = new Date(Date.UTC(y, m - 1, 5));

    for (const mid of memberIds) {
      // 1. Create the invoice first
      const invR = await tx.request()
        .input("rid",  mid)
        .input("m",    month)
        .input("amt",  amount)
        .input("due",  dueDate)
        .input("type", "AHEWA_EVENT")
        .input("note", event_title)
        .query(`
          INSERT INTO invoices
            (resident_id, house_number, billing_month, amount_due, due_date, type, notes)
          OUTPUT INSERTED.id
          VALUES (
            @rid,
            (SELECT house_number FROM Residents WHERE id = @rid),
            @m, @amt, @due, @type, @note
          )
        `);
      const invoiceId = invR.recordset[0].id;

      // 2. Link the contribution row to the invoice
      await tx.request()
        .input("eid", eventId)
        .input("rid", mid)
        .input("amt", amount)
        .input("inv", invoiceId)
        .query(`
          INSERT INTO AhewaContributions (event_id, resident_id, amount_due, invoice_id)
          VALUES (@eid, @rid, @amt, @inv)
        `);
    }

        await tx.commit();
    const eventDetails = {
      id: eventId,
      event_title: event_title,
      event_type: event_type,
      contribution_amount: amount,
      event_date: event_date,
    };
    notifyEventOpened(membersQ.recordset, signatories, eventDetails)
      .catch((err) => console.error("[ahewa] open SMS failed:", err.message));
    res.status(201).json({
      ok: true,
      event_id: eventId,
      members_billed: memberIds.length,
      amount_per_member: amount,
      total_expected: memberIds.length * amount,
    });
  } catch (err) {
    await tx.rollback();
    next(err);
  }
});

/* ============================================================
   DELETE /api/ahewa/events/:id
   Deletes event and all contributions (cascade).
   ============================================================ */
router.delete("/events/:id", requireAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid event id" });

    const pool = await getPool();
    const check = await pool.request()
      .input("id", id)
      .query("SELECT COUNT(*) AS paid_count FROM AhewaContributions WHERE event_id = @id AND status = 'paid'");

    if (check.recordset[0].paid_count > 0) {
      return res.status(400).json({
        error: "Cannot delete — some members have already paid. Void or refund first."
      });
    }

    const result = await pool.request()
      .input("id", id)
      .query("DELETE FROM AhewaEvents WHERE id = @id");

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: "Event not found" });
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

/* ============================================================
   POST /api/ahewa/events/:id/approve-disbursement
   Record one signatory's approval. Only signatories can approve.
   When all signatories approve, event is eligible for disbursement.
   ============================================================ */
router.post("/events/:id/approve-disbursement", requireAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const signatoryId = req.user.id;
    const notes = req.body.notes || null;

    const pool = await getPool();

    // Is the caller an active signatory?
        // Is the caller an active signatory?
    // IMPORTANT: Only users whose role is "resident" can be signatories,
    // because AhewaSignatories.resident_id references Residents.id.
    // Admins have a separate Admins table whose ids can collide with
    // Residents ids, so we must not match them here.
    if (req.user.role !== "resident") {
      return res.status(403).json({
        error: "Only AHEWA resident signatories can approve disbursements."
      });
    }

    const isSigQ = await pool.request()
      .input("rid", signatoryId)
      .query("SELECT 1 FROM AhewaSignatories WHERE resident_id = @rid AND is_active = 1");
    if (!isSigQ.recordset.length) {
      return res.status(403).json({ error: "Only AHEWA signatories can approve disbursements." });
    }

    // Does the event exist?
    const evQ = await pool.request().input("id", id).query("SELECT 1 FROM AhewaEvents WHERE id = @id");
    if (!evQ.recordset.length) return res.status(404).json({ error: "Event not found." });

    // Insert approval (UNIQUE prevents double-approval by same signatory)
    try {
      await pool.request()
        .input("eid", id)
        .input("sid", signatoryId)
        .input("notes", notes)
        .query(`
          INSERT INTO AhewaDisbursementApprovals (event_id, signatory_id, notes)
          VALUES (@eid, @sid, @notes)
        `);
    } catch (err) {
      if (err.number === 2601 || err.number === 2627) {
        return res.status(400).json({ error: "You have already approved this event." });
      }
      throw err;
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ============================================================
   POST /api/ahewa/events/:id/mark-disbursed
   Mark event as fully disbursed. Requires all signatories to have approved.
   ============================================================ */
router.post("/events/:id/mark-disbursed", requireAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const notes = req.body.notes || null;
    const pool = await getPool();
    if (req.user.role !== "resident") {
      return res.status(403).json({
        error: "Only AHEWA resident signatories can mark events as disbursed."
      });
    }
    // Count active signatories and approvals
    const sigQ = await pool.request().query("SELECT COUNT(*) AS n FROM AhewaSignatories WHERE is_active = 1");
    const apprQ = await pool.request().input("id", id)
      .query("SELECT COUNT(*) AS n FROM AhewaDisbursementApprovals WHERE event_id = @id");

    const required = sigQ.recordset[0].n;
    const have = apprQ.recordset[0].n;

    if (required === 0) {
      return res.status(400).json({ error: "No signatories configured." });
    }
    if (have < required) {
      return res.status(400).json({
        error: `Not fully approved. Have ${have}/${required} signatory approvals.`
      });
    }

        await pool.request()
      .input("id", id)
      .input("notes", notes)
      .query(`
        UPDATE AhewaEvents
        SET is_disbursed = 1,
            disbursed_at = SYSUTCDATETIME(),
            disbursed_notes = @notes
        WHERE id = @id
      `);

    /* ---- Fire-and-forget closing SMS to all billed members ---- */
    const evQ = await pool.request()
      .input("id", id)
      .query("SELECT id, event_title, contribution_amount FROM AhewaEvents WHERE id = @id");

    const billedQ = await pool.request()
      .input("id", id)
      .query(`
        SELECT r.phone, r.full_name
        FROM AhewaContributions c
        JOIN Residents r ON r.id = c.resident_id
        WHERE c.event_id = @id
      `);

    if (evQ.recordset.length && billedQ.recordset.length) {
      notifyEventClosed(billedQ.recordset, evQ.recordset[0])
        .catch((err) => console.error("[ahewa] close SMS failed:", err.message));
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
/* ============================================================
   GET /api/ahewa/events/:id/export.xlsx
   Download event report as Excel (xlsx).
   ============================================================ */
router.get("/events/:id/export.xlsx", requireAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid event id" });

    const pool = await getPool();

    // Event header
    const evQ = await pool.request()
      .input("id", id)
      .query(`
        SELECT e.*, r.full_name AS affected_member_name, r.house_number AS affected_member_house,
               c.name AS affected_member_court
        FROM AhewaEvents e
        JOIN Residents r ON r.id = e.affected_member_id
        LEFT JOIN Courts c ON c.id = r.court_id
        WHERE e.id = @id
      `);
    if (!evQ.recordset.length) return res.status(404).json({ error: "Event not found" });
    const ev = evQ.recordset[0];

    // Contribution matrix
    const contribQ = await pool.request()
      .input("id", id)
      .query(`
        SELECT r.full_name, r.house_number, c2.name AS court_name,
               c.amount_due, c.amount_paid, c.status, c.paid_at,
               (SELECT TOP 1 mpesa_receipt FROM payments p
 WHERE p.invoice_id = c.invoice_id
   AND p.type = 'AHEWA_EVENT'
   AND p.status = 'verified'
 ORDER BY p.id DESC) AS last_receipt
        FROM AhewaContributions c
        JOIN Residents r ON r.id = c.resident_id
        LEFT JOIN Courts c2 ON c2.id = r.court_id
        WHERE c.event_id = @id
        ORDER BY r.full_name ASC
      `);

    // Signatories + approvals
    const apprQ = await pool.request()
      .input("id", id)
      .query(`
        SELECT s.role, r.full_name AS signatory_name, a.approved_at
        FROM AhewaSignatories s
        JOIN Residents r ON r.id = s.resident_id
        LEFT JOIN AhewaDisbursementApprovals a
          ON a.signatory_id = s.resident_id AND a.event_id = @id
        WHERE s.is_active = 1
        ORDER BY CASE s.role WHEN 'Chairperson' THEN 1 WHEN 'Treasurer' THEN 2 WHEN 'Secretary' THEN 3 ELSE 9 END
      `);

    // Build workbook
    const wb = new ExcelJS.Workbook();
    wb.creator = "Athi Soko Connect";
    wb.created = new Date();

    const ws = wb.addWorksheet("AHEWA Event");

    // Column widths
    ws.columns = [
      { width: 4  }, // #
      { width: 28 }, // Member
      { width: 16 }, // House
      { width: 22 }, // Court
      { width: 14 }, // Amount due
      { width: 14 }, // Amount paid
      { width: 12 }, // Status
      { width: 16 }, // Paid on
      { width: 18 }, // Receipt
    ];

    let row = 1;

    // Title
    ws.mergeCells(row, 1, row, 9);
    const titleCell = ws.getCell(row, 1);
    titleCell.value = "AHEWA WELFARE CONTRIBUTION REPORT";
    titleCell.font = { bold: true, size: 14, color: { argb: "FF16233F" } };
    titleCell.alignment = { horizontal: "left" };
    row++;

    // Event title
    ws.mergeCells(row, 1, row, 9);
    ws.getCell(row, 1).value = ev.event_title;
    ws.getCell(row, 1).font = { bold: true, size: 12 };
    row += 2;

    // Event info block
    const info = [
      ["Event type:",         ev.event_type === "PRINCIPAL" ? "Deceased principal" : "Deceased dependant"],
      ["Event date:",         new Date(ev.event_date).toDateString()],
      ["Affected member:",    `${ev.affected_member_name} (${ev.affected_member_house || "—"}${ev.affected_member_court ? ` · ${ev.affected_member_court}` : ""})`],
      ["Amount per member:",  Number(ev.contribution_amount).toLocaleString("en-KE", { style: "currency", currency: "KES" })],
    ];
    info.forEach(([label, value]) => {
      ws.getCell(row, 1).value = label;
      ws.getCell(row, 1).font = { bold: true };
      ws.mergeCells(row, 2, row, 9);
      ws.getCell(row, 2).value = value;
      row++;
    });
    row++;

    // Table header
    const headers = ["#", "Member", "House", "Court", "Amount due", "Amount paid", "Status", "Paid on", "Receipt"];
    const headerRow = ws.getRow(row);
    headers.forEach((h, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = h;
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF16233F" } };
      cell.alignment = { horizontal: "left", vertical: "middle" };
      cell.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
    });
    headerRow.height = 20;
    row++;

    // Data rows
    let totalDue = 0, totalPaid = 0;
    contribQ.recordset.forEach((c, i) => {
      totalDue += Number(c.amount_due);
      totalPaid += Number(c.amount_paid);

      const r = ws.getRow(row);
      const values = [
        i + 1,
        c.full_name,
        c.house_number || "—",
        c.court_name || "—",
        Number(c.amount_due),
        Number(c.amount_paid),
        c.status.charAt(0).toUpperCase() + c.status.slice(1),
        c.paid_at ? new Date(c.paid_at).toLocaleDateString("en-KE") : "—",
        c.receipt || "—",
      ];
      values.forEach((v, idx) => {
        const cell = r.getCell(idx + 1);
        cell.value = v;
        cell.border = { top: { style: "thin", color: { argb: "FFDDDDDD" } }, bottom: { style: "thin", color: { argb: "FFDDDDDD" } }, left: { style: "thin", color: { argb: "FFDDDDDD" } }, right: { style: "thin", color: { argb: "FFDDDDDD" } } };
        if (idx === 4 || idx === 5) cell.numFmt = '"KSh "#,##0.00';
      });
      row++;
    });

    // Totals
    row++;
    ws.getCell(row, 1).value = "Totals";
    ws.mergeCells(row, 1, row, 4);
    ws.getCell(row, 1).font = { bold: true };
    ws.getCell(row, 5).value = totalDue;
    ws.getCell(row, 5).numFmt = '"KSh "#,##0.00';
    ws.getCell(row, 5).font = { bold: true };
    ws.getCell(row, 6).value = totalPaid;
    ws.getCell(row, 6).numFmt = '"KSh "#,##0.00';
    ws.getCell(row, 6).font = { bold: true };
    row += 2;

    // Signatories
    ws.getCell(row, 1).value = "Disbursement Co-Authorization";
    ws.mergeCells(row, 1, row, 4);
    ws.getCell(row, 1).font = { bold: true, size: 11 };
    row++;
    apprQ.recordset.forEach((s) => {
      ws.getCell(row, 1).value = s.role;
      ws.getCell(row, 1).font = { bold: true };
      ws.getCell(row, 2).value = s.signatory_name;
      ws.mergeCells(row, 2, row, 4);
      ws.getCell(row, 5).value = s.approved_at
        ? `✅ Approved ${new Date(s.approved_at).toLocaleString("en-KE")}`
        : "⏳ Awaiting approval";
      ws.mergeCells(row, 5, row, 9);
      row++;
    });
    row++;

    // Footer
    ws.getCell(row, 1).value = `Generated ${new Date().toLocaleString("en-KE")} · Athi Highway Estate Welfare Association`;
    ws.mergeCells(row, 1, row, 9);
    ws.getCell(row, 1).font = { italic: true, color: { argb: "FF8791A3" } };

    // Send the file
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="ahewa-event-${id}.xlsx"`);

    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
});

/* ============================================================
   GET /api/ahewa/events/:id/export.pdf
   Download event report as PDF.
   ============================================================ */
router.get("/events/:id/export.pdf", requireAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid event id" });

    const pool = await getPool();

    const evQ = await pool.request()
      .input("id", id)
      .query(`
        SELECT e.*, r.full_name AS affected_member_name, r.house_number AS affected_member_house,
               c.name AS affected_member_court
        FROM AhewaEvents e
        JOIN Residents r ON r.id = e.affected_member_id
        LEFT JOIN Courts c ON c.id = r.court_id
        WHERE e.id = @id
      `);
    if (!evQ.recordset.length) return res.status(404).json({ error: "Event not found" });
    const ev = evQ.recordset[0];

    const contribQ = await pool.request()
      .input("id", id)
      .query(`
        SELECT r.full_name, r.house_number, c2.name AS court_name,
               c.amount_due, c.amount_paid, c.status, c.paid_at,
               (SELECT TOP 1 mpesa_receipt FROM payments p
                WHERE p.invoice_id = c.invoice_id AND p.type = 'AHEWA_EVENT' AND p.status = 'verified'
                ORDER BY p.id DESC) AS receipt
        FROM AhewaContributions c
        JOIN Residents r ON r.id = c.resident_id
        LEFT JOIN Courts c2 ON c2.id = r.court_id
        WHERE c.event_id = @id
        ORDER BY r.full_name ASC
      `);

    const apprQ = await pool.request()
      .input("id", id)
      .query(`
        SELECT s.role, r.full_name AS signatory_name, a.approved_at
        FROM AhewaSignatories s
        JOIN Residents r ON r.id = s.resident_id
        LEFT JOIN AhewaDisbursementApprovals a
          ON a.signatory_id = s.resident_id AND a.event_id = @id
        WHERE s.is_active = 1
        ORDER BY CASE s.role WHEN 'Chairperson' THEN 1 WHEN 'Treasurer' THEN 2 WHEN 'Secretary' THEN 3 ELSE 9 END
      `);

    // Set response headers
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="ahewa-event-${id}.pdf"`);

    // Build PDF
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    doc.pipe(res);

    const fmtKsh = (n) => "KSh " + Number(n).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    /* --- Header --- */
    doc.fillColor("#16233f").fontSize(18).font("Helvetica-Bold").text("AHEWA Welfare Contribution Report", { align: "left" });
    doc.moveDown(0.3);
    doc.fillColor("#c8862a").fontSize(10).font("Helvetica").text("Athi Highway Estate Welfare Association");
    doc.moveDown(1);

    /* --- Event info --- */
    doc.fillColor("#16233f").fontSize(13).font("Helvetica-Bold").text(ev.event_title);
    doc.moveDown(0.4);

    doc.fillColor("#4a5670").fontSize(10).font("Helvetica");
    const typeLabel = ev.event_type === "PRINCIPAL" ? "Deceased principal" : "Deceased dependant";
    doc.text(`Type: ${typeLabel}`);
    doc.text(`Event date: ${new Date(ev.event_date).toDateString()}`);
    doc.text(`Affected member: ${ev.affected_member_name} (${ev.affected_member_house || "—"}${ev.affected_member_court ? ` · ${ev.affected_member_court}` : ""})`);
    doc.text(`Amount per member: ${fmtKsh(ev.contribution_amount)}`);
    doc.moveDown(1);

    /* --- Table header --- */
    const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const cols = [
      { label: "#",          width: 20,  align: "left"   },
      { label: "Member",     width: 150, align: "left"   },
      { label: "House",      width: 70,  align: "left"   },
      { label: "Amount due", width: 80,  align: "right"  },
      { label: "Paid",       width: 80,  align: "right"  },
      { label: "Status",     width: 60,  align: "left"   },
      { label: "Paid on",    width: 70,  align: "left"   },
    ];
    const totalW = cols.reduce((s, c) => s + c.width, 0);
    const scale = pageW / totalW;
    cols.forEach((c) => { c.width = c.width * scale; });

    let y = doc.y;
    const drawRow = (rowData, opts = {}) => {
      let x = doc.page.margins.left;
      doc.font(opts.bold ? "Helvetica-Bold" : "Helvetica");
      doc.fontSize(opts.size || 9);
      doc.fillColor(opts.color || "#16233f");
      cols.forEach((c, i) => {
        doc.text(String(rowData[i] ?? ""), x, y, { width: c.width, align: c.align, lineBreak: false });
        x += c.width;
      });
      y += opts.height || 16;
      doc.y = y;
    };

    // Header background
    doc.rect(doc.page.margins.left, y - 4, pageW, 20).fill("#16233f");
    drawRow(cols.map((c) => c.label), { bold: true, color: "#ffffff", height: 20 });

    // Rows
    let totalDue = 0, totalPaid = 0;
    contribQ.recordset.forEach((c, i) => {
      totalDue += Number(c.amount_due);
      totalPaid += Number(c.amount_paid);

      if (y > doc.page.height - doc.page.margins.bottom - 40) {
        doc.addPage();
        y = doc.page.margins.top;
      }

      const row = [
        i + 1,
        c.full_name,
        c.house_number || "—",
        fmtKsh(c.amount_due),
        fmtKsh(c.amount_paid),
        c.status.charAt(0).toUpperCase() + c.status.slice(1),
        c.paid_at ? new Date(c.paid_at).toLocaleDateString("en-KE") : "—",
      ];
      drawRow(row, { color: c.status === "paid" ? "#2f6f5e" : "#4a5670" });
      doc.moveTo(doc.page.margins.left, y - 4).lineTo(doc.page.margins.left + pageW, y - 4).strokeColor("#dcd8cd").stroke();
    });

    /* --- Totals --- */
    y += 8;
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#16233f");
    doc.text(`Total expected: ${fmtKsh(totalDue)}`, doc.page.margins.left, y);
    y += 14;
    doc.text(`Total collected: ${fmtKsh(totalPaid)}`, doc.page.margins.left, y);
    y += 14;
    doc.text(`Outstanding: ${fmtKsh(totalDue - totalPaid)}`, doc.page.margins.left, y);
    y += 24;
    doc.y = y;

    /* --- Signatories --- */
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#16233f").text("Disbursement Co-Authorization");
    doc.moveDown(0.4);
    doc.font("Helvetica").fontSize(9).fillColor("#4a5670");
    apprQ.recordset.forEach((s) => {
      const status = s.approved_at
        ? `Approved ${new Date(s.approved_at).toLocaleString("en-KE")}`
        : "Awaiting approval";
      doc.text(`${s.role}: ${s.signatory_name} — ${status}`);
    });
    doc.moveDown(1.5);

    /* --- Footer --- */
    doc.fontSize(8).fillColor("#8791a3").font("Helvetica-Oblique");
    doc.text(
      `Generated ${new Date().toLocaleString("en-KE")} · Athi Highway Estate Welfare Association`,
      { align: "center" }
    );

    doc.end();
  } catch (err) {
    next(err);
  }
});
module.exports = router;