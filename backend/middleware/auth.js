/* ============================================================
   middleware/auth.js — JWT verification + role / membership checks
   Loaded by any route that needs authentication.

   Super admin passes EVERY role check so it can inspect,
   test, and maintain any part of the system.
   ============================================================ */

const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

/* ------------------------------------------------------------
   requireAuth — verifies the JWT and attaches req.user
   Usage:
     router.get("/protected", requireAuth, (req, res) => {
       res.json({ user: req.user });
     });
   ------------------------------------------------------------ */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token  = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "No token provided. Please log in." });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload; // { id, role, name, ahewa, ... }
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token." });
  }
}

/* ------------------------------------------------------------
   requireRole — allows one or more roles
   Usage:
     router.delete("/:id", requireAuth, requireRole("super-admin"), handler)
     router.post("/",     requireAuth, requireRole("resident", "vendor"), handler)

   Special case:
     Super admin is always allowed, so they can access every
     admin / vendor / resident / security page for system
     integration and maintenance.
   ------------------------------------------------------------ */
function requireRole(...allowed) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated." });
    }

    // Super admin passes every role check
    if (req.user.role === "super-admin") {
      return next();
    }

    if (!allowed.includes(req.user.role)) {
      return res.status(403).json({
        error: "You do not have permission for this action.",
      });
    }

    next();
  };
}

/* ------------------------------------------------------------
   requireAHEWA — user must have AHEWA membership, or be admin.

   Admin / super-admin always pass (they manage AHEWA globally).
   Otherwise, the JWT's `ahewa` flag decides. If the flag isn't
   present (e.g. a token issued before the join_ahewa column
   existed), we fall back to a DB lookup on Residents.join_ahewa.

   Usage:
     router.get("/summary",   requireAuth, requireAHEWA, handler)
     router.post("/:id/rsvp", requireAuth, requireAHEWA, handler)
   ------------------------------------------------------------ */
function requireAHEWA(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "Not authenticated." });
  }

  // Admin / super-admin bypass
  if (req.user.role === "admin" || req.user.role === "super-admin") {
    return next();
  }

  // Trust the JWT flag if it's already set
  if (req.user.ahewa === true || req.user.ahewa === 1) {
    return next();
  }

  // Fallback: hit the DB once (for legacy tokens that predate the flag)
  (async () => {
    try {
      const { getPool } = require("../db");
      const pool = await getPool();

      const r = await pool
        .request()
        .input("id", req.user.id)
        .query("SELECT join_ahewa FROM Residents WHERE id = @id");

      const row = (r.recordset && r.recordset[0]) || null;
      if (row && (row.join_ahewa === true || row.join_ahewa === 1)) {
        req.user.ahewa = true; // cache for this request
        return next();
      }

      return res.status(403).json({
        error: "AHEWA membership required. Join AHEWA from your profile.",
      });
    } catch (err) {
      console.error("[requireAHEWA] lookup failed:", err);
      return res
        .status(500)
        .json({ error: "Could not verify AHEWA membership." });
    }
  })();
}

/* ------------------------------------------------------------
   requireAnyRole — passes if the user's role is in ANY of the
   given whitelists. Useful when an endpoint is shared by several
   unrelated roles but not by everyone.

   Usage:
     requireAnyRole(["admin", "super-admin"], ["security"])
     // passes if role is admin/super-admin OR security
   ------------------------------------------------------------ */
function requireAnyRole(...roleLists) {
  const flat = new Set();
  roleLists.forEach((list) => {
    if (Array.isArray(list)) list.forEach((r) => flat.add(r));
    else flat.add(list);
  });

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated." });
    }
    if (req.user.role === "super-admin") return next();

    if (!flat.has(req.user.role)) {
      return res
        .status(403)
        .json({ error: "You do not have permission for this action." });
    }
    next();
  };
}

module.exports = {
  requireAuth,
  requireRole,
  requireAHEWA,
  requireAnyRole,
  JWT_SECRET,
};