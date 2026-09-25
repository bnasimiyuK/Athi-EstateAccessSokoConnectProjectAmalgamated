/* ============================================================
   scripts/seed-admin.js — create the first admin account
   Usage:   node scripts/seed-admin.js
   Run ONCE to bootstrap the admin login.
   ============================================================ */

require("dotenv").config();
const bcrypt = require("bcryptjs");
const { getPool } = require("../db");

const ADMIN_EMAIL    = "beverly.kongani@gmail.com";
const ADMIN_NAME     = "Beverly Kong'ani";
const ADMIN_PASSWORD = "Admin@2025";

(async () => {
  try {
    const pool = await getPool();

    // Check if admin already exists
    const existing = await pool.request()
      .input("email", ADMIN_EMAIL)
      .query("SELECT id FROM Admins WHERE email = @email");

    if (existing.recordset.length) {
      console.log(`ℹ️  Admin already exists: ${ADMIN_EMAIL}`);
      console.log(`   You can log in with the existing password.`);
      process.exit(0);
    }

    const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);

    await pool.request()
      .input("email", ADMIN_EMAIL)
      .input("name",  ADMIN_NAME)
      .input("hash",  hash)
      .query(`
        INSERT INTO Admins (email, full_name, password_hash, must_change_password)
        VALUES (@email, @name, @hash, 1)
      `);

    console.log("✅ Admin created:");
    console.log(`   Email:    ${ADMIN_EMAIL}`);
    console.log(`   Password: ${ADMIN_PASSWORD}`);
    console.log(`   ⚠️  Change this password after first login.`);
    process.exit(0);
  } catch (err) {
    console.error("❌ Seed failed:", err.message);
    process.exit(1);
  }
})();