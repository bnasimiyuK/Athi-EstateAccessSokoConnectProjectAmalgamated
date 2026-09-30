/* ============================================================
   server.js — AthiEstateAccessSokoConnectProjectAmalgamated backend
   Serves the REST API under /api/* and the static frontend
   (../frontend) on every other path. Run with: node server.js
   ============================================================ */

require("dotenv").config();

console.log("🔧 ALLOW_ORIGIN =", process.env.ALLOW_ORIGIN || "(not set)");

const express = require("express");
const cors = require("cors");
const path = require("path");

const categoriesRouter = require("./routes/categories");
const providersRouter  = require("./routes/providers");
const reviewsRouter    = require("./routes/reviews");
const bookingsRouter   = require("./routes/bookings");
const reportsRouter    = require("./routes/reports");
const residentsRouter  = require("./routes/residents");
const courtsRouter     = require("./routes/courts");
const authRouter       = require("./routes/auth");
const adminRouter      = require("./routes/admin");
const invoicesRouter = require("./routes/invoices");
const paymentsRouter = require("./routes/payments");
const houseNumbersRouter = require("./routes/house-numbers");
const visitorsRouter = require("./routes/visitors");


const app = express();
const PORT = process.env.PORT || 4050;
const FRONTEND_DIR = path.join(__dirname, "..", "frontend");

/* ------------------------------------------------------------
   CORS — accept requests from one or more origins listed in
   ALLOW_ORIGIN (comma-separated). Falls back to localhost:3000
   for local development.
   ------------------------------------------------------------ */
const allowedOrigins = (process.env.ALLOW_ORIGIN || "http://localhost:3000")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

console.log("🔧 CORS allowed origins:", allowedOrigins);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow same-origin / curl / Postman (no Origin header)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      console.warn(`🚫 CORS blocked: ${origin}`);
      return callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  })
);

app.use(express.json());

/* ---------- API routes ---------- */
app.use("/api/auth",       authRouter);
app.use("/api/categories", categoriesRouter);
app.use("/api/providers",  providersRouter);
app.use("/api/reviews",    reviewsRouter);
app.use("/api/bookings",   bookingsRouter);
app.use("/api/reports",    reportsRouter);
app.use("/api/residents",  residentsRouter);
app.use("/api/courts",     courtsRouter);
app.use("/api/admin",      adminRouter);
app.use("/api/invoices", invoicesRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api/house-numbers", houseNumbersRouter);
app.use("/api/visitors", visitorsRouter);

/* ---------- Static frontend ---------- */
app.use(express.static(FRONTEND_DIR));

/* ---------- Friendly 404 for API ---------- */
app.use("/api", (req, res) => {
  res.status(404).json({ error: `No API route for ${req.method} ${req.originalUrl}` });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Athi Soko Connect backend running at http://localhost:${PORT}`);
  console.log(`Serving frontend from ${FRONTEND_DIR}`);
});