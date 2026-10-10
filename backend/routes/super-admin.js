const express = require('express');
const bcrypt  = require('bcryptjs');
const router  = express.Router();
const { getPool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const BCRYPT_ROUNDS = 10;

router.use(requireAuth, (req, res, next) => {
  if (!req.user || req.user.role !== 'super-admin') {
    return res.status(403).json({ error: 'Super-admin access required' });
  }
  next();
});

router.get('/admins', async (req, res, next) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query('SELECT id, full_name, email, role, created_at FROM Admins ORDER BY id');
    res.json({ data: r.recordset });
  } catch (err) { next(err); }
});

router.post('/admins', async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'name, email, password required' });
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const pool = await getPool();
    const r = await pool.request()
      .input('name', name).input('email', email).input('hash', hash)
      .query('INSERT INTO Admins (name, email, passwordHash) OUTPUT INSERTED.id, INSERTED.name, INSERTED.email VALUES (@name, @email, @hash)');
    res.json({ admin: r.recordset[0] });
  } catch (err) { next(err); }
});

router.delete('/admins/:id', async (req, res, next) => {
  try {
    const pool = await getPool();
    await pool.request().input('id', req.params.id).query('DELETE FROM Admins WHERE id = @id');
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get('/categories', async (req, res, next) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query('SELECT id, label FROM Categories ORDER BY id');
    res.json({ data: r.recordset });
  } catch (err) { next(err); }
});

router.delete('/categories/:id', async (req, res, next) => {
  try {
    const pool = await getPool();
    const inUse = await pool.request().input('id', req.params.id).query('SELECT COUNT(*) AS n FROM Providers WHERE category_id = @id');
    if (inUse.recordset[0].n > 0) return res.status(409).json({ error: 'Category has providers' });
    await pool.request().input('id', req.params.id).query('DELETE FROM Categories WHERE id = @id');
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get('/providers', async (req, res, next) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query('SELECT id, name, category_id, phone, verified, rating, avatar FROM Providers ORDER BY id');
    res.json({ data: r.recordset });
  } catch (err) { next(err); }
});

router.delete('/providers/:id', async (req, res, next) => {
  try {
    const pool = await getPool();
    await pool.request().input('id', req.params.id).query('DELETE FROM Providers WHERE id = @id');
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get('/residents', async (req, res, next) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query('SELECT id, full_name, phone, email, court_id, house_number, verified FROM Residents ORDER BY id');
    res.json({ data: r.recordset });
  } catch (err) { next(err); }
});

router.delete('/residents/:id', async (req, res, next) => {
  try {
    const pool = await getPool();
    await pool.request().input('id', req.params.id).query('DELETE FROM Residents WHERE id = @id');
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;