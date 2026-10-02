/* ============================================================
   jobs/reconcilePending.js
   Runs on a schedule. Finds mpesa_pending rows stuck at 'pending'
   for longer than STALE_AFTER_MS and queries Safaricom's
   Transaction Status API (via utils/mpesa.stkQuery) to see if
   they were actually paid. If so, runs the same finalization
   logic as the live callback.
   ============================================================ */

const { getPool } = require("../db");
const mpesa = require("../utils/mpesa");

// Consider a pending row "stale" after this many ms
const STALE_AFTER_MS = 3 * 60 * 1000;      // 3 minutes
// Give up trying after this many ms and mark as 'abandoned'
const ABANDON_AFTER_MS = 60 * 60 * 1000;   // 1 hour

// These are exposed by routes/mpesa.js so we reuse the EXACT same
// finalization logic the live callback uses. No duplication.
let finalizeBillPayment, finalizeInvoicePayment, finalizeSignupFromPayload;
function loadFinalizers() {
  if (finalizeBillPayment && finalizeInvoicePayment && finalizeSignupFromPayload) return;
  const m = require("../routes/mpesa");
  finalizeBillPayment       = m._finalizeBillPayment;
  finalizeInvoicePayment    = m._finalizeInvoicePayment;
  finalizeSignupFromPayload = m._finalizeSignupFromPayload;
  if (!finalizeBillPayment) {
    throw new Error("mpesa.js did not export finalizer functions. Did you add the exports?");
  }
}

async function reconcilePending() {
  const pool = await getPool();

  /* ---- Find stale pending rows ---- */
  const stale = await pool.request()
    .input("staleMs", STALE_AFTER_MS)
    .query(`
      SELECT TOP 20 *
      FROM mpesa_pending
      WHERE status = 'pending'
        AND created_at < DATEADD(millisecond, -@staleMs, SYSUTCDATETIME())
      ORDER BY created_at ASC
    `);

  if (!stale.recordset.length) return;

  console.log(`[reconcile] ${stale.recordset.length} stale pending row(s) found`);
  loadFinalizers();

  for (const row of stale.recordset) {
    try {
      /* ---- Give up if too old ---- */
      const ageMs = Date.now() - new Date(row.created_at).getTime();
      if (ageMs > ABANDON_AFTER_MS) {
        await pool.request()
          .input("crid", row.checkout_request_id)
          .query(`
            UPDATE mpesa_pending
            SET status = 'abandoned',
                result_desc = 'Timed out after 1h with no callback',
                updated_at = SYSUTCDATETIME()
            WHERE checkout_request_id = @crid
          `);
        console.log(`[reconcile] abandoned ${row.checkout_request_id} (age ${Math.round(ageMs/60000)}m)`);
        continue;
      }

      /* ---- Ask Safaricom: was this actually paid? ---- */
      let status;
      try {
        status = await mpesa.stkQuery(row.checkout_request_id);
      } catch (err) {
        // Network / API error — log and retry next cycle
        console.warn(`[reconcile] stkQuery failed for ${row.checkout_request_id}:`, err.message);
        continue;
      }

      /* ---- Not paid (still pending or terminal failure) ---- */
      if (Number(status.ResultCode) !== 0) {
        // 1032 = cancelled by user
        // 1037 = timeout (user didn't enter PIN)
        // 2001 = wrong PIN
        // Any other non-zero = treat as terminal failure
        const code = String(status.ResultCode);
        const terminalFailure = ["1032", "1037", "2001"].includes(code);

        if (terminalFailure) {
          await pool.request()
            .input("crid", row.checkout_request_id)
            .input("rc",  code)
            .input("rd",  status.ResultDesc || "reconcile: terminal failure")
            .query(`
              UPDATE mpesa_pending
              SET status = 'failed', result_code = @rc, result_desc = @rd,
                  updated_at = SYSUTCDATETIME()
              WHERE checkout_request_id = @crid
            `);
          console.log(`[reconcile] marked failed ${row.checkout_request_id}: ${status.ResultDesc}`);
        }
        continue;
      }

      /* ---- Paid! Run the same finalization as the live callback ---- */
      const receipt = status.MpesaReceiptNumber || `RECON-${Date.now()}`;

      if (row.purpose === "BILL") {
        const plan = JSON.parse(row.signup_payload || "{}");
        await finalizeBillPayment(pool, plan, receipt, row.phone);
      } else if (row.purpose && row.purpose.startsWith("INVOICE:")) {
        const invoiceId = parseInt(row.purpose.split(":")[1], 10);
        await finalizeInvoicePayment(pool, invoiceId, receipt, row.phone);
      } else {
        const includeAHEWA = row.purpose === "AHE_REG+AHEWA_REG";
        const payload = JSON.parse(row.signup_payload || "{}");
        const result  = await finalizeSignupFromPayload(pool, payload, receipt, row.phone, includeAHEWA);
        await pool.request()
          .input("crid", row.checkout_request_id)
          .input("rid",  result.residentId)
          .query(`UPDATE mpesa_pending SET resident_id = @rid WHERE checkout_request_id = @crid`);
      }

      await pool.request()
        .input("crid", row.checkout_request_id)
        .input("rec",  receipt)
        .query(`
          UPDATE mpesa_pending
          SET status = 'paid', mpesa_receipt = @rec, result_code = 0,
              result_desc = 'reconciled', updated_at = SYSUTCDATETIME()
          WHERE checkout_request_id = @crid
        `);
      console.log(`[reconcile] ✅ recovered ${row.checkout_request_id} via STK ${receipt}`);
    } catch (err) {
      console.error(`[reconcile] error on ${row.checkout_request_id}:`, err.message);
    }
  }
}

/* ------------------------------------------------------------
   Scheduler — runs every N ms
   ------------------------------------------------------------ */
let timer = null;
function startReconciler(intervalMs = 60 * 1000) {
  if (timer) return;
  console.log(`[reconcile] starting — every ${intervalMs/1000}s, stale threshold ${STALE_AFTER_MS/1000}s`);
  // Run once immediately so we don't wait a full interval
  reconcilePending().catch((e) => console.error("[reconcile] fatal:", e.message));
  timer = setInterval(() => {
    reconcilePending().catch((e) => console.error("[reconcile] fatal:", e.message));
  }, intervalMs);
}

module.exports = { startReconciler, reconcilePending };