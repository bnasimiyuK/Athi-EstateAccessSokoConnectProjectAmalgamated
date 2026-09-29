/* ============================================================
   db.js — SQL Server connection pool (shared across all routes)
   Works for both local SQL Server AND Azure SQL Database.
   Toggle encryption via env vars.
   ============================================================ */

require("dotenv").config();
const sql = require("mssql");

const dbConfig = {
  server:   process.env.DB_SERVER || "localhost",
  port:     parseInt(process.env.DB_PORT || "1433", 10),
  database: process.env.DB_NAME,
  options: {
    encrypt:                process.env.DB_ENCRYPT === "true",
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERT !== "false",
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

if (process.env.DB_TRUSTED_CONNECTION === "true") {
  dbConfig.options.trustedConnection = true;
  console.log("🔐 Using Windows Authentication");
} else {
  dbConfig.user     = process.env.DB_USER;
  dbConfig.password = process.env.DB_PASSWORD;
  console.log(`🔐 Using SQL Authentication (${process.env.DB_USER})`);
}

let poolPromise = null;

function getPool() {
  if (!poolPromise) {
    poolPromise = sql.connect(dbConfig)
      .then((pool) => {
        console.log(`✅ Connected to SQL Server: ${process.env.DB_NAME}`);
        return pool;
      })
      .catch((err) => {
        console.error("❌ SQL Server connection failed:", err.message);
        poolPromise = null;
        throw err;
      });
  }
  return poolPromise;
}

module.exports = { sql, getPool };