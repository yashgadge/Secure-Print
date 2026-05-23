const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

let DB_PATH = path.join(process.cwd(), 'secureprint.db');
let db;

// Vercel Serverless environment workaround:
// Copy the SQLite database to the writable /tmp directory if running in production/Vercel.
if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
  const fs = require('fs');
  const tempDbPath = path.join('/tmp', 'secureprint.db');
  try {
    let sourceDbPath = DB_PATH;
    if (!fs.existsSync(sourceDbPath)) {
      sourceDbPath = path.join(__dirname, 'secureprint.db');
    }
    if (!fs.existsSync(sourceDbPath)) {
      sourceDbPath = path.join(__dirname, '..', 'secureprint.db');
    }
    
    if (fs.existsSync(sourceDbPath)) {
      if (!fs.existsSync(tempDbPath)) {
        console.log(`[Vercel DB] Copying baseline database from ${sourceDbPath} to writable location: ${tempDbPath}`);
        fs.copyFileSync(sourceDbPath, tempDbPath);
      }
      DB_PATH = tempDbPath;
    } else {
      console.warn(`[Vercel DB] Baseline database not found at any path! Falling back to in-memory.`);
      DB_PATH = ':memory:';
    }
  } catch (err) {
    console.error("[Vercel DB] Failed to copy database to /tmp, falling back to in-memory:", err);
    DB_PATH = ':memory:';
  }
}

try {
  console.log(`Connecting to database: ${DB_PATH}`);
  db = new Database(DB_PATH);
} catch (e) {
  console.error("Failed to initialize database, falling back to in-memory database to prevent crash:", e);
  db = new Database(':memory:');
}



db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'admin',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS operator_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operator_id TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  center_id INTEGER,
  device_id TEXT,
  password_hash TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS operator_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operator_id TEXT NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  center_id INTEGER,
  device_id TEXT,
  password_hash TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  reviewed_by INTEGER,
  reviewed_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS print_centers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  zone TEXT,
  region TEXT,
  address TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS print_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_name TEXT NOT NULL,
  center_id INTEGER,
  printer_id TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'offline',
  queue_length INTEGER DEFAULT 0,
  current_job_id INTEGER,
  last_sync TEXT,
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS print_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_ref TEXT UNIQUE NOT NULL,
  batch_id INTEGER,
  operator_id INTEGER,
  center_id INTEGER,
  node_id INTEGER,
  master_file TEXT,
  status TEXT DEFAULT 'pending',
  copies_count INTEGER DEFAULT 1,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dispatch_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_ref TEXT UNIQUE NOT NULL,
  job_id INTEGER,
  center_id INTEGER,
  operator_id INTEGER,
  total_copies INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dispatches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER,
  job_id INTEGER,
  operator_id INTEGER,
  center_id INTEGER,
  status TEXT DEFAULT 'dispatched',
  verified_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS print_copies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER,
  batch_id INTEGER,
  copy_number INTEGER,
  file_path TEXT,
  forensic_id TEXT UNIQUE,
  status TEXT DEFAULT 'generated',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS forensic_copies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  copy_id INTEGER,
  job_id INTEGER,
  batch_id INTEGER,
  operator_id INTEGER,
  center_id INTEGER,
  forensic_payload TEXT,
  encoding_method TEXT DEFAULT 'steganographic',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS forensic_patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern_key TEXT UNIQUE NOT NULL,
  pattern_value TEXT,
  description TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS watermark_layers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER,
  layer_type TEXT,
  layer_data TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS leak_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_ref TEXT UNIQUE NOT NULL,
  reporter_name TEXT,
  reporter_contact TEXT,
  file_path TEXT,
  original_filename TEXT,
  status TEXT DEFAULT 'submitted',
  matched_job_id INTEGER,
  matched_copy_id INTEGER,
  matched_operator_id INTEGER,
  matched_center_id INTEGER,
  confidence_score REAL DEFAULT 0,
  forensic_payload TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS leak_evidences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER,
  evidence_type TEXT,
  evidence_data TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bounty_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER UNIQUE,
  eligibility TEXT DEFAULT 'pending',
  is_duplicate INTEGER DEFAULT 0,
  first_reporter INTEGER DEFAULT 1,
  reward_amount REAL DEFAULT 0,
  status TEXT DEFAULT 'queued',
  reviewed_by INTEGER,
  reviewed_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bounty_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bounty_case_id INTEGER,
  action TEXT,
  actor_id INTEGER,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ugf_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bounty_case_id INTEGER,
  tx_hash TEXT UNIQUE,
  amount REAL,
  status TEXT DEFAULT 'staged',
  related_type TEXT,
  related_id INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ledger_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_type TEXT NOT NULL,
  source TEXT,
  reference_id TEXT,
  reference_table TEXT,
  payload TEXT,
  proof_hash TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_role TEXT,
  actor_id INTEGER,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  details TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  actor_role TEXT,
  actor_id INTEGER,
  description TEXT,
  status TEXT DEFAULT 'open',
  flagged INTEGER DEFAULT 0,
  escalated INTEGER DEFAULT 0,
  frozen INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS security_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT,
  actor_id INTEGER,
  description TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chain_of_custody_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER,
  job_id INTEGER,
  event_type TEXT,
  description TEXT,
  actor_id INTEGER,
  actor_role TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS telemetry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id INTEGER,
  printer_id TEXT,
  metric TEXT,
  value TEXT,
  recorded_at TEXT DEFAULT (datetime('now'))
);
`);

db.exec(`
CREATE INDEX IF NOT EXISTS idx_operator_users_opid ON operator_users (operator_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions (id);
CREATE INDEX IF NOT EXISTS idx_leak_cases_id ON leak_cases (id);
CREATE INDEX IF NOT EXISTS idx_ugf_transactions_hash ON ugf_transactions (tx_hash);
CREATE INDEX IF NOT EXISTS idx_ledger_records_hash ON ledger_records (proof_hash);
`);

// Migration for existing databases to add related_type and related_id
try {
  db.exec("ALTER TABLE ugf_transactions ADD COLUMN related_type TEXT");
} catch (e) {
  // Column may already exist
}
try {
  db.exec("ALTER TABLE ugf_transactions ADD COLUMN related_id INTEGER");
} catch (e) {
  // Column may already exist
}

// Seed default admin if not exists
const existingAdmin = db.prepare('SELECT id FROM admin_users WHERE username = ?').get('admin');
if (!existingAdmin) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO admin_users (username, password_hash, role) VALUES (?, ?, ?)').run('admin', hash, 'superadmin');
}

// Seed default OP-TEST operator if not exists or ensure correct password hash
const opTestHash = bcrypt.hashSync('password123', 10);
const existingOpRequest = db.prepare('SELECT id FROM operator_requests WHERE operator_id = ?').get('OP-TEST');
if (!existingOpRequest) {
  db.prepare(
    'INSERT INTO operator_requests (operator_id, full_name, email, phone, center_id, device_id, password_hash, status, reviewed_by, reviewed_at) VALUES (?,?,?,?,?,?,?,?,?,datetime(\'now\'))'
  ).run('OP-TEST', 'Test Operator', 'test@test.com', '1234567890', 1, 'DEV-TEST', opTestHash, 'approved', 1);
} else {
  db.prepare('UPDATE operator_requests SET password_hash = ?, status = ? WHERE operator_id = ?').run(opTestHash, 'approved', 'OP-TEST');
}

const existingOpUser = db.prepare('SELECT id FROM operator_users WHERE operator_id = ?').get('OP-TEST');
if (!existingOpUser) {
  db.prepare(
    'INSERT OR IGNORE INTO operator_users (operator_id, full_name, email, phone, center_id, device_id, password_hash, status) VALUES (?,?,?,?,?,?,?,?)'
  ).run('OP-TEST', 'Test Operator', 'test@test.com', '1234567890', 1, 'DEV-TEST', opTestHash, 'approved');
} else {
  db.prepare('UPDATE operator_users SET password_hash = ?, status = ? WHERE operator_id = ?').run(opTestHash, 'approved', 'OP-TEST');
}

// Seed a default pending operator request (OP-1234) so judges can demonstrate the approval flow in stateless Vercel environments
const existingPendingOp = db.prepare('SELECT id FROM operator_requests WHERE operator_id = ?').get('OP-1234');
if (!existingPendingOp) {
  const pendingOpHash = bcrypt.hashSync('password123', 10);
  db.prepare(
    'INSERT INTO operator_requests (operator_id, full_name, email, phone, center_id, device_id, password_hash, status) VALUES (?,?,?,?,?,?,?,?)'
  ).run('OP-1234', 'Yash', 'yash@secureprint.com', '+917410153938', 1, 'DEV-YASH', pendingOpHash, 'pending');
  
  // Ensure the user doesn't already exist in operator_users as approved (so it is clean for approval flow)
  db.prepare("DELETE FROM operator_users WHERE operator_id = 'OP-1234'").run();
} else if (existingPendingOp.status === 'approved') {
  // If it was already approved in a previous container session, we can keep it, but for demo freshness,
  // we check if it is approved and allow resetting it if needed.
}


// Seed default settings
const defaultSettings = {
  screenshot_blocking: 'false',
  watermarking: 'true',
  blockchain_logging: 'true',
  export_restriction: 'false',
  session_timeout: '3600',
  lockdown: 'false'
};
const upsertSetting = db.prepare('INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(defaultSettings)) upsertSetting.run(k, v);

// Seed sample centers if none exist
const centerCount = db.prepare('SELECT COUNT(*) as c FROM print_centers').get();
if (centerCount.c === 0) {
  const insertCenter = db.prepare('INSERT INTO print_centers (name, zone, region, status) VALUES (?, ?, ?, ?)');
  insertCenter.run('Central Exam Hub', 'Zone A', 'North', 'active');
  insertCenter.run('Eastern Print Node', 'Zone B', 'East', 'active');
  insertCenter.run('Southern Distribution Center', 'Zone C', 'South', 'active');
}

// Helpers
function log(actorRole, actorId, action, targetType, targetId, details) {
  db.prepare('INSERT INTO activity_logs (actor_role, actor_id, action, target_type, target_id, details) VALUES (?,?,?,?,?,?)')
    .run(actorRole || null, actorId || null, action, targetType || null, String(targetId || ''), details || null);
}

function ledger(recordType, source, referenceId, referenceTable, payload) {
  const crypto = require('crypto');
  const proof = crypto.createHash('sha256').update(JSON.stringify({ recordType, source, referenceId, payload, t: Date.now() })).digest('hex');
  db.prepare('INSERT INTO ledger_records (record_type, source, reference_id, reference_table, payload, proof_hash) VALUES (?,?,?,?,?,?)')
    .run(recordType, source || null, String(referenceId || ''), referenceTable || null, JSON.stringify(payload), proof);
  return proof;
}

function audit(eventType, actorRole, actorId, description) {
  db.prepare('INSERT INTO audit_logs (event_type, actor_role, actor_id, description) VALUES (?,?,?,?)').run(eventType, actorRole || null, actorId || null, description || null);
}

function securityEvent(eventType, actorId, description) {
  db.prepare('INSERT INTO security_events (event_type, actor_id, description) VALUES (?,?,?)').run(eventType, actorId || null, description || null);
}

module.exports = { db, log, ledger, audit, securityEvent };
