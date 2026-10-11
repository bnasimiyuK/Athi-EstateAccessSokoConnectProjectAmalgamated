/* ============================================================
   routes/super-admin.js — super admin endpoints
   Only users with role === "super-admin" can access these.
   ============================================================ */
const express = require('express');
const bcrypt  = require('bcryptjs');
const router  = express.Router();
const { getPool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const BCRYPT_ROUNDS = 10;

/* Every route requires super-admin auth */
router.use(requireAuth, (req, res, next) => {
  if (!req.user || req.user.role !== 'super-admin') {
    return res.status(403).json({ error: 'Super-admin access required' });
  }
  next();
});

/* ============================================================
   ADMINS
   ============================================================ */

router.get('/admins', async (req, res, next) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query(
      'SELECT id, full_name, email, role, created_at FROM Admins ORDER BY id'
    );
    res.json({ data: r.recordset });
  } catch (err) { next(err); }
});

router.post('/admins', async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'name, email, and password are required.' });
    }

    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const pool = await getPool();

    // Prevent duplicate emails
    const dup = await pool.request()
      .input('email', email.trim().toLowerCase())
      .query('SELECT id FROM Admins WHERE LOWER(email) = @email');
    if (dup.recordset.length) {
      return res.status(409).json({ error: 'An admin with that email already exists.' });
    }

    const r = await pool.request()
      .input('full_name', name.trim())
      .input('email',     email.trim().toLowerCase())
      .input('hash',      hash)
      .query(`INSERT INTO Admins (full_name, email, password_hash, must_change_password, role)
              OUTPUT INSERTED.id, INSERTED.full_name, INSERTED.email
              VALUES (@full_name, @email, @hash, 0, 'admin')`);

    res.status(201).json({ admin: r.recordset[0] });
  } catch (err) { next(err); }
});

router.delete('/admins/:id', async (req, res, next) => {
  try {
    const pool = await getPool();
    await pool.request().input('id', req.params.id)
      .query('DELETE FROM Admins WHERE id = @id');
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ============================================================
   CATEGORIES — full CRUD
   ============================================================ */

router.get('/categories', async (req, res, next) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query(
      'SELECT id, label, icon FROM Categories ORDER BY id'
    );
    res.json({ data: r.recordset });
  } catch (err) { next(err); }
});

router.post('/categories', async (req, res, next) => {
  try {
    const { label, icon } = req.body;
    if (!label || !label.trim()) {
      return res.status(400).json({ error: 'Label is required.' });
    }

    const pool = await getPool();

    // Prevent duplicate labels (case-insensitive)
    const dup = await pool.request()
      .input('label', label.trim())
      .query('SELECT id FROM Categories WHERE LOWER(label) = LOWER(@label)');
    if (dup.recordset.length) {
      return res.status(409).json({ error: 'A category with that label already exists.' });
    }

    const r = await pool.request()
      .input('label', label.trim())
      .input('icon',  icon || null)
      .query(`INSERT INTO Categories (label, icon)
              OUTPUT INSERTED.id, INSERTED.label, INSERTED.icon
              VALUES (@label, @icon)`);

    res.status(201).json({ category: r.recordset[0] });
  } catch (err) { next(err); }
});

router.patch('/categories/:id', async (req, res, next) => {
  try {
    const { label, icon } = req.body;
    const pool = await getPool();

    const sets = [];
    const request = pool.request().input('id', req.params.id);

    if (label !== undefined) {
      if (!label || !label.trim()) {
        return res.status(400).json({ error: 'Label cannot be empty.' });
      }
      sets.push('label = @label');
      request.input('label', label.trim());
    }

    if (icon !== undefined) {
      sets.push('icon = @icon');
      request.input('icon', icon || null);
    }

    if (!sets.length) {
      return res.status(400).json({ error: 'Nothing to update.' });
    }

    await request.query(
      `UPDATE Categories SET ${sets.join(', ')} WHERE id = @id`
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/categories/:id', async (req, res, next) => {
  try {
    const pool = await getPool();
    const inUse = await pool.request()
      .input('id', req.params.id)
      .query('SELECT COUNT(*) AS n FROM Providers WHERE category_id = @id');

    if (inUse.recordset[0].n > 0) {
      return res.status(409).json({
        error: `Cannot delete: ${inUse.recordset[0].n} provider(s) still use this category.`
      });
    }

    await pool.request().input('id', req.params.id)
      .query('DELETE FROM Categories WHERE id = @id');
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ============================================================
   PROVIDERS
   ============================================================ */

router.get('/providers', async (req, res, next) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query(
      'SELECT id, name, category_id, phone, verified, rating, avatar FROM Providers ORDER BY id'
    );
    res.json({ data: r.recordset });
  } catch (err) { next(err); }
});

router.delete('/providers/:id', async (req, res, next) => {
  try {
    const pool = await getPool();
    await pool.request().input('id', req.params.id)
      .query('DELETE FROM Providers WHERE id = @id');
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ============================================================
   RESIDENTS
   ============================================================ */

router.get('/residents', async (req, res, next) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query(
      'SELECT id, full_name, phone, email, court_id, house_number, verified FROM Residents ORDER BY id'
    );
    res.json({ data: r.recordset });
  } catch (err) { next(err); }
});

router.delete('/residents/:id', async (req, res, next) => {
  try {
    const pool = await getPool();
    await pool.request().input('id', req.params.id)
      .query('DELETE FROM Residents WHERE id = @id');
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;