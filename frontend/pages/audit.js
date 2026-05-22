async function renderAudit() {
  const el = document.getElementById('page-audit');
  el.innerHTML = `
  <div class="page-header">
    <div class="header-row">
      <div><h1>Audit & Exceptions</h1><p>Incident review, verification, and immutable audit trail</p></div>
      <button class="btn btn-ghost btn-sm" onclick="renderAudit()">🔄 Refresh</button>
    </div>
  </div>

  <div class="card">
    <div class="card-title">🛡️ Audit Queue</div>
    <div id="audit-table"><div class="state-loading">Loading...</div></div>
  </div>

  <div class="card" id="audit-detail-card" style="display:none;">
    <div class="card-title">📋 Exception Detail</div>
    <div id="audit-detail"></div>
    <div class="btn-row" id="audit-action-btns"></div>
    <div id="audit-action-msg" style="margin-top:8px;"></div>
  </div>`;

  auditLoad();
}

async function auditLoad() {
  try {
    const rows = await API.get('/api/admin/audit');
    const el = document.getElementById('audit-table');
    el.innerHTML = renderTable(
      ['ID', 'Event Type', 'Actor', 'Description', 'Status', 'Flags', 'Created', 'Actions'],
      rows,
      r => `<td>#${r.id}</td>
        <td><span class="chip chip-blue">${r.event_type}</span></td>
        <td>${r.actor_role || '—'}</td>
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${r.description || ''}">${r.description || '—'}</td>
        <td>${statusChip(r.status)}</td>
        <td>
          ${r.flagged ? '<span class="chip chip-red">Flagged</span>' : ''}
          ${r.escalated ? '<span class="chip chip-purple">Escalated</span>' : ''}
          ${r.frozen ? '<span class="chip chip-gray">Frozen</span>' : ''}
        </td>
        <td>${fmtDate(r.created_at)}</td>
        <td><button class="btn btn-ghost btn-sm" onclick="auditSelect(${r.id})">Review</button></td>`
    );
    if (!rows.length) empty(el, 'No audit records yet.');
  } catch { document.getElementById('audit-table').innerHTML = '<div class="state-error">Failed to load</div>'; }
}

async function auditSelect(id) {
  try {
    const rows = await API.get('/api/admin/audit');
    const r = rows.find(x => x.id === id);
    if (!r) return;

    document.getElementById('audit-detail-card').style.display = 'block';
    document.getElementById('audit-detail').innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:13px;">
        <div><span style="color:#64748b">Event Type</span><br><strong>${r.event_type}</strong></div>
        <div><span style="color:#64748b">Status</span><br>${statusChip(r.status)}</div>
        <div><span style="color:#64748b">Actor Role</span><br>${r.actor_role || '—'}</div>
        <div><span style="color:#64748b">Actor ID</span><br>${r.actor_id || '—'}</div>
        <div style="grid-column:1/-1;"><span style="color:#64748b">Description</span><br>${r.description || '—'}</div>
        <div><span style="color:#64748b">Flagged</span><br>${r.flagged ? '✅ Yes' : 'No'}</div>
        <div><span style="color:#64748b">Escalated</span><br>${r.escalated ? '✅ Yes' : 'No'}</div>
        <div><span style="color:#64748b">Frozen</span><br>${r.frozen ? '✅ Yes' : 'No'}</div>
        <div><span style="color:#64748b">Created</span><br>${fmtDate(r.created_at)}</div>
      </div>`;

    document.getElementById('audit-action-btns').innerHTML = `
      <button class="btn btn-primary btn-sm" onclick="auditAction(${id},'verify')">✅ Verify</button>
      <button class="btn btn-warning btn-sm" onclick="auditAction(${id},'flag')">🚩 Flag</button>
      <button class="btn btn-danger btn-sm" onclick="auditAction(${id},'escalate')">⬆️ Escalate</button>
      <button class="btn btn-ghost btn-sm" onclick="auditAction(${id},'freeze')">❄️ Freeze Packet</button>`;

    document.getElementById('audit-detail-card').scrollIntoView({ behavior: 'smooth' });
  } catch {}
}

async function auditAction(id, action) {
  const msg = document.getElementById('audit-action-msg');
  setMsg(msg, `Processing ${action}...`, 'info');
  try {
    await API.post(`/api/admin/audit/${id}/action`, { action });
    setMsg(msg, `✅ Entry ${action}d.`, 'success');
    await auditLoad();
    auditSelect(id);
  } catch (err) { setMsg(msg, `❌ ${err.message}`, 'error'); }
}
