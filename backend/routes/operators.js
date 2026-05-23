const express = require('express');
const { db, log, ledger, audit } = require('../db');
const requireRole = require('../middleware/requireRole');
const bcrypt = require('bcryptjs');
const router = express.Router();

// Get all operator requests
router.get('/requests', requireRole('admin', 'superadmin'), (req, res) => {
  const rows = db.prepare(`
    SELECT r.*, c.name as center_name FROM operator_requests r
    LEFT JOIN print_centers c ON r.center_id = c.id
    ORDER BY r.created_at DESC
  `).all();
  res.json(rows);
});

// Get all approved operators
router.get('/', requireRole('admin', 'superadmin'), (req, res) => {
  const rows = db.prepare(`
    SELECT o.*, c.name as center_name FROM operator_users o
    LEFT JOIN print_centers c ON o.center_id = c.id
    ORDER BY o.created_at DESC
  `).all();
  res.json(rows);
});

// Approve operator request
router.post('/requests/:id/approve', requireRole('admin', 'superadmin'), (req, res) => {
  console.log(`[API] Attempting to approve request with ID/OperatorID: "${req.params.id}"`);
  let request = db.prepare('SELECT * FROM operator_requests WHERE id = ?').get(req.params.id);
  if (!request) {
    request = db.prepare('SELECT * FROM operator_requests WHERE operator_id = ?').get(req.params.id);
  }
  if (!request) {
    console.error(`[API] Approve failed: Request not found for ID/OperatorID "${req.params.id}"`);
    return res.status(404).json({ error: `Request not found (ID: ${req.params.id})` });
  }
  if (request.status !== 'pending') {
    console.warn(`[API] Approve warning: Request with ID/OperatorID "${req.params.id}" already processed (status: ${request.status})`);
    return res.status(400).json({ error: `Request already processed (Status: ${request.status})` });
  }

  db.prepare('UPDATE operator_requests SET status = ?, reviewed_by = ?, reviewed_at = datetime(\'now\') WHERE id = ?')
    .run('approved', req.session.userId, request.id);

  // Create operator user
  const result = db.prepare(
    'INSERT OR IGNORE INTO operator_users (operator_id, full_name, email, phone, center_id, device_id, password_hash, status) VALUES (?,?,?,?,?,?,?,?)'
  ).run(request.operator_id, request.full_name, request.email, request.phone, request.center_id, request.device_id, request.password_hash, 'approved');

  log('admin', req.session.userId, 'operator_approved', 'operator_request', request.id, `Approved operator: ${request.operator_id}`);
  audit('operator_approved', 'admin', req.session.userId, `Operator ${request.operator_id} approved`);
  ledger('operator_approved', 'admin', request.operator_id, 'operator_users', { operatorId: request.operator_id, approvedBy: req.session.userId });
  
  console.log(`[API] Successfully approved operator request for ID/OperatorID "${req.params.id}"`);
  res.json({ success: true });
});

// Reject operator request
router.post('/requests/:id/reject', requireRole('admin', 'superadmin'), (req, res) => {
  console.log(`[API] Attempting to reject request with ID/OperatorID: "${req.params.id}"`);
  let request = db.prepare('SELECT * FROM operator_requests WHERE id = ?').get(req.params.id);
  if (!request) {
    request = db.prepare('SELECT * FROM operator_requests WHERE operator_id = ?').get(req.params.id);
  }
  if (!request) {
    console.error(`[API] Reject failed: Request not found for ID/OperatorID "${req.params.id}"`);
    return res.status(404).json({ error: `Request not found (ID: ${req.params.id})` });
  }

  db.prepare('UPDATE operator_requests SET status = ?, reviewed_by = ?, reviewed_at = datetime(\'now\') WHERE id = ?')
    .run('rejected', req.session.userId, request.id);

  log('admin', req.session.userId, 'operator_rejected', 'operator_request', request.id, `Rejected operator: ${request.operator_id}`);
  audit('operator_rejected', 'admin', req.session.userId, `Operator ${request.operator_id} rejected`);
  
  console.log(`[API] Successfully rejected operator request for ID/OperatorID "${req.params.id}"`);
  res.json({ success: true });
});

// Suspend operator
router.post('/:id/suspend', requireRole('admin', 'superadmin'), (req, res) => {
  console.log(`[API] Attempting to suspend operator with ID/OperatorID: "${req.params.id}"`);
  let op = db.prepare('SELECT * FROM operator_users WHERE id = ?').get(req.params.id);
  if (!op) {
    op = db.prepare('SELECT * FROM operator_users WHERE operator_id = ?').get(req.params.id);
  }
  if (!op) {
    console.error(`[API] Suspend failed: Operator not found for ID/OperatorID "${req.params.id}"`);
    return res.status(404).json({ error: `Operator not found (ID: ${req.params.id})` });
  }

  db.prepare('UPDATE operator_users SET status = ? WHERE id = ?').run('suspended', op.id);
  log('admin', req.session.userId, 'operator_suspended', 'operator_user', op.id, `Suspended operator: ${op.operator_id}`);
  audit('operator_suspended', 'admin', req.session.userId, `Operator ${op.operator_id} suspended`);
  
  console.log(`[API] Successfully suspended operator for ID/OperatorID "${req.params.id}"`);
  res.json({ success: true });
});

// Reassign zone/center
router.post('/:id/reassign', requireRole('admin', 'superadmin'), (req, res) => {
  const { center_id } = req.body;
  if (!center_id) return res.status(400).json({ error: 'center_id required' });

  console.log(`[API] Attempting to reassign operator with ID/OperatorID: "${req.params.id}" to center ${center_id}`);
  let op = db.prepare('SELECT * FROM operator_users WHERE id = ?').get(req.params.id);
  if (!op) {
    op = db.prepare('SELECT * FROM operator_users WHERE operator_id = ?').get(req.params.id);
  }
  if (!op) {
    console.error(`[API] Reassign failed: Operator not found for ID/OperatorID "${req.params.id}"`);
    return res.status(404).json({ error: `Operator not found (ID: ${req.params.id})` });
  }

  db.prepare('UPDATE operator_users SET center_id = ? WHERE id = ?').run(center_id, op.id);
  log('admin', req.session.userId, 'operator_reassigned', 'operator_user', op.id, `Reassigned to center ${center_id}`);
  res.json({ success: true });
});

// Get operator's own profile
router.get('/me', requireRole('operator'), (req, res) => {
  const op = db.prepare('SELECT o.*, c.name as center_name FROM operator_users o LEFT JOIN print_centers c ON o.center_id = c.id WHERE o.id = ?').get(req.session.userId);
  if (!op) return res.status(404).json({ error: 'Not found' });
  res.json(op);
});

module.exports = router;
