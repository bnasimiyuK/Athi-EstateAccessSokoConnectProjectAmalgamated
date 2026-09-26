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
   Shared helper: build the dashboard payload
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

/* ============================================================
   GET /api/admin/stats
   Existing dashboard-tile counts (kept as-is)
   ============================================================ */
router.get("/stats",
  requireAuth,
  requireRole("admin"),
  async (req, res, next) => {
    try {
      const pool = await getPool();

      const result = await pool.request().query(`
        SELECT
          (SELECT COUNT(*) FROM Residents WHERE verified = 0) AS pending_residents,
          (SELECT COUNT(*) FROM Residents WHERE verified = 1) AS approved_residents,
          (SELECT COUNT(*) FROM Providers WHERE verified = 0) AS pending_vendors,
          (SELECT COUNT(*) FROM Providers WHERE verified = 1) AS approved_vendors,
          (SELECT COUNT(*) FROM Bookings)                     AS total_bookings,
          (SELECT COUNT(*) FROM Bookings WHERE status = 'requested') AS open_bookings,
          (SELECT COUNT(*) FROM Reports WHERE status = 'open')       AS open_reports,
          (SELECT COUNT(*) FROM Courts)                       AS total_courts
      `);

      const row = result.recordset[0];

      res.json({
        pendingResidents:  row.pending_residents,
        approvedResidents: row.approved_residents,
        pendingVendors:    row.pending_vendors,
        approvedVendors:   row.approved_vendors,
        totalBookings:     row.total_bookings,
        openBookings:      row.open_bookings,
        openReports:       row.open_reports,
        totalCourts:       row.total_courts,
      });
    } catch (err) {
      next(err);
    }
  }
);

/* ============================================================
   GET /api/admin/dashboard
   Full dashboard payload (headline + this-month + active +
   byCategory + trend)
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

/* ============================================================
   GET /api/admin/export.xlsx
   Download the dashboard as an Excel workbook with 3 sheets
   ============================================================ */
router.get("/export.xlsx",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    try {
      const data = await getDashboardData();
      const wb = new ExcelJS.Workbook();
      wb.creator = "Athi Soko Connect";
      wb.created = new Date();

      const headerStyle = {
        font:      { bold: true, color: { argb: "FFFFFFFF" } },
        fill:      { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } },
      };

      /* ---- Sheet 1: Summary ---- */
      const s1 = wb.addWorksheet("Summary");
      s1.columns = [
        { header: "Metric", key: "metric", width: 40 },
        { header: "Value",  key: "value",  width: 20 },
      ];
      const flat = (obj) =>
        Object.entries(obj).map(([k, v]) => ({
          metric: k.replace(/_/g, " "),
          value:  v,
        }));

      s1.addRows(flat(data.headline));
      s1.addRow({});
      s1.addRow({ metric: "— THIS MONTH —", value: "" });
      s1.addRows(flat(data.thisMonth));
      s1.addRow({});
      s1.addRows(flat(data.active));
      s1.getRow(1).font = headerStyle.font;
      s1.getRow(1).fill = headerStyle.fill;

      /* ---- Sheet 2: Vendors by Category ---- */
      const s2 = wb.addWorksheet("Vendors by Category");
      s2.columns = [
        { header: "Category",         key: "category",         width: 30 },
        { header: "Approved Vendors", key: "approved_vendors", width: 20 },
        { header: "Pending Vendors",  key: "pending_vendors",  width: 20 },
      ];
      s2.addRows(data.byCategory);
      s2.getRow(1).font = headerStyle.font;
      s2.getRow(1).fill = headerStyle.fill;

      /* ---- Sheet 3: Monthly Trend ---- */
      const s3 = wb.addWorksheet("Monthly Trend");
      s3.columns = [
        { header: "Month",     key: "month",     width: 15 },
        { header: "Total",     key: "total",     width: 12 },
        { header: "Completed", key: "completed", width: 12 },
        { header: "Cancelled", key: "cancelled", width: 12 },
      ];
      s3.addRows(data.trend);
      s3.getRow(1).font = headerStyle.font;
      s3.getRow(1).fill = headerStyle.fill;

      /* ---- Stream ---- */
      const filename = `athi-soko-report-${new Date().toISOString().slice(0, 10)}.xlsx`;
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      await wb.xlsx.write(res);
      res.end();
    } catch (err) {
      console.error(err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Excel export failed." });
      }
    }
  }
);

/* ============================================================
   GET /api/admin/export.pdf
   Download the dashboard as a PDF report
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

      /* ---- Header ---- */
      doc.fontSize(20).text("Athi Soko Connect — Admin Report", { align: "center" });
      doc.fontSize(10).fillColor("#666")
         .text(`Generated: ${new Date().toLocaleString()}`, { align: "center" });
      doc.moveDown(2).fillColor("#000");

      /* ---- Headline ---- */
      doc.fontSize(14).text("Headline Metrics", { underline: true }).moveDown(0.5);
      Object.entries(data.headline).forEach(([k, v]) => {
        doc.fontSize(10).text(`${k.replace(/_/g, " ")}:  ${v}`);
      });

      /* ---- This month ---- */
      doc.moveDown(1).fontSize(14).text("This Month", { underline: true }).moveDown(0.5);
      Object.entries(data.thisMonth).forEach(([k, v]) => {
        doc.fontSize(10).text(`${k.replace(/_/g, " ")}:  ${v}`);
      });

      /* ---- Active vendors ---- */
      doc.moveDown(1).fontSize(14)
         .text("Active Vendors (last 30 days)", { underline: true }).moveDown(0.5);
      doc.fontSize(10).text(`Active vendors:  ${data.active.vendors_active_30d}`);

      /* ---- Vendors by category ---- */
      doc.moveDown(1).fontSize(14)
         .text("Vendors by Category", { underline: true }).moveDown(0.5);
      data.byCategory.forEach((row) => {
        doc.fontSize(10).text(
          `${row.category}:  ${row.approved_vendors} approved, ${row.pending_vendors} pending`
        );
      });

      /* ---- Monthly trend ---- */
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

module.exports = router;