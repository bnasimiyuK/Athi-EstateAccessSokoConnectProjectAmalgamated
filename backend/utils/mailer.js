/* ============================================================
   utils/mailer.js — send emails via Gmail SMTP (Nodemailer)
   Modes:
     MAIL_MODE=smtp     → send real emails
     MAIL_MODE=console  → log emails to terminal (dev fallback)
   ============================================================ */

require("dotenv").config();

const MODE    = (process.env.MAIL_MODE || "console").toLowerCase();
const FROM    = process.env.MAIL_FROM || "Athi Soko Connect <noreply@athisoko.local>";
const APP_URL = process.env.APP_URL  || "http://localhost:4050";

/* ------------------------------------------------------------
   Set up transporter once, only if SMTP mode
   ------------------------------------------------------------ */
let transporter = null;
if (MODE === "smtp") {
  const nodemailer = require("nodemailer");

  // Gmail requires an App Password (not the main account password)
  const smtpPass = (process.env.SMTP_PASS || "").replace(/\s+/g, "");

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: false, // STARTTLS on port 587
    auth: {
      user: process.env.SMTP_USER,
      pass: smtpPass,
    },
  });

  // Verify credentials at boot (best-effort, non-blocking)
  transporter.verify()
    .then(() => console.log(`📧 Mailer ready (SMTP) — sending as ${process.env.SMTP_USER}`))
    .catch((err) => console.error("❌ Mailer SMTP verify failed:", err.message));
} else {
  console.log("📧 Mailer: CONSOLE mode (emails printed to terminal)");
}

/* ------------------------------------------------------------
   Main send function
   ------------------------------------------------------------ */
async function sendMail({ to, subject, text, html }) {
  if (MODE === "smtp" && transporter) {
    const info = await transporter.sendMail({
      from: FROM,
      to,
      subject,
      text,
      html,
    });
    return { sent: true, mode: "smtp", messageId: info.messageId };
  }

  // Console fallback
  console.log("\n" + "═".repeat(72));
  console.log("📧  EMAIL (console mode — NOT actually sent)");
  console.log("═".repeat(72));
  console.log(`From:    ${FROM}`);
  console.log(`To:      ${to}`);
  console.log(`Subject: ${subject}`);
  console.log("─".repeat(72));
  console.log(text || "(no text body)");
  console.log("═".repeat(72) + "\n");

  return { sent: false, mode: "console" };
}

/* ------------------------------------------------------------
   Reusable HTML wrapper for all our emails
   ------------------------------------------------------------ */
function htmlWrapper(title, bodyHtml) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
</head>
<body style="margin:0; padding:0; background:#f4f2ec; font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color:#16233f;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2ec; padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px; background:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,0.06);">
          <!-- Header -->
          <tr>
            <td style="background:#16233f; padding:24px 32px; color:#fbfaf7;">
              <div style="font-size:20px; font-weight:700; letter-spacing:0.3px;">
                Athi Soko <span style="color:#c8862a;">Connect</span>
              </div>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              ${bodyHtml}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px; background:#f0eee7; color:#4a5670; font-size:12px;">
              This message was sent by Athi Soko Connect. If you didn't expect it, please ignore it.
              <br/>Athi Highway Estate · Resident-only marketplace
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/* ------------------------------------------------------------
   Template: Welcome resident with temp password
   ------------------------------------------------------------ */
function residentWelcomeEmail({ fullName, phone, tempPassword, expiresHours = 24 }) {
  const loginUrl = `${APP_URL}/login.html`;
  const subject = "Welcome to Athi Soko Connect — your login details";

  const text = [
    `Hi ${fullName},`,
    ``,
    `Your account has been created by the estate admin.`,
    ``,
    `Login details:`,
    `  Phone:              ${phone}`,
    `  Temporary password: ${tempPassword}`,
    ``,
    `Login here: ${loginUrl}`,
    ``,
    `⚠️ This temporary password expires in ${expiresHours} hours.`,
    `You must change it on first login.`,
    ``,
    `— Athi Soko Connect`,
  ].join("\n");

  const html = htmlWrapper(subject, `
    <h2 style="margin:0 0 12px; font-family: Georgia, 'Times New Roman', serif; font-size:22px;">Welcome to Athi Soko Connect</h2>
    <p style="margin:0 0 16px; font-size:15px; line-height:1.5;">
      Hi <strong>${fullName}</strong>,
    </p>
    <p style="margin:0 0 16px; font-size:15px; line-height:1.5;">
      Your account has been created by the estate admin. Use the details below to log in to your resident portal.
    </p>

    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px; border:1px solid #dcd8cd; border-radius:8px; width:100%;">
      <tr>
        <td style="padding:12px 16px; background:#fbfaf7; font-size:13px; color:#4a5670; width:40%;">Login URL</td>
        <td style="padding:12px 16px; font-size:14px;"><a href="${loginUrl}" style="color:#c8862a; text-decoration:none;">${loginUrl}</a></td>
      </tr>
      <tr>
        <td style="padding:12px 16px; background:#fbfaf7; font-size:13px; color:#4a5670; border-top:1px solid #dcd8cd;">Phone (username)</td>
        <td style="padding:12px 16px; font-size:14px; border-top:1px solid #dcd8cd;"><strong>${phone}</strong></td>
      </tr>
      <tr>
        <td style="padding:12px 16px; background:#fbfaf7; font-size:13px; color:#4a5670; border-top:1px solid #dcd8cd;">Temporary password</td>
        <td style="padding:12px 16px; font-size:16px; letter-spacing:1px; border-top:1px solid #dcd8cd;"><code style="background:#f5ecd9; padding:2px 8px; border-radius:4px; color:#a86c1c;">${tempPassword}</code></td>
      </tr>
    </table>

    <div style="background:#f7e6e0; border-left:4px solid #b0472e; padding:12px 16px; border-radius:6px; margin:0 0 20px;">
      <strong style="color:#b0472e;">⚠️ Action required</strong>
      <p style="margin:6px 0 0; font-size:14px; color:#4a5670; line-height:1.4;">
        This temporary password expires in <strong>${expiresHours} hours</strong>.
        You must change it on first login.
      </p>
    </div>

    <p style="margin:0; font-size:13px; color:#4a5670;">
      If you didn't expect this message, you can safely ignore it.
    </p>
  `);

  return { subject, text, html };
}

/* ------------------------------------------------------------
   Template: simple plain-text test
   ------------------------------------------------------------ */
function testEmail() {
  const subject = "Athi Soko Connect — Mailer Test";
  const text = "✅ Your Gmail SMTP setup is working. Real emails can now be delivered.";
  const html = htmlWrapper(subject, `
    <h2 style="margin:0 0 12px; font-family: Georgia, serif;">✅ Mailer working</h2>
    <p style="font-size:15px; line-height:1.5;">
      Your Gmail SMTP configuration is set up correctly.
      Real emails can now be delivered to residents and vendors.
    </p>
  `);
  return { subject, text, html };
}

module.exports = {
  sendMail,
  residentWelcomeEmail,
  testEmail,
  htmlWrapper,
};