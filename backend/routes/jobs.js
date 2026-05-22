const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { db, log, ledger, audit } = require('../db');
const { embedForensicMarkers, generateForensicId } = require('../pdf_forensics');
const requireRole = require('../middleware/requireRole');
const router = express.Router();

const GENERATED_DIR = path.join(__dirname, '..', '..', 'uploads', 'generated');

// Get all jobs
router.get('/', requireRole('admin', 'superadmin', 'operator'), (req, res) => {
  let query = `
    SELECT j.*, c.name as center_name, o.full_name as operator_name, o.operator_id as op_ref
    FROM print_jobs j
    LEFT JOIN print_centers c ON j.center_id = c.id
    LEFT JOIN operator_users o ON j.operator_id = o.id
  `;
  const params = [];
  if (req.session.role === 'operator') {
    query += ' WHERE j.operator_id = ?';
    params.push(req.session.userId);
  }
  query += ' ORDER BY j.created_at DESC LIMIT 50';
  res.json(db.prepare(query).all(...params));
});

// Generate job + encoded copies
router.post('/generate', requireRole('admin', 'superadmin'), async (req, res) => {
  const { center_id, operator_id, copies_count, master_file, forensic_settings } = req.body;
  if (!center_id || !operator_id || !master_file) {
    return res.status(400).json({ error: 'center_id, operator_id, and master_file required' });
  }

  const count = parseInt(copies_count) || 1;
  const jobRef = `JOB-${uuidv4().substring(0, 8).toUpperCase()}`;
  const batchRef = `BATCH-${uuidv4().substring(0, 8).toUpperCase()}`;

  // Create batch
  const batchResult = db.prepare(
    'INSERT INTO dispatch_batches (batch_ref, center_id, operator_id, total_copies, status) VALUES (?,?,?,?,?)'
  ).run(batchRef, center_id, operator_id, count, 'generating');

  const batchId = batchResult.lastInsertRowid;

  // Create job
  const jobResult = db.prepare(
    'INSERT INTO print_jobs (job_ref, batch_id, operator_id, center_id, master_file, status, copies_count) VALUES (?,?,?,?,?,?,?)'
  ).run(jobRef, batchId, operator_id, center_id, master_file, 'generated', count);

  const jobId = jobResult.lastInsertRowid;

  // Update batch with job_id
  db.prepare('UPDATE dispatch_batches SET job_id = ? WHERE id = ?').run(jobId, batchId);

  // Get center and operator info for watermark
  const center = db.prepare('SELECT * FROM print_centers WHERE id = ?').get(center_id);
  const operator = db.prepare('SELECT * FROM operator_users WHERE id = ?').get(operator_id);

  const sourcePath = path.join(__dirname, '..', '..', 'uploads', 'original', master_file);
  const jobDir = path.join(GENERATED_DIR, String(jobId));
  if (!fs.existsSync(jobDir)) fs.mkdirSync(jobDir, { recursive: true });

  const sourceExists = fs.existsSync(sourcePath);
  console.log(`[jobs] Source: ${sourcePath} | exists: ${sourceExists}`);

  const generatedFiles = [];

  for (let i = 1; i <= count; i++) {
    const forensicId = generateForensicId(jobId, i, batchId);
    const payload = {
      forensicId,
      jobId,
      jobRef,
      batchId,
      batchRef,
      copyNumber: i,
      operatorId: operator?.operator_id || 'UNKNOWN',
      operatorName: operator?.full_name || 'UNKNOWN',
      centerId: center_id,
      centerName: center?.name || 'UNKNOWN',
      generatedAt: new Date().toISOString()
    };

    const outFilename = `copy_${i}_${forensicId}.pdf`;
    const outPath = path.join(jobDir, outFilename);

    try {
      const result = await embedForensicMarkers(sourcePath, outPath, payload);
      console.log(`[jobs] Copy ${i} generated: ${outFilename} | layers: ${result.layers?.join(',')} | placeholder: ${result.usedPlaceholder}`);

      const copyResult = db.prepare(
        'INSERT INTO print_copies (job_id, batch_id, copy_number, file_path, forensic_id, status) VALUES (?,?,?,?,?,?)'
      ).run(jobId, batchId, i, `generated/${jobId}/${outFilename}`, forensicId, 'generated');

      db.prepare(
        'INSERT INTO forensic_copies (copy_id, job_id, batch_id, operator_id, center_id, forensic_payload, encoding_method) VALUES (?,?,?,?,?,?,?)'
      ).run(copyResult.lastInsertRowid, jobId, batchId, operator_id, center_id, JSON.stringify(payload), '3layer_border_metadata');

      generatedFiles.push({ copyNumber: i, forensicId, filename: outFilename, proofHash: result.proofHash, checksum: result.checksum, usedPlaceholder: result.usedPlaceholder });
    } catch (err) {
      console.error(`[jobs] ERROR generating copy ${i}:`, err.message, err.stack);
    }
  }

  db.prepare('UPDATE dispatch_batches SET status = ? WHERE id = ?').run('ready', batchId);

  // UGF Integration
  let ugfTxHash = null;
  try {
    const ugf = require('../ugf');
    const ugfResult = await ugf.createJob(jobRef, count, req.session.userId);
    if (ugfResult.success) {
      ugfTxHash = ugfResult.txHash;
      db.prepare('INSERT INTO ugf_transactions (bounty_case_id, tx_hash, amount, status, related_type, related_id) VALUES (?,?,?,?,?,?)')
        .run(null, ugfTxHash, ugfResult.amount, 'settled', 'job_created', jobId);
    } else {
      return res.status(500).json({ error: `UGF createJob Failed: ${ugfResult.error}` });
    }
  } catch (err) {
    console.error('[UGF] createJob transaction error:', err.message);
    return res.status(500).json({ error: `UGF createJob Error: ${err.message}` });
  }

  log('admin', req.session.userId, 'job_generated', 'print_job', jobId, `Generated job ${jobRef} with ${count} copies`);
  ledger('job_generated', 'admin', jobRef, 'print_jobs', { jobRef, batchRef, copies: count, center: center?.name, operator: operator?.operator_id, ugfTxHash });
  audit('job_generated', 'admin', req.session.userId, `Job ${jobRef} generated with ${count} encoded copies`);

  res.json({ success: true, jobId, jobRef, batchId, batchRef, generatedFiles, ugfTxHash });
});

// Dispatch job
router.post('/:id/dispatch', requireRole('admin', 'superadmin'), async (req, res) => {
  const job = db.prepare('SELECT * FROM print_jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  // UGF Integration
  let ugfTxHash = null;
  try {
    const ugf = require('../ugf');
    const ugfResult = await ugf.assignJob(job.id, job.operator_id, req.session.userId);
    if (ugfResult.success) {
      ugfTxHash = ugfResult.txHash;
      db.prepare('INSERT INTO ugf_transactions (bounty_case_id, tx_hash, amount, status, related_type, related_id) VALUES (?,?,?,?,?,?)')
        .run(null, ugfTxHash, ugfResult.amount, 'settled', 'job_dispatched', job.id);
    } else {
      return res.status(500).json({ error: `UGF assignJob Failed: ${ugfResult.error}` });
    }
  } catch (err) {
    console.error('[UGF] assignJob transaction error:', err.message);
    return res.status(500).json({ error: `UGF assignJob Error: ${err.message}` });
  }

  const result = db.prepare(
    'INSERT INTO dispatches (batch_id, job_id, operator_id, center_id, status) VALUES (?,?,?,?,?)'
  ).run(job.batch_id, job.id, job.operator_id, job.center_id, 'dispatched');

  db.prepare('UPDATE print_jobs SET status = ? WHERE id = ?').run('dispatched', job.id);
  db.prepare('UPDATE dispatch_batches SET status = ? WHERE id = ?').run('dispatched', job.batch_id);

  log('admin', req.session.userId, 'job_dispatched', 'print_job', job.id, `Dispatched job ${job.job_ref}`);
  ledger('job_dispatched', 'admin', job.job_ref, 'dispatches', { jobRef: job.job_ref, dispatchId: result.lastInsertRowid, ugfTxHash });
  res.json({ success: true, dispatchId: result.lastInsertRowid, ugfTxHash });
});

// Job action (operator: start/pause/resume/complete)
router.post('/:id/action', requireRole('operator', 'admin', 'superadmin'), async (req, res) => {
  const { action } = req.body;

  // Check lockdown setting
  const lockdownSetting = db.prepare("SELECT value FROM system_settings WHERE key = 'lockdown'").get();
  if (lockdownSetting && lockdownSetting.value === 'true' && req.session.role === 'operator') {
    return res.status(403).json({ error: 'System is currently under lockdown. Operations are suspended.' });
  }

  const job = db.prepare('SELECT * FROM print_jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  if (req.session.role === 'operator' && job.operator_id !== req.session.userId) {
    return res.status(403).json({ error: 'Not your job' });
  }

  const validTransitions = {
    start: ['dispatched', 'pending'],
    pause: ['printing'],
    resume: ['paused'],
    complete: ['printing', 'paused']
  };

  if (!validTransitions[action]) return res.status(400).json({ error: 'Invalid action' });
  if (!validTransitions[action].includes(job.status)) {
    return res.status(400).json({ error: `Cannot ${action} a job with status: ${job.status}` });
  }

  const statusMap = { start: 'printing', pause: 'paused', resume: 'printing', complete: 'completed' };
  const newStatus = statusMap[action];

  // UGF Integration for start/accept
  let ugfTxHash = null;
  if (action === 'start') {
    try {
      const ugf = require('../ugf');
      const ugfResult = await ugf.acceptJob(job.id, job.operator_id);
      if (ugfResult.success) {
        ugfTxHash = ugfResult.txHash;
        db.prepare('INSERT INTO ugf_transactions (bounty_case_id, tx_hash, amount, status, related_type, related_id) VALUES (?,?,?,?,?,?)')
          .run(null, ugfTxHash, ugfResult.amount, 'settled', 'job_accepted', job.id);
      } else {
        return res.status(500).json({ error: `UGF acceptJob Failed: ${ugfResult.error}` });
      }
    } catch (err) {
      console.error('[UGF] acceptJob transaction error:', err.message);
      return res.status(500).json({ error: `UGF acceptJob Error: ${err.message}` });
    }
  }

  const updates = { status: newStatus };
  if (action === 'start') updates.started_at = new Date().toISOString();
  if (action === 'complete') updates.completed_at = new Date().toISOString();

  db.prepare(`UPDATE print_jobs SET status = ?${action === 'start' ? ', started_at = datetime(\'now\')' : action === 'complete' ? ', completed_at = datetime(\'now\')' : ''} WHERE id = ?`).run(newStatus, job.id);

  log(req.session.role, req.session.userId, `job_${action}`, 'print_job', job.id, `Job ${job.job_ref} ${action}`);
  if (action === 'complete') {
    ledger('job_completed', req.session.role, job.job_ref, 'print_jobs', { jobRef: job.job_ref, completedBy: req.session.userId });
  }
  res.json({ success: true, newStatus, ugfTxHash });
});

// Verify dispatch
router.post('/:id/verify-dispatch', requireRole('operator', 'admin', 'superadmin'), async (req, res) => {
  const job = db.prepare('SELECT * FROM print_jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const copy = db.prepare('SELECT forensic_id FROM print_copies WHERE job_id = ? LIMIT 1').get(job.id);
  const forensicId = copy ? copy.forensic_id : 'MOCK_FORENSIC_ID';

  // UGF Integration
  let ugfTxHash = null;
  try {
    const ugf = require('../ugf');
    const ugfResult = await ugf.submitAcknowledgment(job.id, forensicId, job.operator_id);
    if (ugfResult.success) {
      ugfTxHash = ugfResult.txHash;
      db.prepare('INSERT INTO ugf_transactions (bounty_case_id, tx_hash, amount, status, related_type, related_id) VALUES (?,?,?,?,?,?)')
        .run(null, ugfTxHash, ugfResult.amount, 'settled', 'dispatch_verified', job.id);
    } else {
      return res.status(500).json({ error: `UGF submitAcknowledgment Failed: ${ugfResult.error}` });
    }
  } catch (err) {
    console.error('[UGF] submitAcknowledgment transaction error:', err.message);
    return res.status(500).json({ error: `UGF submitAcknowledgment Error: ${err.message}` });
  }

  db.prepare('UPDATE dispatches SET verified_at = datetime(\'now\'), status = ? WHERE job_id = ?').run('verified', job.id);
  log(req.session.role, req.session.userId, 'dispatch_verified', 'print_job', job.id, `Dispatch verified for job ${job.job_ref}`);
  ledger('dispatch_verified', req.session.role, job.job_ref, 'dispatches', { jobRef: job.job_ref, ugfTxHash });
  res.json({ success: true, ugfTxHash });
});

// Get copies for a job
router.get('/:id/copies', requireRole('admin', 'superadmin', 'operator'), (req, res) => {
  const copies = db.prepare('SELECT * FROM print_copies WHERE job_id = ? ORDER BY copy_number').all(req.params.id);
  res.json(copies);
});

// Preview/download a copy file
router.get('/file/:jobId/:filename', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  const filePath = path.join(GENERATED_DIR, req.params.jobId, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  res.sendFile(filePath);
});

// Verify encoding of a copy
router.get('/:jobId/verify/:forensicId', requireRole('admin', 'superadmin'), async (req, res) => {
  const copy = db.prepare('SELECT * FROM print_copies WHERE job_id = ? AND forensic_id = ?').get(req.params.jobId, req.params.forensicId);
  if (!copy) return res.status(404).json({ error: 'Copy not found' });

  const forensicCopy = db.prepare('SELECT * FROM forensic_copies WHERE copy_id = ?').get(copy.id);
  if (!forensicCopy) return res.status(404).json({ error: 'Forensic record not found' });

  const filePath = path.join(__dirname, '..', '..', 'uploads', copy.file_path);
  const { recoverForensicMarkers } = require('../pdf_forensics');
  const recovery = await recoverForensicMarkers(filePath, db);

  res.json({
    copyRecord: copy,
    forensicRecord: forensicCopy,
    storedPayload: JSON.parse(forensicCopy.forensic_payload),
    recoveredPayload: recovery
  });
});

// Get dispatches
router.get('/dispatches/all', requireRole('admin', 'superadmin'), (req, res) => {
  const rows = db.prepare(`
    SELECT d.*, j.job_ref, c.name as center_name, o.full_name as operator_name
    FROM dispatches d
    LEFT JOIN print_jobs j ON d.job_id = j.id
    LEFT JOIN print_centers c ON d.center_id = c.id
    LEFT JOIN operator_users o ON d.operator_id = o.id
    ORDER BY d.created_at DESC LIMIT 50
  `).all();
  res.json(rows);
});

module.exports = router;
