const express = require('express');
const { db, log } = require('../db');
const requireRole = require('../middleware/requireRole');
const router = express.Router();

// Get all centers
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM print_centers ORDER BY name').all();
  res.json(rows);
});

// Create center
router.post('/', requireRole('admin', 'superadmin'), (req, res) => {
  const { name, zone, region, address } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const result = db.prepare('INSERT INTO print_centers (name, zone, region, address) VALUES (?,?,?,?)').run(name, zone || null, region || null, address || null);
  log('admin', req.session.userId, 'center_created', 'print_center', result.lastInsertRowid, `Center created: ${name}`);
  res.json({ success: true, id: result.lastInsertRowid });
});

// Get print nodes
router.get('/nodes', (req, res) => {
  const rows = db.prepare(`
    SELECT n.*, c.name as center_name FROM print_nodes n
    LEFT JOIN print_centers c ON n.center_id = c.id
    ORDER BY n.created_at DESC
  `).all();
  res.json(rows);
});

// Create print node
router.post('/nodes', requireRole('admin', 'superadmin'), (req, res) => {
  const { node_name, center_id, printer_id } = req.body;
  if (!node_name || !printer_id) return res.status(400).json({ error: 'node_name and printer_id required' });
  const result = db.prepare('INSERT INTO print_nodes (node_name, center_id, printer_id, status, last_sync) VALUES (?,?,?,?,datetime(\'now\'))').run(node_name, center_id || null, printer_id, 'online');
  log('admin', req.session.userId, 'node_created', 'print_node', result.lastInsertRowid, `Node created: ${node_name}`);
  res.json({ success: true, id: result.lastInsertRowid });
});

// Node action: enable/disable/restart/test
router.post('/nodes/:id/action', requireRole('admin', 'superadmin'), (req, res) => {
  const { action } = req.body;
  const node = db.prepare('SELECT * FROM print_nodes WHERE id = ?').get(req.params.id);
  if (!node) return res.status(404).json({ error: 'Node not found' });

  if (action === 'enable') {
    db.prepare('UPDATE print_nodes SET enabled = 1, status = \'online\', last_sync = datetime(\'now\') WHERE id = ?').run(req.params.id);
  } else if (action === 'disable') {
    db.prepare('UPDATE print_nodes SET enabled = 0, status = \'offline\' WHERE id = ?').run(req.params.id);
  } else if (action === 'restart') {
    db.prepare('UPDATE print_nodes SET status = \'online\', queue_length = 0, last_sync = datetime(\'now\') WHERE id = ?').run(req.params.id);
  } else if (action === 'test') {
    db.prepare('INSERT INTO telemetry (node_id, printer_id, metric, value) VALUES (?,?,?,?)').run(node.id, node.printer_id, 'test_print', 'ok');
    db.prepare('UPDATE print_nodes SET last_sync = datetime(\'now\') WHERE id = ?').run(req.params.id);
  } else {
    return res.status(400).json({ error: 'Unknown action' });
  }

  log('admin', req.session.userId, `node_${action}`, 'print_node', req.params.id, `Node ${action}: ${node.node_name}`);
  res.json({ success: true });
});

// Get telemetry
router.get('/nodes/:id/telemetry', requireRole('admin', 'superadmin'), (req, res) => {
  const rows = db.prepare('SELECT * FROM telemetry WHERE node_id = ? ORDER BY recorded_at DESC LIMIT 50').all(req.params.id);
  res.json(rows);
});

module.exports = router;
