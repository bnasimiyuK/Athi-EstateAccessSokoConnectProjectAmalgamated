/* ============================================================
   utils/sms.js — send SMS via Africa's Talking
   Modes:
     MAIL_MODE=smtp     → sends real SMS (sandbox or production)
     MAIL_MODE=console  → logs SMS to terminal (dev fallback)
   Requires AT_USERNAME, AT_API_KEY, AT_SENDER_ID
   ============================================================ */

require("dotenv").config();

const MODE          = (process.env.MAIL_MODE || "console").toLowerCase();
const AT_USERNAME   = process.env.AT_USERNAME || null;
const AT_API_KEY    = process.env.AT_API_KEY || null;
const AT_SENDER_ID  = process.env.AT_SENDER_ID || "";

let at = null;
let atEnabled = false;

if (MODE === "smtp" && AT_USERNAME && AT_API_KEY) {
  try {
    const AfricasTalking = require("africastalking");
    at = AfricasTalking({ apiKey: AT_API_KEY, username: AT_USERNAME });
    atEnabled = true;
    console.log(`📱 SMS ready (Africa's Talking) — username: ${AT_USERNAME}`);
  } catch (err) {
    console.error("❌ Africa's Talking init failed:", err.message);
    atEnabled = false;
  }
} else if (MODE === "smtp" && (!AT_USERNAME || !AT_API_KEY)) {
  console.warn("⚠️  SMS skipped — AT_USERNAME or AT_API_KEY not set in .env");
} else {
  console.log("📱 SMS: CONSOLE mode (messages printed to terminal)");
}

/* ------------------------------------------------------------
   Normalize a Kenyan phone to +254XXXXXXXXX
   ------------------------------------------------------------ */
function normalizePhone(phone) {
  const cleaned = String(phone || "").replace(/\s+/g, "").replace(/-/g, "");
  if (!cleaned) return null;
  if (cleaned.startsWith("+254")) return cleaned;
  if (cleaned.startsWith("254"))  return `+${cleaned}`;
  if (cleaned.startsWith("0"))    return `+254${cleaned.slice(1)}`;
  return cleaned;
}

/* ------------------------------------------------------------
   Send a single SMS. Returns { sent, mode, messageId? }
   ------------------------------------------------------------ */
async function sendSms({ to, message }) {
  const normalized = normalizePhone(to);
  if (!normalized) {
    throw new Error("Invalid phone number");
  }

  if (MODE === "smtp" && atEnabled && at) {
    try {
      const sendOptions = {
        to: [normalized],
        message: message,
      };
      if (AT_SENDER_ID && AT_SENDER_ID.trim()) {
        sendOptions.from = AT_SENDER_ID.trim();
      }

      const result = await at.SMS.send(sendOptions);

      /* Handle every possible response shape */
      const data      = result && result.SMSMessageData ? result.SMSMessageData : {};
      const rawList   = data.Recipients;
      const recipient = Array.isArray(rawList)
        ? rawList[0]
        : (rawList && typeof rawList === "object" ? rawList : null);

      const statusCode = recipient && recipient.statusCode != null ? recipient.statusCode : null;
      const statusText = recipient && recipient.status ? String(recipient.status) : "";
      const messageId  = recipient && recipient.messageId ? recipient.messageId : null;

      const isSuccess =
        statusCode === 101 ||
        statusCode === 100 ||
        statusText.toLowerCase() === "success";

      if (isSuccess) {
        console.log(`[sms] SENT -> ${normalized} | "${message.slice(0, 40)}..." | id=${messageId || "n/a"}`);
        return { sent: true, mode: "smtp", messageId };
      }

      let reason = statusText || `Status code ${statusCode}`;
      if (!reason || reason === "Status code null") {
        reason = `Unexpected response: ${JSON.stringify(result).slice(0, 200)}`;
      }
      console.error(`[sms] FAILED -> ${normalized} | ${reason}`);
      throw new Error(reason);
    } catch (err) {
      console.error(`[sms] FAILED -> ${normalized} | ${err.message}`);
      throw err;
    }
  }

  // Console fallback
  console.log("\n" + "=".repeat(72));
  console.log("[sms] CONSOLE mode — NOT actually sent");
  console.log("=".repeat(72));
  console.log(`To:      ${normalized}`);
  console.log(`From:    ${AT_SENDER_ID || "(default)"}`);
  console.log("-".repeat(72));
  console.log(message);
  console.log("=".repeat(72) + "\n");

  return { sent: false, mode: "console" };
}

/* ------------------------------------------------------------
   Batch-send SMS with throttling
   ------------------------------------------------------------ */
async function sendSmsBatch(messages, batchSize = 25, delayMs = 1000) {
  const results = { sent: 0, failed: 0, failures: [] };

  for (let i = 0; i < messages.length; i += batchSize) {
    const batch = messages.slice(i, i + batchSize);

    await Promise.all(batch.map(async (m) => {
      try {
        await sendSms({ to: m.to, message: m.message });
        results.sent++;
      } catch (err) {
        results.failed++;
        results.failures.push({ to: m.to, error: err.message });
      }
    }));

    if (i + batchSize < messages.length) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return results;
}

module.exports = {
  sendSms,
  sendSmsBatch,
  normalizePhone,
};