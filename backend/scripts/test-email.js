/* ============================================================
   scripts/test-email.js - verify Gmail SMTP works
   Usage:  node scripts/test-email.js recipient@example.com
   ============================================================ */

require("dotenv").config();
const { sendMail, testEmail } = require("../utils/mailer");

const recipient = process.argv[2];

(async () => {
  if (!recipient) {
    console.error("❌ Usage: node scripts/test-email.js <recipient-email>");
    process.exit(1);
  }

  console.log("📤 Sending test email to:", recipient);
  console.log("   SMTP user:", process.env.SMTP_USER);
  console.log("   Mode:",      process.env.MAIL_MODE);
  console.log("");

  try {
    const tpl = testEmail();

    const result = await sendMail({
      to: recipient,
      subject: tpl.subject,
      text: tpl.text,
      html: tpl.html,
    });

    if (result.sent) {
      console.log("✅ Email sent successfully!");
      console.log("   Message ID:", result.messageId);
      console.log("   Check your inbox (and Spam folder).");
    } else {
      console.log("⚠️  Email was logged to console instead of sent (MAIL_MODE=console).");
    }
    process.exit(0);
  } catch (err) {
    console.error("❌ Failed to send:", err.message);
    if (err.code === "EAUTH") {
      console.error("   Hint: Check SMTP_USER / SMTP_PASS in .env - must be an App Password, not your normal Gmail password.");
    }
    process.exit(1);
  }
})();