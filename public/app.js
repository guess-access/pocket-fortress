// App entry: boot, authentication screens, shell layout and routing.
import { state, router, api, esc, icon, toast, onUnauthorized, loadAll } from './core.js';
import { renderDashboard, renderTransactions, renderBudgets, renderReports } from './views.js';
import { renderAdmin, renderSettings } from './admin.js';

const app = document.getElementById('app');

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: 'home' },
  { id: 'transactions', label: 'Transactions', icon: 'list' },
  { id: 'budgets', label: 'Budgets', icon: 'target' },
  { id: 'reports', label: 'Reports', icon: 'chart' },
  { id: 'admin', label: 'Admin', icon: 'users', adminOnly: true },
  { id: 'settings', label: 'Settings', icon: 'gear' },
];

const VIEWS = {
  dashboard: renderDashboard,
  transactions: renderTransactions,
  budgets: renderBudgets,
  reports: renderReports,
  admin: renderAdmin,
  settings: renderSettings,
};

const MARK = `<div class="brand-mark">${icon('wallet')}</div>`;

let shell = null; // { role } once the shell DOM is built
let viewSeq = 0;
let renderedRoute = null;

/* ------------------------------------------------------- router wiring */

router.go = (name) => {
  const target = `#/${name}`;
  if (location.hash === target) refresh();
  else location.hash = target;
};
router.refresh = () => refresh();
router.showAuth = () => {
  shell = null;
  renderedRoute = null;
  history.replaceState(null, '', '#/dashboard');
  renderAuth();
};

function currentRoute() {
  const raw = location.hash.replace(/^#\/?/, '').split('/')[0];
  return VIEWS[raw] ? raw : 'dashboard';
}

window.addEventListener('hashchange', () => {
  const route = currentRoute();
  if (route !== renderedRoute) refresh();
});

onUnauthorized(() => {
  if (!state.user) return;
  state.user = null;
  shell = null;
  renderedRoute = null;
  history.replaceState(null, '', '#/dashboard');
  renderAuth();
  toast('Your session ended. Please sign in again.', 'error');
});

/* ------------------------------------------------------------- views */

async function refresh() {
  if (!state.user) return renderAuth();
  if (!shell || shell.role !== state.user.role) buildShell();

  let name = currentRoute();
  if (name === 'admin' && state.user.role !== 'admin') {
    // Never show another account's area: bounce non-admins to their dashboard.
    history.replaceState(null, '', '#/dashboard');
    name = 'dashboard';
  }
  renderedRoute = name;
  document.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.nav === name);
  });

  const view = document.getElementById('view');
  if (!view) return;
  const seq = ++viewSeq;
  try {
    await (VIEWS[name] || renderDashboard)(view);
  } catch (err) {
    if (seq !== viewSeq) return;
    view.innerHTML = `
      <div class="card">
        <div class="empty">
          ${icon('alert')}
          <b>Could not load this page</b>
          <span class="small">${esc(err.message)}</span>
        </div>
      </div>`;
    const retry = document.createElement('button');
    retry.className = 'btn btn-sm';
    retry.textContent = 'Try again';
    retry.addEventListener('click', () => refresh());
    view.querySelector('.empty')?.appendChild(retry);
  }
}

/* -------------------------------------------------------------- shell */

function navButtons() {
  return NAV_ITEMS
    .filter((item) => !item.adminOnly || state.user?.role === 'admin')
    .map((item) => `<button class="nav-item" data-nav="${item.id}">${icon(item.icon)}<span>${item.label}</span></button>`)
    .join('');
}

function buildShell() {
  const nav = navButtons();
  const username = state.user.username;
  const role = state.user.role;
  const initials = username.slice(0, 2).toUpperCase();

  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand-row">${MARK}<div><div class="brand-title">Pocket Fortress</div><div class="brand-sub">One paycheck = one entry</div></div></div>
        <nav class="nav">${nav}</nav>
        <div class="side-foot">
          <div class="avatar">${initials}</div>
          <div class="who"><b>${esc(username)}</b><span>${esc(role)}</span></div>
          <button class="icon-btn" data-signout title="Sign out" aria-label="Sign out">${icon('logout')}</button>
        </div>
      </aside>

      <main class="main">
        <header class="topbar">
          <div class="brand-row">${MARK}<div><div class="brand-title">Pocket Fortress</div></div></div>
          <div style="display:flex;align-items:center;gap:6px">
            <div class="who"><b>${esc(username)}</b><span>${esc(role)}</span></div>
            <button class="icon-btn" data-signout title="Sign out" aria-label="Sign out">${icon('logout')}</button>
          </div>
        </header>
        <div class="view" id="view"></div>
      </main>

      <nav class="tabbar">${nav}</nav>
    </div>`;

  app.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => router.go(btn.dataset.nav));
  });
  app.querySelectorAll('[data-signout]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try { await api('/logout', { method: 'POST' }); } catch { /* already gone */ }
      state.user = null;
      shell = null;
      renderedRoute = null;
      history.replaceState(null, '', '#/dashboard');
      renderAuth();
    });
  });

  shell = { role };
}

/* --------------------------------------------------------- auth screens */

function authError(el, message) {
  el.textContent = message;
  el.classList.add('show');
}

function renderAuth() {
  app.innerHTML = `
    <div class="auth">
      <div class="auth-card">
        <div class="brand-row">${MARK}<div><div class="brand-title">Pocket Fortress</div><div class="brand-sub">Private tracker &middot; every income counted once</div></div></div>
        <h1>Sign in</h1>
        <p class="muted">Use the username and password created for you by the main admin.</p>
        <div class="form-error" id="auth-error"></div>
        <form id="login-form">
          <div class="field">
            <label>Username</label>
            <input name="username" autocomplete="username" autocapitalize="none" autocorrect="off" required />
          </div>
          <div class="field">
            <label>Password</label>
            <input name="password" type="password" autocomplete="current-password" required />
          </div>
          <button class="btn btn-primary" type="submit">Sign in</button>
        </form>
        <div class="auth-foot">Accounts are created by the main admin.</div>
      </div>
    </div>`;

  const error = document.getElementById('auth-error');
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const username = String(fd.get('username') || '');
    const password = String(fd.get('password') || '');
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try {
      const res = await api('/login', { method: 'POST', body: { username, password } });
      state.user = res.user;
      state.storage = res.storage || state.storage;
      history.replaceState(null, '', '#/dashboard'); // fresh session always starts home
      await enterApp();
    } catch (err) {
      authError(error, err.message);
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  });
}

function renderSetup() {
  app.innerHTML = `
    <div class="auth">
      <div class="auth-card">
        <div class="brand-row">${MARK}<div><div class="brand-title">Pocket Fortress</div><div class="brand-sub">First-time setup</div></div></div>
        <h1>Create the main admin</h1>
        <p class="muted">This one-time account creates and manages every user login. It cannot open anyone's ledger.</p>
        <div class="setup-note">${icon('info')} Pick a username and password you will remember — each user's login is created from this account later.</div>
        <div class="form-error" id="setup-error"></div>
        <form id="setup-form">
          <div class="field">
            <label>Admin username</label>
            <input name="username" autocomplete="off" autocapitalize="none" autocorrect="off" placeholder="e.g. admin" required />
          </div>
          <div class="field">
            <label>Password</label>
            <input name="password" type="password" autocomplete="new-password" placeholder="At least 8 characters" required />
          </div>
          <div class="field">
            <label>Repeat password</label>
            <input name="confirm" type="password" autocomplete="new-password" required />
          </div>
          <div class="field">
            <label>Display currency</label>
            <select name="currency">
              ${['USD', 'EUR', 'GBP', 'PHP', 'INR', 'SGD', 'MYR', 'AED', 'NGN', 'KES', 'BRL', 'ZAR', 'AUD', 'CAD', 'JPY', 'CNY']
                .map((c) => `<option value="${c}" ${c === 'USD' ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </div>
          <button class="btn btn-primary" type="submit">Create admin account</button>
        </form>
        <div class="auth-foot">This screen disappears once the admin exists.</div>
      </div>
    </div>`;

  const error = document.getElementById('setup-error');
  document.getElementById('setup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const username = String(fd.get('username') || '').trim();
    const password = String(fd.get('password') || '');
    const confirm = String(fd.get('confirm') || '');
    const currency = String(fd.get('currency') || 'USD');
    error.classList.remove('show');

    if (username.length < 3) return authError(error, 'Username must be at least 3 characters.');
    if (password.length < 8) return authError(error, 'Password must be at least 8 characters.');
    if (password !== confirm) return authError(error, 'Passwords do not match.');

    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Creating…';
    try {
      const res = await api('/setup', { method: 'POST', body: { username, password } });
      state.user = res.user;
      state.storage = res.storage || state.storage;
      history.replaceState(null, '', '#/dashboard'); // fresh setup starts home
      const saved = await api('/settings', { method: 'PUT', body: { currency } });
      state.prefs = saved.prefs;
      toast('Admin account created.', 'success');
      await enterApp();
    } catch (err) {
      authError(error, err.message);
      btn.disabled = false;
      btn.textContent = 'Create admin account';
    }
  });
}

/* ------------------------------------------------------------ start up */

async function enterApp() {
  shell = null;
  renderedRoute = null;
  try {
    await loadAll();
  } catch (err) {
    toast(err.message, 'error');
  }
  buildShell();
  if (!location.hash || location.hash === '#/' || location.hash === '#') {
    history.replaceState(null, '', '#/dashboard');
  }
  await refresh();
}

async function boot() {
  try {
    const s = await api('/state');
    state.user = s.user;
    state.setupRequired = s.setupRequired;
    state.storage = s.storage;
    if (s.setupRequired) return renderSetup();
    if (!s.user) return renderAuth();
    await enterApp();
  } catch (err) {
    app.innerHTML = `
      <div class="boot">
        ${icon('alert')}
        <p>${esc(err.message)}</p>
        <button class="btn btn-sm" onclick="location.reload()">Retry</button>
      </div>`;
  }
}

boot();
