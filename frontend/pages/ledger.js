async function renderLedger() {
  const el = document.getElementById('page-ledger');
  el.innerHTML = `
  <div class="page-header">
    <div class="header-row">
      <div><h1>Ledger Explorer</h1><p>Immutable audit records — every system event preserved</p></div>
      <button class="btn btn-ghost btn-sm" onclick="renderLedger()">🔄 Refresh</button>
    </div>
  </div>

  <div class="card">
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">
      <div class="form-group" style="margin:0;flex:1;min-width:200px;">
        <label>Search</label>
        <input class="form-control" id="ledger-search" placeholder="Job ref, batch, case, hash..." onkeydown="if(event.key==='Enter')ledgerLoad()">
      </div>
      <div class="form-group" style="margin:0;min-width:160px;">
        <label>Record Type</label>
        <select class="form-control" id="ledger-type" onchange="ledgerLoad()">
          <option value="">All types</option>
          <option value="job_generated">Job Generated</option>
          <option value="job_dispatched">Job Dispatched</option>
          <option value="job_completed">Job Completed</option>
          <option value="leak_attributed">Leak Attributed</option>
          <option value="bounty_approved">Bounty Approved</option>
          <option value="operator_approved">Operator Approved</option>
          <option value="dispatch_verified">Dispatch Verified</option>
        </select>
      </div>
      <button class="btn btn-primary btn-sm" onclick="ledgerLoad()">🔍 Search</button>
    </div>
  </div>

  <div class="card">
    <div class="card-title">📒 Ledger Records</div>
    <div id="ledger-table"><div class="state-loading">Loading...</div></div>
  </div>

  <div class="card" id="ledger-detail-card" style="display:none;">
    <div class="card-title">🔎 Record Detail</div>
    <div id="ledger-detail"></div>
  </div>`;

  ledgerLoad();
}

async function ledgerLoad() {
  const search = document.getElementById('ledger-search')?.value || '';
  const type = document.getElementById('ledger-type')?.value || '';
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (type) params.set('type', type);

  try {
    const rows = await API.get(`/api/admin/ledger?${params}`);
    const el = document.getElementById('ledger-table');
    el.innerHTML = renderTable(
      ['Timestamp', 'Type', 'Source', 'Reference', 'On-Chain Tx', 'Actions'],
      rows,
      r => {
        let payload = {};
        try { payload = JSON.parse(r.payload || '{}'); } catch {}
        const txHash = payload.ugfTxHash || payload.txHash || '';
        const txLink = txHash 
          ? `<a href="https://sepolia.basescan.org/tx/${txHash}" target="_blank" style="color:var(--accent);font-weight:600;font-family:monospace;" title="${txHash}">${txHash.substring(0, 10)}... 🔗</a>` 
          : '<span style="color:var(--muted)">Simulated / Off-chain</span>';
        
        return `<td>${fmtDate(r.created_at)}</td>
          <td><span class="chip chip-blue">${r.record_type}</span></td>
          <td>${r.source || '—'}</td>
          <td><code>${r.reference_id || '—'}</code></td>
          <td>${txLink}</td>
          <td><button class="btn btn-ghost btn-sm" onclick="ledgerShowDetail(${r.id})">View</button></td>`;
      }
    );
    if (!rows.length) empty(el, 'No ledger records found.');
  } catch (err) { 
    console.error(err);
    document.getElementById('ledger-table').innerHTML = '<div class="state-error">Failed to load ledger</div>'; 
  }
}

async function ledgerShowDetail(id) {
  try {
    const r = await API.get(`/api/admin/ledger/${id}`);
    if (!r) return;
    let payload = {};
    try { payload = JSON.parse(r.payload || '{}'); } catch {}

    const txHash = payload.ugfTxHash || payload.txHash || '';
    const txLink = txHash 
      ? `<a href="https://sepolia.basescan.org/tx/${txHash}" target="_blank" style="color:var(--accent);font-weight:bold;font-family:monospace;word-break:break-all;">${txHash} 🔗</a>` 
      : '<span style="color:var(--muted)">No on-chain transaction</span>';

    document.getElementById('ledger-detail-card').style.display = 'block';
    document.getElementById('ledger-detail').innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;font-size:13px;">
        <div><span style="color:#64748b">Record ID</span><br><strong>#${r.id}</strong></div>
        <div><span style="color:#64748b">Type</span><br><span class="chip chip-blue">${r.record_type}</span></div>
        <div><span style="color:#64748b">Source</span><br>${r.source || '—'}</div>
        <div><span style="color:#64748b">Reference</span><br><code>${r.reference_id || '—'}</code></div>
        <div><span style="color:#64748b">Table</span><br>${r.reference_table || '—'}</div>
        <div><span style="color:#64748b">Timestamp</span><br>${fmtDate(r.created_at)}</div>
        <div style="grid-column:1/-1;"><span style="color:#64748b">Base Sepolia Tx</span><br>${txLink}</div>
        <div style="grid-column:1/-1;"><span style="color:#64748b">Proof Hash</span><br><code style="word-break:break-all;font-size:11px;">${r.proof_hash}</code></div>
        <div style="grid-column:1/-1;"><span style="color:#64748b">Payload</span><br><pre style="background:#f8fafc;padding:10px;border-radius:6px;font-size:11px;overflow-x:auto;">${JSON.stringify(payload, null, 2)}</pre></div>
      </div>`;
    document.getElementById('ledger-detail-card').scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    console.error(err);
  }
}
