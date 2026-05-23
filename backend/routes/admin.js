const express = require('express');
const { db, log, ledger, audit, securityEvent } = require('../db');
const requireRole = require('../middleware/requireRole');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

// ---- BOUNTY ----
router.get('/bounty', requireRole('admin', 'superadmin'), (req, res) => {
  const rows = db.prepare(`
    SELECT bc.*, lc.id as leak_case_id, lc.case_ref, lc.reporter_name, lc.confidence_score, lc.file_path, lc.created_at as case_date
    FROM bounty_cases bc
    LEFT JOIN leak_cases lc ON bc.case_id = lc.id
    ORDER BY bc.created_at DESC
  `).all();
  res.json(rows);
});

router.post('/bounty/:id/action', requireRole('admin', 'superadmin'), async (req, res) => {
  const { action, reward_amount, notes } = req.body;
  const bc = db.prepare('SELECT * FROM bounty_cases WHERE id = ?').get(req.params.id);
  if (!bc) return res.status(404).json({ error: 'Bounty case not found' });

  if (!['approve', 'reject', 'escalate'].includes(action)) return res.status(400).json({ error: 'Invalid action' });

  const statusMap = { approve: 'approved', reject: 'rejected', escalate: 'escalated' };
  db.prepare('UPDATE bounty_cases SET status = ?, reviewed_by = ?, reviewed_at = datetime(\'now\'), reward_amount = ? WHERE id = ?')
    .run(statusMap[action], req.session.userId, reward_amount || bc.reward_amount, req.params.id);

  db.prepare('INSERT INTO bounty_submissions (bounty_case_id, action, actor_id, notes) VALUES (?,?,?,?)').run(bc.id, action, req.session.userId, notes || null);

  let ugfTxHash = null;
  if (action === 'approve') {
    // UGF Integration
    try {
      const ugf = require('../ugf');
      const ugfResult = await ugf.claimReward(bc.id, req.session.userId);
      if (ugfResult.success) {
        ugfTxHash = ugfResult.txHash;
        db.prepare('INSERT INTO ugf_transactions (bounty_case_id, tx_hash, amount, status, related_type, related_id) VALUES (?,?,?,?,?,?)')
          .run(bc.id, ugfTxHash, reward_amount || ugfResult.amount || 0.05, 'settled', 'bounty_approved', bc.id);
      } else {
        return res.status(500).json({ error: `UGF claimReward Failed: ${ugfResult.error}` });
      }
    } catch (err) {
      console.error('[UGF] claimReward transaction error:', err.message);
      return res.status(500).json({ error: `UGF claimReward Error: ${err.message}` });
    }
    ledger('bounty_approved', 'admin', bc.id, 'bounty_cases', { bountyId: bc.id, txHash: ugfTxHash, amount: reward_amount });
  }

  log('admin', req.session.userId, `bounty_${action}`, 'bounty_case', bc.id, `Bounty case ${bc.id} ${action}`);
  res.json({ success: true, ugfTxHash, ugfMode: typeof ugfResult !== 'undefined' ? ugfResult.mode : 'simulated' });
});

// ---- LEDGER ----
router.get('/ledger', requireRole('admin', 'superadmin'), (req, res) => {
  const { search, type, from, to } = req.query;
  let query = 'SELECT * FROM ledger_records WHERE 1=1';
  const params = [];
  if (search) { query += ' AND (reference_id LIKE ? OR proof_hash LIKE ? OR payload LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  if (type) { query += ' AND record_type = ?'; params.push(type); }
  if (from) { query += ' AND created_at >= ?'; params.push(from); }
  if (to) { query += ' AND created_at <= ?'; params.push(to); }
  query += ' ORDER BY created_at DESC LIMIT 200';
  res.json(db.prepare(query).all(...params));
});

// GET ledger record by ID
router.get('/ledger/:id', requireRole('admin', 'superadmin'), (req, res) => {
  const row = db.prepare('SELECT * FROM ledger_records WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Record not found' });
  res.json(row);
});

// ---- ACTIVITY ----
router.get('/activity', requireRole('admin', 'superadmin'), (req, res) => {
  const rows = db.prepare('SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT 100').all();
  res.json(rows);
});

// ---- AUDIT ----
router.get('/audit', requireRole('admin', 'superadmin'), (req, res) => {
  const rows = db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100').all();
  res.json(rows);
});

router.post('/audit/:id/action', requireRole('admin', 'superadmin'), (req, res) => {
  const { action } = req.body;
  const entry = db.prepare('SELECT * FROM audit_logs WHERE id = ?').get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'Not found' });

  if (action === 'flag') db.prepare('UPDATE audit_logs SET flagged = 1 WHERE id = ?').run(req.params.id);
  else if (action === 'escalate') db.prepare('UPDATE audit_logs SET escalated = 1, status = \'escalated\' WHERE id = ?').run(req.params.id);
  else if (action === 'freeze') db.prepare('UPDATE audit_logs SET frozen = 1, status = \'frozen\' WHERE id = ?').run(req.params.id);
  else if (action === 'verify') db.prepare('UPDATE audit_logs SET status = \'verified\' WHERE id = ?').run(req.params.id);
  else return res.status(400).json({ error: 'Invalid action' });

  log('admin', req.session.userId, `audit_${action}`, 'audit_log', req.params.id, `Audit entry ${req.params.id} ${action}`);
  res.json({ success: true });
});

// ---- SECURITY SETTINGS ----
router.get('/security', requireRole('admin', 'superadmin'), (req, res) => {
  const rows = db.prepare('SELECT * FROM system_settings').all();
  const settings = {};
  rows.forEach(r => settings[r.key] = r.value);
  res.json(settings);
});

router.post('/security', requireRole('admin', 'superadmin'), (req, res) => {
  const allowed = ['screenshot_blocking', 'watermarking', 'blockchain_logging', 'export_restriction', 'session_timeout', 'lockdown'];
  for (const [k, v] of Object.entries(req.body)) {
    if (allowed.includes(k)) {
      db.prepare('INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES (?, ?, datetime(\'now\'))').run(k, String(v));
    }
  }
  log('admin', req.session.userId, 'security_settings_updated', 'system_settings', null, 'Security settings updated');
  audit('security_settings_updated', 'admin', req.session.userId, 'Security settings updated');
  securityEvent('security_settings_updated', req.session.userId, `Security settings updated: ${Object.keys(req.body).join(', ')}`);
  res.json({ success: true });
});

router.post('/security/lockdown', requireRole('admin', 'superadmin'), (req, res) => {
  const { action } = req.body;
  const val = action === 'lock' ? 'true' : 'false';
  db.prepare('INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES (?, ?, datetime(\'now\'))').run('lockdown', val);
  log('admin', req.session.userId, `system_${action}`, 'system_settings', null, `System ${action}down activated`);
  audit(`system_${action}down`, 'admin', req.session.userId, `System ${action}down by admin`);
  securityEvent(`system_${action}down`, req.session.userId, `System ${action}down activated by admin`);
  res.json({ success: true });
});

router.post('/security/revoke-token', requireRole('admin', 'superadmin'), (req, res) => {
  const { user_id, role } = req.body;
  // In session-based auth, we mark the user as suspended
  if (role === 'operator' && user_id) {
    db.prepare('UPDATE operator_users SET status = \'suspended\' WHERE id = ?').run(user_id);
  }
  log('admin', req.session.userId, 'token_revoked', role, user_id, `Token/session revoked for ${role} ${user_id}`);
  audit('token_revoked', 'admin', req.session.userId, `Session revoked for ${role} ID ${user_id}`);
  securityEvent('token_revoked', req.session.userId, `Session/token revoked for ${role} user ID ${user_id}`);
  res.json({ success: true });
});

// GET security events
router.get('/security/events', requireRole('admin', 'superadmin'), (req, res) => {
  const rows = db.prepare('SELECT * FROM security_events ORDER BY created_at DESC LIMIT 100').all();
  res.json(rows);
});

// ---- DASHBOARD COUNTERS ----
router.get('/dashboard/counters', requireRole('admin', 'superadmin'), (req, res) => {
  res.json({
    total_centers: db.prepare('SELECT COUNT(*) as c FROM print_centers').get().c,
    total_operators: db.prepare('SELECT COUNT(*) as c FROM operator_users WHERE status = \'approved\'').get().c,
    active_jobs: db.prepare('SELECT COUNT(*) as c FROM print_jobs WHERE status IN (\'printing\', \'dispatched\', \'generated\')').get().c,
    pending_approvals: db.prepare('SELECT COUNT(*) as c FROM operator_requests WHERE status = \'pending\'').get().c,
    recent_leaks: db.prepare('SELECT COUNT(*) as c FROM leak_cases WHERE created_at >= datetime(\'now\', \'-7 days\')').get().c,
    ledger_events: db.prepare('SELECT COUNT(*) as c FROM ledger_records').get().c,
    total_jobs: db.prepare('SELECT COUNT(*) as c FROM print_jobs').get().c,
    active_operators: db.prepare('SELECT COUNT(*) as c FROM operator_users WHERE status = \'approved\'').get().c,
    pending_leaks: db.prepare('SELECT COUNT(*) as c FROM leak_cases WHERE status = \'submitted\'').get().c
  });
});

module.exports = router;
