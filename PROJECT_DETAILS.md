# SecurePrint Ledger — Project Details (Full Documentation)

> This document is generated from the current repository code.
> Includes: implemented features, workflows, every dashboard/page button logic, backend routes, SQLite schema, forensic encoding & recovery internals, libraries used, and code-detected issues/gaps.

---

## 1. What this project is
**SecurePrint Ledger** is a web application (Node.js + Express + SQLite + Vanilla JS frontend) that:

1. Lets **Admins** upload a master document.
2. Generates multiple **forensically encoded copies** (PDF forensic markers) and records them.
3. Enables **dispatch** of jobs to **Operator** users.
4. Lets **Operators** run job workflows (start/pause/resume/complete + dispatch verification).
5. Provides a **public portal** where users can upload suspected leaked documents and track their case anonymously.
6. Provides an **admin forensic console** to scan leak files and attribute them to generated copies via forensic recovery.
7. Creates **bounty cases** from attributed leak cases, and supports admin review actions.
8. Provides an **immutable ledger explorer** + activity/audit + security controls.
9. Provides infrastructure monitoring of **print nodes** (register nodes; enable/disable/restart/test; view telemetry).

---

## 2. Repository structure

### Root
- `package.json`
- `package-lock.json`
- `backend/`
- `frontend/`
- `uploads/`
- `secureprint.db`, `secureprint.db-wal`, `secureprint.db-shm`
- `server.log`
- `q-dev-chat-2026-05-21.md`

### Backend (`backend/`)
- `server.js`
- `db.js`
- `pdf_forensics.js`
- `middleware/requireRole.js`
- `routes/`
  - `auth.js`
  - `operators.js`
  - `centers.js`
  - `jobs.js`
  - `leaks.js`
  - `admin.js`

### Frontend (`frontend/`)
- `index.html` (SPA shell + gateway + public portal containers)
- `pages/`
  - `api.js` (fetch utilities + UI helper functions)
  - `app.js` (session load + sidebar navigation + page routing)
  - `gateway.js`
  - `public_portal.js`
  - `admin_login.js`
  - `operator_auth.js`
  - `command_center.js`
  - `operator_control.js`
  - `active_jobs.js`
  - `leak_trace.js`
  - `bounty.js`
  - `ledger.js`
  - `audit.js`
  - `security.js`
  - `print_nodes.js`

### Uploads (`uploads/`)
- `uploads/original/` (uploaded master PDFs)
- `uploads/generated/` (generated forensic copies)
- `uploads/leaks/` (uploaded suspected leaks)
- `uploads/reports/` (directory exists; routes not shown in inspected code)

---

## 3. Libraries / Tools used

### Runtime dependencies (`package.json`)
- **express**: HTTP server + API routing + static hosting
- **express-session**: session-based authentication
- **better-sqlite3**: SQLite DB driver
- **bcryptjs**: password hashing + verification
- **multer**: multipart file uploads
- **uuid**: job/batch/case/tx identifier generation
- **pdf-lib**: forensic marker embedding + placeholder PDF generation
- **jimp**: image processing for forensic recovery
- **tesseract.js**: OCR for forensic recovery from images/screenshots

### Dev dependency
- **nodemon**: development hot reload

---

## 4. Database schema (SQLite)
Schema is created in `backend/db.js`.

### Access / Identity
- **admin_users**
  - `id`
  - `username` (unique)
  - `password_hash`
  - `role` (seeded: `admin` / `superadmin`)

- **operator_users**
  - `id`
  - `operator_id` (unique)
  - `full_name`, `email`, `phone`
  - `center_id`, `device_id`
  - `password_hash`
  - `status` (`pending`, `approved`, `suspended`)

- **operator_requests**
  - pending operator signup requests
  - includes `password_hash` captured during signup
  - includes `reviewed_by`, `reviewed_at`

### Sessions
- **sessions** table exists in schema but current runtime uses `express-session` directly; the app code shown does not read/write this table.

### Operations / Infrastructure
- **print_centers**
  - `name`, `zone`, `region`, `address`, `status`

- **print_nodes**
  - `node_name`, `center_id`
  - `printer_id` (unique)
  - `status` (`offline`, `online`)
  - `queue_length`, `current_job_id`, `last_sync`, `enabled`

### Jobs / Dispatch
- **print_jobs**
  - `job_ref` (unique)
  - `batch_id`, `operator_id`, `center_id`, `node_id`
  - `master_file`, `status`
  - `copies_count`, `started_at`, `completed_at`

- **dispatch_batches**
  - `batch_ref` (unique)
  - `job_id`, `center_id`, `operator_id`
  - `total_copies`, `status`

- **dispatches**
  - `batch_id`, `job_id`, `operator_id`, `center_id`
  - `status`, `verified_at`

- **print_copies**
  - `job_id`, `batch_id`
  - `copy_number`
  - `file_path`, `forensic_id` (unique)
  - `status` (`generated`, etc.)

- **forensic_copies**
  - per-copy forensic payload JSON
  - `copy_id`, `job_id`, `batch_id`
  - `operator_id`, `center_id`
  - `forensic_payload`, `encoding_method`

### Leaks / Attribution
- **leak_cases**
  - `case_ref` (unique)
  - reporter fields, `file_path`, `original_filename`
  - `status`
  - matched fields: `matched_job_id`, `matched_copy_id`, `matched_operator_id`, `matched_center_id`
  - `confidence_score`, `forensic_payload`

- **leak_evidences**
  - `case_id`, `evidence_type`, `evidence_data`

- **chain_of_custody_events**
  - timeline events per leak case

### Bounty / Rewards
- **bounty_cases**
  - `case_id` (unique)
  - `eligibility`, `is_duplicate`, `reward_amount`, `status`
  - `reviewed_by`, `reviewed_at`

- **bounty_submissions**
  - stores admin actions taken on bounty cases

- **ugf_transactions**
  - tx hash + amount + status

### Ledger / Activity / Audit / Security
- **ledger_records**
  - `record_type`, `source`
  - `reference_id`, `reference_table`
  - `payload` (JSON string)
  - `proof_hash`

- **activity_logs**
  - actor role/id + action + target + details

- **audit_logs**
  - incident queue with `flagged/escalated/frozen`

- **security_events**
  - exists but current UI primarily consumes `activity_logs`.

- **system_settings**
  - key/value store for security toggles, session_timeout, lockdown.

### Telemetry
- **telemetry**
  - node_id/printer_id/metric/value + timestamp

---

## 5. Backend: Express setup and routing

### `backend/server.js`
- Configures `express-session`.
- Creates upload directories:
  - `uploads/original`, `uploads/generated`, `uploads/leaks`, `uploads/reports`.
- Serves:
  - `frontend/` as static
  - `/uploads` as static
- Upload handling uses `multer` storage configured for:
  - master files → `uploads/original`
  - leak files → `uploads/leaks`
- Mounts routers:
  - `/api/auth` → `routes/auth.js`
  - `/api/operators` → `routes/operators.js`
  - `/api/centers` → `routes/centers.js`
  - `/api/jobs` → `routes/jobs.js`
  - `/api/leaks` → `routes/leaks.js`
  - `/api/admin` → `routes/admin.js`
- SPA fallback:
  - `GET *` → `frontend/index.html`

Upload endpoints defined in `server.js`:
- `POST /api/upload/master`
- `POST /api/upload/leak`

---

## 6. Backend APIs & workflows (routes)

### 6.1 Auth (`backend/routes/auth.js`)

#### Admin
- `POST /api/auth/admin/login`
  - Validates `{ username, password }` against `admin_users` using `bcryptjs`.
  - Sets session: `userId`, `role`, `username`.

- `POST /api/auth/admin/logout`
  - Destroys session.

#### Operator
- `POST /api/auth/operator/signup`
  - Creates row in `operator_requests` with `status='pending'`.

- `POST /api/auth/operator/login`
  - Finds operator in `operator_users`.
  - If missing: checks `operator_requests`.
    - pending → returns `403 { error:'pending' }`
  - If present: requires `operator_users.status='approved'`.
  - Sets session: `userId`, `role='operator'`, `operatorId`.

- `GET /api/auth/operator/status/:operatorId`
  - Returns signup request status.

- `GET /api/auth/session`
  - Returns authentication state.

---

### 6.2 Centers / Nodes (`backend/routes/centers.js`)

- `GET /api/centers`
- `POST /api/centers` (admin)

Nodes:
- `GET /api/centers/nodes`
- `POST /api/centers/nodes` (admin)
- `POST /api/centers/nodes/:id/action` (admin)
  - `enable` / `disable` / `restart` / `test`
- `GET /api/centers/nodes/:id/telemetry` (admin)

---

### 6.3 Operators (`backend/routes/operators.js`)

- `GET /api/operators/requests` (admin)
- `GET /api/operators` (admin)

Admin moderation actions:
- `POST /api/operators/requests/:id/approve`
- `POST /api/operators/requests/:id/reject`
- `POST /api/operators/:id/suspend`
- `POST /api/operators/:id/reassign`

Operator profile:
- `GET /api/operators/me` (operator)

---

### 6.4 Jobs (`backend/routes/jobs.js`)

- `GET /api/jobs`
  - operator role restricted to their jobs

- `POST /api/jobs/generate` (admin)
  - creates `dispatch_batches` + `print_jobs`
  - generates N copies:
    - calls `generateForensicId(jobId, i, batchId)`
    - builds payload
    - calls `embedForensicMarkers(sourcePath, outPath, payload)`
    - inserts into `print_copies` and `forensic_copies`
  - updates batch status to `ready`
  - writes ledger/activity/audit

- `POST /api/jobs/:id/dispatch` (admin)
  - creates `dispatches`
  - updates statuses to `dispatched`
  - writes ledger

Operator control:
- `POST /api/jobs/:id/action` (operator/admin)
  - validates ownership
  - allowed transitions:
    - `start`: `pending|dispatched` → `printing`
    - `pause`: `printing` → `paused`
    - `resume`: `paused` → `printing`
    - `complete`: `printing|paused` → `completed`
  - on `complete`: writes ledger `job_completed`

Dispatch verification:
- `POST /api/jobs/:id/verify-dispatch` (operator/admin)
  - sets `dispatches.status='verified'` and `verified_at`
  - writes ledger `dispatch_verified`

Copy retrieval:
- `GET /api/jobs/:id/copies`

Preview/download:
- `GET /api/jobs/file/:jobId/:filename` (session required)

Encoding verification (admin):
- `GET /api/jobs/:jobId/verify/:forensicId`
  - loads stored forensic payload from `forensic_copies`
  - reads generated PDF file
  - calls `recoverForensicMarkers(filePath)`
  - **note**: this recovery call does not pass `db`, so DB-assisted matching logic is not used.

---

### 6.5 Leaks (`backend/routes/leaks.js`)

Public portal:
- `POST /api/leaks/submit`
  - creates `leak_cases` + chain-of-custody event `case_submitted`
  - logs + audit

- `GET /api/leaks/track/:caseRef`
  - returns leak case + timeline

Admin scan/attribution:
- `POST /api/leaks/:id/scan` (admin)
  - updates status to `scanning`
  - calls `recoverForensicMarkers(filePath, db)`
  - on no match:
    - status `no_match`
    - adds `scan_no_match` event
  - on match:
    - status `attributed`
    - updates matched job/copy/operator/center + `confidence_score` and `forensic_payload`
    - adds `attribution_confirmed` event
    - inserts `leak_evidences`
    - ensures `bounty_cases` exists (eligibility `eligible`, status `queued`)
    - logs + ledger

Admin listing:
- `GET /api/leaks`
- `GET /api/leaks/:id`

---

### 6.6 Admin (`backend/routes/admin.js`)

Bounty:
- `GET /api/admin/bounty`
- `POST /api/admin/bounty/:id/action`
  - `approve` / `reject` / `escalate`
  - on approve: creates `ugf_transactions` tx_hash and writes ledger `bounty_approved`

Ledger explorer:
- `GET /api/admin/ledger`
  - query: `search`, `type`, `from`, `to`
  - returns last 200 entries

Activity:
- `GET /api/admin/activity`

Audit:
- `GET /api/admin/audit`
- `POST /api/admin/audit/:id/action`
  - `flag` / `escalate` / `freeze` / `verify`

Security:
- `GET /api/admin/security`
- `POST /api/admin/security` (save allowed keys)
- `POST /api/admin/security/lockdown` (lock/unlock)
- `POST /api/admin/security/revoke-token`
  - for operators: sets `operator_users.status='suspended'`

Dashboard counters:
- `GET /api/admin/dashboard/counters`

---

## 7. Frontend: SPA architecture

### `frontend/index.html`
- Gateway landing page.
- Public portal container.
- Admin/operator login containers.
- SPA shell with sidebar + pages.

### Routing (`frontend/pages/app.js`)
- Holds `appState = { role, userId, username, operatorId }`.
- Sidebar items depend on role.
- `navigate()` toggles top-level views and renders specific page.

### Shared utilities (`frontend/pages/api.js`)
- `API.get/post/upload`
- UI helpers:
  - `statusChip(status)`
  - `fmtDate`, `renderTable`, `setMsg`, `empty`, etc.

---

## 8. Frontend dashboards & page logic (buttons/workflows)

### 8.1 Admin — Command Center (`command_center.js`)
- Counters: auto-loads `/api/admin/dashboard/counters`.
- Master upload: upload area → `/api/upload/master`.
- Generate button (`cc-gen-btn`): calls `/api/jobs/generate`.
- Dispatch button (`cc-dispatch-btn`): calls `/api/jobs/:jobId/dispatch`.
- View/Download/Verify:
  - View/Download: `/api/jobs/file/:jobId/:filename`
  - Verify: `/api/jobs/:jobId/verify/:forensicId`
- Activity/Jobs/Dispatches:
  - `/api/admin/activity`
  - `/api/jobs`
  - `/api/jobs/dispatches/all`

### 8.2 Admin — Operator Control (`operator_control.js`)
- Pending requests:
  - `/api/operators/requests`
  - approve/reject endpoints
- Approved operators:
  - `/api/operators`
  - suspend endpoint
- Reassign:
  - load `/api/operators` + `/api/centers`
  - call `/api/operators/:id/reassign`

### 8.3 Operator — Active Jobs (`active_jobs.js`)
- Loads `/api/jobs`.
- Buttons based on job status:
  - start/pause/resume/complete → `/api/jobs/:id/action`
  - verify dispatch → `/api/jobs/:id/verify-dispatch`

### 8.4 Admin — Leak Trace Console (`leak_trace.js`)
- Upload leak:
  - file → `/api/upload/leak`
  - create case → `/api/leaks/submit`
- Scan/Deep Trace:
  - `/api/leaks/:caseId/scan`
- View timeline:
  - `/api/leaks/:caseId`
- Ledger proof attempt:
  - `/api/admin/ledger?search=caseRef`
- Table: `/api/leaks`

### 8.5 Admin — Bounty Review (`bounty.js`)
- Queue: `/api/admin/bounty`
- Action buttons (approve/reject/escalate) → `/api/admin/bounty/:id/action`
- Loads transaction info by `/api/admin/ledger?search=bounty` and client filtering.

### 8.6 Admin — Ledger Explorer (`ledger.js`)
- Search/filter → `/api/admin/ledger`.
- Row “View” → `ledgerShowDetail(id)` (client attempts to fetch and locate by id).

### 8.7 Admin — Audit (`audit.js`)
- Queue: `/api/admin/audit`
- Detail + actions → `/api/admin/audit/:id/action`
  - verify/flag/escalate/freeze

### 8.8 Admin — Security (`security.js`)
- Settings load: `/api/admin/security`
- Toggles save: `/api/admin/security`
- Session timeout: `/api/admin/security`
- Lock/unlock: `/api/admin/security/lockdown`
- Revoke operator session: `/api/admin/security/revoke-token`
- Security events displayed via `/api/admin/activity` client-side filtering.

### 8.9 Admin — Print Nodes (`print_nodes.js`)
- Centers: `/api/centers`
- Nodes list: `/api/centers/nodes`
- Node actions: `/api/centers/nodes/:id/action`
- Telemetry: `/api/centers/nodes/:nodeId/telemetry`

---

## 9. Forensic engine (PDF encoding + recovery)

Implemented in `backend/pdf_forensics.js`.

### 9.1 Encoding: `embedForensicMarkers(sourcePath, outputPath, payload)`
Main encoding layers:
1. **PDF metadata keywords**
   - stores `SPLFID:<base64(JSON(payload))>`
2. **Creator/Subject/Producer/Author fields**
   - embeds forensic identifiers in text fields
3. **Border layer**
   - light grey border lines
   - corner L-bracket anchors with orientation (`tl/tr/bl/br`)
4. **Redundant symbol bands on all sides**
   - uses 4 solid vector symbols:
     - short bar, long bar, triangle, square
   - encodes a core string repeated across all four sides
5. **Micro-text + human stamp**
   - OCR-friendly bottom micro-text
   - vertical margin label
   - bottom-right visible stamp rectangle

Fallback:
- If the source PDF cannot be loaded/parsed, a placeholder PDF is generated and layered the same way.

### 9.2 Recovery: `recoverForensicMarkers(filePath, db)`
Routing:
- If file extension indicates an image → OCR + pixel/shape scanning.
- If PDF:
  - tries text/metadata extraction first.
  - if text markers missing: attempts scanned-PDF extraction (embedded images) then OCR.
  - includes a shape-sequence decoder as a fallback when `db` is available.

When DB is provided:
- for OCR matches, it tries to match extracted fields against `forensic_copies` joined with `print_copies`/`print_jobs`.

---

## 10. Current issues / gaps (from code inspection)
- `ledger.js` detail-view uses `/api/admin/ledger` without a direct “get by id” endpoint; if the requested entry isn’t in the last 200 results, “View” may fail.
- `GET /api/jobs/:jobId/verify/:forensicId` calls recovery without passing `db`, so DB-backed matching logic inside `recoverForensicMarkers` is not used.
- Security events UI consumes `GET /api/admin/activity` filtering action strings; the `security_events` table is not surfaced directly.
- `sessions` table exists in schema but isn’t used by the runtime shown (auth uses express-session).

---

## 11. How to run
- `npm install`
- `npm run dev` (starts with nodemon)
- App URL: `http://localhost:3001`

