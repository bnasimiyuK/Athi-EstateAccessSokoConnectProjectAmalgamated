/* ============================================================
   utils/ahewaSms.js — AHEWA welfare event notifications

   Channels:
     - SMS   : all billed members (via utils/sms.sendSmsBatch)
     - Email : signatories only (via utils/mailer.sendMail)

   The signatory email contains a clickable link to the event
   detail page where they co-authorize the disbursement.

   Env:
     PUBLIC_BASE_URL — public URL where the portal is served
                       (defaults to http://localhost:3000)
   ============================================================ */

const { sendSmsBatch } = require("./sms");
const { sendMail, htmlWrapper } = require("./mailer");

const BASE_URL = (process.env.PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/$/, "");

/* ------------------------------------------------------------
   Build the event detail URL
   ------------------------------------------------------------ */
function eventUrl(eventId) {
  return `${BASE_URL}/admin-ahewa-event.html?id=${eventId}`;
}

/* ============================================================
   MESSAGE BUILDERS
   ============================================================ */

/* SMS to regular (non-signatory) members when an event opens */
function openSmsForMember(event) {
  const amount = Number(event.contribution_amount || 0).toLocaleString();
  return (
    `AHEWA Welfare: Contribution opened for "${event.event_title}". ` +
    `Please contribute KSh ${amount} via the AHEWA paybill. Thank you.`
  );
}

/* SMS to signatories when an event opens */
function openSmsForSignatory(event) {
  const amount = Number(event.contribution_amount || 0).toLocaleString();
  return (
    `AHEWA Welfare: Event "${event.event_title}" opened. ` +
    `Your approval is needed — check your email. ` +
    `(KSh ${amount} per member)`
  );
}

/* SMS to everyone billed, when the event closes */
function closeSms(event) {
  return (
    `AHEWA Welfare: "${event.event_title}" is now closed. ` +
    `Thank you for your contributions. - AHEWA`
  );
}

/* Email to signatories when an event opens */
function openSignatoryEmail(event, signatory) {
  const amount = Number(event.contribution_amount || 0).toLocaleString();
  const url = eventUrl(event.id);
  const typeLabel = event.event_type === "PRINCIPAL"
    ? "Deceased principal"
    : "Deceased dependant";

  const subject = `AHEWA Approval Needed — ${event.event_title}`;

  const text = [
    `Hi ${signatory.full_name},`,
    ``,
    `A new AHEWA welfare contribution event has been opened:`,
    ``,
    `  Event:      ${event.event_title}`,
    `  Type:       ${typeLabel}`,
    `  Amount:     KSh ${amount} per member`,
    `  Event date: ${new Date(event.event_date).toDateString()}`,
    ``,
    `As a signatory, your approval is required to authorize the`,
    `disbursement once contributions have been collected.`,
    ``,
    `Review and approve here:`,
    `${url}`,
    ``,
    `— Athi Highway Estate Welfare Association`,
  ].join("\n");

  const html = htmlWrapper(subject, `
    <h2 style="margin:0 0 12px; font-family: Georgia, serif; font-size:22px;">
      AHEWA Approval Needed
    </h2>
    <p style="margin:0 0 16px; font-size:15px; line-height:1.5;">
      Hi <strong>${signatory.full_name}</strong>,
    </p>
    <p style="margin:0 0 16px; font-size:15px; line-height:1.5;">
      A new AHEWA welfare contribution event has been opened.
      As a signatory, your approval is required to authorize
      the eventual disbursement.
    </p>

    <table role="presentation" cellpadding="0" cellspacing="0"
           style="margin:0 0 20px; border:1px solid #dcd8cd; border-radius:8px; width:100%;">
      <tr>
        <td style="padding:10px 14px; background:#fbfaf7; font-size:13px; color:#4a5670; width:40%;">Event</td>
        <td style="padding:10px 14px; font-size:14px;"><strong>${event.event_title}</strong></td>
      </tr>
      <tr>
        <td style="padding:10px 14px; background:#fbfaf7; font-size:13px; color:#4a5670; border-top:1px solid #dcd8cd;">Type</td>
        <td style="padding:10px 14px; font-size:14px; border-top:1px solid #dcd8cd;">${typeLabel}</td>
      </tr>
      <tr>
        <td style="padding:10px 14px; background:#fbfaf7; font-size:13px; color:#4a5670; border-top:1px solid #dcd8cd;">Amount per member</td>
        <td style="padding:10px 14px; font-size:14px; border-top:1px solid #dcd8cd;"><strong>KSh ${amount}</strong></td>
      </tr>
      <tr>
        <td style="padding:10px 14px; background:#fbfaf7; font-size:13px; color:#4a5670; border-top:1px solid #dcd8cd;">Event date</td>
        <td style="padding:10px 14px; font-size:14px; border-top:1px solid #dcd8cd;">${new Date(event.event_date).toDateString()}</td>
      </tr>
    </table>

    <div style="text-align:center; margin:28px 0;">
      <a href="${url}"
         style="background:#c8862a; color:#fff; text-decoration:none;
                padding:12px 28px; border-radius:6px; font-weight:600;
                display:inline-block;">
        Review &amp; Approve →
      </a>
    </div>

    <p style="margin:0 0 8px; font-size:13px; color:#4a5670;">
      If the button doesn't work, copy this link into your browser:
    </p>
    <p style="margin:0 0 20px; font-size:13px;">
      <a href="${url}" style="color:#c8862a;">${url}</a>
    </p>

    <p style="margin:0; font-size:13px; color:#4a5670;">
      — Athi Highway Estate Welfare Association
    </p>
  `);

  return { subject, text, html };
}

/* ============================================================
   NOTIFY — event opened
     members       : array of { phone, full_name, id } (billed, excluding affected)
     signatories   : array of { phone, full_name, id, email } (with email)
     event         : { id, event_title, contribution_amount, event_date, event_type }
   ============================================================ */
async function notifyEventOpened(members, signatories, event) {
  const results = { sms: { sent: 0, failed: 0 }, email: { sent: 0, failed: 0 } };

  // ---- 1. SMS to all billed members ----
  // Regular members get the "contribute" message.
  // Signatories get a "check your email" message.
  const signatoryIds = new Set(signatories.map((s) => s.id));
  const smsBatch = [];

  for (const m of members) {
    const isSignatory = signatoryIds.has(m.id);
    smsBatch.push({
      to: m.phone,
      message: isSignatory ? openSmsForSignatory(event) : openSmsForMember(event),
    });
  }

  if (smsBatch.length) {
    console.log(`[ahewa-sms] opening event ${event.id} — SMS to ${smsBatch.length} members`);
    const smsRes = await sendSmsBatch(smsBatch);
    results.sms = smsRes;
    console.log(`[ahewa-sms] opening event ${event.id} — SMS sent ${smsRes.sent}, failed ${smsRes.failed}`);
  }

  // ---- 2. Email to signatories ----
  const emailFailures = [];
  for (const sig of signatories) {
    if (!sig.email) {
      console.warn(`[ahewa-sms] signatory ${sig.full_name} has no email — skipping email`);
      continue;
    }
    try {
      const tpl = openSignatoryEmail(event, sig);
      await sendMail({
        to: sig.email,
        subject: tpl.subject,
        text: tpl.text,
        html: tpl.html,
      });
      console.log(`[ahewa-sms] email sent → ${sig.full_name} <${sig.email}>`);
      results.email.sent++;
    } catch (err) {
      console.error(`[ahewa-sms] email FAILED → ${sig.full_name}: ${err.message}`);
      results.email.failed++;
      emailFailures.push({ to: sig.email, error: err.message });
    }
  }

  return results;
}

/* ============================================================
   NOTIFY — event closed
     members : array of { phone, full_name }
     event   : { id, event_title, contribution_amount }
   ============================================================ */
async function notifyEventClosed(members, event) {
  if (!members || !members.length) {
    console.log("[ahewa-sms] no recipients for event closed");
    return { sent: 0, failed: 0 };
  }

  const message = closeSms(event);
  const batch = members.map((m) => ({ to: m.phone, message }));

  console.log(`[ahewa-sms] closing event ${event.id} — SMS to ${batch.length} members`);
  const result = await sendSmsBatch(batch);
  console.log(`[ahewa-sms] closing event ${event.id} — SMS sent ${result.sent}, failed ${result.failed}`);
  return result;
}

module.exports = { notifyEventOpened, notifyEventClosed };