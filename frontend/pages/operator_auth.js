function renderOperatorLogin() {
  document.getElementById('page-operator-login').innerHTML = `
  <div class="login-wrap">
    <div>
      <div style="text-align:center;margin-bottom:24px;"><div style="font-size:36px;">🖨️</div></div>
      <div class="login-card">
        <h2>Operator Login</h2>
        <div class="sub">Enter your approved operator credentials</div>
        <div class="form-group">
          <label>Operator ID</label>
          <input class="form-control" id="op-id" placeholder="OP-XXXXX" onkeydown="if(event.key==='Enter')opLogin()">
        </div>
        <div class="form-group">
          <label>Password</label>
          <input class="form-control" type="password" id="op-pass" placeholder="••••••••" onkeydown="if(event.key==='Enter')opLogin()">
        </div>
        <div id="op-login-msg"></div>
        <button class="btn btn-primary" style="width:100%;margin-bottom:10px" onclick="opLogin()">Login</button>
        <button class="btn btn-ghost" style="width:100%" onclick="navigate('operator-signup')">New Operator? Request Access</button>
        <div style="text-align:center;margin-top:12px;">
          <button class="btn btn-ghost btn-sm" onclick="navigate('gateway')">← Back</button>
        </div>
      </div>
    </div>
  </div>`;
}

async function opLogin() {
  const operator_id = document.getElementById('op-id').value.trim();
  const password = document.getElementById('op-pass').value;
  const msg = document.getElementById('op-login-msg');
  if (!operator_id || !password) return setMsg(msg, 'Operator ID and password required.', 'error');
  setMsg(msg, 'Authenticating...', 'info');
  try {
    const data = await API.post('/api/auth/operator/login', { operator_id, password });
    appState = { role: 'operator', userId: null, operatorId: data.operatorId, username: data.name };
    navigate('operator-shell');
  } catch (err) {
    if (err.message === 'pending') {
      window._pendingOpId = operator_id;
      navigate('operator-pending');
    } else {
      setMsg(msg, `❌ ${err.message}`, 'error');
    }
  }
}

function renderOperatorSignup() {
  document.getElementById('page-operator-signup').innerHTML = `
  <div class="login-wrap" style="align-items:flex-start;padding-top:40px;">
    <div style="width:460px;">
      <div class="login-card">
        <h2>Request Operator Access</h2>
        <div class="sub">Submit your details for admin approval. You'll be notified once approved.</div>
        <div class="grid-2">
          <div class="form-group">
            <label>Full Name *</label>
            <input class="form-control" id="sig-name" placeholder="John Doe">
          </div>
          <div class="form-group">
            <label>Operator ID *</label>
            <input class="form-control" id="sig-opid" placeholder="OP-12345">
          </div>
          <div class="form-group">
            <label>Email</label>
            <input class="form-control" id="sig-email" type="email" placeholder="you@example.com">
          </div>
          <div class="form-group">
            <label>Phone</label>
            <input class="form-control" id="sig-phone" placeholder="+1 555 0000">
          </div>
        </div>
        <div class="form-group">
          <label>Print Center / Zone</label>
          <select class="form-control" id="sig-center"><option value="">Loading centers...</option></select>
        </div>
        <div class="form-group">
          <label>Printer / Device ID</label>
          <input class="form-control" id="sig-device" placeholder="PRN-001">
        </div>
        <div class="form-group">
          <label>Password *</label>
          <input class="form-control" type="password" id="sig-pass" placeholder="Choose a password">
        </div>
        <div id="sig-msg"></div>
        <button class="btn btn-accent" style="width:100%;margin-bottom:10px" onclick="opSignup()">Submit Access Request</button>
        <button class="btn btn-ghost" style="width:100%" onclick="navigate('operator-login')">Already have access? Login</button>
      </div>
    </div>
  </div>`;

  API.get('/api/centers').then(centers => {
    const sel = document.getElementById('sig-center');
    sel.innerHTML = '<option value="">Select center...</option>' + centers.map(c => `<option value="${c.id}">${c.name} — ${c.zone || ''}</option>`).join('');
  }).catch(() => {});
}

async function opSignup() {
  const full_name = document.getElementById('sig-name').value.trim();
  const operator_id = document.getElementById('sig-opid').value.trim();
  const email = document.getElementById('sig-email').value.trim();
  const phone = document.getElementById('sig-phone').value.trim();
  const center_id = document.getElementById('sig-center').value;
  const device_id = document.getElementById('sig-device').value.trim();
  const password = document.getElementById('sig-pass').value;
  const msg = document.getElementById('sig-msg');

  if (!full_name || !operator_id || !password) return setMsg(msg, 'Full name, Operator ID, and password are required.', 'error');
  setMsg(msg, 'Submitting...', 'info');
  try {
    await API.post('/api/auth/operator/signup', { full_name, operator_id, email, phone, center_id: center_id || null, device_id, password });
    window._pendingOpId = operator_id;
    navigate('operator-pending');
  } catch (err) {
    setMsg(msg, `❌ ${err.message}`, 'error');
  }
}

function renderOperatorPending() {
  const opId = window._pendingOpId || '—';
  document.getElementById('page-operator-pending').innerHTML = `
  <div class="login-wrap">
    <div class="login-card" style="text-align:center;max-width:420px;">
      <div style="font-size:48px;margin-bottom:16px;">⏳</div>
      <h2>Access Pending</h2>
      <div class="sub">Your request is awaiting admin approval</div>
      <div style="background:#fef9c3;border-radius:8px;padding:16px;margin:20px 0;">
        <div style="font-size:12px;color:#a16207;">Operator ID</div>
        <div style="font-size:18px;font-weight:700;color:#92400e;">${opId}</div>
        <div id="pending-status" style="margin-top:8px;font-size:13px;color:#64748b;">Checking status...</div>
      </div>
      <div class="btn-row" style="justify-content:center;">
        <button class="btn btn-ghost btn-sm" onclick="checkPendingStatus()">🔄 Refresh Status</button>
        <button class="btn btn-ghost btn-sm" onclick="navigate('operator-login')">← Back to Login</button>
      </div>
    </div>
  </div>`;
  checkPendingStatus();
}

async function checkPendingStatus() {
  const opId = window._pendingOpId;
  if (!opId) return;
  const el = document.getElementById('pending-status');
  if (!el) return;
  try {
    const data = await API.get(`/api/auth/operator/status/${opId}`);
    if (data.status === 'approved') {
      el.innerHTML = `<span class="chip chip-green">✅ Approved — you can now login</span>`;
    } else if (data.status === 'rejected') {
      el.innerHTML = `<span class="chip chip-red">❌ Request rejected</span>`;
    } else {
      el.innerHTML = `<span class="chip chip-yellow">⏳ ${data.status} — submitted ${fmtDate(data.created_at)}</span>`;
    }
  } catch {
    if (el) el.textContent = 'Could not fetch status.';
  }
}
