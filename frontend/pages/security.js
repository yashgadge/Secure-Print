async function renderSecurity() {
  const el = document.getElementById('page-security');
  el.innerHTML = `
  <div class="page-header">
    <div class="header-row">
      <div><h1>Security Protocol</h1><p>System-wide security settings and incident controls</p></div>
      <button class="btn btn-ghost btn-sm" onclick="renderSecurity()">🔄 Refresh</button>
    </div>
  </div>

  <div class="grid-2">
    <div>
      <div class="card">
        <div class="card-title">🔒 Security Toggles</div>
        <div id="sec-toggles"><div class="state-loading">Loading...</div></div>
        <div id="sec-save-msg" style="margin-top:10px;"></div>
        <button class="btn btn-primary btn-sm" style="margin-top:10px;" onclick="secSave()">💾 Save Settings</button>
      </div>

      <div class="card">
        <div class="card-title">⏱️ Session Settings</div>
        <div class="form-group">
          <label>Session Timeout (seconds)</label>
          <input class="form-control" type="number" id="sec-timeout" value="3600" min="300">
        </div>
        <div id="sec-session-msg"></div>
        <button class="btn btn-primary btn-sm" onclick="secSaveSession()">Save</button>
      </div>
    </div>

    <div>
      <div class="card">
        <div class="card-title">🚨 Incident Controls</div>
        <div style="display:grid;gap:10px;">
          <div style="padding:14px;background:#fef2f2;border-radius:8px;border:1px solid #fecaca;">
            <div style="font-weight:600;font-size:13px;margin-bottom:6px;">System Lockdown</div>
            <div style="font-size:12px;color:#64748b;margin-bottom:10px;">Immediately halt all print operations and restrict access.</div>
            <div style="display:flex;gap:8px;">
              <button class="btn btn-danger btn-sm" onclick="secLockdown('lock')">🔴 Activate Lockdown</button>
              <button class="btn btn-success btn-sm" onclick="secLockdown('unlock')">🟢 Unlock System</button>
            </div>
          </div>
          <div style="padding:14px;background:#f0f9ff;border-radius:8px;border:1px solid #bae6fd;">
            <div style="font-weight:600;font-size:13px;margin-bottom:6px;">Revoke Operator Session</div>
            <div class="form-group" style="margin-bottom:8px;">
              <label>Operator ID</label>
              <select class="form-control" id="sec-revoke-op"><option value="">Select operator...</option></select>
            </div>
            <button class="btn btn-warning btn-sm" onclick="secRevoke()">⚡ Revoke Token</button>
          </div>
        </div>
        <div id="sec-incident-msg" style="margin-top:10px;"></div>
      </div>

      <div class="card">
        <div class="card-title">🛡️ Security Events</div>
        <div id="sec-events"><div class="state-loading">Loading...</div></div>
      </div>
    </div>
  </div>`;

  secLoadSettings();
  secLoadOperators();
  secLoadEvents();
}

async function secLoadSettings() {
  try {
    const s = await API.get('/api/admin/security');
    document.getElementById('sec-timeout').value = s.session_timeout || 3600;

    const toggleDefs = [
      { key: 'screenshot_blocking', label: 'Screenshot Blocking', desc: 'Prevent screen capture on sensitive pages' },
      { key: 'watermarking', label: 'Document Watermarking', desc: 'Embed visible watermarks in all generated copies' },
      { key: 'blockchain_logging', label: 'Blockchain Logging', desc: 'Write all events to immutable ledger' },
      { key: 'export_restriction', label: 'Export Restriction', desc: 'Restrict PDF export to admin only' },
    ];

    document.getElementById('sec-toggles').innerHTML = toggleDefs.map(t => `
      <div class="toggle-row">
        <div>
          <div class="toggle-label">${t.label}</div>
          <div class="toggle-desc">${t.desc}</div>
        </div>
        <label class="toggle">
          <input type="checkbox" id="sec-toggle-${t.key}" ${s[t.key] === 'true' ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
      </div>`).join('');
  } catch { document.getElementById('sec-toggles').innerHTML = '<div class="state-error">Failed to load settings</div>'; }
}

async function secSave() {
  const msg = document.getElementById('sec-save-msg');
  const keys = ['screenshot_blocking', 'watermarking', 'blockchain_logging', 'export_restriction'];
  const data = {};
  keys.forEach(k => {
    const el = document.getElementById(`sec-toggle-${k}`);
    if (el) data[k] = el.checked ? 'true' : 'false';
  });
  try {
    await API.post('/api/admin/security', data);
    setMsg(msg, '✅ Settings saved.', 'success');
  } catch (err) { setMsg(msg, `❌ ${err.message}`, 'error'); }
}

async function secSaveSession() {
  const timeout = document.getElementById('sec-timeout').value;
  const msg = document.getElementById('sec-session-msg');
  try {
    await API.post('/api/admin/security', { session_timeout: timeout });
    setMsg(msg, '✅ Session timeout saved.', 'success');
  } catch (err) { setMsg(msg, `❌ ${err.message}`, 'error'); }
}

async function secLockdown(action) {
  const msg = document.getElementById('sec-incident-msg');
  try {
    await API.post('/api/admin/security/lockdown', { action });
    setMsg(msg, `✅ System ${action === 'lock' ? 'locked down' : 'unlocked'}.`, action === 'lock' ? 'error' : 'success');
  } catch (err) { setMsg(msg, `❌ ${err.message}`, 'error'); }
}

async function secRevoke() {
  const user_id = document.getElementById('sec-revoke-op').value;
  const msg = document.getElementById('sec-incident-msg');
  if (!user_id) return setMsg(msg, 'Select an operator.', 'error');
  try {
    await API.post('/api/admin/security/revoke-token', { user_id, role: 'operator' });
    setMsg(msg, '✅ Token revoked. Operator suspended.', 'success');
    secLoadOperators();
  } catch (err) { setMsg(msg, `❌ ${err.message}`, 'error'); }
}

async function secLoadOperators() {
  try {
    const ops = await API.get('/api/operators');
    const sel = document.getElementById('sec-revoke-op');
    if (sel) sel.innerHTML = '<option value="">Select operator...</option>' + ops.map(o => `<option value="${o.id}">${o.full_name} (${o.operator_id}) — ${o.status}</option>`).join('');
  } catch {}
}

async function secLoadEvents() {
  try {
    const secLogs = await API.get('/api/admin/security/events');
    const el = document.getElementById('sec-events');
    if (!secLogs.length) { empty(el, 'No security events yet.'); return; }
    el.innerHTML = secLogs.slice(0, 15).map(l => `
      <div class="activity-item">
        <span class="act-time">${fmtDate(l.created_at).split(',')[1]?.trim() || ''}</span>
        <span class="act-role">[sys]</span>
        <span class="act-text">${l.event_type}${l.description ? ' — ' + l.description : ''}</span>
      </div>`).join('');
  } catch {}
}
