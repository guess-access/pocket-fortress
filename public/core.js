// Shared state, API client, formatting helpers and UI utilities.

export const state = {
  user: null,
  setupRequired: false,
  storage: 'unknown',
  prefs: { currency: 'USD' },
  categories: { presets: { income: [], expense: [] }, custom: [] },
  transactions: [],
  budgets: { month: '', limits: {} },
  users: [],
};

export const router = { go: () => {}, refresh: () => {} };
let unauthorizedHandler = null;

export const onUnauthorized = (fn) => { unauthorizedHandler = fn; };

const pad2 = (n) => String(n).padStart(2, '0');

/** Local calendar date helpers (never UTC: entries follow the user's own day). */
export const currentMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
};
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

export const CURRENCIES = [
  'USD', 'EUR', 'GBP', 'JPY', 'CNY', 'INR', 'AUD', 'CAD', 'SGD', 'MYR',
  'PHP', 'IDR', 'THB', 'VND', 'KRW', 'PKR', 'BDT', 'LKR', 'NPR', 'AED',
  'SAR', 'QAR', 'KWD', 'NGN', 'KES', 'GHS', 'EGP', 'ZAR', 'BRL', 'MXN',
  'TRY', 'PLN', 'UAH', 'RUB', 'CHF', 'SEK', 'NOK', 'NZD',
];

/* --------------------------------------------------------------- API */

export async function api(path, { method = 'GET', body } = {}) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (body !== undefined) {
    opts.headers['content-type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(`/api${path}`, opts);
  } catch {
    throw new Error('Cannot reach the server. Check your connection and try again.');
  }
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON response */ }
  if (!res.ok) {
    if (res.status === 401 && unauthorizedHandler) unauthorizedHandler();
    throw new Error((data && data.error) || `Request failed (${res.status}).`);
  }
  return data;
}

/* ----------------------------------------------------------- loaders */

export async function loadPrefs() {
  const r = await api('/settings');
  state.prefs = r.prefs || { currency: 'USD' };
}

export async function loadCategories() {
  state.categories = await api('/categories');
}

export async function loadTransactions() {
  const r = await api('/transactions');
  state.transactions = r.transactions || [];
}

export async function loadBudgets(month = currentMonth()) {
  state.budgets = await api(`/budgets?month=${encodeURIComponent(month)}`);
}

export async function loadUsers() {
  const r = await api('/admin/users');
  state.users = r.users || [];
}

export async function loadAll() {
  await Promise.all([loadPrefs(), loadCategories(), loadTransactions(), loadBudgets(currentMonth())]);
}

/* --------------------------------------------------------- formatting */

export function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function money(cents) {
  const raw = Number(cents) || 0;
  const abs = Math.abs(raw) / 100;
  const currency = state.prefs?.currency || 'USD';
  let text;
  try {
    text = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(abs);
  } catch {
    text = abs.toFixed(2);
  }
  return raw < 0 ? `-${text}` : text;
}

/** Signed display used inside transaction rows: "+ ₱1.00" / "- ₱1.00" */
export function signedMoney(type, cents) {
  return `${type === 'income' ? '+' : '\u2212'} ${money(Math.abs(cents))}`;
}

export function toCents(raw) {
  const cleaned = String(raw ?? '').replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  const cents = Math.round(n * 100);
  if (cents < 1 || cents > 10_000_000_000) return null;
  return cents;
}

export function fromCents(cents) {
  return cents ? (cents / 100).toFixed(2) : '';
}

export function fmtDate(iso) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
    }).format(new Date(`${iso}T00:00:00Z`));
  } catch {
    return iso;
  }
}

export function monthLabel(month) {
  try {
    const [y, m] = month.split('-').map(Number);
    return new Intl.DateTimeFormat(undefined, {
      month: 'long', year: 'numeric', timeZone: 'UTC',
    }).format(new Date(Date.UTC(y, m - 1, 1)));
  } catch {
    return month;
  }
}

export function monthShort(month) {
  try {
    const [y, m] = month.split('-').map(Number);
    return new Intl.DateTimeFormat(undefined, {
      month: 'short', timeZone: 'UTC',
    }).format(new Date(Date.UTC(y, m - 1, 1)));
  } catch {
    return month;
  }
}

export function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function timeAgo(ts) {
  if (!ts) return 'Never';
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return fmtTimestamp(ts);
}

export function fmtTimestamp(ts) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
    }).format(new Date(ts));
  } catch {
    return '';
  }
}

/** All expense categories available to the current user (presets + custom). */
export function expenseCategories() {
  const custom = (state.categories.custom || [])
    .filter((c) => c.kind === 'expense')
    .map((c) => c.name);
  return [...(state.categories.presets?.expense || []), ...custom];
}

export function incomeCategories() {
  const custom = (state.categories.custom || [])
    .filter((c) => c.kind === 'income')
    .map((c) => c.name);
  return [...(state.categories.presets?.income || []), ...custom];
}

export function categoriesFor(type) {
  return type === 'income' ? incomeCategories() : expenseCategories();
}

export const sumIncome = (list) => list.reduce((s, t) => (t.type === 'income' ? s + t.amountCents : s), 0);
export const sumExpense = (list) => list.reduce((s, t) => (t.type === 'expense' ? s + t.amountCents : s), 0);

/* -------------------------------------------------------------- icons */

const PATHS = {
  home: '<path d="M3 10.6 12 3.2l9 7.4"/><path d="M5.4 9.4V20a1 1 0 0 0 1 1h11.2a1 1 0 0 0 1-1V9.4"/><path d="M9.6 21v-6h4.8v6"/>',
  list: '<path d="M8.5 6.5h12M8.5 12h12M8.5 17.5h12"/><circle cx="4.2" cy="6.5" r="1.2"/><circle cx="4.2" cy="12" r="1.2"/><circle cx="4.2" cy="17.5" r="1.2"/>',
  target: '<circle cx="12" cy="12" r="8.2"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/>',
  chart: '<path d="M3.5 20.5h17"/><path d="M6.5 20.5v-7"/><path d="M11.5 20.5V6.5"/><path d="M16.5 20.5v-4.5"/>',
  users: '<circle cx="9" cy="8" r="3.3"/><path d="M3 20c0-3.4 2.7-5.6 6-5.6s6 2.2 6 5.6"/><path d="M16.2 5.3a3.3 3.3 0 0 1 0 6.2"/><path d="M17.6 14.9c1.9.8 3.4 2.6 3.4 5.1"/>',
  gear: '<circle cx="12" cy="12" r="3.1"/><path d="M12 3v2.2M12 18.8V21M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M3 12h2.2M18.8 12H21M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/>',
  logout: '<path d="M9.5 21H5.5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 16.5 4.5-4.5L16 7.5"/><path d="M20.5 12H9.5"/>',
  plus: '<path d="M12 5.5v13M5.5 12h13"/>',
  pencil: '<path d="M4.5 19.5l.9-3.9L16.4 4.6a2.1 2.1 0 0 1 3 3L8.4 18.6l-3.9.9z"/>',
  trash: '<path d="M4 7h16"/><path d="M9.5 7V5.2a1.2 1.2 0 0 1 1.2-1.2h2.6a1.2 1.2 0 0 1 1.2 1.2V7"/><path d="m6.6 7 .8 12a2 2 0 0 0 2 1.9h5.2a2 2 0 0 0 2-1.9L17.4 7"/>',
  check: '<path d="m4.5 12.5 5 5 10-11"/>',
  alert: '<path d="M10.4 4.1 2.7 17.6A1.9 1.9 0 0 0 4.4 20.5h15.2a1.9 1.9 0 0 0 1.7-2.9L13.6 4.1a1.9 1.9 0 0 0-3.2 0z"/><path d="M12 9.5v4.2"/><circle cx="12" cy="16.8" r=".7" fill="currentColor" stroke="none"/>',
  info: '<circle cx="12" cy="12" r="8.8"/><path d="M12 11.2v5"/><circle cx="12" cy="7.9" r=".8" fill="currentColor" stroke="none"/>',
  wallet: '<path d="M3.5 8.2A2 2 0 0 1 5.5 6.2H17a1 1 0 0 1 1 1v1.6"/><path d="M3.5 8.2v9.6a2 2 0 0 0 2 2H19a1.6 1.6 0 0 0 1.6-1.6v-6.8A1.6 1.6 0 0 0 19 9.8H5.5a2 2 0 0 1-2-1.6z"/><circle cx="16.6" cy="14.4" r="1.1" fill="currentColor" stroke="none"/>',
  inbox: '<path d="M5.6 5.4 3.2 12v6.2a2 2 0 0 0 2 2h13.6a2 2 0 0 0 2-2V12l-2.4-6.6a2 2 0 0 0-1.9-1.4H7.5a2 2 0 0 0-1.9 1.4z"/><path d="M3.2 12h5l1.7 2.8h4.2L16 12h4.8"/>',
  shield: '<path d="M12 3.2 19 6v5.4c0 4.4-3 8.3-7 9.6-4-1.3-7-5.2-7-9.6V6l7-2.8z"/>',
  search: '<circle cx="11" cy="11" r="6.6"/><path d="m20 20-4.2-4.2"/>',
  copy: '<rect x="9" y="9" width="11.4" height="11.4" rx="2"/><path d="M5.4 15H4.6a1.6 1.6 0 0 1-1.6-1.6V4.6A1.6 1.6 0 0 1 4.6 3h8.8A1.6 1.6 0 0 1 15 4.6v.8"/>',
  left: '<path d="m14.5 5.5-7 6.5 7 6.5"/>',
  right: '<path d="m9.5 5.5 7 6.5-7 6.5"/>',
  down: '<path d="M12 4.5v14M6 12.5l6 6 6-6"/>',
  up: '<path d="M12 19.5v-14M6 11.5l6-6 6 6"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.6" rx="2"/><path d="M3.5 9.6h17M8 3.2v3.4M16 3.2v3.4"/>',
  lock: '<rect x="4.8" y="10.5" width="14.4" height="10.2" rx="2"/><path d="M8.2 10.5V7.8a3.8 3.8 0 0 1 7.6 0v2.7"/>',
  coin: '<circle cx="12" cy="12" r="8.6"/><path d="M14.8 9.3c-.6-.9-1.6-1.3-2.8-1.3-1.6 0-2.7.8-2.7 2s1 1.7 2.8 2.1c1.9.5 3 1.1 3 2.4s-1.3 2.1-3 2.1c-1.4 0-2.5-.5-3.1-1.5"/><path d="M12 6.2v1.8M12 16.2v1.6"/>',
};

export function icon(name, cls = '') {
  const body = PATHS[name] || PATHS.info;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="${cls}" aria-hidden="true">${body}</svg>`;
}

/* -------------------------------------------------------------- toast */

export function toast(message, type = 'info') {
  const host = document.getElementById('toast-host');
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `${icon(type === 'error' ? 'alert' : type === 'success' ? 'check' : 'info')}<span>${esc(message)}</span>`;
  host.appendChild(el);
  setTimeout(() => el.classList.add('hide'), 3000);
  setTimeout(() => el.remove(), 3400);
}
