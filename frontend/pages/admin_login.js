function renderAdminLogin() {
  document.getElementById('page-admin-login').innerHTML = `
  <div class="login-wrap">
    <div>
      <div style="text-align:center;margin-bottom:24px;">
        <div style="font-size:36px;">🔐</div>
        <div style="color:#64748b;font-size:13px;margin-top:4px;">SecurePrint Ledger</div>
      </div>
      <div class="login-card">
        <h2>Admin Login</h2>
        <div class="sub">Command Center access — authorized personnel only</div>
        <div class="form-group">
          <label>Username</label>
          <input class="form-control" id="adm-user" placeholder="admin" autocomplete="username">
        </div>
        <div class="form-group">
          <label>Password</label>
          <input class="form-control" type="password" id="adm-pass" placeholder="••••••••" autocomplete="current-password" onkeydown="if(event.key==='Enter')admLogin()">
        </div>
        <div id="adm-msg"></div>
        <button class="btn btn-primary" style="width:100%" onclick="admLogin()">Login to Command Center</button>
        <div style="text-align:center;margin-top:16px;">
          <button class="btn btn-ghost btn-sm" onclick="navigate('gateway')">← Back to Gateway</button>
        </div>
      </div>
    </div>
  </div>`;
}

async function admLogin() {
  const username = document.getElementById('adm-user').value.trim();
  const password = document.getElementById('adm-pass').value;
  const msg = document.getElementById('adm-msg');
  if (!username || !password) return setMsg(msg, 'Username and password required.', 'error');
  setMsg(msg, 'Authenticating...', 'info');
  try {
    const data = await API.post('/api/auth/admin/login', { username, password });
    appState = { role: data.role, userId: null, username: data.username };
    navigate('admin-shell');
  } catch (err) {
    setMsg(msg, `❌ ${err.message}`, 'error');
  }
}
