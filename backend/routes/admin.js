/* ============================================================
   routes/admin.js — admin-only stats, dashboard & exports
   ============================================================ */

const express = require("express");
const router = express.Router();
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");

const { getPool } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");

/* ------------------------------------------------------------
   Shared helper: legacy dashboard payload
   (still used by /dashboard and /export.pdf)
   ------------------------------------------------------------ */
async function getDashboardData() {
  const pool = await getPool();

  const headline = await pool.request().query(`
    SELECT
      (SELECT COUNT(*) FROM Providers)                                    AS vendors_total,
      (SELECT COUNT(*) FROM Providers WHERE verified = 1)                 AS vendors_approved,
      (SELECT COUNT(*) FROM Providers WHERE verified = 0)                 AS vendors_pending,
      (SELECT COUNT(*) FROM Residents)                                    AS residents_total,
      (SELECT COUNT(*) FROM Residents WHERE verified = 1)                 AS residents_verified,
      (SELECT COUNT(*) FROM Bookings)                                     AS bookings_total,
      (SELECT COUNT(*) FROM Bookings WHERE status = 'requested')          AS bookings_requested,
      (SELECT COUNT(*) FROM Bookings WHERE status = 'confirmed')          AS bookings_confirmed,
      (SELECT COUNT(*) FROM Bookings WHERE status = 'completed')          AS bookings_completed,
      (SELECT COUNT(*) FROM Bookings WHERE status = 'cancelled')          AS bookings_cancelled,
      (SELECT COUNT(*) FROM Reviews)                                      AS reviews_total,
      (SELECT ISNULL(AVG(CAST(rating AS DECIMAL(3,2))), 0) FROM Reviews)  AS avg_rating
  `);

  const thisMonth = await pool.request().query(`
    DECLARE @m DATETIME2 = DATEADD(month, DATEDIFF(month, 0, SYSUTCDATETIME()), 0);
    SELECT
      (SELECT COUNT(*) FROM Bookings WHERE created_at >= @m)                        AS bookings_this_month,
      (SELECT COUNT(*) FROM Bookings WHERE created_at >= @m AND status='completed') AS completed_this_month,
      (SELECT COUNT(*) FROM Bookings WHERE created_at >= @m AND status='cancelled') AS cancelled_this_month,
      (SELECT COUNT(*) FROM Providers WHERE created_at >= @m)                       AS vendors_joined_this_month,
      (SELECT COUNT(*) FROM Residents WHERE created_at >= @m)                       AS residents_joined_this_month;
  `);

  const active = await pool.request().query(`
    SELECT COUNT(DISTINCT provider_id) AS vendors_active_30d
    FROM Bookings WHERE created_at >= DATEADD(day, -30, SYSUTCDATETIME())
  `);

  const byCategory = await pool.request().query(`
    SELECT c.label AS category,
           COUNT(p.id)                                     AS approved_vendors,
           SUM(CASE WHEN p.verified = 0 THEN 1 ELSE 0 END) AS pending_vendors
    FROM Categories c
    LEFT JOIN Providers p ON p.category_id = c.id
    GROUP BY c.label
    ORDER BY approved_vendors DESC
  `);

  const trend = await pool.request().query(`
    SELECT FORMAT(DATEFROMPARTS(YEAR(created_at), MONTH(created_at), 1), 'yyyy-MM') AS month,
           COUNT(*)                                                                 AS total,
           SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END)                      AS completed,
           SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END)                      AS cancelled
    FROM Bookings
    WHERE created_at >= DATEADD(month, -6, SYSUTCDATETIME())
    GROUP BY YEAR(created_at), MONTH(created_at)
    ORDER BY YEAR(created_at), MONTH(created_at)
  `);

  return {
    headline:   headline.recordset[0],
    thisMonth:  thisMonth.recordset[0],
    active:     active.recordset[0],
    byCategory: byCategory.recordset,
    trend:      trend.recordset,
  };
}

/* ------------------------------------------------------------
   Shared helper: full stats payload
   (powers both /stats and /export.xlsx so they never drift)
   ------------------------------------------------------------ */
async function getAdminStats() {
  const pool = await getPool();

  const result = await pool.request().query(`
    DECLARE @monthStart DATETIME2 = DATEADD(month, DATEDIFF(month, 0, SYSUTCDATETIME()), 0);
    DECLARE @lastMonthStart DATETIME2 = DATEADD(month, -1, @monthStart);
    DECLARE @d30 DATETIME2 = DATEADD(day, -30, SYSUTCDATETIME());

    SELECT
      (SELECT COUNT(*) FROM Residents WHERE verified = 0) AS pending_residents,
      (SELECT COUNT(*) FROM Residents WHERE verified = 1) AS approved_residents,
      (SELECT COUNT(*) FROM Providers WHERE verified = 0) AS pending_vendors,
      (SELECT COUNT(*) FROM Providers WHERE verified = 1) AS approved_vendors,
      (SELECT COUNT(*) FROM Residents WHERE created_at >= @monthStart) AS residents_joined_this_month,
      (SELECT COUNT(*) FROM Providers WHERE created_at >= @monthStart) AS vendors_joined_this_month,
      (SELECT COUNT(*) FROM Bookings)                             AS bookings_total,
      (SELECT COUNT(*) FROM Bookings WHERE status = 'requested')  AS bookings_open,
      (SELECT COUNT(*) FROM Bookings WHERE status = 'confirmed')  AS bookings_confirmed,
      (SELECT COUNT(*) FROM Bookings WHERE status = 'completed')  AS bookings_completed,
      (SELECT COUNT(*) FROM Bookings WHERE status = 'cancelled')  AS bookings_cancelled,
      (SELECT COUNT(*) FROM Bookings WHERE created_at >= @monthStart) AS bookings_this_month,
      (SELECT COUNT(*) FROM Bookings
        WHERE created_at >= @monthStart AND status = 'completed')   AS completed_this_month,
      (SELECT COUNT(*) FROM Bookings
        WHERE created_at >= @monthStart AND status = 'cancelled')   AS cancelled_this_month,
      (SELECT COUNT(*) FROM Bookings
        WHERE created_at >= @lastMonthStart AND created_at < @monthStart) AS bookings_last_month,
      (SELECT COUNT(*) FROM Bookings
        WHERE created_at >= @lastMonthStart AND created_at < @monthStart
          AND status = 'completed')                                     AS completed_last_month,
      (SELECT COUNT(*) FROM Bookings
        WHERE created_at >= @lastMonthStart AND created_at < @monthStart
          AND status = 'cancelled')                                     AS cancelled_last_month,
      (SELECT COUNT(*) FROM Bookings WHERE created_at >= @d30) AS bookings_last_30d,
      (SELECT COUNT(*) FROM Bookings
        WHERE created_at >= DATEADD(day, -7, SYSUTCDATETIME())) AS bookings_last_7d,
      (SELECT COUNT(*) FROM Reviews)                                     AS reviews_total,
      (SELECT ISNULL(AVG(CAST(rating AS DECIMAL(3,2))), 0) FROM Reviews) AS avg_rating,
      (SELECT COUNT(*) FROM Reviews WHERE rating = 5)                    AS reviews_5star,
      (SELECT COUNT(*) FROM Reviews WHERE rating <= 2)                   AS reviews_low,
      (SELECT COUNT(DISTINCT provider_id) FROM Bookings
        WHERE created_at >= @d30)                                        AS vendors_active_30d,
      (SELECT COUNT(*) FROM Providers p
        WHERE p.verified = 1
          AND NOT EXISTS (SELECT 1 FROM Bookings b WHERE b.provider_id = p.id))
                                                                        AS vendors_with_no_bookings,
      (SELECT COUNT(*) FROM Categories c
        WHERE NOT EXISTS (SELECT 1 FROM Providers p
                          WHERE p.category_id = c.id AND p.verified = 1))
                                                                        AS categories_without_vendor,
      (SELECT COUNT(DISTINCT resident_phone) FROM Bookings) AS booking_residents_distinct,
      (SELECT COUNT(*) FROM (
        SELECT resident_phone FROM Bookings
        GROUP BY resident_phone HAVING COUNT(*) >= 2
      ) x)                                                   AS residents_repeat,
      (SELECT COUNT(*) FROM Courts) AS courts_total;
  `);

  const row = result.recordset[0];

  const trend = await pool.request().query(`
    SELECT
      FORMAT(DATEFROMPARTS(YEAR(created_at), MONTH(created_at), 1), 'yyyy-MM') AS month,
      COUNT(*)                                                                  AS total,
      SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END)                       AS completed,
      SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END)                       AS cancelled
    FROM Bookings
    WHERE created_at >= DATEADD(month, -6, SYSUTCDATETIME())
    GROUP BY YEAR(created_at), MONTH(created_at)
    ORDER BY YEAR(created_at), MONTH(created_at)
  `);

  const topVendors = await pool.request().query(`
    SELECT TOP 5 id, name, rating, reviews
    FROM Providers
    WHERE verified = 1 AND reviews > 0
    ORDER BY rating DESC, reviews DESC
  `);

  const emptyCats = await pool.request().query(`
    SELECT c.id, c.label
    FROM Categories c
    WHERE NOT EXISTS (
      SELECT 1 FROM Providers p WHERE p.category_id = c.id AND p.verified = 1
    )
    ORDER BY c.label
  `);

  const deadVendors = await pool.request().query(`
    SELECT p.id, p.name, p.phone
    FROM Providers p
    WHERE p.verified = 1
      AND NOT EXISTS (SELECT 1 FROM Bookings b WHERE b.provider_id = p.id)
    ORDER BY p.created_at DESC
  `);

  const byWeekday = await pool.request().query(`
    SELECT DATENAME(weekday, created_at) AS day, COUNT(*) AS total
    FROM Bookings
    GROUP BY DATENAME(weekday, created_at)
    ORDER BY MIN(DATEPART(weekday, created_at))
  `);

  const categories = await pool.request().query(`
    SELECT
      c.label AS label,
      SUM(CASE WHEN p.verified = 1 THEN 1 ELSE 0 END) AS approved,
      SUM(CASE WHEN p.verified = 0 THEN 1 ELSE 0 END) AS pending
    FROM Categories c
    LEFT JOIN Providers p ON p.category_id = c.id
    GROUP BY c.label
    ORDER BY approved DESC, c.label
  `);

  return {
    headline: {
      pendingResidents:  row.pending_residents,
      approvedResidents: row.approved_residents,
      pendingVendors:    row.pending_vendors,
      approvedVendors:   row.approved_vendors,
      residentsJoinedThisMonth: row.residents_joined_this_month,
      vendorsJoinedThisMonth:   row.vendors_joined_this_month,
    },
    bookings: {
      total:              row.bookings_total,
      open:               row.bookings_open,
      confirmed:          row.bookings_confirmed,
      completed:          row.bookings_completed,
      cancelled:          row.bookings_cancelled,
      thisMonth:          row.bookings_this_month,
      completedThisMonth: row.completed_this_month,
      cancelledThisMonth: row.cancelled_this_month,
      lastMonth:          row.bookings_last_month,
      completedLastMonth: row.completed_last_month,
      cancelledLastMonth: row.cancelled_last_month,
      last30d:            row.bookings_last_30d,
      last7d:             row.bookings_last_7d,
    },
    quality: {
      reviewsTotal: row.reviews_total,
      avgRating:    Number(row.avg_rating) || 0,
      reviews5Star: row.reviews_5star,
      reviewsLow:   row.reviews_low,
    },
    providers: {
      active30d:               row.vendors_active_30d,
      withNoBookings:          row.vendors_with_no_bookings,
      categoriesWithoutVendor: row.categories_without_vendor,
    },
    residents: {
      distinctBookers: row.booking_residents_distinct,
      repeatBookers:   row.residents_repeat,
    },
    courts: {
      total: row.courts_total,
    },
    trend:           trend.recordset,
    topVendors:      topVendors.recordset,
    emptyCategories: emptyCats.recordset,
    deadVendors:     deadVendors.recordset,
    byWeekday:       byWeekday.recordset,
    categories:      categories.recordset,
  };
}

/* ============================================================
   GET /api/admin/stats
   ============================================================ */
router.get("/stats",
  requireAuth,
  requireRole("admin"),
  async (req, res, next) => {
    try {
      res.json(await getAdminStats());
    } catch (err) {
      next(err);
    }
  }
);

/* ============================================================
   GET /api/admin/dashboard
   ============================================================ */
router.get("/dashboard",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    try {
      res.json(await getDashboardData());
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Dashboard query failed." });
    }
  }
);

/* ------------------------------------------------------------
   Build an Excel workbook with chart PNGs embedded.
   (exceljs cannot create native Excel chart objects, so we
   embed images of the Chart.js canvases sent by the frontend.)
   ------------------------------------------------------------ */
function buildWorkbookWithChartImages(stats, images = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Athi Soko Connect";
  wb.created = new Date();

  const headerStyle = {
    font: { bold: true, color: { argb: "FFFFFFFF" } },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } },
  };

  /* ---------- Sheet 1: Summary (metrics + embedded charts) ---------- */
  const summary = wb.addWorksheet("Summary");
  summary.columns = [
    { header: "Metric", key: "metric", width: 40 },
    { header: "Value",  key: "value",  width: 20 },
  ];

  const push = (label, value) => summary.addRow({ metric: label, value });

  push("Total bookings",           stats.bookings.total);
  push("Completed",                stats.bookings.completed);
  push("Cancelled",                stats.bookings.cancelled);
  push("Open (requested)",         stats.bookings.open);
  push("Confirmed",                stats.bookings.confirmed);
  push("Bookings this month",      stats.bookings.thisMonth);
  push("Bookings last 30 days",    stats.bookings.last30d);
  push("Reviews",                  stats.quality.reviewsTotal);
  push("Avg rating",               Number(stats.quality.avgRating).toFixed(2));
  push("5-star reviews",           stats.quality.reviews5Star);
  push("Low reviews (1–2★)",       stats.quality.reviewsLow);
  push("Active vendors (30d)",     stats.providers.active30d);
  push("Vendors with no bookings", stats.providers.withNoBookings);
  push("Distinct bookers",         stats.residents.distinctBookers);
  push("Repeat bookers (2+)",      stats.residents.repeatBookers);
  push("Courts covered",           stats.courts.total);

  summary.getRow(1).font = headerStyle.font;
  summary.getRow(1).fill = headerStyle.fill;

  /* ---------- Embed chart PNGs ---------- */
  const chartMap = [
    { key: "chart-trend",    label: "Bookings — last 6 months" },
    { key: "chart-status",   label: "Bookings by status" },
    { key: "chart-category", label: "Providers by category" },
    { key: "chart-weekday",  label: "Bookings by weekday" },
  ];

  let imageCount = 0;
  // Start two rows below the metric table so we don't clash with cell content
  let currentRow = summary.rowCount + 2;

  chartMap.forEach(({ key, label }) => {
    const dataUrl = images[key];
    if (!dataUrl || typeof dataUrl !== "string") {
      console.log(`[admin] no image for ${key} — skipping`);
      return;
    }

    const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");

    /* --- Title row, written directly at currentRow --- */
    const titleRow = summary.getRow(currentRow);
    titleRow.getCell(1).value = label;
    titleRow.getCell(1).font = { bold: true, size: 12 };
    titleRow.height = 22;

    /* --- Image anchored one row below the title so it can't overlap --- */
    const imageId = wb.addImage({ base64, extension: "png" });
    summary.addImage(imageId, {
      tl:  { col: 0, row: currentRow },   // column A, one row under the title
      ext: { width: 720, height: 380 },    // px — bigger and clearer
    });

    /* --- Advance cursor past the title + the image + a small gap --- */
    currentRow += 22;
    imageCount++;
  });

  console.log(`[admin] embedded ${imageCount} chart(s) into the workbook`);

  /* ---------- Sheet 2: Trend data ---------- */
  const trend = wb.addWorksheet("Trend");
  trend.columns = [
    { header: "Month",     key: "month",     width: 14 },
    { header: "Total",     key: "total",     width: 10 },
    { header: "Completed", key: "completed", width: 12 },
    { header: "Cancelled", key: "cancelled", width: 12 },
  ];
  stats.trend.forEach((r) => trend.addRow(r));
  trend.getRow(1).font = headerStyle.font;
  trend.getRow(1).fill = headerStyle.fill;

  /* ---------- Sheet 3: Status data ---------- */
  const status = wb.addWorksheet("Status");
  status.columns = [
    { header: "Status", key: "status", width: 14 },
    { header: "Count",  key: "count",  width: 10 },
  ];
  status.addRow({ status: "Requested", count: stats.bookings.open });
  status.addRow({ status: "Confirmed", count: stats.bookings.confirmed });
  status.addRow({ status: "Completed", count: stats.bookings.completed });
  status.addRow({ status: "Cancelled", count: stats.bookings.cancelled });
  status.getRow(1).font = headerStyle.font;
  status.getRow(1).fill = headerStyle.fill;

  /* ---------- Sheet 4: Categories data ---------- */
  const cats = wb.addWorksheet("Categories");
  cats.columns = [
    { header: "Category", key: "label",    width: 22 },
    { header: "Approved", key: "approved", width: 12 },
    { header: "Pending",  key: "pending",  width: 12 },
  ];
  stats.categories.forEach((c) => cats.addRow(c));
  cats.getRow(1).font = headerStyle.font;
  cats.getRow(1).fill = headerStyle.fill;

  /* ---------- Sheet 5: Weekday data ---------- */
  const weekday = wb.addWorksheet("Weekday");
  weekday.columns = [
    { header: "Day",   key: "day",   width: 14 },
    { header: "Total", key: "total", width: 10 },
  ];
  stats.byWeekday.forEach((r) => weekday.addRow(r));
  weekday.getRow(1).font = headerStyle.font;
  weekday.getRow(1).fill = headerStyle.fill;

  return wb;
}

/* ============================================================
   POST /api/admin/export.xlsx
   Body: { images: { "chart-trend": "data:image/png;base64,...", ... } }
   Returns: .xlsx workbook with the images embedded.
   ============================================================ */
router.post("/export.xlsx",
  requireAuth,
  requireRole("admin"),
  express.json({ limit: "25mb" }),
  async (req, res) => {
    try {
      const stats  = await getAdminStats();
      const images = req.body?.images || {};
      console.log("[admin] xlsx export — received", Object.keys(images).length, "image(s)");

      const wb = buildWorkbookWithChartImages(stats, images);

      const filename = `athi-soko-report-${new Date().toISOString().slice(0, 10)}.xlsx`;
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

      await wb.xlsx.write(res);
      res.end();
    } catch (err) {
      console.error("[admin] xlsx export failed:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Excel export failed." });
      }
    }
  }
);

/* ============================================================
   GET /api/admin/export.pdf
   ============================================================ */
router.get("/export.pdf",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    try {
      const data = await getDashboardData();

      const doc = new PDFDocument({ margin: 40, size: "A4" });
      const filename = `athi-soko-report-${new Date().toISOString().slice(0, 10)}.pdf`;

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      doc.pipe(res);

      doc.fontSize(20).text("Athi Soko Connect — Admin Report", { align: "center" });
      doc.fontSize(10).fillColor("#666")
         .text(`Generated: ${new Date().toLocaleString()}`, { align: "center" });
      doc.moveDown(2).fillColor("#000");

      doc.fontSize(14).text("Headline Metrics", { underline: true }).moveDown(0.5);
      Object.entries(data.headline).forEach(([k, v]) => {
        doc.fontSize(10).text(`${k.replace(/_/g, " ")}:  ${v}`);
      });

      doc.moveDown(1).fontSize(14).text("This Month", { underline: true }).moveDown(0.5);
      Object.entries(data.thisMonth).forEach(([k, v]) => {
        doc.fontSize(10).text(`${k.replace(/_/g, " ")}:  ${v}`);
      });

      doc.moveDown(1).fontSize(14)
         .text("Active Vendors (last 30 days)", { underline: true }).moveDown(0.5);
      doc.fontSize(10).text(`Active vendors:  ${data.active.vendors_active_30d}`);

      doc.moveDown(1).fontSize(14)
         .text("Vendors by Category", { underline: true }).moveDown(0.5);
      data.byCategory.forEach((row) => {
        doc.fontSize(10).text(
          `${row.category}:  ${row.approved_vendors} approved, ${row.pending_vendors} pending`
        );
      });

      doc.moveDown(1).fontSize(14)
         .text("Monthly Trend (last 6 months)", { underline: true }).moveDown(0.5);
      data.trend.forEach((row) => {
        doc.fontSize(10).text(
          `${row.month}:  ${row.total} total, ${row.completed} completed, ${row.cancelled} cancelled`
        );
      });

      doc.end();
    } catch (err) {
      console.error(err);
      if (!res.headersSent) {
        res.status(500).json({ error: "PDF export failed." });
      }
    }
  }
);

/* ============================================================
   Residents export — Excel + PDF
   Reuses the same filter shape as routes/residents.js:
     ?verified=true|false&phase=1|2&courtId=N&q=text
   ============================================================ */

/* ------------------------------------------------------------
   Shared query — mirrors applyResidentFilters() in residents.js
   ------------------------------------------------------------ */
async function fetchResidentsForExport(query) {
  const { phase, courtId, q, verified } = query;
  const pool = await getPool();
  const request = pool.request();

  const where = [];

  if (phase) {
    where.push("c.phase = @phase");
    request.input("phase", parseInt(phase, 10));
  }
  if (courtId) {
    where.push("r.court_id = @courtId");
    request.input("courtId", parseInt(courtId, 10));
  }
  if (q && q.trim()) {
    where.push("(r.full_name LIKE @q OR r.phone LIKE @q)");
    request.input("q", `%${q.trim()}%`);
  }
  if (verified === "true" || verified === "false") {
    where.push("r.verified = @verified");
    request.input("verified", verified === "true" ? 1 : 0);
  }

  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";

  const result = await request.query(`
    SELECT
      r.id,
      r.full_name,
      r.phone,
      r.email,
      r.court_id,
      r.verified,
      r.created_at,
      c.name  AS court_name,
      c.phase AS phase
    FROM Residents r
    JOIN Courts c ON c.id = r.court_id
    ${whereSql}
    ORDER BY c.phase ASC, c.name ASC, r.full_name ASC
  `);

  return result.recordset;
}

/* ------------------------------------------------------------
   Column definitions (shared by Excel + PDF)
   ------------------------------------------------------------ */
const RESIDENT_EXPORT_COLUMNS = [
  { header: "ID",          key: "id",       width: 10 },
  { header: "Full name",   key: "fullName", width: 28 },
  { header: "ID number",   key: "idNumber", width: 15 },
  { header: "Phone",       key: "phone",    width: 18 },
  { header: "Email",       key: "email",    width: 26 },
  { header: "Phase",       key: "phase",    width: 10 },
  { header: "Court",       key: "court",    width: 20 },
  { header: "Role",        key: "role",     width: 12 },
  { header: "Approved on", key: "approved", width: 18 },
  { header: "Status",      key: "status",   width: 12 },
];

function residentRowToExportShape(r) {
  const approved = r.created_at
    ? new Date(r.created_at).toLocaleDateString("en-GB", {
        day: "2-digit", month: "short", year: "numeric",
      })
    : "—";

  return {
    id:       "AR-" + String(r.id).padStart(3, "0"),
    fullName: r.full_name || "—",
    idNumber: "—",
    phone:    r.phone || "—",
    email:    r.email || "—",
    phase:    r.phase ? "Phase " + r.phase : "—",
    court:    r.court_name || "—",
    role:     "Resident",
    approved,
    status:   r.verified ? "Approved" : "Pending",
  };
}

/* ============================================================
   GET /api/admin/residents/export.xlsx
   ============================================================ */
router.get("/residents/export.xlsx",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    try {
      const rows = await fetchResidentsForExport(req.query);

      const wb = new ExcelJS.Workbook();
      wb.creator = "Athi Soko Connect";
      wb.created = new Date();

      const ws = wb.addWorksheet("Approved Residents");

      ws.columns = RESIDENT_EXPORT_COLUMNS.map((c) => ({
        header: c.header,
        key:    c.key,
        width:  c.width,
      }));

      rows.forEach((r) => ws.addRow(residentRowToExportShape(r)));

      /* Style header */
      ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      ws.getRow(1).fill = {
        type: "pattern", pattern: "solid",
        fgColor: { argb: "FF16233F" },
      };
      ws.getRow(1).alignment = { vertical: "middle", horizontal: "left" };

      /* Freeze + autofilter */
      ws.views = [{ state: "frozen", ySplit: 1 }];
      ws.autoFilter = {
        from: { row: 1, column: 1 },
        to:   { row: 1, column: RESIDENT_EXPORT_COLUMNS.length },
      };

      const filename = `athi-soko-approved-residents-${new Date()
        .toISOString().slice(0, 10)}.xlsx`;

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

      await wb.xlsx.write(res);
      res.end();
    } catch (err) {
      console.error("[admin] residents xlsx export failed:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Residents Excel export failed." });
      }
    }
  }
);

/* ============================================================
   GET /api/admin/residents/export.pdf
   ============================================================ */
router.get("/residents/export.pdf",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    try {
      const rows = await fetchResidentsForExport(req.query);

      const filename = `athi-soko-approved-residents-${new Date()
        .toISOString().slice(0, 10)}.pdf`;

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

      const doc = new PDFDocument({
        size: "A4",
        margin: 40,
        layout: "landscape",
      });
      doc.pipe(res);

      /* ---------- Header ---------- */
      doc.fontSize(20).fillColor("#16233f")
         .text("Athi Soko Connect");
      doc.moveDown(0.3);
      doc.fontSize(14).fillColor("#16233f")
         .text("Approved Residents Report");
      doc.moveDown(0.2);
      doc.fontSize(9).fillColor("#666")
         .text("Generated: " + new Date().toLocaleString("en-GB"));
      doc.moveDown(1);

      /* ---------- Table layout ---------- */
      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const cols      = RESIDENT_EXPORT_COLUMNS;
      const totalW    = cols.reduce((s, c) => s + c.width, 0);
      const scale     = pageWidth / totalW;
      const colX      = [];
      let x = doc.page.margins.left;
      cols.forEach((c) => {
        colX.push(x);
        x += c.width * scale;
      });

      const rowH    = 18;
      const headerY = doc.y;

      /* ---------- Header row ---------- */
      doc.rect(doc.page.margins.left, headerY, pageWidth, rowH).fill("#16233f");
      doc.fillColor("#ffffff").fontSize(9).font("Helvetica-Bold");
      cols.forEach((c, i) => {
        doc.text(c.header, colX[i] + 4, headerY + 5, {
          width:    c.width * scale - 8,
          ellipsis: true,
          lineBreak: false,
        });
      });

      /* ---------- Body ---------- */
      let y = headerY + rowH;
      doc.font("Helvetica").fontSize(9).fillColor("#222");

      rows.forEach((r, idx) => {
        /* page break */
        if (y + rowH > doc.page.height - doc.page.margins.bottom - 20) {
          doc.addPage();
          y = doc.page.margins.top;

          doc.rect(doc.page.margins.left, y, pageWidth, rowH).fill("#16233f");
          doc.fillColor("#ffffff").font("Helvetica-Bold");
          cols.forEach((c, i) => {
            doc.text(c.header, colX[i] + 4, y + 5, {
              width:    c.width * scale - 8,
              ellipsis: true,
              lineBreak: false,
            });
          });
          y += rowH;
          doc.font("Helvetica").fillColor("#222");
        }

        /* zebra */
        if (idx % 2 === 0) {
          doc.rect(doc.page.margins.left, y, pageWidth, rowH)
             .fill("#f5f5f5")
             .fillColor("#222");
        }

        const shaped = residentRowToExportShape(r);
        cols.forEach((c, i) => {
          doc.fillColor("#222").text(
            String(shaped[c.key] ?? "—"),
            colX[i] + 4,
            y + 5,
            { width: c.width * scale - 8, ellipsis: true, lineBreak: false }
          );
        });

        y += rowH;
      });

      doc.moveDown(1);
      doc.fontSize(8).fillColor("#888")
         .text(`Total: ${rows.length} resident${rows.length === 1 ? "" : "s"}`);

      doc.end();
    } catch (err) {
      console.error("[admin] residents pdf export failed:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Residents PDF export failed." });
      }
    }
  }
);
/* ============================================================
   Providers export — Excel + PDF
   Mirrors residents export but for the Providers table.
   ============================================================ */

async function fetchProvidersForExport(query) {
  const { phase, courtId, q, verified } = query;
  const pool = await getPool();
  const request = pool.request();

  const where = [];

  if (phase) {
    where.push("c.phase = @phase");
    request.input("phase", parseInt(phase, 10));
  }
  if (courtId) {
    // court_id lives on Residents (r), NOT on Providers (p)
    where.push("r.court_id = @courtId");
    request.input("courtId", parseInt(courtId, 10));
  }
  if (q && q.trim()) {
    where.push("(p.name LIKE @q OR p.phone LIKE @q OR cat.label LIKE @q)");
    request.input("q", `%${q.trim()}%`);
  }
  if (verified === "true" || verified === "false") {
    where.push("p.verified = @verified");
    request.input("verified", verified === "true" ? 1 : 0);
  }

  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";

  const result = await request.query(`
    SELECT
      p.id,
      p.name,
      p.phone,
      p.verified,
      p.rating,
      p.reviews,
      p.category_id,
      p.created_at,
      r.court_id  AS court_id,
      c.name      AS court_name,
      c.phase     AS phase,
      cat.label   AS category_label
    FROM Providers p
    LEFT JOIN Categories cat ON cat.id  = p.category_id
    LEFT JOIN Residents  r   ON r.id   = p.resident_id
    LEFT JOIN Courts     c   ON c.id   = r.court_id
    ${whereSql}
    ORDER BY c.phase ASC, c.name ASC, p.name ASC
  `);

  return result.recordset;
}

const PROVIDER_EXPORT_COLUMNS = [
  { header: "ID",          key: "id",        width: 8  },
  { header: "Business",    key: "name",      width: 28 },
  { header: "Category",    key: "category",  width: 20 },
  { header: "Phase",       key: "phase",     width: 10 },
  { header: "Court",       key: "court",     width: 20 },
  { header: "Phone",       key: "phone",     width: 18 },
  { header: "Rating",      key: "rating",    width: 10 },
  { header: "Reviews",     key: "reviews",   width: 10 },
  { header: "Status",      key: "status",    width: 14 },
  { header: "Registered",  key: "created",   width: 16 },
];

function providerRowToExportShape(p) {
  const created = p.created_at
    ? new Date(p.created_at).toLocaleDateString("en-GB", {
        day: "2-digit", month: "short", year: "numeric",
      })
    : "—";

  return {
    id:       "PV-" + String(p.id).padStart(3, "0"),
    name:     p.name || "—",
    category: p.category_label || "—",
    phase:    p.phase ? "Phase " + p.phase : "—",
    court:    p.court_name || "—",
    phone:    p.phone || "—",
    rating:   p.rating != null ? Number(p.rating).toFixed(1) : "—",
    reviews:  p.reviews != null ? p.reviews : "—",
    status:   p.verified ? "Verified" : "Pending review",
    created,
  };
}

/* GET /api/admin/providers/export.xlsx */
router.get("/providers/export.xlsx",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    try {
      const rows = await fetchProvidersForExport(req.query);

      const wb = new ExcelJS.Workbook();
      wb.creator = "Athi Soko Connect";
      wb.created = new Date();

      const ws = wb.addWorksheet("Providers");
      ws.columns = PROVIDER_EXPORT_COLUMNS.map((c) => ({
        header: c.header, key: c.key, width: c.width,
      }));

      rows.forEach((r) => ws.addRow(providerRowToExportShape(r)));

      ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      ws.getRow(1).fill = {
        type: "pattern", pattern: "solid",
        fgColor: { argb: "FF16233F" },
      };
      ws.views = [{ state: "frozen", ySplit: 1 }];
      ws.autoFilter = {
        from: { row: 1, column: 1 },
        to:   { row: 1, column: PROVIDER_EXPORT_COLUMNS.length },
      };

      const filename = `athi-soko-providers-${new Date()
        .toISOString().slice(0, 10)}.xlsx`;

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

      await wb.xlsx.write(res);
      res.end();
    } catch (err) {
      console.error("[admin] providers xlsx export failed:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Providers Excel export failed." });
      }
    }
  }
);

/* GET /api/admin/providers/export.pdf */
router.get("/providers/export.pdf",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    try {
      const rows = await fetchProvidersForExport(req.query);

      const filename = `athi-soko-providers-${new Date()
        .toISOString().slice(0, 10)}.pdf`;

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

      const doc = new PDFDocument({
        size: "A4", margin: 40, layout: "landscape",
      });
      doc.pipe(res);

      doc.fontSize(20).fillColor("#16233f").text("Athi Soko Connect");
      doc.moveDown(0.3);
      doc.fontSize(14).fillColor("#16233f").text("Providers Report");
      doc.moveDown(0.2);
      doc.fontSize(9).fillColor("#666")
         .text("Generated: " + new Date().toLocaleString("en-GB"));
      doc.moveDown(1);

      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const cols      = PROVIDER_EXPORT_COLUMNS;
      const totalW    = cols.reduce((s, c) => s + c.width, 0);
      const scale     = pageWidth / totalW;
      const colX      = [];
      let x = doc.page.margins.left;
      cols.forEach((c) => { colX.push(x); x += c.width * scale; });

      const rowH    = 18;
      const headerY = doc.y;

      doc.rect(doc.page.margins.left, headerY, pageWidth, rowH).fill("#16233f");
      doc.fillColor("#ffffff").fontSize(9).font("Helvetica-Bold");
      cols.forEach((c, i) => {
        doc.text(c.header, colX[i] + 4, headerY + 5, {
          width: c.width * scale - 8, ellipsis: true, lineBreak: false,
        });
      });

      let y = headerY + rowH;
      doc.font("Helvetica").fontSize(9).fillColor("#222");

      rows.forEach((r, idx) => {
        if (y + rowH > doc.page.height - doc.page.margins.bottom - 20) {
          doc.addPage();
          y = doc.page.margins.top;
          doc.rect(doc.page.margins.left, y, pageWidth, rowH).fill("#16233f");
          doc.fillColor("#ffffff").font("Helvetica-Bold");
          cols.forEach((c, i) => {
            doc.text(c.header, colX[i] + 4, y + 5, {
              width: c.width * scale - 8, ellipsis: true, lineBreak: false,
            });
          });
          y += rowH;
          doc.font("Helvetica").fillColor("#222");
        }

        if (idx % 2 === 0) {
          doc.rect(doc.page.margins.left, y, pageWidth, rowH)
             .fill("#f5f5f5").fillColor("#222");
        }

        const shaped = providerRowToExportShape(r);
        cols.forEach((c, i) => {
          doc.fillColor("#222").text(
            String(shaped[c.key] ?? "—"),
            colX[i] + 4, y + 5,
            { width: c.width * scale - 8, ellipsis: true, lineBreak: false }
          );
        });

        y += rowH;
      });

      doc.moveDown(1);
      doc.fontSize(8).fillColor("#888")
         .text(`Total: ${rows.length} provider${rows.length === 1 ? "" : "s"}`);

      doc.end();
    } catch (err) {
      console.error("[admin] providers pdf export failed:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Providers PDF export failed." });
      }
    }
  }
);

module.exports = router;