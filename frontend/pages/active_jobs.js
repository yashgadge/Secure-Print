async function renderActiveJobs() {
  const el = document.getElementById('page-active-jobs');
  const isAdmin = ['admin', 'superadmin'].includes(appState.role);

  el.innerHTML = `
  <div class="page-header">
    <div class="header-row">
      <div><h1>Active Jobs</h1><p>${isAdmin ? 'All print jobs across the system' : 'Your assigned print jobs'}</p></div>
      <button class="btn btn-ghost btn-sm" onclick="renderActiveJobs()">🔄 Refresh</button>
    </div>
  </div>

  <div class="card">
    <div class="card-title">🖨️ Print Jobs</div>
    <div id="jobs-table"><div class="state-loading">Loading...</div></div>
  </div>

  <div class="card" id="job-detail-card" style="display:none;">
    <div class="card-title">📋 Job Controls</div>
    <div id="job-detail"></div>
    <div class="btn-row" id="job-action-btns"></div>
    <div id="job-action-msg" style="margin-top:8px;"></div>
  </div>`;

  ajLoadJobs();
}

async function ajLoadJobs() {
  try {
    const jobs = await API.get('/api/jobs');
    const el = document.getElementById('jobs-table');
    el.innerHTML = renderTable(
      ['Job Ref', 'Center', 'Operator', 'Copies', 'Status', 'Started', 'Actions'],
      jobs,
      j => `<td><code>${j.job_ref}</code></td>
        <td>${j.center_name || '—'}</td>
        <td>${j.operator_name || '—'}</td>
        <td>${j.copies_count}</td>
        <td>${statusChip(j.status)}</td>
        <td>${fmtDate(j.started_at)}</td>
        <td><button class="btn btn-ghost btn-sm" onclick="ajSelectJob(${j.id}, '${j.job_ref}', '${j.status}')">Manage</button></td>`
    );
    if (!jobs.length) empty(el, 'No jobs assigned yet.');
  } catch { document.getElementById('jobs-table').innerHTML = '<div class="state-error">Failed to load jobs</div>'; }
}

function ajSelectJob(id, jobRef, status) {
  document.getElementById('job-detail-card').style.display = 'block';
  document.getElementById('job-detail').innerHTML = `
    <div style="font-size:13px;display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <div><span style="color:#64748b">Job Reference</span><br><strong>${jobRef}</strong></div>
      <div><span style="color:#64748b">Current Status</span><br>${statusChip(status)}</div>
    </div>`;

  const btns = document.getElementById('job-action-btns');
  const actions = [];

  if (['dispatched', 'pending', 'generated'].includes(status)) {
    actions.push(`<button class="btn btn-success btn-sm" onclick="ajAction(${id},'start')">▶ Start Print</button>`);
  }
  if (status === 'printing') {
    actions.push(`<button class="btn btn-warning btn-sm" onclick="ajAction(${id},'pause')">⏸ Pause</button>`);
    actions.push(`<button class="btn btn-primary btn-sm" onclick="ajAction(${id},'complete')">✅ Complete</button>`);
  }
  if (status === 'paused') {
    actions.push(`<button class="btn btn-success btn-sm" onclick="ajAction(${id},'resume')">▶ Resume</button>`);
    actions.push(`<button class="btn btn-primary btn-sm" onclick="ajAction(${id},'complete')">✅ Complete</button>`);
  }
  if (['dispatched', 'printing', 'completed'].includes(status)) {
    actions.push(`<button class="btn btn-ghost btn-sm" onclick="ajVerifyDispatch(${id})">📦 Verify Dispatch</button>`);
  }

  if (!actions.length) {
    btns.innerHTML = `<div style="color:#64748b;font-size:12px;">No actions available for status: ${status}</div>`;
  } else {
    btns.innerHTML = actions.join('');
  }

  document.getElementById('job-detail-card').scrollIntoView({ behavior: 'smooth' });
}

async function ajAction(id, action) {
  const msg = document.getElementById('job-action-msg');
  setMsg(msg, `Processing ${action}...`, 'info');
  try {
    let result;
    if (action === 'start') {
      result = await showUGFModal('Accept & Start Print Job', () => 
        API.post(`/api/jobs/${id}/action`, { action })
      );
    } else {
      result = await API.post(`/api/jobs/${id}/action`, { action });
    }
    setMsg(msg, `✅ Job ${action}ed. New status: ${result.newStatus}`, 'success');
    ajLoadJobs();
    const jobRef = document.querySelector('#job-detail strong')?.textContent || 'JOB';
    ajSelectJob(id, jobRef, result.newStatus);
  } catch (err) { setMsg(msg, `❌ ${err.message}`, 'error'); }
}

async function ajVerifyDispatch(id) {
  const msg = document.getElementById('job-action-msg');
  setMsg(msg, 'Verifying dispatch...', 'info');
  try {
    await showUGFModal('Verify Dispatch & Submit Acknowledgment', () =>
      API.post(`/api/jobs/${id}/verify-dispatch`, {})
    );
    setMsg(msg, '✅ Dispatch verified and recorded.', 'success');
    ajLoadJobs();
    const jobRef = document.querySelector('#job-detail strong')?.textContent;
    const statusBadge = document.querySelector('#job-detail .chip');
    const status = statusBadge ? statusBadge.textContent.trim() : 'dispatched';
    if (jobRef) {
      ajSelectJob(id, jobRef, status);
    }
  } catch (err) { setMsg(msg, `❌ ${err.message}`, 'error'); }
}
