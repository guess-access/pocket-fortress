// Admin (account management) and Settings views.
// Privacy rule: the admin manages accounts only — no one can read another
// user's transactions, budgets or reports.
import {
  api, state, router, esc, icon, toast, timeAgo, CURRENCIES, loadUsers,
} from './core.js';

/* ==================================================== Admin */

export async function renderAdmin(root) {
  if (state.user?.role !== 'admin') {
    root.innerHTML = `
      <div class="view-head"><h1>Admin</h1></div>
      <div class="card">${'<div class="empty">' + icon('lock') + '<b>Admin access required</b><span class="small">Only the main admin can manage accounts.</span></div>'}</div>`;
    return;
  }

  await loadUsers();
  const users = state.users;

  root.innerHTML = `
    <div class="view-head">
      <div>
        <h1>Accounts</h1>
        <div class="sub">Create and manage logins for each device user.</div>
      </div>
    </div>

    <div class="privacy-note">
      ${icon('shield')}
      <div><b>Private by design.</b> You can create, disable and reset accounts — but nobody, including you, can open another person's ledger. Each account's transactions stay hidden to everyone else.</div>
    </div>

    <div class="card">
      <div class="card-head"><h2>Create account</h2></div>
      <div class="form-error" id="admin-error"></div>
      <form id="admin-create">
        <div class="form-row">
          <div class="field">
            <label>Username</label>
            <input name="username" autocomplete="off" autocapitalize="none" placeholder="e.g. maria" />
          </div>
          <div class="field">
            <label>Password</label>
            <input name="password" type="text" autocomplete="off" placeholder="At least 8 characters" />
          </div>
          <div class="field">
            <label>Role</label>
            <select name="role">
              <option value="user">User (own ledger only)</option>
              <option value="admin">Admin (can manage accounts)</option>
            </select>
          </div>
        </div>
        <div class="form-actions">
          <button class="btn btn-primary" type="submit">${icon('plus')} Create account</button>
        </div>
      </form>
    </div>

    <div class="card">
      <div class="card-head">
        <h2>All accounts</h2>
        <span class="muted small">${users.length} ${users.length === 1 ? 'account' : 'accounts'}</span>
      </div>
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th>Username</th><th>Role</th><th>Status</th><th>Last sign-in</th><th class="right">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${users.map((u) => `
              <tr>
                <td><b>${esc(u.username)}</b>${u.username === state.user.username ? ' <span class="badge blue">you</span>' : ''}</td>
                <td><span class="badge ${u.role === 'admin' ? 'blue' : 'gray'}">${u.role}</span></td>
                <td><span class="badge ${u.active ? 'green' : 'red'}">${u.active ? 'active' : 'disabled'}</span></td>
                <td class="small muted">${timeAgo(u.lastLoginAt)}</td>
                <td class="actions">
                  <button class="btn btn-sm" data-act="password" data-user="${esc(u.username)}">${icon('lock')} Reset</button>
                  <button class="btn btn-sm" data-act="toggle" data-user="${esc(u.username)}">${u.active ? 'Disable' : 'Enable'}</button>
                  ${u.username !== state.user.username
                    ? `<button class="btn btn-sm" data-act="role" data-user="${esc(u.username)}">${u.role === 'admin' ? 'Make user' : 'Make admin'}</button>
                       <button class="btn btn-sm btn-danger" data-act="delete" data-user="${esc(u.username)}">${icon('trash')}</button>`
                    : ''}
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;

  const errBox = root.querySelector('#admin-error');

  root.querySelector('#admin-create').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const username = String(fd.get('username') || '').trim().toLowerCase();
    const password = String(fd.get('password') || '');
    const role = String(fd.get('role') || 'user');
    errBox.classList.remove('show');
    if (username.length < 3) {
      errBox.textContent = 'Username must be at least 3 characters.';
      return errBox.classList.add('show');
    }
    if (password.length < 8) {
      errBox.textContent = 'Password must be at least 8 characters.';
      return errBox.classList.add('show');
    }
    try {
      await api('/admin/users', { method: 'POST', body: { username, password, role } });
      toast(`Account "${username}" created. Share the login with them.`, 'success');
      router.refresh();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.add('show');
    }
  });

  root.querySelectorAll('[data-act]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const user = btn.dataset.user;
      const act = btn.dataset.act;
      const account = state.users.find((u) => u.username === user);

      try {
        if (act === 'password') {
          const next = prompt(`New password for "${user}" (min 8 characters):`);
          if (next === null) return;
          if (next.length < 8) return toast('Password must be at least 8 characters.', 'error');
          await api(`/admin/users/${user}`, { method: 'PUT', body: { password: next } });
          toast(`Password updated for ${user}. Their sessions were signed out.`, 'success');
        } else if (act === 'toggle') {
          const nextActive = !account?.active;
          if (!nextActive && !confirm(`Disable "${user}"? They will be signed out immediately.`)) return;
          await api(`/admin/users/${user}`, { method: 'PUT', body: { active: nextActive } });
          toast(nextActive ? `${user} enabled.` : `${user} disabled.`, 'success');
        } else if (act === 'role') {
          const nextRole = account?.role === 'admin' ? 'user' : 'admin';
          if (nextRole === 'user' && !confirm(`Remove admin rights from "${user}"?`)) return;
          await api(`/admin/users/${user}`, { method: 'PUT', body: { role: nextRole } });
          toast(`${user} is now ${nextRole}.`, 'success');
        } else if (act === 'delete') {
          if (!confirm(`Delete "${user}" permanently? Their entries, budgets and categories will be removed.`)) return;
          await api(`/admin/users/${user}`, { method: 'DELETE' });
          toast(`Account ${user} deleted.`, 'success');
        }
        router.refresh();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}

/* ==================================================== Settings */

export async function renderSettings(root) {
  const prefs = state.prefs || { currency: 'USD' };

  root.innerHTML = `
    <div class="view-head">
      <div>
        <h1>Settings</h1>
        <div class="sub">Your account, currency and password.</div>
      </div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <div class="card-head"><h2>Account</h2></div>
        <div class="budget-top">
          <div class="name">Username</div>
          <div class="muted"><b>${esc(state.user.username)}</b></div>
        </div>
        <div class="budget-top" style="margin-top:10px">
          <div class="name">Role</div>
          <div><span class="badge ${state.user.role === 'admin' ? 'blue' : 'gray'}">${esc(state.user.role)}</span></div>
        </div>
        <div class="budget-top" style="margin-top:10px">
          <div class="name">Storage</div>
          <div class="muted small">${esc(state.storage)}</div>
        </div>
        <div class="divider"></div>
        <p class="tiny muted">Your ledger is private: only your own username can open these transactions.</p>
        <div class="form-actions">
          <button class="btn" id="btn-signout">${icon('logout')} Sign out</button>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h2>Display currency</h2></div>
        <form id="currency-form">
          <div class="field">
            <label>Currency used across your ledger</label>
            <select name="currency">
              ${CURRENCIES.map((c) => `<option value="${c}" ${c === prefs.currency ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </div>
          <div class="form-actions">
            <button class="btn btn-primary" type="submit">${icon('check')} Save currency</button>
          </div>
        </form>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h2>Change password</h2></div>
      <div class="form-error" id="pw-error"></div>
      <form id="pw-form">
        <div class="form-row">
          <div class="field">
            <label>Current password</label>
            <input name="currentPassword" type="password" autocomplete="current-password" />
          </div>
          <div class="field">
            <label>New password</label>
            <input name="newPassword" type="password" autocomplete="new-password" placeholder="At least 8 characters" />
          </div>
          <div class="field">
            <label>Repeat new password</label>
            <input name="repeatPassword" type="password" autocomplete="new-password" />
          </div>
        </div>
        <div class="form-actions">
          <button class="btn btn-primary" type="submit">${icon('check')} Update password</button>
        </div>
      </form>
    </div>`;

  root.querySelector('#btn-signout').addEventListener('click', () => signOut());

  root.querySelector('#currency-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const currency = new FormData(e.target).get('currency');
    try {
      const res = await api('/settings', { method: 'PUT', body: { currency } });
      state.prefs = res.prefs;
      toast('Currency updated.', 'success');
      router.refresh();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  const pwErr = root.querySelector('#pw-error');
  root.querySelector('#pw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const currentPassword = String(fd.get('currentPassword') || '');
    const newPassword = String(fd.get('newPassword') || '');
    const repeatPassword = String(fd.get('repeatPassword') || '');
    pwErr.classList.remove('show');

    if (newPassword.length < 8) {
      pwErr.textContent = 'New password must be at least 8 characters.';
      return pwErr.classList.add('show');
    }
    if (newPassword !== repeatPassword) {
      pwErr.textContent = 'New passwords do not match.';
      return pwErr.classList.add('show');
    }
    try {
      await api('/password', { method: 'POST', body: { currentPassword, newPassword } });
      toast('Password changed.', 'success');
      router.refresh();
    } catch (err) {
      pwErr.textContent = err.message;
      pwErr.classList.add('show');
    }
  });
}

async function signOut() {
  try { await api('/logout', { method: 'POST' }); } catch { /* already signed out */ }
  state.user = null;
  router.showAuth();
}
