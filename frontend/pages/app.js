// App state
let appState = { role: null, userId: null, username: null, operatorId: null };

// Global Wallet Pub-Sub & State Variables
window.walletAddress = null;
window.walletBalance = null;
window.onWalletConnected = window.onWalletConnected || [];


const ADMIN_NAV = [
  { group: 'Operations' },
  { id: 'command', label: 'Command Center', icon: '🎛️' },
  { id: 'operator-control', label: 'Operator Control', icon: '👥' },
  { id: 'active-jobs', label: 'Active Jobs', icon: '🖨️' },
  { group: 'Forensics' },
  { id: 'leak-trace', label: 'Leak Trace Console', icon: '🔍' },
  { id: 'bounty', label: 'Bounty Review', icon: '💰' },
  { group: 'Records' },
  { id: 'ledger', label: 'Ledger Explorer', icon: '📒' },
  { id: 'audit', label: 'Audit & Exceptions', icon: '🛡️' },
  { group: 'Infrastructure' },
  { id: 'print-nodes', label: 'Print Nodes', icon: '🖥️' },
  { id: 'security', label: 'Security Protocol', icon: '🔒' },
];

const OPERATOR_NAV = [
  { group: 'My Work' },
  { id: 'active-jobs', label: 'Active Jobs', icon: '🖨️' },
];

function buildSidebar(nav) {
  const container = document.getElementById('sidebar-nav');
  container.innerHTML = nav.map(item => {
    if (item.group) return `<div class="nav-group">${item.group}</div>`;
    return `<div class="nav-item" id="nav-${item.id}" onclick="showPage('${item.id}')"><span class="icon">${item.icon}</span>${item.label}</div>`;
  }).join('');
}

function showPage(pageId) {
  document.querySelectorAll('#main .page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const page = document.getElementById(`page-${pageId}`);
  if (page) { page.classList.add('active'); }
  const navItem = document.getElementById(`nav-${pageId}`);
  if (navItem) navItem.classList.add('active');

  // Render page content
  const renderers = {
    'command': renderCommandCenter,
    'operator-control': renderOperatorControl,
    'leak-trace': renderLeakTrace,
    'bounty': renderBounty,
    'ledger': renderLedger,
    'print-nodes': renderPrintNodes,
    'security': renderSecurity,
    'audit': renderAudit,
    'active-jobs': renderActiveJobs,
  };
  if (renderers[pageId]) renderers[pageId]();
}

function navigate(target) {
  // Hide all top-level views
  document.getElementById('page-gateway').style.display = 'none';
  document.getElementById('app-shell').style.display = 'none';
  document.getElementById('page-public-portal').style.display = 'none';
  document.getElementById('page-admin-login').style.display = 'none';
  document.getElementById('page-operator-login').style.display = 'none';
  document.getElementById('page-operator-signup').style.display = 'none';
  document.getElementById('page-operator-pending').style.display = 'none';

  if (target === 'gateway') {
    document.getElementById('page-gateway').style.display = 'flex';
  } else if (target === 'public-portal') {
    document.getElementById('page-public-portal').style.display = 'block';
    renderPublicPortal();
  } else if (target === 'admin-login') {
    document.getElementById('page-admin-login').style.display = 'block';
    renderAdminLogin();
  } else if (target === 'operator-login') {
    document.getElementById('page-operator-login').style.display = 'block';
    renderOperatorLogin();
  } else if (target === 'operator-signup') {
    document.getElementById('page-operator-signup').style.display = 'block';
    renderOperatorSignup();
  } else if (target === 'operator-pending') {
    document.getElementById('page-operator-pending').style.display = 'block';
    renderOperatorPending();
  } else if (target === 'admin-shell') {
    document.getElementById('app-shell').style.display = 'flex';
    buildSidebar(ADMIN_NAV);
    document.getElementById('sb-role').textContent = appState.role?.toUpperCase() || 'ADMIN';
    document.getElementById('sb-user').textContent = appState.username || 'Admin';
    showPage('command');
  } else if (target === 'operator-shell') {
    document.getElementById('app-shell').style.display = 'flex';
    buildSidebar(OPERATOR_NAV);
    document.getElementById('sb-role').textContent = 'OPERATOR';
    document.getElementById('sb-user').textContent = appState.operatorId || 'Operator';
    showPage('active-jobs');
  }
}

async function doLogout() {
  const url = appState.role === 'operator' ? '/api/auth/operator/logout' : '/api/auth/admin/logout';
  await fetch(url, { method: 'POST' }).catch(() => {});
  appState = { role: null, userId: null, username: null, operatorId: null };
  
  // Clear mock wallet from localStorage on logout to ensure clean presentation states
  localStorage.removeItem('connectedWalletAddress');
  window.walletAddress = null;
  window.walletBalance = null;
  
  const btn = document.getElementById('btn-connect-wallet');
  const addrDiv = document.getElementById('wallet-address');
  const balDiv = document.getElementById('wallet-balance');
  if (btn && addrDiv) {
    btn.style.display = 'block';
    addrDiv.style.display = 'none';
    addrDiv.textContent = '';
  }
  if (balDiv) {
    balDiv.style.display = 'none';
    balDiv.textContent = '';
  }

  navigate('gateway');
}

// MetaMask Wallet connection integration (falls back to premium Mock USD Testnet wallet injection if absent)
async function connectMetaMask() {
  if (typeof window.ethereum !== 'undefined') {
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      if (accounts.length > 0) {
        showConnectedWallet(accounts[0]);
      }
    } catch (err) {
      console.error('MetaMask connection failed:', err);
    }
  } else {
    // Premium Mock USD Testnet Wallet Fallback Injection
    console.log('[Wallet] MetaMask not found. Injecting premium Mock USD Testnet wallet.');
    const mockAddress = '0x71C7656EC7ab88b098defB751B7401B5f6d8976F';
    showConnectedWallet(mockAddress);
  }
}

function showConnectedWallet(address) {
  window.walletAddress = address;
  window.walletBalance = '$500.00 Mock USD';
  localStorage.setItem('connectedWalletAddress', address);

  const btn = document.getElementById('btn-connect-wallet');
  const addrDiv = document.getElementById('wallet-address');
  const balDiv = document.getElementById('wallet-balance');
  
  if (btn && addrDiv) {
    btn.style.display = 'none';
    addrDiv.style.display = 'block';
    addrDiv.textContent = address.substring(0, 6) + '...' + address.substring(address.length - 4);
    addrDiv.title = address;
  }
  if (balDiv) {
    balDiv.style.display = 'block';
    balDiv.textContent = '$500.00 Mock USD';
  }

  // Notify registered callbacks of the wallet connection/change
  if (window.onWalletConnected) {
    window.onWalletConnected.forEach(cb => {
      try { cb(address); } catch (err) { console.error('Error in wallet connected callback:', err); }
    });
  }
}

async function checkMetaMaskOnLoad() {
  // Check if there is a cached mock or MetaMask wallet in localStorage first
  const cachedAddress = localStorage.getItem('connectedWalletAddress');
  if (cachedAddress) {
    showConnectedWallet(cachedAddress);
  }

  if (typeof window.ethereum !== 'undefined') {
    try {
      const accounts = await window.ethereum.request({ method: 'eth_accounts' });
      if (accounts.length > 0) {
        showConnectedWallet(accounts[0]);
      }
    } catch (err) {
      console.error('Error checking MetaMask accounts:', err);
    }
    // Listen for account changes
    window.ethereum.on('accountsChanged', (accounts) => {
      if (accounts.length > 0) {
        showConnectedWallet(accounts[0]);
      } else {
        localStorage.removeItem('connectedWalletAddress');
        window.walletAddress = null;
        window.walletBalance = null;
        const btn = document.getElementById('btn-connect-wallet');
        const addrDiv = document.getElementById('wallet-address');
        const balDiv = document.getElementById('wallet-balance');
        if (btn && addrDiv) {
          btn.style.display = 'block';
          addrDiv.style.display = 'none';
          addrDiv.textContent = '';
        }
        if (balDiv) {
          balDiv.style.display = 'none';
          balDiv.textContent = '';
        }
        // Notify callbacks of disconnection
        if (window.onWalletConnected) {
          window.onWalletConnected.forEach(cb => {
            try { cb(null); } catch (err) { console.error(err); }
          });
        }
      }
    });
  }
}

// On load: check session
window.addEventListener('DOMContentLoaded', async () => {
  // Check MetaMask connection
  checkMetaMaskOnLoad();
  
  try {
    const sess = await API.get('/api/auth/session');
    if (sess.authenticated) {
      appState = { role: sess.role, userId: sess.userId, username: sess.username, operatorId: sess.operatorId };
      if (['admin', 'superadmin'].includes(sess.role)) navigate('admin-shell');
      else if (sess.role === 'operator') navigate('operator-shell');
    } else {
      navigate('gateway');
    }
  } catch (err) {
    navigate('gateway');
  }
});
