/* ============================================================
   routes/mpesa.js — M-Pesa STK push integration
   Endpoints:
     POST /api/mpesa/stkpush       (public)   initiate STK push for a signup
     POST /api/mpesa/pay-invoice   (resident) initiate STK for an existing invoice
     POST /api/mpesa/pay-for       (resident) initiate STK for a set of fees
     POST /api/mpesa/callback      (public)   Safaricom calls back on completion
     POST /api/mpesa/query         (public)   frontend polls this for status
     POST /api/mpesa/simulate      (dev)      fake a successful callback
   ============================================================ */

const express  = require("express");
const bcrypt   = require("bcryptjs");
const router   = express.Router();
const { getPool } = require("../db");
const mpesa       = require("../utils/mpesa");
const { requireAuth } = require("../middleware/auth");
const { sendMail, residentApprovedEmail } = require("../utils/mailer");

const BCRYPT_ROUNDS   = parseInt(process.env.BCRYPT_ROUNDS || "10", 10);
const ENABLE_SIMULATE = (process.env.MPESA_ENABLE_SIMULATE || "false") === "true";

const FEE_AHE     = parseInt(process.env.FEE_AHE     || "1", 10);
const FEE_AHEWA   = parseInt(process.env.FEE_AHEWA   || "1", 10);
const FEE_SERVICE = parseInt(process.env.FEE_SERVICE || "1", 10);

function currentMonth() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/* ------------------------------------------------------------
   finalizeSignupFromPayload
   ------------------------------------------------------------ */
async function finalizeSignupFromPayload(pool, payload, mpesaReceipt, phoneUsed, includeAHEWA) {
  const { fullName, phone, email, courtId, password } = payload;

  const courtIdInt   = parseInt(courtId, 10);
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const now          = new Date();
  const month        = currentMonth();
  const [y, m]       = month.split("-").map(Number);
  const dueDate      = new Date(Date.UTC(y, m - 1, 5));

  const tx = pool.transaction();
  await tx.begin();

  try {
    /* ---- 1. Resident ---- */
    const inserted = await tx.request()
      .input("fullName",  fullName.trim())
      .input("phone",     phone.trim())
      .input("email",     email ? email.trim() : null)
      .input("courtId",   courtIdInt)
      .input("hash",      passwordHash)
      .input("joinAHEWA", includeAHEWA ? 1 : 0)
      .query(`
        INSERT INTO Residents
          (full_name, phone, email, court_id, password_hash,
           verified, must_change_password, join_ahewa)
        OUTPUT INSERTED.id
        VALUES (@fullName, @phone, @email, @courtId, @hash, 0, 0, @joinAHEWA)
      `);
    const residentId  = inserted.recordset[0].id;
    const placeholder = `PENDING-${residentId}`;

    /* ---- 2. AHE_REG invoice (paid) ---- */
    const aheInv = await tx.request()
      .input("rid", residentId)
      .input("h",   placeholder)
      .input("m",   month)
      .input("amt", FEE_AHE)
      .input("due", dueDate)
      .query(`
        INSERT INTO invoices
          (resident_id, house_number, billing_month, amount_due, amount_paid, status, due_date, type, paid_at)
        OUTPUT INSERTED.id
        VALUES (@rid, @h, @m, @amt, @amt, 'paid', @due, 'AHE_REG', SYSUTCDATETIME())
      `);
    const aheInvoiceId = aheInv.recordset[0].id;

    await tx.request()
      .input("inv",  aheInvoiceId)
      .input("h",    placeholder)
      .input("rid",  residentId)
      .input("amt",  FEE_AHE)
      .input("rec",  mpesaReceipt)
      .input("ph",   phoneUsed)
      .input("date", now)
      .query(`
        INSERT INTO payments
          (invoice_id, house_number, resident_id, amount, method, status,
           mpesa_receipt, mpesa_phone, payment_date, entered_by, type, verified_at)
        VALUES
          (@inv, @h, @rid, @amt, 'mpesa', 'verified',
           @rec, @ph, @date, @rid, 'AHE_REG', SYSUTCDATETIME())
      `);

    /* ---- 3. AHEWA_REG invoice (paid) if includeAHEWA ---- */
    let ahewaInvoiceId = null;
    if (includeAHEWA) {
      const ahewaInv = await tx.request()
        .input("rid", residentId)
        .input("h",   placeholder)
        .input("m",   month)
        .input("amt", FEE_AHEWA)
        .input("due", dueDate)
        .query(`
          INSERT INTO invoices
            (resident_id, house_number, billing_month, amount_due, amount_paid, status, due_date, type, paid_at)
          OUTPUT INSERTED.id
          VALUES (@rid, @h, @m, @amt, @amt, 'paid', @due, 'AHEWA_REG', SYSUTCDATETIME())
        `);
      ahewaInvoiceId = ahewaInv.recordset[0].id;

      await tx.request()
        .input("inv",  ahewaInvoiceId)
        .input("h",    placeholder)
        .input("rid",  residentId)
        .input("amt",  FEE_AHEWA)
        .input("rec",  mpesaReceipt)
        .input("ph",   phoneUsed)
        .input("date", now)
        .query(`
          INSERT INTO payments
            (invoice_id, house_number, resident_id, amount, method, status,
             mpesa_receipt, mpesa_phone, payment_date, entered_by, type, verified_at)
          VALUES
            (@inv, @h, @rid, @amt, 'mpesa', 'verified',
             @rec, @ph, @date, @rid, 'AHEWA_REG', SYSUTCDATETIME())
        `);
    }

    /* ---- 4. Auto-approve resident ---- */
    await tx.request()
      .input("rid", residentId)
      .query(`UPDATE Residents SET verified = 1 WHERE id = @rid`);

    /* ---- 5. First SERVICE invoice ---- */
    await tx.request()
      .input("rid", residentId)
      .input("h",   placeholder)
      .input("m",   month)
      .input("amt", FEE_SERVICE)
      .input("due", dueDate)
      .query(`
        INSERT INTO invoices
          (resident_id, house_number, billing_month, amount_due, due_date, type)
        VALUES (@rid, @h, @m, @amt, @due, 'SERVICE')
      `);

    await tx.commit();

    if (email && email.trim()) {
      try {
        const tpl = residentApprovedEmail({ fullName: fullName.trim(), phone: phone.trim() });
        await sendMail({ to: email.trim(), subject: tpl.subject, text: tpl.text, html: tpl.html });
        console.log(`[mpesa] welcome email sent to ${email}`);
      } catch (mailErr) {
        console.error("[mpesa] welcome email failed:", mailErr.message);
      }
    }

    return { residentId, aheInvoiceId, ahewaInvoiceId };
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

/* ------------------------------------------------------------
   finalizeInvoicePayment — for SERVICE / AHEWA_EVENT invoices
   ------------------------------------------------------------ */
async function finalizeInvoicePayment(pool, invoiceId, mpesaReceipt, phoneUsed) {
  const tx = pool.transaction();
  await tx.begin();

  try {
    const invQ = await tx.request()
      .input("id", invoiceId)
      .query("SELECT * FROM invoices WHERE id = @id");
    if (!invQ.recordset.length) {
      await tx.rollback();
      throw new Error("Invoice not found.");
    }
    const inv = invQ.recordset[0];

    const remaining = Number(inv.amount_due) - Number(inv.amount_paid);
    if (remaining <= 0) {
      await tx.rollback();
      throw new Error("Invoice already paid.");
    }

    const newPaid   = Number(inv.amount_paid) + remaining;
    const fullyPaid = newPaid >= Number(inv.amount_due);

    await tx.request()
      .input("id",  invoiceId)
      .input("amt", newPaid)
      .input("st",  fullyPaid ? "paid" : "partial")
      .query(`
        UPDATE invoices
        SET amount_paid = @amt,
            status      = @st,
            paid_at     = CASE WHEN @st = 'paid' THEN SYSUTCDATETIME() ELSE paid_at END
        WHERE id = @id
      `);

    await tx.request()
      .input("inv",  invoiceId)
      .input("h",    inv.house_number)
      .input("rid",  inv.resident_id)
      .input("amt",  remaining)
      .input("rec",  mpesaReceipt)
      .input("ph",   phoneUsed)
      .input("date", new Date())
      .input("type", inv.type || "SERVICE")
      .query(`
        INSERT INTO payments
          (invoice_id, house_number, resident_id, amount, method, status,
           mpesa_receipt, mpesa_phone, payment_date, entered_by, type, verified_at)
        VALUES
          (@inv, @h, @rid, @amt, 'mpesa', 'verified',
           @rec, @ph, @date, @rid, @type, SYSUTCDATETIME())
      `);

    const overdueQ = await tx.request()
      .input("rid", inv.resident_id)
      .query(`SELECT COUNT(*) AS n FROM invoices WHERE resident_id = @rid AND status = 'overdue'`);
    if (overdueQ.recordset[0].n === 0) {
      await tx.request()
        .input("rid", inv.resident_id)
        .query(`UPDATE Residents SET access_blocked = 0, access_blocked_reason = NULL WHERE id = @rid`);
    }

    await tx.commit();
    return { invoiceId, newPaid, fullyPaid };
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

/* ------------------------------------------------------------
   finalizeBillPayment — for the resident's "Pay via M-Pesa" flow
   plan = { residentId, toCreate:[{type,amount}], toAllocate:[{invoiceId,amount,type}] }
   ------------------------------------------------------------ */
async function finalizeBillPayment(pool, plan, mpesaReceipt, phoneUsed) {
  const { residentId, toCreate = [], toAllocate = [] } = plan;

  const tx = pool.transaction();
  await tx.begin();

  try {
    const now   = new Date();
    const month = currentMonth();
    const [y, m] = month.split("-").map(Number);
    const dueDate = new Date(Date.UTC(y, m - 1, 5));

    const meQ = await tx.request()
      .input("id", residentId)
      .query("SELECT house_number FROM Residents WHERE id = @id");
    const house = (meQ.recordset[0] && meQ.recordset[0].house_number) || `PENDING-${residentId}`;

    /* ---- Create new invoices (immediately marked paid) ---- */
    for (const c of toCreate) {
      const invR = await tx.request()
        .input("rid", residentId)
        .input("h",   house)
        .input("m",   month)
        .input("amt", c.amount)
        .input("due", dueDate)
        .input("type", c.type)
        .query(`
          INSERT INTO invoices
            (resident_id, house_number, billing_month, amount_due, amount_paid, status, due_date, type, paid_at)
          OUTPUT INSERTED.id
          VALUES (@rid, @h, @m, @amt, @amt, 'paid', @due, @type, SYSUTCDATETIME())
        `);
      const invId = invR.recordset[0].id;

      await tx.request()
        .input("inv",  invId)
        .input("h",    house)
        .input("rid",  residentId)
        .input("amt",  c.amount)
        .input("rec",  mpesaReceipt)
        .input("ph",   phoneUsed)
        .input("date", now)
        .input("type", c.type)
        .query(`
          INSERT INTO payments
            (invoice_id, house_number, resident_id, amount, method, status,
             mpesa_receipt, mpesa_phone, payment_date, entered_by, type, verified_at)
          VALUES (@inv, @h, @rid, @amt, 'mpesa', 'verified',
                  @rec, @ph, @date, @rid, @type, SYSUTCDATETIME())
        `);
    }

    /* ---- Allocate to existing invoices ---- */
    for (const a of toAllocate) {
      const invQ = await tx.request()
        .input("id", a.invoiceId)
        .query("SELECT amount_due, amount_paid FROM invoices WHERE id = @id");
      if (!invQ.recordset.length) continue;

      const inv = invQ.recordset[0];
      const newPaid = Number(inv.amount_paid) + a.amount;
      const fullyPaid = newPaid >= Number(inv.amount_due);

      await tx.request()
        .input("id",  a.invoiceId)
        .input("amt", newPaid)
        .input("st",  fullyPaid ? "paid" : "partial")
        .query(`
          UPDATE invoices
          SET amount_paid = @amt,
              status      = @st,
              paid_at     = CASE WHEN @st = 'paid' THEN SYSUTCDATETIME() ELSE paid_at END
          WHERE id = @id
        `);

      await tx.request()
        .input("inv",  a.invoiceId)
        .input("h",    house)
        .input("rid",  residentId)
        .input("amt",  a.amount)
        .input("rec",  mpesaReceipt)
        .input("ph",   phoneUsed)
        .input("date", now)
        .input("type", a.type)
        .query(`
          INSERT INTO payments
            (invoice_id, house_number, resident_id, amount, method, status,
             mpesa_receipt, mpesa_phone, payment_date, entered_by, type, verified_at)
          VALUES (@inv, @h, @rid, @amt, 'mpesa', 'verified',
                  @rec, @ph, @date, @rid, @type, SYSUTCDATETIME())
        `);
    }

    /* ---- If AHEWA_REG was in the plan, flip the resident flag ---- */
    const hasAhewa = [...toCreate, ...toAllocate].some((x) => x.type === "AHEWA_REG");
    if (hasAhewa) {
      await tx.request()
        .input("rid", residentId)
        .query(`UPDATE Residents SET join_ahewa = 1 WHERE id = @rid`);
    }

    /* ---- Unblock if all overdue invoices are now clear ---- */
    const overdueQ = await tx.request()
      .input("rid", residentId)
      .query(`SELECT COUNT(*) AS n FROM invoices WHERE resident_id = @rid AND status = 'overdue'`);
    if (overdueQ.recordset[0].n === 0) {
      await tx.request()
        .input("rid", residentId)
        .query(`UPDATE Residents SET access_blocked = 0, access_blocked_reason = NULL WHERE id = @rid`);
    }

    await tx.commit();
    return { residentId };
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

/* ============================================================
   POST /api/mpesa/stkpush
   ============================================================ */
router.post("/stkpush", async (req, res, next) => {
  try {
    const { phone, amount, purpose, includeAHEWA = false, signup } = req.body;

    if (!phone || !amount || !purpose || !signup) {
      return res.status(400).json({ error: "phone, amount, purpose, and signup payload are required." });
    }
    if (purpose !== "AHE_REG") {
      return res.status(400).json({ error: "Invalid purpose for signup." });
    }
    if (!signup.fullName || !signup.phone || !signup.courtId || !signup.password) {
      return res.status(400).json({ error: "signup payload incomplete." });
    }

    const expectedAmount = includeAHEWA ? FEE_AHE + FEE_AHEWA : FEE_AHE;
    if (Number(amount) !== expectedAmount) {
      return res.status(400).json({
        error: `Amount mismatch. Expected ${expectedAmount} for ${includeAHEWA ? "AHE + AHEWA" : "AHE only"}.`,
      });
    }

    const pool = await getPool();

    const existing = await pool.request()
      .input("phone", signup.phone.trim())
      .query("SELECT id FROM Residents WHERE phone = @phone");
    if (existing.recordset.length) {
      return res.status(409).json({ error: "Phone number already registered." });
    }

    const stk = await mpesa.stkPush({
      phone,
      amount:           expectedAmount,
      accountReference: signup.phone.slice(-6),
      transactionDesc:  includeAHEWA ? "AHE+AHEWA reg" : "AHE registration",
    });

    if (stk.ResponseCode !== "0") {
      return res.status(400).json({
        error: stk.ResponseDescription || "STK push rejected.",
        raw: stk.raw,
      });
    }

    await pool.request()
      .input("crid", stk.CheckoutRequestID)
      .input("mrid", stk.MerchantRequestID)
      .input("phone", mpesa.normalizePhone(phone))
      .input("amt", expectedAmount)
      .input("purpose", includeAHEWA ? "AHE_REG+AHEWA_REG" : "AHE_REG")
      .input("payload", JSON.stringify(signup))
      .query(`
        INSERT INTO mpesa_pending
          (checkout_request_id, merchant_request_id, phone, amount, purpose, signup_payload, status)
        VALUES (@crid, @mrid, @phone, @amt, @purpose, @payload, 'pending')
      `);

    res.json({
      ok: true,
      checkoutRequestId: stk.CheckoutRequestID,
      customerMessage:   stk.CustomerMessage,
      amount:            expectedAmount,
    });
  } catch (err) {
    console.error("[mpesa] stkpush error:", err.message);
    next(err);
  }
});

/* ============================================================
   POST /api/mpesa/pay-invoice   (resident, auth)
   ============================================================ */
router.post("/pay-invoice", requireAuth, async (req, res, next) => {
  try {
    const { invoiceId, phone } = req.body;
    if (!invoiceId) return res.status(400).json({ error: "invoiceId required." });

    const pool = await getPool();
    const invQ = await pool.request()
      .input("id",  invoiceId)
      .input("rid", req.user.id)
      .query("SELECT * FROM invoices WHERE id = @id AND resident_id = @rid");
    if (!invQ.recordset.length) {
      return res.status(404).json({ error: "Invoice not found for this resident." });
    }
    const inv = invQ.recordset[0];
    if (inv.status === "paid") {
      return res.status(400).json({ error: "Invoice already paid." });
    }

    const remaining = Number(inv.amount_due) - Number(inv.amount_paid);
    if (remaining <= 0) return res.status(400).json({ error: "Nothing left to pay." });

    const meQ = await pool.request()
      .input("id", req.user.id)
      .query("SELECT phone FROM Residents WHERE id = @id");
    const residentPhone = (meQ.recordset[0] || {}).phone;
    const targetPhone   = phone || residentPhone;
    if (!targetPhone) return res.status(400).json({ error: "No phone number on file." });

    const stk = await mpesa.stkPush({
      phone: targetPhone,
      amount: remaining,
      accountReference: String(invoiceId),
      transactionDesc:  `${inv.type || "SERVICE"} ${inv.billing_month || ""}`.trim().slice(0, 100),
    });

    if (stk.ResponseCode !== "0") {
      return res.status(400).json({
        error: stk.ResponseDescription || "STK push rejected.",
        raw: stk.raw,
      });
    }

    await pool.request()
      .input("crid", stk.CheckoutRequestID)
      .input("mrid", stk.MerchantRequestID)
      .input("phone", mpesa.normalizePhone(targetPhone))
      .input("amt", remaining)
      .input("purpose", "INVOICE:" + invoiceId)
      .input("payload", JSON.stringify({ invoiceId }))
      .query(`
        INSERT INTO mpesa_pending
          (checkout_request_id, merchant_request_id, phone, amount, purpose, signup_payload, status)
        VALUES (@crid, @mrid, @phone, @amt, @purpose, @payload, 'pending')
      `);

    res.json({
      ok: true,
      checkoutRequestId: stk.CheckoutRequestID,
      customerMessage:   stk.CustomerMessage,
      amount:            remaining,
    });
  } catch (err) {
    console.error("[mpesa] pay-invoice error:", err.message);
    next(err);
  }
});

/* ============================================================
   POST /api/mpesa/pay-for   (resident, auth)
   Body: { items: ["SERVICE","AHE_REG","AHEWA_REG"], invoiceId?: number }
   Fires one STK for the total. Callback creates/allocates everything.
   ============================================================ */
router.post("/pay-for", requireAuth, async (req, res, next) => {
  try {
    const { items = [], invoiceId } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Choose at least one item to pay." });
    }

    const pool = await getPool();
    const residentId = req.user.id;

    const meQ = await pool.request()
      .input("id", residentId)
      .query("SELECT id, verified, join_ahewa, house_number, phone FROM Residents WHERE id = @id");
    if (!meQ.recordset.length) return res.status(404).json({ error: "Resident not found." });
    const me = meQ.recordset[0];
    if (!me.verified) return res.status(403).json({ error: "Your account is not yet approved." });

    const feeAhe     = parseInt(process.env.FEE_AHE     || "1", 10);
    const feeAhewa   = parseInt(process.env.FEE_AHEWA   || "1", 10);
    const feeService = parseInt(process.env.FEE_SERVICE || "1", 10);

    let totalAmount = 0;
    const toCreate   = [];
    const toAllocate = [];

    /* ---- AHE_REG ---- */
    if (items.includes("AHE_REG")) {
      const ahePaid = await pool.request()
        .input("rid", residentId)
        .query(`
          SELECT TOP 1 1 FROM invoices
          WHERE resident_id = @rid AND type = 'AHE_REG' AND status = 'paid'
        `);
      if (ahePaid.recordset.length) {
        return res.status(400).json({ error: "AHE registration is already paid." });
      }
      const aheUnpaid = await pool.request()
        .input("rid", residentId)
        .query(`
          SELECT id, amount_due, amount_paid FROM invoices
          WHERE resident_id = @rid AND type = 'AHE_REG'
            AND status IN ('unpaid','partial','overdue')
        `);
      if (aheUnpaid.recordset.length) {
        const inv = aheUnpaid.recordset[0];
        const remaining = Number(inv.amount_due) - Number(inv.amount_paid);
        totalAmount += remaining;
        toAllocate.push({ invoiceId: inv.id, amount: remaining, type: "AHE_REG" });
      } else {
        totalAmount += feeAhe;
        toCreate.push({ type: "AHE_REG", amount: feeAhe });
      }
    }

    /* ---- SERVICE ---- */
    if (items.includes("SERVICE")) {
      const svcQ = await pool.request()
        .input("rid", residentId)
        .query(`
          SELECT TOP 1 id, amount_due, amount_paid
          FROM invoices
          WHERE resident_id = @rid AND type = 'SERVICE'
            AND status IN ('unpaid','partial','overdue')
          ORDER BY billing_month ASC
        `);
      if (svcQ.recordset.length) {
        const inv = svcQ.recordset[0];
        const remaining = Number(inv.amount_due) - Number(inv.amount_paid);
        totalAmount += remaining;
        toAllocate.push({ invoiceId: inv.id, amount: remaining, type: "SERVICE" });
      } else {
        totalAmount += feeService;
        toCreate.push({ type: "SERVICE", amount: feeService });
      }
    }

    /* ---- AHEWA_REG ---- */
    if (items.includes("AHEWA_REG")) {
      if (me.join_ahewa) {
        return res.status(400).json({ error: "You are already an AHEWA member." });
      }
      const ahewaQ = await pool.request()
        .input("rid", residentId)
        .query(`SELECT id, amount_due, amount_paid FROM invoices
                WHERE resident_id = @rid AND type = 'AHEWA_REG'
                  AND status IN ('unpaid','partial','overdue')`);
      if (ahewaQ.recordset.length) {
        const inv = ahewaQ.recordset[0];
        const remaining = Number(inv.amount_due) - Number(inv.amount_paid);
        totalAmount += remaining;
        toAllocate.push({ invoiceId: inv.id, amount: remaining, type: "AHEWA_REG" });
      } else {
        totalAmount += feeAhewa;
        toCreate.push({ type: "AHEWA_REG", amount: feeAhewa });
      }
    }

    /* ---- AHEWA_EVENT ---- */
    if (items.includes("AHEWA_EVENT")) {
      if (!invoiceId) return res.status(400).json({ error: "AHEWA_EVENT requires invoiceId." });
      const evQ = await pool.request()
        .input("id",  invoiceId)
        .input("rid", residentId)
        .query(`SELECT * FROM invoices
                WHERE id = @id AND resident_id = @rid AND type = 'AHEWA_EVENT'`);
      if (!evQ.recordset.length) return res.status(404).json({ error: "Event invoice not found." });
      const inv = evQ.recordset[0];
      const remaining = Number(inv.amount_due) - Number(inv.amount_paid);
      totalAmount += remaining;
      toAllocate.push({ invoiceId: inv.id, amount: remaining, type: "AHEWA_EVENT" });
    }

    if (totalAmount <= 0) return res.status(400).json({ error: "Nothing to pay." });

    const targetPhone = me.phone;
    if (!targetPhone) return res.status(400).json({ error: "No phone number on file." });

    const stk = await mpesa.stkPush({
      phone: targetPhone,
      amount: totalAmount,
      accountReference: "Bill",
      transactionDesc: items.join("+").slice(0, 100),
    });

    if (stk.ResponseCode !== "0") {
      return res.status(400).json({ error: stk.ResponseDescription || "STK push rejected." });
    }

    await pool.request()
      .input("crid", stk.CheckoutRequestID)
      .input("mrid", stk.MerchantRequestID)
      .input("phone", mpesa.normalizePhone(targetPhone))
      .input("amt", totalAmount)
      .input("purpose", "BILL")
      .input("payload", JSON.stringify({ residentId, items, toCreate, toAllocate, invoiceId }))
      .query(`
        INSERT INTO mpesa_pending
          (checkout_request_id, merchant_request_id, phone, amount, purpose, signup_payload, status)
        VALUES (@crid, @mrid, @phone, @amt, @purpose, @payload, 'pending')
      `);

    res.json({
      ok: true,
      checkoutRequestId: stk.CheckoutRequestID,
      amount: totalAmount,
    });
  } catch (err) {
    console.error("[mpesa] pay-for error:", err.message);
    next(err);
  }
});

/* ============================================================
   POST /api/mpesa/callback
   ============================================================ */
router.post("/callback", async (req, res, next) => {
  try {
    console.log("[mpesa] callback received:", JSON.stringify(req.body));

    const stk = req.body && req.body.Body && req.body.Body.stkCallback;
    if (!stk || !stk.CheckoutRequestID) {
      return res.json({ ok: true, ignored: true });
    }

    const pool = await getPool();
    const rowQ = await pool.request()
      .input("crid", stk.CheckoutRequestID)
      .query("SELECT * FROM mpesa_pending WHERE checkout_request_id = @crid");

    if (!rowQ.recordset.length) {
      console.warn("[mpesa] callback for unknown CheckoutRequestID:", stk.CheckoutRequestID);
      return res.json({ ok: true, ignored: true });
    }

    const row = rowQ.recordset[0];

    if (Number(stk.ResultCode) !== 0) {
      await pool.request()
        .input("crid", stk.CheckoutRequestID)
        .input("rc", stk.ResultCode)
        .input("rd", stk.ResultDesc || "failed")
        .query(`
          UPDATE mpesa_pending
          SET status = 'failed', result_code = @rc, result_desc = @rd,
              updated_at = SYSUTCDATETIME()
          WHERE checkout_request_id = @crid
        `);
      return res.json({ ok: true });
    }

    const cbItems = (stk.CallbackMetadata && stk.CallbackMetadata.Item) || [];
    const getItem = (n) => (cbItems.find((i) => i.Name === n) || {}).Value;
    const receipt = getItem("MpesaReceiptNumber") || "UNKNOWN";

    if (row.status === "paid") {
      return res.json({ ok: true, already: true });
    }

    /* ---- BILL: resident paid via "Pay via M-Pesa" modal ---- */
    if (row.purpose === "BILL") {
      const plan = JSON.parse(row.signup_payload || "{}");
      const result = await finalizeBillPayment(pool, plan, receipt, row.phone);
      await pool.request()
        .input("crid", stk.CheckoutRequestID)
        .input("rec",  receipt)
        .query(`
          UPDATE mpesa_pending
          SET status = 'paid', mpesa_receipt = @rec, result_code = 0,
              updated_at = SYSUTCDATETIME()
          WHERE checkout_request_id = @crid
        `);
      console.log(`[mpesa] ✅ bill paid for resident ${result.residentId} via STK ${receipt}`);
      return res.json({ ok: true, ...result });
    }

    /* ---- INVOICE:<id>: single invoice payment ---- */
    if (row.purpose && row.purpose.startsWith("INVOICE:")) {
      const invoiceId = parseInt(row.purpose.split(":")[1], 10);
      await finalizeInvoicePayment(pool, invoiceId, receipt, row.phone);
      await pool.request()
        .input("crid", stk.CheckoutRequestID)
        .input("rec", receipt)
        .query(`
          UPDATE mpesa_pending
          SET status = 'paid', mpesa_receipt = @rec, result_code = 0,
              updated_at = SYSUTCDATETIME()
          WHERE checkout_request_id = @crid
        `);
      console.log(`[mpesa] ✅ invoice ${invoiceId} paid via STK ${receipt}`);
      return res.json({ ok: true, invoiceId });
    }

    /* ---- Signup ---- */
    const includeAHEWA = row.purpose === "AHE_REG+AHEWA_REG";
    const payload = JSON.parse(row.signup_payload || "{}");
    const result  = await finalizeSignupFromPayload(pool, payload, receipt, row.phone, includeAHEWA);

    await pool.request()
      .input("crid", stk.CheckoutRequestID)
      .input("rid",  result.residentId)
      .input("rec",  receipt)
      .query(`
        UPDATE mpesa_pending
        SET status = 'paid', resident_id = @rid, mpesa_receipt = @rec,
            result_code = 0, updated_at = SYSUTCDATETIME()
        WHERE checkout_request_id = @crid
      `);

    console.log(`[mpesa] ✅ resident ${result.residentId} auto-approved from STK ${receipt}`);
    res.json({ ok: true, residentId: result.residentId });
  } catch (err) {
    console.error("[mpesa] callback error:", err.message);
    res.json({ ok: false, error: err.message });
  }
});

/* ============================================================
   POST /api/mpesa/query
   ============================================================ */
router.post("/query", async (req, res, next) => {
  try {
    const { checkoutRequestId } = req.body;
    if (!checkoutRequestId) return res.status(400).json({ error: "checkoutRequestId required." });

    const pool = await getPool();
    const q = await pool.request()
      .input("crid", checkoutRequestId)
      .query(`
        SELECT status, resident_id, mpesa_receipt, result_code, result_desc
        FROM mpesa_pending WHERE checkout_request_id = @crid
      `);
    if (!q.recordset.length) {
      return res.status(404).json({ error: "Unknown checkoutRequestId." });
    }
    const r = q.recordset[0];
    res.json({
      status:       r.status,
      residentId:   r.resident_id,
      mpesaReceipt: r.mpesa_receipt,
      resultCode:   r.result_code,
      resultDesc:   r.result_desc,
    });
  } catch (err) {
    next(err);
  }
});

/* ============================================================
   POST /api/mpesa/simulate   (dev-only)
   ============================================================ */
router.post("/simulate", async (req, res, next) => {
  try {
    if (!ENABLE_SIMULATE) {
      return res.status(403).json({ error: "Simulate is disabled. Set MPESA_ENABLE_SIMULATE=true." });
    }
    const { checkoutRequestId, receipt } = req.body;
    if (!checkoutRequestId) return res.status(400).json({ error: "checkoutRequestId required." });

    const pool = await getPool();
    const q = await pool.request()
      .input("crid", checkoutRequestId)
      .query("SELECT * FROM mpesa_pending WHERE checkout_request_id = @crid");
    if (!q.recordset.length) return res.status(404).json({ error: "Unknown checkoutRequestId." });

    const row = q.recordset[0];
    if (row.status === "paid") return res.json({ ok: true, already: true });

    const simReceipt = (receipt || "SIM" + Date.now()).slice(0, 12);

    if (row.purpose === "BILL") {
      const plan = JSON.parse(row.signup_payload || "{}");
      const result = await finalizeBillPayment(pool, plan, simReceipt, row.phone);
      await pool.request()
        .input("crid", checkoutRequestId)
        .input("rec",  simReceipt)
        .query(`
          UPDATE mpesa_pending
          SET status = 'paid', mpesa_receipt = @rec, result_code = 0,
              updated_at = SYSUTCDATETIME()
          WHERE checkout_request_id = @crid
        `);
      console.log(`[mpesa] ✅ bill paid for resident ${result.residentId} via STK ${simReceipt}`);
      return res.json({ ok: true, ...result });
    }
    if (row.purpose && row.purpose.startsWith("INVOICE:")) {
      const invoiceId = parseInt(row.purpose.split(":")[1], 10);
      await finalizeInvoicePayment(pool, invoiceId, simReceipt, row.phone);
      await pool.request()
        .input("crid", checkoutRequestId)
        .input("rec",  simReceipt)
        .query(`
          UPDATE mpesa_pending
          SET status = 'paid', mpesa_receipt = @rec, result_code = 0,
              updated_at = SYSUTCDATETIME()
          WHERE checkout_request_id = @crid
        `);
      return res.json({ ok: true, invoiceId, receipt: simReceipt });
    }

    const includeAHEWA = row.purpose === "AHE_REG+AHEWA_REG";
    const payload = JSON.parse(row.signup_payload || "{}");
    const result  = await finalizeSignupFromPayload(pool, payload, simReceipt, row.phone, includeAHEWA);

    await pool.request()
      .input("crid", checkoutRequestId)
      .input("rid",  result.residentId)
      .input("rec",  simReceipt)
      .query(`
        UPDATE mpesa_pending
        SET status = 'paid', resident_id = @rid, mpesa_receipt = @rec,
            result_code = 0, updated_at = SYSUTCDATETIME()
        WHERE checkout_request_id = @crid
      `);

    res.json({ ok: true, residentId: result.residentId, receipt: simReceipt });
  } catch (err) {
    next(err);
  }
});

module.exports = router;