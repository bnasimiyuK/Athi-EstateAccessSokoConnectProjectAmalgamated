/* ============================================================
   server.js — Athi Soko Connect backend
   Serves the REST API under /api/* and the static frontend
   (../frontend) on every other path. Run with: node server.js
   ============================================================ */

require("dotenv").config();

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
const adminRouter = require("./routes/admin");

const app = express();
const PORT = process.env.PORT || 4050;
const FRONTEND_DIR = path.join(__dirname, "..", "frontend");

app.use(cors({
  origin: process.env.ALLOW_ORIGIN || true,
  credentials: true,
}));
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
app.use("/api/admin", adminRouter);

/* ---------- Static frontend ---------- */
app.use(express.static(FRONTEND_DIR));

/* ---------- Friendly 404 for API ---------- */
app.use("/api", (req, res) => {
  res.status(404).json({ error: `No API route for ${req.method} ${req.originalUrl}` });
});

app.listen(PORT, () => {
  console.log(`Athi Soko Connect backend running at http://localhost:${PORT}`);
  console.log(`Serving frontend from ${FRONTEND_DIR}`);
});