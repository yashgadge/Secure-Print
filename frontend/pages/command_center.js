let ccState = { masterFile: null, selectedCenter: null, selectedOperator: null, lastJobId: null, lastJobRef: null, lastBatchId: null, generatedFiles: [] };

async function renderCommandCenter() {
  const el = document.getElementById('page-command');
  el.innerHTML = `
  <div class="page-header">
    <div class="header-row">
      <div><h1>Command Center</h1><p>Secure document generation, dispatch, and operational oversight</p></div>
      <div style="display:flex;gap:8px;align-items:center;">
        <span class="status-badge badge-green" id="cc-sys-status">● System Online</span>
        <button class="btn btn-ghost btn-sm" onclick="renderCommandCenter()">🔄 Refresh</button>
      </div>
    </div>
  </div>

  <!-- Counters -->
  <div class="grid-6" id="cc-counters"><div class="state-loading">Loading...</div></div>

  <!-- Main workflow -->
  <div class="grid-2" style="margin-top:16px;">
    <div>
      <!-- Upload -->
      <div class="card">
        <div class="card-title">📄 Master Document</div>
        <div class="upload-area" id="cc-upload-area" onclick="document.getElementById('cc-file-input').click()">
          <div class="upload-icon">📁</div>
          <p>Upload master PDF or DOCX</p>
          <div class="file-name" id="cc-file-name"></div>
        </div>
        <input type="file" id="cc-file-input" accept=".pdf,.docx,.doc" style="display:none" onchange="ccFileSelected(this)">
        <div id="cc-upload-msg" style="margin-top:8px;"></div>
      </div>

      <!-- Forensic Settings -->
      <div class="card">
        <div class="card-title">🔬 Forensic Settings</div>
        <div class="grid-2">
          <div class="form-group">
            <label>Print Center</label>
            <select class="form-control" id="cc-center" onchange="ccCenterChanged()"><option value="">Loading...</option></select>
          </div>
          <div class="form-group">
            <label>Operator</label>
            <select class="form-control" id="cc-operator" onchange="ccCheckGenBtn()"><option value="">Select center first</option></select>
          </div>
        </div>
        <div class="form-group">
          <label>Number of Copies</label>
          <input class="form-control" type="number" id="cc-copies" value="3" min="1" max="100">
        </div>
        <div id="cc-gen-msg"></div>
        <div class="btn-row">
          <button class="btn btn-accent" id="cc-gen-btn" disabled onclick="ccGenerate()" title="Requires file + center + operator">⚡ Generate Fingerprints & Deploy via UGF</button>
          <button class="btn btn-primary" id="cc-dispatch-btn" disabled onclick="ccDispatch()" title="Requires generated job">📤 Dispatch</button>
        </div>
      </div>
    </div>

    <div>
      <!-- PDF Preview -->
      <div class="card">
        <div class="card-title">👁️ Document Preview</div>
        <div id="cc-preview-area" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;height:280px;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:13px;">
          No document generated yet
        </div>
        <div class="btn-row" style="margin-top:10px;">
          <button class="btn btn-ghost btn-sm" id="cc-view-btn" disabled onclick="ccViewFile()">👁️ View PDF</button>
          <button class="btn btn-ghost btn-sm" id="cc-dl-btn" disabled onclick="ccDownloadFile()">⬇️ Download</button>
          <button class="btn btn-ghost btn-sm" id="cc-verify-btn" disabled onclick="ccVerify()">✅ Verify Encoding</button>
        </div>
        <div id="cc-verify-result" style="margin-top:8px;font-size:12px;"></div>
      </div>

      <!-- Activity Feed -->
      <div class="card">
        <div class="card-title">📡 Activity Feed</div>
        <div id="cc-activity" style="max-height:200px;overflow-y:auto;"><div class="state-loading">Loading...</div></div>
      </div>
    </div>
  </div>

  <!-- Job details -->
  <div class="card" id="cc-job-card" style="display:none;">
    <div class="card-title">📋 Current Batch / Job</div>
    <div id="cc-job-info"></div>
  </div>

  <!-- Tables -->
  <div class="grid-2" style="margin-top:0;">
    <div class="card">
      <div class="card-title">🗂️ Recent Jobs</div>
      <div id="cc-jobs-table"><div class="state-loading">Loading...</div></div>
    </div>
    <div class="card">
      <div class="card-title">📦 Recent Dispatches</div>
      <div id="cc-dispatches-table"><div class="state-loading">Loading...</div></div>
    </div>
  </div>`;

  // Load data
  ccLoadCounters();
  ccLoadCenters();
  ccLoadActivity();
  ccLoadJobsTable();
  ccLoadDispatchesTable();

  // Initialize wallet verification states
  ccCheckGenBtn();
  ccCheckDispatchBtn();

  // Register wallet listener to dynamically update Command Center states
  if (window.onWalletConnected) {
    window.onWalletConnected = window.onWalletConnected.filter(cb => cb.name !== 'ccWalletCallback');
    window.onWalletConnected.push(function ccWalletCallback(addr) {
      ccCheckGenBtn();
      ccCheckDispatchBtn();
    });
  }

  // Upload drag/drop
  const area = document.getElementById('cc-upload-area');
  area.addEventListener('dragover', e => { e.preventDefault(); area.classList.add('drag-over'); });
  area.addEventListener('dragleave', () => area.classList.remove('drag-over'));
  area.addEventListener('drop', e => {
    e.preventDefault(); area.classList.remove('drag-over');
    const f = e.dataTransfer.files[0];
    if (f) { document.getElementById('cc-file-input').files = e.dataTransfer.files; ccFileSelected({ files: [f] }); }
  });
}

async function ccLoadCounters() {
  try {
    const d = await API.get('/api/admin/dashboard/counters');
    document.getElementById('cc-counters').innerHTML = [
      ['Total Jobs', d.total_jobs, ''],
      ['Active Operators', d.active_operators, ''],
      ['Pending Leaks', d.pending_leaks, d.pending_leaks > 0 ? 'Needs review' : ''],
      ['Pending Approvals', d.pending_approvals, d.pending_approvals > 0 ? 'Needs review' : ''],
      ['Ledger Events', d.ledger_events, ''],
      ['Total Centers', d.total_centers, ''],
    ].map(([label, value, note]) => `
      <div class="counter-card">
        <div class="label">${label}</div>
        <div class="value">${value}</div>
        ${note ? `<div class="note">${note}</div>` : ''}
      </div>`).join('');
  } catch { document.getElementById('cc-counters').innerHTML = '<div class="state-error">Failed to load counters</div>'; }
}

async function ccLoadCenters() {
  try {
    const centers = await API.get('/api/centers');
    const sel = document.getElementById('cc-center');
    if (!sel) return;
    sel.innerHTML = '<option value="">Select center...</option>' + centers.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  } catch {}
}

async function ccCenterChanged() {
  const centerId = document.getElementById('cc-center').value;
  ccState.selectedCenter = centerId;
  const opSel = document.getElementById('cc-operator');
  opSel.innerHTML = '<option value="">Loading operators...</option>';
  if (!centerId) { opSel.innerHTML = '<option value="">Select center first</option>'; return; }
  try {
    const ops = await API.get('/api/operators');
    const filtered = ops.filter(o => String(o.center_id) === String(centerId));
    const list = filtered.length ? filtered : ops; // fallback: show all approved operators
    const note = filtered.length ? '' : ' (all operators — none assigned to this center)';
    opSel.innerHTML = list.length
      ? `<option value="">Select operator${note}...</option>` + list.map(o => `<option value="${o.id}">${o.full_name} (${o.operator_id})</option>`).join('')
      : '<option value="">No approved operators found</option>';
  } catch { opSel.innerHTML = '<option value="">Failed to load</option>'; }
  ccCheckGenBtn();
}

function ccCheckGenBtn() {
  const hasFile = !!ccState.masterFile;
  const hasCenter = !!document.getElementById('cc-center')?.value;
  const hasOp = !!document.getElementById('cc-operator')?.value;
  const walletConnected = !!window.walletAddress;
  const btn = document.getElementById('cc-gen-btn');
  if (!btn) return;

  btn.disabled = !(hasFile && hasCenter && hasOp && walletConnected);

  if (!walletConnected) {
    btn.title = 'Wallet connection required. Please connect in sidebar.';
    if (hasFile && hasCenter && hasOp) {
      setMsg(document.getElementById('cc-gen-msg'), '⚠️ Wallet connection required in the sidebar to deploy via UGF.', 'warning');
    }
  } else {
    // Clear warning message if wallet is connected and has other fields
    const msgEl = document.getElementById('cc-gen-msg');
    if (msgEl && msgEl.textContent.includes('Wallet connection required')) {
      msgEl.innerHTML = '';
    }
    
    if (!hasFile) btn.title = 'Upload a master document first';
    else if (!hasCenter) btn.title = 'Select a print center';
    else if (!hasOp) btn.title = 'Select an operator';
    else btn.title = '';
  }
}

function ccCheckDispatchBtn() {
  const btn = document.getElementById('cc-dispatch-btn');
  if (!btn) return;

  const hasJob = !!ccState.lastJobId;
  const walletConnected = !!window.walletAddress;

  btn.disabled = !(hasJob && walletConnected);

  if (!walletConnected && hasJob) {
    btn.title = 'Wallet connection required in sidebar to dispatch.';
  } else if (!hasJob) {
    btn.title = 'Requires generated job';
  } else {
    btn.title = '';
  }
}

async function ccFileSelected(input) {
  const f = input.files[0];
  if (!f) return;
  const msg = document.getElementById('cc-upload-msg');
  setMsg(msg, 'Uploading...', 'info');
  try {
    const fd = new FormData();
    fd.append('file', f);
    const result = await API.upload('/api/upload/master', fd);
    ccState.masterFile = result.filename;
    document.getElementById('cc-file-name').textContent = result.originalName;
    setMsg(msg, `✅ Uploaded: ${result.originalName}`, 'success');
    ccCheckGenBtn();
  } catch (err) {
    setMsg(msg, `❌ ${err.message}`, 'error');
  }
}

async function ccGenerate() {
  const center_id = document.getElementById('cc-center').value;
  const operator_id = document.getElementById('cc-operator').value;
  const copies_count = document.getElementById('cc-copies').value;
  const msg = document.getElementById('cc-gen-msg');
  if (!ccState.masterFile || !center_id || !operator_id) return;

  setMsg(msg, '⚡ Submitting to UGF Relayer...', 'info');
  document.getElementById('cc-gen-btn').disabled = true;

  try {
    const result = await showUGFModal('Generate Fingerprints & Deploy via UGF', () =>
      API.post('/api/jobs/generate', { center_id, operator_id, copies_count, master_file: ccState.masterFile })
    );
    ccState.lastJobId = result.jobId;
    ccState.lastJobRef = result.jobRef;
    ccState.lastBatchId = result.batchId;
    ccState.generatedFiles = result.generatedFiles;

    setMsg(msg, `✅ Generated ${result.generatedFiles.length} encoded copies. Job: ${result.jobRef}`, 'success');

    // Show job card
    document.getElementById('cc-job-card').style.display = 'block';
    document.getElementById('cc-job-info').innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;font-size:13px;">
        <div><span style="color:#64748b">Job Ref</span><br><strong>${result.jobRef}</strong></div>
        <div><span style="color:#64748b">Batch Ref</span><br><strong>${result.batchRef}</strong></div>
        <div><span style="color:#64748b">Copies</span><br><strong>${result.generatedFiles.length}</strong></div>
        <div><span style="color:#64748b">Status</span><br>${statusChip('generated')}</div>
      </div>
      <div style="margin-top:12px;font-size:12px;color:#64748b;">
        ${result.generatedFiles.map(f => `<span style="margin-right:8px;">📄 Copy ${f.copyNumber}: ${f.forensicId}</span>`).join('')}
      </div>`;

    // Enable preview/download/verify
    if (result.generatedFiles.length > 0) {
      const firstFile = result.generatedFiles[0];
      // Use the exact filename returned by the server
      const previewFilename = firstFile.filename;
      ccState.previewFile = { jobId: result.jobId, filename: previewFilename, forensicId: firstFile.forensicId };
      
      ccState.previewDataUrl = result.previewPdfBase64 ? `data:application/pdf;base64,${result.previewPdfBase64}` : null;
      const previewUrl = ccState.previewDataUrl || `/api/jobs/file/${result.jobId}/${encodeURIComponent(previewFilename)}`;
      
      document.getElementById('cc-preview-area').innerHTML =
        `<iframe src="${previewUrl}" style="width:100%;height:100%;border:none;border-radius:6px;"></iframe>`;
      document.getElementById('cc-view-btn').disabled = false;
      document.getElementById('cc-dl-btn').disabled = false;
      document.getElementById('cc-verify-btn').disabled = false;

      // Show placeholder notice if source PDF was not usable
      if (firstFile.usedPlaceholder) {
        setMsg(msg, `✅ Generated ${result.generatedFiles.length} encoded copies (placeholder used — upload a real PDF for full encoding). Job: ${result.jobRef}`, 'success');
      }
    }

    ccCheckDispatchBtn();
    ccLoadCounters();
    ccLoadActivity();
    ccLoadJobsTable();
  } catch (err) {
    setMsg(msg, `❌ ${err.message}`, 'error');
    document.getElementById('cc-gen-btn').disabled = false;
  }
}

async function ccDispatch() {
  if (!ccState.lastJobId) return;
  if (!window.walletAddress) {
    setMsg(document.getElementById('cc-gen-msg'), '❌ Wallet connection required in sidebar to dispatch.', 'error');
    return;
  }
  const msg = document.getElementById('cc-gen-msg');
  try {
    await showUGFModal('Dispatch Job to Operator', () =>
      API.post(`/api/jobs/${ccState.lastJobId}/dispatch`, {})
    );
    setMsg(msg, `✅ Job ${ccState.lastJobRef} dispatched to operator.`, 'success');
    ccCheckDispatchBtn();
    ccLoadCounters();
    ccLoadActivity();
    ccLoadJobsTable();
    ccLoadDispatchesTable();
  } catch (err) {
    setMsg(msg, `❌ ${err.message}`, 'error');
  }
}

function ccViewFile() {
  if (!ccState.previewFile) return;
  if (ccState.previewDataUrl) {
    const win = window.open();
    win.document.write(`<iframe src="${ccState.previewDataUrl}" style="width:100%;height:100%;border:none;margin:0;padding:0;"></iframe>`);
    win.document.close();
  } else {
    window.open(`/api/jobs/file/${ccState.previewFile.jobId}/${ccState.previewFile.filename}`, '_blank');
  }
}

function ccDownloadFile() {
  if (!ccState.previewFile) return;
  const a = document.createElement('a');
  a.href = ccState.previewDataUrl || `/api/jobs/file/${ccState.previewFile.jobId}/${ccState.previewFile.filename}`;
  a.download = ccState.previewFile.filename;
  a.click();
}

async function ccVerify() {
  if (!ccState.previewFile) return;
  const result = document.getElementById('cc-verify-result');
  setMsg(result, 'Verifying encoding...', 'info');
  try {
    const data = await API.get(`/api/jobs/${ccState.previewFile.jobId}/verify/${ccState.previewFile.forensicId}`);
    const p = data.storedPayload;
    result.className = 'state-success';
    result.innerHTML = `✅ Encoding verified — Job: ${p.jobRef} | Copy: ${p.copyNumber} | Operator: ${p.operatorId} | Center: ${p.centerName} | Forensic ID: ${p.forensicId}`;
  } catch (err) {
    setMsg(result, `❌ ${err.message}`, 'error');
  }
}

async function ccLoadActivity() {
  try {
    const logs = await API.get('/api/admin/activity');
    const el = document.getElementById('cc-activity');
    if (!el) return;
    if (!logs.length) { empty(el, 'No activity yet.'); return; }
    el.innerHTML = logs.slice(0, 20).map(l => `
      <div class="activity-item">
        <span class="act-time">${fmtDate(l.created_at).split(',')[1]?.trim() || fmtDate(l.created_at)}</span>
        <span class="act-role">[${l.actor_role || 'sys'}]</span>
        <span class="act-text">${l.action}${l.details ? ' — ' + l.details : ''}</span>
      </div>`).join('');
  } catch {}
}

async function ccLoadJobsTable() {
  try {
    const jobs = await API.get('/api/jobs');
    const el = document.getElementById('cc-jobs-table');
    if (!el) return;
    el.innerHTML = renderTable(
      ['Job Ref', 'Center', 'Operator', 'Copies', 'Status', 'Created'],
      jobs.slice(0, 10),
      j => `<td><code>${j.job_ref}</code></td><td>${j.center_name || '—'}</td><td>${j.operator_name || '—'}</td><td>${j.copies_count}</td><td>${statusChip(j.status)}</td><td>${fmtDate(j.created_at)}</td>`
    );
  } catch {}
}

async function ccLoadDispatchesTable() {
  try {
    const dispatches = await API.get('/api/jobs/dispatches/all');
    const el = document.getElementById('cc-dispatches-table');
    if (!el) return;
    el.innerHTML = renderTable(
      ['Job Ref', 'Center', 'Operator', 'Status', 'Dispatched'],
      dispatches.slice(0, 10),
      d => `<td><code>${d.job_ref || '—'}</code></td><td>${d.center_name || '—'}</td><td>${d.operator_name || '—'}</td><td>${statusChip(d.status)}</td><td>${fmtDate(d.created_at)}</td>`
    );
  } catch {}
}
