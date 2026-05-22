let selectedBountyCase = null;

async function renderBounty() {
  const el = document.getElementById('page-bounty');
  el.innerHTML = `
  <div class="page-header">
    <div class="header-row">
      <div><h1>Bounty Review</h1><p>Eligibility assessment and reward workflow for verified leak reports</p></div>
      <button class="btn btn-ghost btn-sm" onclick="renderBounty()">🔄 Refresh</button>
    </div>
  </div>

  <div class="grid-2">
    <div class="card" style="grid-column:1/-1;">
      <div class="card-title">💰 Bounty Queue</div>
      <div id="bounty-table"><div class="state-loading">Loading...</div></div>
    </div>
  </div>

  <div class="grid-2" id="bounty-detail-area" style="display:none;">
    <div class="card">
      <div class="card-title">📋 Case Details</div>
      <div id="bounty-case-detail"></div>
    </div>
    <div class="card">
      <div class="card-title">⚡ UGF Transaction</div>
      <div id="bounty-ugf-detail"></div>
      <div class="form-group" style="margin-top:12px;">
        <label>Reward Amount (UGF)</label>
        <input class="form-control" type="number" id="bounty-reward-amount" value="500" min="0">
      </div>
      <div id="bounty-action-msg"></div>
      <div class="btn-row" id="bounty-action-btns"></div>
    </div>
  </div>`;

  // Register wallet listener to update UI on connect
  if (window.onWalletConnected) {
    window.onWalletConnected = window.onWalletConnected.filter(cb => cb.name !== 'bountyWalletCallback');
    window.onWalletConnected.push(function bountyWalletCallback(addr) {
      bountyUpdateActions();
    });
  }

  bountyLoadQueue();
}

async function bountyLoadQueue() {
  try {
    const rows = await API.get('/api/admin/bounty');
    const el = document.getElementById('bounty-table');
    el.innerHTML = renderTable(
      ['Case Ref', 'Reporter', 'Confidence', 'Eligibility', 'Status', 'Submitted', 'Actions'],
      rows,
      r => `<td><code>${r.case_ref || '—'}</code></td>
        <td>${r.reporter_name || 'Anonymous'}</td>
        <td>${r.confidence_score ? (r.confidence_score * 100).toFixed(0) + '%' : '—'}</td>
        <td>${statusChip(r.eligibility)}</td>
        <td>${statusChip(r.status)}</td>
        <td>${fmtDate(r.case_date)}</td>
        <td><button class="btn btn-ghost btn-sm" onclick="bountySelectCase(${r.id}, '${r.case_ref}', '${r.eligibility}', '${r.status}', ${r.reward_amount || 0})">Review</button></td>`
    );
    if (!rows.length) empty(el, 'No bounty cases yet. Cases appear after leak attribution.');
  } catch { document.getElementById('bounty-table').innerHTML = '<div class="state-error">Failed to load</div>'; }
}

async function bountySelectCase(id, caseRef, eligibility, status, rewardAmount) {
  document.getElementById('bounty-detail-area').style.display = 'grid';
  document.getElementById('bounty-reward-amount').value = rewardAmount || 500;

  document.getElementById('bounty-case-detail').innerHTML = `
    <div style="font-size:13px;display:grid;gap:8px;">
      <div><span style="color:#64748b">Bounty Case ID</span><br><strong>#${id}</strong></div>
      <div><span style="color:#64748b">Case Reference</span><br><code>${caseRef}</code></div>
      <div><span style="color:#64748b">Eligibility</span><br>${statusChip(eligibility)}</div>
      <div><span style="color:#64748b">Current Status</span><br>${statusChip(status)}</div>
    </div>`;

  // Load UGF transactions
  try {
    const ledger = await API.get(`/api/admin/ledger?search=bounty`);
    const relevant = ledger.filter(l => l.payload?.includes(String(id)));
    document.getElementById('bounty-ugf-detail').innerHTML = relevant.length
      ? relevant.map(l => {
          const p = JSON.parse(l.payload || '{}');
          return `<div style="font-size:12px;margin-bottom:8px;">
            <div><span style="color:#64748b">TX Hash</span><br><code style="word-break:break-all;">${p.txHash || '—'}</code></div>
            <div style="margin-top:4px;"><span style="color:#64748b">Amount</span><br><strong>${p.amount || 0} UGF</strong></div>
            <div style="margin-top:4px;">${statusChip('settled')}</div>
          </div>`;
        }).join('')
      : '<div style="color:#64748b;font-size:13px;">No transaction yet</div>';
  } catch {}

  selectedBountyCase = { id, caseRef, eligibility, status, rewardAmount };
  bountyUpdateActions();
}

function bountyUpdateActions() {
  if (!selectedBountyCase) return;
  const { id, eligibility, status } = selectedBountyCase;
  const btns = document.getElementById('bounty-action-btns');
  const actionMsg = document.getElementById('bounty-action-msg');
  if (!btns || !actionMsg) return;

  const canAct = ['queued', 'escalated'].includes(status) && eligibility === 'eligible';
  
  if (canAct) {
    if (!window.walletAddress) {
      btns.innerHTML = `
        <button class="btn btn-success btn-sm" disabled title="Connect wallet in sidebar to authorize">🔒 Approve Reward (Connect Wallet)</button>
        <button class="btn btn-danger btn-sm" onclick="bountyAction(${id}, 'reject')">❌ Reject</button>
        <button class="btn btn-warning btn-sm" onclick="bountyAction(${id}, 'escalate')">⬆️ Escalate</button>
      `;
      actionMsg.className = 'state-error';
      actionMsg.style.display = 'block';
      actionMsg.innerHTML = `⚠️ <strong>Wallet Connection Required:</strong> Please connect your Web3 or Mock USD wallet in the sidebar to authorize Mock USD gasless payout.`;
    } else {
      btns.innerHTML = `
        <button class="btn btn-success btn-sm" onclick="bountyAction(${id}, 'approve')">✅ Approve Reward</button>
        <button class="btn btn-danger btn-sm" onclick="bountyAction(${id}, 'reject')">❌ Reject</button>
        <button class="btn btn-warning btn-sm" onclick="bountyAction(${id}, 'escalate')">⬆️ Escalate</button>
      `;
      if (actionMsg.textContent.includes('Wallet Connection Required')) {
        actionMsg.style.display = 'none';
        actionMsg.innerHTML = '';
      }
    }
  } else {
    btns.innerHTML = `<div style="color:#64748b;font-size:12px;">No actions available — status: ${status}, eligibility: ${eligibility}</div>`;
    if (actionMsg.textContent.includes('Wallet Connection Required')) {
      actionMsg.style.display = 'none';
      actionMsg.innerHTML = '';
    }
  }
}

async function bountyAction(id, action) {
  const amount = document.getElementById('bounty-reward-amount').value;
  const msg = document.getElementById('bounty-action-msg');
  setMsg(msg, `Processing ${action}...`, 'info');
  try {
    if (action === 'approve') {
      if (!window.walletAddress) {
        setMsg(msg, '❌ Wallet connection required in sidebar to approve reward.', 'error');
        return;
      }
      await showUGFModal('Approve Bounty & Claim Reward', () =>
        API.post(`/api/admin/bounty/${id}/action`, { action, reward_amount: parseFloat(amount) || 0 })
      );
    } else {
      await API.post(`/api/admin/bounty/${id}/action`, { action, reward_amount: parseFloat(amount) || 0 });
    }
    setMsg(msg, `✅ Case ${action}d successfully.`, 'success');
    await bountyLoadQueue();
    const rows = await API.get('/api/admin/bounty');
    const updated = rows.find(r => r.id === id);
    if (updated) {
      bountySelectCase(updated.id, updated.case_ref, updated.eligibility, updated.status, updated.reward_amount);
    } else {
      selectedBountyCase = null;
      document.getElementById('bounty-detail-area').style.display = 'none';
    }
  } catch (err) {
    setMsg(msg, `❌ ${err.message}`, 'error');
  }
}
