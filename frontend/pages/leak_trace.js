let ltState = { uploadedFile: null, caseId: null };

async function renderLeakTrace() {
  const el = document.getElementById('page-leak-trace');
  el.innerHTML = `
  <div class="page-header">
    <div class="header-row">
      <div><h1>Leak Trace Console</h1><p>Forensic scanning and attribution of leaked documents</p></div>
      <span class="status-badge badge-blue">🔍 Scan Mode</span>
    </div>
  </div>

  <div class="grid-2">
    <div>
      <div class="card">
        <div class="card-title">📤 Upload Leak File</div>
        <div class="upload-area" id="lt-upload-area" onclick="document.getElementById('lt-file-input').click()">
          <div class="upload-icon">🔍</div>
          <p>Upload suspected leaked document</p>
          <p style="font-size:11px;margin-top:4px;">PDF, JPG, PNG accepted</p>
          <div class="file-name" id="lt-file-name"></div>
        </div>
        <input type="file" id="lt-file-input" accept=".pdf,.jpg,.jpeg,.png" style="display:none" onchange="ltFileSelected(this)">
        <div id="lt-upload-msg" style="margin-top:8px;"></div>
        <div class="btn-row">
          <button class="btn btn-accent" id="lt-scan-btn" disabled onclick="ltScan()">🔬 Initiate Deep Trace Analysis</button>
        </div>
      </div>

      <div class="card" id="lt-confidence-card" style="display:none;">
        <div class="card-title">📊 Confidence Score</div>
        <div id="lt-confidence-bar"></div>
      </div>

      <div class="card" id="lt-ledger-card" style="display:none;">
        <div class="card-title">🔗 Ledger Proof</div>
        <div id="lt-ledger-info"></div>
      </div>
    </div>

    <div>
      <div class="card" id="lt-attribution-card" style="display:none;">
        <div class="card-title">🎯 Recovered Attribution</div>
        <div id="lt-attribution-info"></div>
      </div>

      <div class="card" id="lt-timeline-card" style="display:none;">
        <div class="card-title">📅 Chain of Custody</div>
        <ul class="timeline" id="lt-timeline"></ul>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-title">📂 All Leak Cases</div>
    <div id="lt-cases-table"><div class="state-loading">Loading...</div></div>
  </div>`;

  ltLoadCases();

  const area = document.getElementById('lt-upload-area');
  area.addEventListener('dragover', e => { e.preventDefault(); area.classList.add('drag-over'); });
  area.addEventListener('dragleave', () => area.classList.remove('drag-over'));
  area.addEventListener('drop', e => {
    e.preventDefault(); area.classList.remove('drag-over');
    const f = e.dataTransfer.files[0];
    if (f) { document.getElementById('lt-file-input').files = e.dataTransfer.files; ltFileSelected({ files: [f] }); }
  });
}

async function ltFileSelected(input) {
  const f = input.files[0];
  if (!f) return;
  const msg = document.getElementById('lt-upload-msg');
  setMsg(msg, 'Uploading...', 'info');
  try {
    const fd = new FormData();
    fd.append('file', f);
    const upload = await API.upload('/api/upload/leak', fd);

    // Create case
    const result = await API.post('/api/leaks/submit', {
      filename: upload.filename,
      original_filename: upload.originalName,
      reporter_name: 'Admin Trace',
      reporter_contact: null
    });

    ltState.uploadedFile = upload.filename;
    ltState.caseId = result.caseId;
    document.getElementById('lt-file-name').textContent = upload.originalName;
    setMsg(msg, `✅ File uploaded. Case: ${result.caseRef}`, 'success');
    document.getElementById('lt-scan-btn').disabled = false;
  } catch (err) {
    setMsg(msg, `❌ ${err.message}`, 'error');
  }
}

async function ltScan() {
  if (!ltState.caseId) return;
  const btn = document.getElementById('lt-scan-btn');
  const msg = document.getElementById('lt-upload-msg');
  btn.disabled = true;
  setMsg(msg, '🔬 Running deep trace analysis...', 'info');

  try {
    const result = await API.post(`/api/leaks/${ltState.caseId}/scan`, {});

    if (!result.found) {
      setMsg(msg, `⚠️ No match found. ${result.reason || 'No forensic markers detected.'} (layer: ${result.recoveryLayer || 'none'})`, 'error');
      btn.disabled = false;
      return;
    }

    setMsg(msg, `✅ Attribution confirmed with ${(result.confidence * 100).toFixed(0)}% confidence`, 'success');

    // Confidence bar
    const confCard = document.getElementById('lt-confidence-card');
    confCard.style.display = 'block';
    const pct = (result.confidence * 100).toFixed(0);
    const color = result.confidence > 0.9 ? '#22c55e' : result.confidence > 0.7 ? '#f59e0b' : '#ef4444';
    document.getElementById('lt-confidence-bar').innerHTML = `
      <div style="font-size:32px;font-weight:700;color:${color};margin-bottom:8px;">${pct}%</div>
      <div style="background:#f1f5f9;border-radius:8px;height:12px;overflow:hidden;">
        <div style="width:${pct}%;height:100%;background:${color};border-radius:8px;transition:width 0.5s;"></div>
      </div>
      <div style="font-size:12px;color:#64748b;margin-top:6px;">${result.confidence > 0.9 ? 'High confidence match' : result.confidence > 0.7 ? 'Probable match' : 'Low confidence'}</div>`;

    // Attribution
    const attr = result.attribution;
    document.getElementById('lt-attribution-card').style.display = 'block';
    document.getElementById('lt-attribution-info').innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:13px;">
        <div><span style="color:#64748b">Job Reference</span><br><strong>${attr.jobRef || '—'}</strong></div>
        <div><span style="color:#64748b">Batch Reference</span><br><strong>${attr.batchRef || '—'}</strong></div>
        <div><span style="color:#64748b">Copy Number</span><br><strong>#${attr.copyNumber || '—'}</strong></div>
        <div><span style="color:#64748b">Forensic ID</span><br><code style="font-size:11px;">${result.payload?.forensicId || '—'}</code></div>
        <div><span style="color:#64748b">Operator ID</span><br><strong>${attr.operatorId || '—'}</strong></div>
        <div><span style="color:#64748b">Operator Name</span><br><strong>${attr.operatorName || '—'}</strong></div>
        <div><span style="color:#64748b">Print Center</span><br><strong>${attr.centerName || '—'}</strong></div>
        <div><span style="color:#64748b">Generated At</span><br><strong>${fmtDate(result.payload?.generatedAt)}</strong></div>
      </div>`;

    // Load timeline
    const caseDetail = await API.get(`/api/leaks/${ltState.caseId}`);
    if (caseDetail.timeline?.length) {
      document.getElementById('lt-timeline-card').style.display = 'block';
      document.getElementById('lt-timeline').innerHTML = caseDetail.timeline.map(e => `
        <li>
          <div>
            <div class="tl-label">${e.event_type?.replace(/_/g, ' ').toUpperCase()}</div>
            <div class="tl-time">${fmtDate(e.created_at)}</div>
            <div class="tl-note">${e.description || ''}</div>
          </div>
        </li>`).join('');
    }

    // Ledger proof
    const ledgerRows = await API.get(`/api/admin/ledger?search=${encodeURIComponent(caseDetail.case_ref)}`);
    if (ledgerRows.length) {
      document.getElementById('lt-ledger-card').style.display = 'block';
      document.getElementById('lt-ledger-info').innerHTML = `
        <div style="font-size:12px;">
          <div><span style="color:#64748b">Proof Hash</span><br><code style="word-break:break-all;">${ledgerRows[0].proof_hash}</code></div>
          <div style="margin-top:8px;"><span style="color:#64748b">Record Type</span><br><strong>${ledgerRows[0].record_type}</strong></div>
          <div style="margin-top:8px;"><span style="color:#64748b">Timestamp</span><br>${fmtDate(ledgerRows[0].created_at)}</div>
        </div>`;
    }

    ltLoadCases();
  } catch (err) {
    setMsg(msg, `❌ ${err.message}`, 'error');
    btn.disabled = false;
  }
}

async function ltLoadCases() {
  try {
    const cases = await API.get('/api/leaks');
    const el = document.getElementById('lt-cases-table');
    if (!el) return;
    el.innerHTML = renderTable(
      ['Case Ref', 'Status', 'Confidence', 'Operator', 'Center', 'Job Ref', 'Submitted'],
      cases,
      c => `<td><code>${c.case_ref}</code></td><td>${statusChip(c.status)}</td>
        <td>${c.confidence_score ? (c.confidence_score * 100).toFixed(0) + '%' : '—'}</td>
        <td>${c.op_name || '—'}</td><td>${c.center_name || '—'}</td>
        <td>${c.job_ref ? `<code>${c.job_ref}</code>` : '—'}</td>
        <td>${fmtDate(c.created_at)}</td>`
    );
  } catch {}
}
