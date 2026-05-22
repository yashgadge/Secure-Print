async function renderOperatorControl() {
  const el = document.getElementById('page-operator-control');
  el.innerHTML = `
  <div class="page-header">
    <div class="header-row">
      <div><h1>Operator Control</h1><p>Manage operator access, approvals, and assignments</p></div>
      <button class="btn btn-ghost btn-sm" onclick="renderOperatorControl()">🔄 Refresh</button>
    </div>
  </div>

  <div class="grid-2">
    <div class="card">
      <div class="card-title">⏳ Pending Requests</div>
      <div id="oc-pending"><div class="state-loading">Loading...</div></div>
    </div>
    <div class="card">
      <div class="card-title">✅ Approved Operators</div>
      <div id="oc-approved"><div class="state-loading">Loading...</div></div>
    </div>
  </div>

  <div class="grid-2">
    <div class="card">
      <div class="card-title">🔄 Reassign Zone / Center</div>
      <div class="form-group">
        <label>Operator</label>
        <select class="form-control" id="oc-reassign-op"><option value="">Select operator...</option></select>
      </div>
      <div class="form-group">
        <label>New Center</label>
        <select class="form-control" id="oc-reassign-center"><option value="">Select center...</option></select>
      </div>
      <div id="oc-reassign-msg"></div>
      <button class="btn btn-primary btn-sm" onclick="ocReassign()">Reassign</button>
    </div>
    <div class="card">
      <div class="card-title">📡 Operator Activity Monitor</div>
      <div id="oc-activity"><div class="state-loading">Loading...</div></div>
    </div>
  </div>`;

  ocLoadPending();
  ocLoadApproved();
  ocLoadActivity();
  ocLoadReassignDropdowns();
}

async function ocLoadPending() {
  try {
    const rows = await API.get('/api/operators/requests');
    const pending = rows.filter(r => r.status === 'pending');
    const el = document.getElementById('oc-pending');
    el.innerHTML = renderTable(
      ['Operator ID', 'Name', 'Center', 'Submitted', 'Actions'],
      pending,
      r => `<td><code>${r.operator_id}</code></td><td>${r.full_name}</td><td>${r.center_name || '—'}</td><td>${fmtDate(r.created_at)}</td>
        <td>
          <button class="btn btn-success btn-sm" onclick="ocApprove(${r.id})">✅ Approve</button>
          <button class="btn btn-danger btn-sm" onclick="ocReject(${r.id})">❌ Reject</button>
        </td>`
    );
    if (!pending.length) empty(el, 'No pending requests.');
  } catch { document.getElementById('oc-pending').innerHTML = '<div class="state-error">Failed to load</div>'; }
}

async function ocLoadApproved() {
  try {
    const ops = await API.get('/api/operators');
    const el = document.getElementById('oc-approved');
    el.innerHTML = renderTable(
      ['Operator ID', 'Name', 'Center', 'Device', 'Status', 'Actions'],
      ops,
      o => `<td><code>${o.operator_id}</code></td><td>${o.full_name}</td><td>${o.center_name || '—'}</td><td>${o.device_id || '—'}</td><td>${statusChip(o.status)}</td>
        <td>${o.status !== 'suspended' ? `<button class="btn btn-warning btn-sm" onclick="ocSuspend(${o.id})">⏸ Suspend</button>` : '<span class="chip chip-red">Suspended</span>'}</td>`
    );
    if (!ops.length) empty(el, 'No approved operators yet.');
  } catch { document.getElementById('oc-approved').innerHTML = '<div class="state-error">Failed to load</div>'; }
}

async function ocApprove(id) {
  try {
    await API.post(`/api/operators/requests/${id}/approve`, {});
    ocLoadPending(); ocLoadApproved(); ocLoadReassignDropdowns();
  } catch (err) { alert(err.message); }
}

async function ocReject(id) {
  if (!confirm('Reject this operator request?')) return;
  try {
    await API.post(`/api/operators/requests/${id}/reject`, {});
    ocLoadPending();
  } catch (err) { alert(err.message); }
}

async function ocSuspend(id) {
  if (!confirm('Suspend this operator?')) return;
  try {
    await API.post(`/api/operators/${id}/suspend`, {});
    ocLoadApproved();
  } catch (err) { alert(err.message); }
}

async function ocReassign() {
  const op = document.getElementById('oc-reassign-op').value;
  const center = document.getElementById('oc-reassign-center').value;
  const msg = document.getElementById('oc-reassign-msg');
  if (!op || !center) return setMsg(msg, 'Select operator and center.', 'error');
  try {
    await API.post(`/api/operators/${op}/reassign`, { center_id: center });
    setMsg(msg, '✅ Reassigned successfully.', 'success');
    ocLoadApproved();
  } catch (err) { setMsg(msg, `❌ ${err.message}`, 'error'); }
}

async function ocLoadReassignDropdowns() {
  try {
    const [ops, centers] = await Promise.all([API.get('/api/operators'), API.get('/api/centers')]);
    const opSel = document.getElementById('oc-reassign-op');
    const cSel = document.getElementById('oc-reassign-center');
    if (opSel) opSel.innerHTML = '<option value="">Select operator...</option>' + ops.map(o => `<option value="${o.id}">${o.full_name} (${o.operator_id})</option>`).join('');
    if (cSel) cSel.innerHTML = '<option value="">Select center...</option>' + centers.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  } catch {}
}

async function ocLoadActivity() {
  try {
    const logs = await API.get('/api/admin/activity');
    const opLogs = logs.filter(l => l.actor_role === 'operator' || l.action?.includes('operator'));
    const el = document.getElementById('oc-activity');
    if (!opLogs.length) { empty(el, 'No operator activity yet.'); return; }
    el.innerHTML = opLogs.slice(0, 15).map(l => `
      <div class="activity-item">
        <span class="act-time">${fmtDate(l.created_at).split(',')[1]?.trim() || ''}</span>
        <span class="act-role">[${l.actor_role || 'sys'}]</span>
        <span class="act-text">${l.action}${l.details ? ' — ' + l.details : ''}</span>
      </div>`).join('');
  } catch {}
}
