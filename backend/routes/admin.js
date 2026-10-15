/* ============================================================
   routes/admin.js - admin-only stats, dashboard & exports
   ============================================================ */

const express = require("express");
const router = express.Router();
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");

const { getPool } = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");

/* ------------------------------------------------------------
   Helpers
   ------------------------------------------------------------ */
function toNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Batch-load offerings for a set of provider ids.
 * Returns Map<provider_id, offering[]>.
 *
 * Used by the vendor exports so each vendor row can list every
 * category it offers, and so the "Offerings" sheet has one row
 * per (provider, category) tuple.
 */
async function fetchOfferingsFor(pool, providerIds) {
  const map = new Map();
  if (!Array.isArray(providerIds) || !providerIds.length) return map;

  const req = pool.request();
  const placeholders = providerIds.map((id, i) => {
    req.input("pid" + i, id);
    return "@pid" + i;
  }).join(",");

  const q = await req.query(`
    SELECT
      o.provider_id,
      o.category_id,
      cat.label AS category_label,
      o.price_from,
      o.price_unit,
      o.services,
      o.sort_order
    FROM ProviderOfferings o
    LEFT JOIN Categories cat ON cat.id = o.category_id
    WHERE o.provider_id IN (${placeholders})
    ORDER BY o.provider_id, o.sort_order, o.id
  `);

  for (const r of q.recordset) {
    if (!map.has(r.provider_id)) map.set(r.provider_id, []);
    map.get(r.provider_id).push({
      categoryLabel: r.category_label || "—",
      priceFrom:     toNumber(r.price_from, 0),
      priceUnit:     r.price_unit || "per visit",
      services:      r.services
                       ? r.services.split(",").map((s) => s.trim()).filter(Boolean)
                       : [],
      sortOrder:     r.sort_order || 0,
    });
  }
  return map;
}

/* ------------------------------------------------------------
   Shared helper: legacy dashboard payload
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
  requireRole("super-admin"),
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
  requireRole("super-admin"),
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
   ------------------------------------------------------------ */
function buildWorkbookWithChartImages(stats, images = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Athi Soko Connect";
  wb.created = new Date();

  const headerStyle = {
    font: { bold: true, color: { argb: "FFFFFFFF" } },
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } },
  };

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
  push("Low reviews (1-2★)",       stats.quality.reviewsLow);
  push("Active vendors (30d)",     stats.providers.active30d);
  push("Vendors with no bookings", stats.providers.withNoBookings);
  push("Distinct bookers",         stats.residents.distinctBookers);
  push("Repeat bookers (2+)",      stats.residents.repeatBookers);
  push("Courts covered",           stats.courts.total);

  summary.getRow(1).font = headerStyle.font;
  summary.getRow(1).fill = headerStyle.fill;

  const chartMap = [
    { key: "chart-trend",    label: "Bookings - last 6 months" },
    { key: "chart-status",   label: "Bookings by status" },
    { key: "chart-category", label: "Providers by category" },
    { key: "chart-weekday",  label: "Bookings by weekday" },
  ];

  let imageCount = 0;
  let currentRow = summary.rowCount + 2;

  chartMap.forEach(({ key, label }) => {
    const dataUrl = images[key];
    if (!dataUrl || typeof dataUrl !== "string") {
      console.log(`[admin] no image for ${key} - skipping`);
      return;
    }

    const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");

    const titleRow = summary.getRow(currentRow);
    titleRow.getCell(1).value = label;
    titleRow.getCell(1).font = { bold: true, size: 12 };
    titleRow.height = 22;

    const imageId = wb.addImage({ base64, extension: "png" });
    summary.addImage(imageId, {
      tl:  { col: 0, row: currentRow },
      ext: { width: 720, height: 380 },
    });

    currentRow += 22;
    imageCount++;
  });

  console.log(`[admin] embedded ${imageCount} chart(s) into the workbook`);

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

  const cats = wb.addWorksheet("Categories");
  cats.columns = [
    { header: "Category", key: "label",    width: 22 },
    { header: "Approved", key: "approved", width: 12 },
    { header: "Pending",  key: "pending",  width: 12 },
  ];
  stats.categories.forEach((c) => cats.addRow(c));
  cats.getRow(1).font = headerStyle.font;
  cats.getRow(1).fill = headerStyle.fill;

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
   ============================================================ */
router.post("/export.xlsx",
  requireAuth,
  requireRole("super-admin"),
  express.json({ limit: "25mb" }),
  async (req, res) => {
    try {
      const stats  = await getAdminStats();
      const images = req.body?.images || {};
      console.log("[admin] xlsx export - received", Object.keys(images).length, "image(s)");

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
  requireRole("super-admin"),
  async (req, res) => {
    try {
      const data = await getDashboardData();

      const doc = new PDFDocument({ margin: 40, size: "A4" });
      const filename = `athi-soko-report-${new Date().toISOString().slice(0, 10)}.pdf`;

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      doc.pipe(res);

      doc.fontSize(20).text("Athi Soko Connect - Admin Report", { align: "center" });
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
   Residents export - Excel + PDF
   ============================================================ */
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
    : "-";

  return {
    id:       "AR-" + String(r.id).padStart(3, "0"),
    fullName: r.full_name || "-",
    idNumber: "-",
    phone:    r.phone || "-",
    email:    r.email || "-",
    phase:    r.phase ? "Phase " + r.phase : "-",
    court:    r.court_name || "-",
    role:     "Resident",
    approved,
    status:   r.verified ? "Approved" : "Pending",
  };
}

router.get("/residents/export.xlsx",
  requireAuth,
  requireRole("super-admin"),
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

      ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      ws.getRow(1).fill = {
        type: "pattern", pattern: "solid",
        fgColor: { argb: "FF16233F" },
      };
      ws.getRow(1).alignment = { vertical: "middle", horizontal: "left" };

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

router.get("/residents/export.pdf",
  requireAuth,
  requireRole("super-admin"),
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

      doc.fontSize(20).fillColor("#16233f")
         .text("Athi Soko Connect");
      doc.moveDown(0.3);
      doc.fontSize(14).fillColor("#16233f")
         .text("Approved Residents Report");
      doc.moveDown(0.2);
      doc.fontSize(9).fillColor("#666")
         .text("Generated: " + new Date().toLocaleString("en-GB"));
      doc.moveDown(1);

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

      doc.rect(doc.page.margins.left, headerY, pageWidth, rowH).fill("#16233f");
      doc.fillColor("#ffffff").fontSize(9).font("Helvetica-Bold");
      cols.forEach((c, i) => {
        doc.text(c.header, colX[i] + 4, headerY + 5, {
          width:    c.width * scale - 8,
          ellipsis: true,
          lineBreak: false,
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
              width:    c.width * scale - 8,
              ellipsis: true,
              lineBreak: false,
            });
          });
          y += rowH;
          doc.font("Helvetica").fillColor("#222");
        }

        if (idx % 2 === 0) {
          doc.rect(doc.page.margins.left, y, pageWidth, rowH)
             .fill("#f5f5f5")
             .fillColor("#222");
        }

        const shaped = residentRowToExportShape(r);
        cols.forEach((c, i) => {
          doc.fillColor("#222").text(
            String(shaped[c.key] ?? "-"),
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
   Providers export - Excel + PDF
   Now includes every offering per vendor (multi-category).
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
    where.push("r.court_id = @courtId");
    request.input("courtId", parseInt(courtId, 10));
  }
  if (q && q.trim()) {
    /* Search across provider name, phone, primary category,
       and any offering's category label or services. */
    where.push(`(
      p.name LIKE @q
      OR p.phone LIKE @q
      OR cat.label LIKE @q
      OR EXISTS (
        SELECT 1 FROM ProviderOfferings po
        LEFT JOIN Categories oc ON oc.id = po.category_id
        WHERE po.provider_id = p.id
          AND (po.services LIKE @q OR oc.label LIKE @q)
      )
    )`);
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

  const providers = result.recordset;
  const offeringMap = await fetchOfferingsFor(pool, providers.map((p) => p.id));

  return { providers, offeringMap };
}

const PROVIDER_EXPORT_COLUMNS = [
  { header: "ID",          key: "id",        width: 8  },
  { header: "Business",    key: "name",      width: 28 },
  { header: "Categories",  key: "category",  width: 32 },
  { header: "Phase",       key: "phase",     width: 10 },
  { header: "Court",       key: "court",     width: 20 },
  { header: "Phone",       key: "phone",     width: 18 },
  { header: "Rating",      key: "rating",    width: 10 },
  { header: "Reviews",     key: "reviews",   width: 10 },
  { header: "Status",      key: "status",    width: 14 },
  { header: "Registered",  key: "created",   width: 16 },
];

function providerRowToExportShape(p, offerings) {
  const created = p.created_at
    ? new Date(p.created_at).toLocaleDateString("en-GB", {
        day: "2-digit", month: "short", year: "numeric",
      })
    : "-";

  /* Categories: prefer the offerings list if populated, fall back
     to the primary category label. */
  const categoryString = (offerings && offerings.length)
    ? offerings.map((o) => o.categoryLabel).filter(Boolean).join(", ")
    : (p.category_label || "-");

  return {
    id:       "PV-" + String(p.id).padStart(3, "0"),
    name:     p.name || "-",
    category: categoryString || "-",
    phase:    p.phase ? "Phase " + p.phase : "-",
    court:    p.court_name || "-",
    phone:    p.phone || "-",
    rating:   p.rating != null ? Number(p.rating).toFixed(1) : "-",
    reviews:  p.reviews != null ? p.reviews : "-",
    status:   p.verified ? "Verified" : "Pending review",
    created,
  };
}

/* GET /api/admin/providers/export.xlsx */
router.get("/providers/export.xlsx",
  requireAuth,
  requireRole("super-admin"),
  async (req, res) => {
    try {
      const { providers, offeringMap } = await fetchProvidersForExport(req.query);

      const wb = new ExcelJS.Workbook();
      wb.creator = "Athi Soko Connect";
      wb.created = new Date();

      /* ---------- Sheet 1: Vendors ---------- */
      const ws = wb.addWorksheet("Vendors");
      ws.columns = PROVIDER_EXPORT_COLUMNS.map((c) => ({
        header: c.header, key: c.key, width: c.width,
      }));

      providers.forEach((p) => {
        const offerings = offeringMap.get(p.id) || [];
        ws.addRow(providerRowToExportShape(p, offerings));
      });

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

      /* ---------- Sheet 2: Offerings ---------- */
      const wsOffer = wb.addWorksheet("Offerings");
      wsOffer.columns = [
        { header: "#",         key: "n",         width: 6  },
        { header: "Provider",  key: "provider",  width: 28 },
        { header: "Category",  key: "category",  width: 22 },
        { header: "Services",  key: "services",  width: 60 },
        { header: "Price from",key: "priceFrom", width: 14 },
        { header: "Unit",      key: "unit",      width: 14 },
        { header: "Verified",  key: "verified",  width: 10 },
      ];

      let counter = 0;
      providers.forEach((p) => {
        const offerings = offeringMap.get(p.id) || [];

        if (!offerings.length) {
          counter++;
          wsOffer.addRow({
            n:         counter,
            provider:  p.name || "-",
            category:  p.category_label || "-",
            services:  "(no offerings recorded)",
            priceFrom: "-",
            unit:      "-",
            verified:  p.verified ? "Yes" : "No",
          });
          return;
        }

        offerings.forEach((o) => {
          counter++;
          wsOffer.addRow({
            n:         counter,
            provider:  p.name || "-",
            category:  o.categoryLabel || "-",
            services:  o.services.join(", "),
            priceFrom: o.priceFrom,
            unit:      o.priceUnit || "per visit",
            verified:  p.verified ? "Yes" : "No",
          });
        });
      });

      wsOffer.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      wsOffer.getRow(1).fill = {
        type: "pattern", pattern: "solid",
        fgColor: { argb: "FF16233F" },
      };
      wsOffer.views = [{ state: "frozen", ySplit: 1 }];
      wsOffer.autoFilter = {
        from: { row: 1, column: 1 },
        to:   { row: 1, column: 7 },
      };

      /* Right-align prices */
      wsOffer.getColumn("priceFrom").numFmt = '"KSh "#,##0.00';

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
  requireRole("super-admin"),
  async (req, res) => {
    try {
      const { providers, offeringMap } = await fetchProvidersForExport(req.query);

      /* Flatten offerings into rows for the second table. */
      const flat = [];
      providers.forEach((p) => {
        const offerings = offeringMap.get(p.id) || [];
        if (!offerings.length) {
          flat.push({
            provider: p.name || "-",
            category: p.category_label || "-",
            services: [],
            priceFrom: 0,
            unit: "-",
            verified: p.verified,
          });
        } else {
          offerings.forEach((o) => {
            flat.push({
              provider: p.name || "-",
              category: o.categoryLabel || "-",
              services: o.services,
              priceFrom: Number(o.priceFrom || 0),
              unit: o.priceUnit || "per visit",
              verified: p.verified,
            });
          });
        }
      });

      const filename = `athi-soko-providers-${new Date()
        .toISOString().slice(0, 10)}.pdf`;

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

      const doc = new PDFDocument({
        size: "A4", margin: 40, layout: "landscape",
      });
      doc.pipe(res);

      const fmtKsh = (n) =>
        "KSh " + Number(n || 0).toLocaleString("en-KE", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 2,
        });

      /* ---------- Page title ---------- */
      doc.fontSize(20).fillColor("#16233f").text("Athi Soko Connect");
      doc.moveDown(0.3);
      doc.fontSize(14).fillColor("#16233f").text("Vendors Report");
      doc.moveDown(0.2);
      doc.fontSize(9).fillColor("#666")
         .text(
           `${providers.length} vendors · ${flat.length} offerings · ` +
           `Generated ${new Date().toLocaleString("en-GB")}`
         );
      doc.moveDown(1);

      /* ---------- Shared table renderer ---------- */
      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

      const renderTable = (title, columns, rows) => {
        /* Section title */
        doc.fontSize(12).fillColor("#16233f").font("Helvetica-Bold")
           .text(title);
        doc.moveDown(0.5);

        const totalW = columns.reduce((s, c) => s + c.width, 0);
        const scale  = pageWidth / totalW;
        const colX   = [];
        let x = doc.page.margins.left;
        columns.forEach((c) => { colX.push(x); x += c.width * scale; });

        const rowH = 18;

        /* Header */
        const headerY = doc.y;
        doc.rect(doc.page.margins.left, headerY, pageWidth, rowH).fill("#16233f");
        doc.fillColor("#ffffff").fontSize(9).font("Helvetica-Bold");
        columns.forEach((c, i) => {
          doc.text(c.header, colX[i] + 4, headerY + 5, {
            width: c.width * scale - 8,
            ellipsis: true,
            lineBreak: false,
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
            columns.forEach((c, i) => {
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

          columns.forEach((c, i) => {
            doc.fillColor("#222").text(
              String(r[c.key] ?? "-"),
              colX[i] + 4, y + 5,
              { width: c.width * scale - 8, ellipsis: true, lineBreak: false }
            );
          });

          y += rowH;
        });

        doc.y = y + 12;
        doc.moveDown(0.6);
      };

      /* ---------- Table 1: Vendors ---------- */
      renderTable(
        `Vendors (${providers.length})`,
        [
          { header: "ID",         key: "id",       width: 8  },
          { header: "Business",   key: "name",     width: 28 },
          { header: "Categories", key: "category", width: 32 },
          { header: "Phase",      key: "phase",    width: 10 },
          { header: "Court",      key: "court",    width: 20 },
          { header: "Phone",      key: "phone",    width: 18 },
          { header: "Status",     key: "status",   width: 14 },
          { header: "Registered", key: "created",  width: 16 },
        ],
        providers.map((p) => {
          const offerings = offeringMap.get(p.id) || [];
          return providerRowToExportShape(p, offerings);
        })
      );

      /* ---------- Table 2: Offerings ---------- */
      renderTable(
        `Vendor offerings (${flat.length})`,
        [
          { header: "Provider",  key: "provider",  width: 26 },
          { header: "Category",  key: "category",  width: 20 },
          { header: "Services",  key: "services",  width: 60 },
          { header: "Price",     key: "price",     width: 16 },
          { header: "Unit",      key: "unit",      width: 16 },
          { header: "Verified",  key: "verified",  width: 10 },
        ],
        flat.map((o) => ({
          provider:  o.provider,
          category:  o.category,
          services:  o.services.length ? o.services.join(", ") : "(no services)",
          price:     fmtKsh(o.priceFrom),
          unit:      o.unit,
          verified:  o.verified ? "Yes" : "No",
        }))
      );

      doc.fontSize(8).fillColor("#888")
         .text(
           "Prices are set by providers. Payment is arranged directly between residents and providers.",
           { align: "center" }
         );

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