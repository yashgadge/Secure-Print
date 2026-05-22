async function renderPrintNodes() {
  const el = document.getElementById('page-print-nodes');
  el.innerHTML = `
  <div class="page-header">
    <div class="header-row">
      <div><h1>Print Nodes</h1><p>Monitor and manage physical and virtual printing resources</p></div>
      <button class="btn btn-ghost btn-sm" onclick="renderPrintNodes()">🔄 Refresh</button>
    </div>
  </div>

  <div class="card">
    <div class="card-title">➕ Register New Node</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">
      <div class="form-group" style="margin:0;flex:1;min-width:140px;">
        <label>Node Name</label>
        <input class="form-control" id="pn-name" placeholder="Node Alpha">
      </div>
      <div class="form-group" style="margin:0;flex:1;min-width:140px;">
        <label>Printer ID</label>
        <input class="form-control" id="pn-printer-id" placeholder="PRN-001">
      </div>
      <div class="form-group" style="margin:0;flex:1;min-width:140px;">
        <label>Center</label>
        <select class="form-control" id="pn-center"><option value="">Select...</option></select>
      </div>
      <button class="btn btn-primary btn-sm" onclick="pnCreate()">Add Node</button>
    </div>
    <div id="pn-create-msg" style="margin-top:8px;"></div>
  </div>

  <div class="card">
    <div class="card-title">🖥️ Node Health</div>
    <div id="pn-nodes-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;"></div>
  </div>

  <div class="card">
    <div class="card-title">📊 Telemetry</div>
    <div id="pn-telemetry"><div class="state-loading">Loading...</div></div>
  </div>`;

  pnLoadCenters();
  pnLoadNodes();
}

async function pnLoadCenters() {
  try {
    const centers = await API.get('/api/centers');
    const sel = document.getElementById('pn-center');
    if (sel) sel.innerHTML = '<option value="">Select center...</option>' + centers.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  } catch {}
}

async function pnLoadNodes() {
  try {
    const nodes = await API.get('/api/centers/nodes');
    const grid = document.getElementById('pn-nodes-grid');
    if (!nodes.length) { grid.innerHTML = '<div class="state-empty">📭 No nodes registered yet.</div>'; return; }
    grid.innerHTML = nodes.map(n => `
      <div style="background:white;border:1px solid #e2e8f0;border-radius:10px;padding:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
          <strong style="font-size:14px;">${n.node_name}</strong>
          ${statusChip(n.status)}
        </div>
        <div style="font-size:12px;color:#64748b;margin-bottom:4px;">Printer: <code>${n.printer_id}</code></div>
        <div style="font-size:12px;color:#64748b;margin-bottom:4px;">Center: ${n.center_name || '—'}</div>
        <div style="font-size:12px;color:#64748b;margin-bottom:4px;">Queue: ${n.queue_length} jobs</div>
        <div style="font-size:11px;color:#94a3b8;margin-bottom:10px;">Last sync: ${fmtDate(n.last_sync)}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button class="btn btn-ghost btn-sm" onclick="pnAction(${n.id},'test')">🖨️ Test</button>
          <button class="btn btn-ghost btn-sm" onclick="pnAction(${n.id},'restart')">🔄 Restart</button>
          ${n.enabled ? `<button class="btn btn-warning btn-sm" onclick="pnAction(${n.id},'disable')">⏸ Disable</button>` : `<button class="btn btn-success btn-sm" onclick="pnAction(${n.id},'enable')">▶ Enable</button>`}
        </div>
      </div>`).join('');

    // Load telemetry for all nodes
    pnLoadTelemetry(nodes[0]?.id);
  } catch { document.getElementById('pn-nodes-grid').innerHTML = '<div class="state-error">Failed to load nodes</div>'; }
}

async function pnLoadTelemetry(nodeId) {
  if (!nodeId) { document.getElementById('pn-telemetry').innerHTML = '<div class="state-empty">Select a node to view telemetry.</div>'; return; }
  try {
    const rows = await API.get(`/api/centers/nodes/${nodeId}/telemetry`);
    const el = document.getElementById('pn-telemetry');
    el.innerHTML = renderTable(
      ['Printer ID', 'Metric', 'Value', 'Recorded At'],
      rows,
      r => `<td><code>${r.printer_id}</code></td><td>${r.metric}</td><td>${r.value}</td><td>${fmtDate(r.recorded_at)}</td>`
    );
    if (!rows.length) empty(el, 'No telemetry data yet.');
  } catch {}
}

async function pnCreate() {
  const node_name = document.getElementById('pn-name').value.trim();
  const printer_id = document.getElementById('pn-printer-id').value.trim();
  const center_id = document.getElementById('pn-center').value;
  const msg = document.getElementById('pn-create-msg');
  if (!node_name || !printer_id) return setMsg(msg, 'Node name and printer ID required.', 'error');
  try {
    await API.post('/api/centers/nodes', { node_name, printer_id, center_id: center_id || null });
    setMsg(msg, '✅ Node registered.', 'success');
    document.getElementById('pn-name').value = '';
    document.getElementById('pn-printer-id').value = '';
    pnLoadNodes();
  } catch (err) { setMsg(msg, `❌ ${err.message}`, 'error'); }
}

async function pnAction(id, action) {
  try {
    await API.post(`/api/centers/nodes/${id}/action`, { action });
    pnLoadNodes();
  } catch (err) { alert(err.message); }
}
