const express = require('express');
const bcrypt = require('bcryptjs');
const { db, log, audit, securityEvent } = require('../db');
const router = express.Router();

// Admin login
router.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const admin = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    audit('login_failed', 'admin', null, `Failed login attempt for username: ${username}`);
    securityEvent('login_failed', null, `Failed login attempt for admin username: ${username}`);
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  req.session.userId = admin.id;
  req.session.role = admin.role;
  req.session.username = admin.username;
  log('admin', admin.id, 'login_success', 'admin_user', admin.id, `Admin ${admin.username} logged in`);
  securityEvent('login_success', admin.id, `Admin ${admin.username} logged in successfully`);
  res.json({ success: true, role: admin.role, username: admin.username });
});

// Admin logout
router.post('/admin/logout', (req, res) => {
  const id = req.session.userId;
  req.session.destroy();
  log('admin', id, 'logout', 'admin_user', id, 'Admin logged out');
  res.json({ success: true });
});

// Operator signup
router.post('/operator/signup', (req, res) => {
  const { operator_id, full_name, email, phone, center_id, device_id, password } = req.body;
  if (!operator_id || !full_name || !password) return res.status(400).json({ error: 'operator_id, full_name, and password required' });

  const existing = db.prepare('SELECT id FROM operator_requests WHERE operator_id = ?').get(operator_id);
  if (existing) return res.status(409).json({ error: 'Operator ID already submitted' });

  const existingUser = db.prepare('SELECT id FROM operator_users WHERE operator_id = ?').get(operator_id);
  if (existingUser) return res.status(409).json({ error: 'Operator ID already registered' });

  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare(
    'INSERT INTO operator_requests (operator_id, full_name, email, phone, center_id, device_id, password_hash) VALUES (?,?,?,?,?,?,?)'
  ).run(operator_id, full_name, email || null, phone || null, center_id || null, device_id || null, hash);

  log('operator', null, 'signup_request', 'operator_request', result.lastInsertRowid, `New operator signup: ${operator_id}`);
  audit('operator_signup', 'operator', null, `Operator signup request: ${operator_id}`);
  res.json({ success: true, requestId: result.lastInsertRowid });
});

// Operator login
router.post('/operator/login', (req, res) => {
  const { operator_id, password } = req.body;
  if (!operator_id || !password) return res.status(400).json({ error: 'operator_id and password required' });

  const op = db.prepare('SELECT * FROM operator_users WHERE operator_id = ?').get(operator_id);
  if (!op) {
    // Check if pending
    const pending = db.prepare('SELECT status FROM operator_requests WHERE operator_id = ?').get(operator_id);
    if (pending) {
      securityEvent('login_failed_pending', null, `Operator ${operator_id} attempted login but status is pending`);
      return res.status(403).json({ error: 'pending', status: pending.status });
    }
    securityEvent('login_failed_not_found', null, `Operator ${operator_id} attempted login but operator does not exist`);
    return res.status(401).json({ error: 'Operator not found' });
  }

  if (op.status !== 'approved') {
    securityEvent('login_failed_suspended', op.id, `Operator ${operator_id} attempted login but status is ${op.status}`);
    return res.status(403).json({ error: op.status, status: op.status });
  }
  if (!bcrypt.compareSync(password, op.password_hash)) {
    audit('login_failed', 'operator', op.id, `Failed login for operator: ${operator_id}`);
    securityEvent('login_failed', op.id, `Failed login attempt for operator: ${operator_id}`);
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  req.session.userId = op.id;
  req.session.role = 'operator';
  req.session.operatorId = op.operator_id;
  log('operator', op.id, 'login_success', 'operator_user', op.id, `Operator ${op.operator_id} logged in`);
  securityEvent('login_success', op.id, `Operator ${op.operator_id} logged in successfully`);
  res.json({ success: true, role: 'operator', operatorId: op.operator_id, name: op.full_name });
});

// Operator logout
router.post('/operator/logout', (req, res) => {
  const id = req.session.userId;
  req.session.destroy();
  log('operator', id, 'logout', 'operator_user', id, 'Operator logged out');
  res.json({ success: true });
});

// Check operator request status
router.get('/operator/status/:operatorId', (req, res) => {
  const req2 = db.prepare('SELECT status, created_at FROM operator_requests WHERE operator_id = ?').get(req.params.operatorId);
  if (!req2) return res.status(404).json({ error: 'Not found' });
  res.json(req2);
});

// Session check
router.get('/session', (req, res) => {
  if (!req.session.userId) return res.json({ authenticated: false });
  res.json({ authenticated: true, role: req.session.role, userId: req.session.userId, username: req.session.username, operatorId: req.session.operatorId });
});

module.exports = router;
