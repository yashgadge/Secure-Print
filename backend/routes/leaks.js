const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { db, log, ledger, audit } = require('../db');
const { recoverForensicMarkers } = require('../pdf_forensics');
const requireRole = require('../middleware/requireRole');
const router = express.Router();

const LEAKS_DIR = path.join(__dirname, '..', '..', 'uploads', 'leaks');

// Submit leak case (public)
router.post('/submit', (req, res) => {
  const { reporter_name, reporter_contact, filename, original_filename } = req.body;
  if (!filename) return res.status(400).json({ error: 'filename required' });

  const caseRef = `CASE-${uuidv4().substring(0, 10).toUpperCase()}`;
  const filePath = `leaks/${filename}`;

  const result = db.prepare(
    'INSERT INTO leak_cases (case_ref, reporter_name, reporter_contact, file_path, original_filename, status) VALUES (?,?,?,?,?,?)'
  ).run(caseRef, reporter_name || null, reporter_contact || null, filePath, original_filename || filename, 'submitted');

  const caseId = result.lastInsertRowid;

  // Create chain of custody event
  db.prepare('INSERT INTO chain_of_custody_events (case_id, event_type, description, actor_role) VALUES (?,?,?,?)')
    .run(caseId, 'case_submitted', `Leak case submitted: ${caseRef}`, 'public');

  log('public', null, 'leak_submitted', 'leak_case', caseId, `Leak case submitted: ${caseRef}`);
  audit('leak_submitted', 'public', null, `Leak case ${caseRef} submitted`);

  res.json({ success: true, caseId, caseRef });
});

// Track case by caseRef (public)
router.get('/track/:caseRef', (req, res) => {
  const lc = db.prepare('SELECT id, case_ref, status, confidence_score, created_at, matched_job_id, matched_operator_id, matched_center_id FROM leak_cases WHERE case_ref = ?').get(req.params.caseRef);
  if (!lc) return res.status(404).json({ error: 'Case not found' });

  const events = db.prepare('SELECT * FROM chain_of_custody_events WHERE case_id = ? ORDER BY created_at ASC').all(lc.id);
  res.json({ ...lc, timeline: events });
});

// Scan / analyze a case (admin/public)
router.post('/:id/scan', async (req, res) => {
  const lc = db.prepare('SELECT * FROM leak_cases WHERE id = ?').get(req.params.id);
  if (!lc) return res.status(404).json({ error: 'Case not found' });

  const filePath = path.join(__dirname, '..', '..', 'uploads', lc.file_path);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Leak file not found on disk' });

  const isAdmin = req.session && (req.session.role === 'admin' || req.session.role === 'superadmin');
  const actorRole = isAdmin ? req.session.role : 'public';
  const actorId = isAdmin ? req.session.userId : null;

  db.prepare('UPDATE leak_cases SET status = ? WHERE id = ?').run('scanning', lc.id);

  const recovery = await recoverForensicMarkers(filePath, db);

  if (!recovery.found || !recovery.payload) {
    db.prepare('UPDATE leak_cases SET status = ? WHERE id = ?').run('no_match', lc.id);
    db.prepare('INSERT INTO chain_of_custody_events (case_id, event_type, description, actor_role, actor_id) VALUES (?,?,?,?,?)')
      .run(lc.id, 'scan_no_match', 'Forensic scan completed: no markers found', actorRole, actorId);
    return res.json({ found: false, reason: recovery.reason });
  }

  const payload = recovery.payload;

  // Look up the forensic copy
  const forensicCopy = db.prepare('SELECT fc.*, pc.copy_number, pc.file_path FROM forensic_copies fc LEFT JOIN print_copies pc ON fc.copy_id = pc.id WHERE fc.forensic_payload LIKE ?')
    .get(`%${payload.forensicId}%`);

  let confidence = recovery.confidence || 0.5;
  let matchedJobId = null, matchedCopyId = null, matchedOperatorId = null, matchedCenterId = null;

  // If image pixel scan already resolved the match directly, use those IDs
  if (recovery.recoveryLayer === 'image_pixel_scan') {
    matchedJobId      = recovery._matchedJobId      || null;
    matchedCopyId     = recovery._matchedCopyId     || null;
    matchedOperatorId = recovery._matchedOperatorId || null;
    matchedCenterId   = recovery._matchedCenterId   || null;
  }

  if (forensicCopy) {
    confidence = 0.97;
    matchedJobId    = forensicCopy.job_id;
    matchedCopyId   = forensicCopy.copy_id;
    matchedOperatorId = forensicCopy.operator_id;
    matchedCenterId = forensicCopy.center_id;
  } else if (payload.jobId) {
    // Fallback 1: match by jobId
    const job = db.prepare('SELECT * FROM print_jobs WHERE id = ?').get(payload.jobId);
    if (job) {
      confidence = Math.max(confidence, 0.82);
      matchedJobId      = job.id;
      matchedOperatorId = job.operator_id;
      matchedCenterId   = job.center_id;
    }
  }

  // Fallback 2: match by centerId alone (partial scan — enough to identify leak center)
  if (!matchedCenterId && payload.centerId) {
    const center = db.prepare('SELECT id FROM print_centers WHERE id = ?').get(payload.centerId);
    if (center) {
      matchedCenterId = center.id;
      confidence = Math.max(confidence, 0.60);
    }
  }

  // Fallback 3: match by copyNumber + centerId across jobs
  if (!matchedJobId && payload.copyNumber && payload.centerId) {
    const copy = db.prepare(`
      SELECT pc.*, pj.operator_id, pj.center_id, pj.id as job_id
      FROM print_copies pc
      JOIN print_jobs pj ON pc.job_id = pj.id
      WHERE pc.copy_number = ? AND pj.center_id = ?
      ORDER BY pc.id DESC LIMIT 1
    `).get(payload.copyNumber, payload.centerId);
    if (copy) {
      confidence = Math.max(confidence, 0.70);
      matchedJobId      = copy.job_id;
      matchedCopyId     = copy.id;
      matchedOperatorId = copy.operator_id;
      matchedCenterId   = copy.center_id;
    }
  }

  db.prepare(`UPDATE leak_cases SET status = 'attributed', matched_job_id = ?, matched_copy_id = ?, matched_operator_id = ?, matched_center_id = ?, confidence_score = ?, forensic_payload = ? WHERE id = ?`)
    .run(matchedJobId, matchedCopyId, matchedOperatorId, matchedCenterId, confidence, JSON.stringify(payload), lc.id);

  // UGF Integration
  let ugfTxHash = null;
  try {
    const ugf = require('../ugf');
    const ugfResult = await ugf.reportLeak(matchedJobId || 0, payload.copyNumber || 0, payload.forensicId || '');
    if (ugfResult.success) {
      ugfTxHash = ugfResult.txHash;
      db.prepare('INSERT INTO ugf_transactions (bounty_case_id, tx_hash, amount, status, related_type, related_id) VALUES (?,?,?,?,?,?)')
        .run(null, ugfTxHash, ugfResult.amount, 'settled', 'leak_reported', lc.id);
    } else {
      return res.status(500).json({ error: `UGF reportLeak Failed: ${ugfResult.error}` });
    }
  } catch (err) {
    console.error('[UGF] reportLeak transaction error:', err.message);
    return res.status(500).json({ error: `UGF reportLeak Error: ${err.message}` });
  }

  // Chain of custody
  db.prepare('INSERT INTO chain_of_custody_events (case_id, job_id, event_type, description, actor_role, actor_id) VALUES (?,?,?,?,?,?)')
    .run(lc.id, matchedJobId, 'attribution_confirmed', `Attributed to job ${payload.jobRef}, copy ${payload.copyNumber}, operator ${payload.operatorId}`, actorRole, actorId);

  // Store evidence
  db.prepare('INSERT INTO leak_evidences (case_id, evidence_type, evidence_data) VALUES (?,?,?)').run(lc.id, 'forensic_payload', JSON.stringify(payload));

  // Create bounty case
  const existingBounty = db.prepare('SELECT id FROM bounty_cases WHERE case_id = ?').get(lc.id);
  if (!existingBounty) {
    db.prepare('INSERT INTO bounty_cases (case_id, eligibility, status) VALUES (?,?,?)').run(lc.id, 'eligible', 'queued');
  }

  log(actorRole, actorId, 'leak_scanned', 'leak_case', lc.id, `Case ${lc.case_ref} attributed with confidence ${confidence}`);
  ledger('leak_attributed', actorRole, lc.case_ref, 'leak_cases', { caseRef: lc.case_ref, forensicId: payload.forensicId, confidence, jobRef: payload.jobRef, ugfTxHash });
  audit('leak_attributed', actorRole, actorId, `Case ${lc.case_ref} attributed to job ${payload.jobRef}`);

  // Get enriched attribution
  const operator = matchedOperatorId ? db.prepare('SELECT operator_id, full_name FROM operator_users WHERE id = ?').get(matchedOperatorId) : null;
  const center = matchedCenterId ? db.prepare('SELECT name FROM print_centers WHERE id = ?').get(matchedCenterId) : null;
  const job = matchedJobId ? db.prepare('SELECT job_ref, batch_id FROM print_jobs WHERE id = ?').get(matchedJobId) : null;
  const batch = job ? db.prepare('SELECT batch_ref FROM dispatch_batches WHERE id = ?').get(job.batch_id) : null;

  res.json({
    found: true,
    confidence,
    payload,
    recoveryLayer: recovery.recoveryLayer,
    attribution: {
      jobRef:      job?.job_ref      || payload.jobRef,
      batchRef:    batch?.batch_ref  || payload.batchRef,
      copyNumber:  payload.copyNumber,
      operatorId:  operator?.operator_id || payload.operatorId,
      operatorName: operator?.full_name  || payload.operatorName,
      centerName:  center?.name          || payload.centerName
    },
    ugfTxHash
  });
});

// Get all cases (admin)
router.get('/', requireRole('admin', 'superadmin'), (req, res) => {
  const rows = db.prepare(`
    SELECT lc.*, o.operator_id as op_ref, o.full_name as op_name, c.name as center_name, j.job_ref
    FROM leak_cases lc
    LEFT JOIN operator_users o ON lc.matched_operator_id = o.id
    LEFT JOIN print_centers c ON lc.matched_center_id = c.id
    LEFT JOIN print_jobs j ON lc.matched_job_id = j.id
    ORDER BY lc.created_at DESC
  `).all();
  res.json(rows);
});

// Get case detail (admin)
router.get('/:id', requireRole('admin', 'superadmin'), (req, res) => {
  const lc = db.prepare('SELECT * FROM leak_cases WHERE id = ?').get(req.params.id);
  if (!lc) return res.status(404).json({ error: 'Not found' });
  const events = db.prepare('SELECT * FROM chain_of_custody_events WHERE case_id = ? ORDER BY created_at ASC').all(lc.id);
  const evidences = db.prepare('SELECT * FROM leak_evidences WHERE case_id = ?').all(lc.id);
  res.json({ ...lc, timeline: events, evidences });
});

module.exports = router;
