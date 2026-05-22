function renderPublicPortal() {
  const el = document.getElementById('page-public-portal');
  el.innerHTML = `
  <div style="min-height:100vh;background:#f4f6f9;padding:0;">
    <div style="background:#0f1623;padding:16px 32px;display:flex;align-items:center;justify-content:space-between;">
      <div style="color:#00b4d8;font-size:18px;font-weight:700;">🔐 SecurePrint Ledger</div>
      <div style="display:flex;gap:12px;align-items:center;">
        <span class="status-badge badge-green">● Public Portal</span>
        <button class="btn btn-ghost btn-sm" style="color:#8899aa;border-color:#2a3a55" onclick="navigate('gateway')">← Back</button>
      </div>
    </div>
    <div style="max-width:900px;margin:0 auto;padding:32px 24px;">
      <div class="page-header">
        <h1>Public Integrity Portal</h1>
        <p>Submit suspected leaked documents for forensic analysis. Your identity is protected.</p>
      </div>

      <div class="grid-2">
        <div>
          <div class="card">
            <div class="card-title">📤 Submit Leak File</div>
            <div class="upload-area" id="pub-upload-area" onclick="document.getElementById('pub-file-input').click()">
              <div class="upload-icon">📄</div>
              <p>Click or drag a file here</p>
              <p style="font-size:11px;margin-top:4px;">PDF, JPG, PNG accepted</p>
              <div class="file-name" id="pub-file-name"></div>
            </div>
            <input type="file" id="pub-file-input" accept=".pdf,.jpg,.jpeg,.png" style="display:none" onchange="pubFileSelected(this)">
            <div class="form-group" style="margin-top:14px;">
              <label>Your Name (optional)</label>
              <input class="form-control" id="pub-reporter-name" placeholder="Anonymous">
            </div>
            <div class="form-group">
              <label>Contact (optional)</label>
              <input class="form-control" id="pub-reporter-contact" placeholder="Email or phone">
            </div>
            <div id="pub-submit-msg"></div>
            <button class="btn btn-accent" id="pub-submit-btn" disabled onclick="pubSubmit()">Submit Leak Report</button>
          </div>

          <div class="card">
            <div class="card-title">🔎 Track Your Case</div>
            <div class="form-group">
              <label>Case ID</label>
              <input class="form-control" id="pub-track-input" placeholder="CASE-XXXXXXXXXX">
            </div>
            <button class="btn btn-primary btn-sm" onclick="pubTrack()">Track Status</button>
            <div id="pub-track-result" style="margin-top:14px;"></div>
          </div>
        </div>

        <div>
          <div class="card" id="pub-case-card" style="display:none;">
            <div class="card-title">📋 Case Information</div>
            <div id="pub-case-info"></div>
          </div>

          <div class="card" id="pub-timeline-card" style="display:none;">
            <div class="card-title">📅 Case Timeline</div>
            <ul class="timeline" id="pub-timeline"></ul>
          </div>

          <div class="card">
            <div class="card-title">📂 Recent Cases</div>
            <div id="pub-recent-cases"><div class="state-empty">📭 Submit a case to see it here.</div></div>
          </div>
        </div>
      </div>
    </div>
  </div>`;

  // Drag and drop
  const area = document.getElementById('pub-upload-area');
  area.addEventListener('dragover', e => { e.preventDefault(); area.classList.add('drag-over'); });
  area.addEventListener('dragleave', () => area.classList.remove('drag-over'));
  area.addEventListener('drop', e => {
    e.preventDefault(); area.classList.remove('drag-over');
    const f = e.dataTransfer.files[0];
    if (f) { document.getElementById('pub-file-input').files = e.dataTransfer.files; pubFileSelected({ files: [f] }); }
  });

  pubLoadRecentCases();
}

let pubSelectedFile = null;
function pubFileSelected(input) {
  const f = input.files[0];
  if (!f) return;
  pubSelectedFile = f;
  document.getElementById('pub-file-name').textContent = f.name;
  document.getElementById('pub-submit-btn').disabled = false;
}

async function pubSubmit() {
  if (!pubSelectedFile) return;
  const btn = document.getElementById('pub-submit-btn');
  const msg = document.getElementById('pub-submit-msg');
  btn.disabled = true;
  setMsg(msg, 'Uploading leak file...', 'info');

  try {
    const fd = new FormData();
    fd.append('file', pubSelectedFile);
    const upload = await API.upload('/api/upload/leak', fd);

    setMsg(msg, 'Submitting leak case report...', 'info');
    const result = await API.post('/api/leaks/submit', {
      filename: upload.filename,
      original_filename: upload.originalName,
      reporter_name: document.getElementById('pub-reporter-name').value || null,
      reporter_contact: document.getElementById('pub-reporter-contact').value || null
    });

    const caseId = result.caseId;
    const caseRef = result.caseRef;


    setMsg(msg, 'Executing automated forensic scans...', 'info');
    const scanResult = await showUGFModal('Scan Leak & Attribute to Chain', () =>
      API.post(`/api/leaks/${caseId}/scan`, {})
    );

    if (scanResult.found) {
      setMsg(msg, `✅ Analysis complete! Forensic markers detected (Attributed with ${(scanResult.confidence * 100).toFixed(0)}% confidence). Case ID: ${caseRef}`, 'success');
    } else {
      setMsg(msg, `⚠️ Analysis complete: No matching forensic markers found. Case ID: ${caseRef}`, 'warning');
    }

    pubSelectedFile = null;
    document.getElementById('pub-file-name').textContent = '';
    document.getElementById('pub-reporter-name').value = '';
    document.getElementById('pub-reporter-contact').value = '';
    document.getElementById('pub-track-input').value = caseRef;
    
    pubAddRecentCase(caseRef);
    pubTrack();
  } catch (err) {
    setMsg(msg, `❌ ${err.message}`, 'error');
    btn.disabled = false;
  }
}

async function pubTrack() {
  const caseRef = document.getElementById('pub-track-input').value.trim();
  if (!caseRef) return;
  const result = document.getElementById('pub-track-result');
  setMsg(result, 'Looking up case...', 'info');
  try {
    const data = await API.get(`/api/leaks/track/${caseRef}`);
    setMsg(result, '', 'info');
    pubShowCase(data);
  } catch (err) {
    setMsg(result, `❌ ${err.message}`, 'error');
  }
}

function pubShowCase(data) {
  const card = document.getElementById('pub-case-card');
  const info = document.getElementById('pub-case-info');
  card.style.display = 'block';
  info.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px;">
      <div><span style="color:#64748b">Case ID</span><br><strong>${data.case_ref}</strong></div>
      <div><span style="color:#64748b">Status</span><br>${statusChip(data.status)}</div>
      <div><span style="color:#64748b">Submitted</span><br>${fmtDate(data.created_at)}</div>
      <div><span style="color:#64748b">Confidence</span><br><strong>${data.confidence_score ? (data.confidence_score * 100).toFixed(0) + '%' : 'Pending'}</strong></div>
    </div>`;

  if (data.timeline && data.timeline.length) {
    document.getElementById('pub-timeline-card').style.display = 'block';
    document.getElementById('pub-timeline').innerHTML = data.timeline.map(e => `
      <li>
        <div>
          <div class="tl-label">${e.event_type?.replace(/_/g, ' ').toUpperCase()}</div>
          <div class="tl-time">${fmtDate(e.created_at)}</div>
          <div class="tl-note">${e.description || ''}</div>
        </div>
      </li>`).join('');
  }
}

function pubAddRecentCase(caseRef) {
  let list = [];
  try {
    list = JSON.parse(localStorage.getItem('spl_recent_cases') || '[]');
  } catch {}
  if (!list.includes(caseRef)) {
    list.unshift(caseRef);
    if (list.length > 5) list = list.slice(0, 5);
    localStorage.setItem('spl_recent_cases', JSON.stringify(list));
  }
  pubLoadRecentCases();
}

function pubLoadRecentCases() {
  const el = document.getElementById('pub-recent-cases');
  if (!el) return;
  let list = [];
  try {
    list = JSON.parse(localStorage.getItem('spl_recent_cases') || '[]');
  } catch {}
  if (!list.length) {
    el.innerHTML = '<div class="state-empty">📭 Submit a case to see it here.</div>';
    return;
  }
  el.innerHTML = list.map(ref => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #e2e8f0;font-size:13px;">
      <code>${ref}</code>
      <button class="btn btn-ghost btn-sm" onclick="document.getElementById('pub-track-input').value='${ref}'; pubTrack();">Track</button>
    </div>
  `).join('');
}
