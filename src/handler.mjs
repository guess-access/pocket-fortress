// Pocket Fortress API handler.
// One rule applies everywhere: every income entry is a ONE-TIME event.
// There is no recurring/repeating income concept in the data model, on purpose.
import { dbDel, dbGet, dbList, dbSet, storageMode } from './store.mjs';
import { DUMMY_PASSWORD_RECORD, hashPassword, newId, newToken, verifyPassword } from './auth.mjs';

export const COOKIE_NAME = 'pocket_fortress_session';

const SESSION_DAYS = 30;
const MAX_LOGIN_FAILS = 8;
const LOCK_MINUTES = 15;
const MAX_TRANSACTIONS = 20000;
const MAX_CUSTOM_CATEGORIES = 60;
const MAX_BUDGET_ROWS = 60;
const MAX_AMOUNT_CENTS = 10_000_000_000; // 100,000,000.00
const SESSION_PREFIX = 'sess:';
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,23}$/;

export const PRESET_CATEGORIES = {
  income: [
    'Salary / Paycheck',
    'Bonus',
    'Freelance / Side Job',
    'Business Income',
    'Interest / Dividends',
    'Rental Income',
    'Gift',
    'Refund / Reimbursement',
    'Other Income',
  ],
  expense: [
    'Housing / Rent',
    'Utilities',
    'Groceries',
    'Food & Dining',
    'Transportation',
    'Health & Medical',
    'Education',
    'Insurance',
    'Debt Payments',
    'Savings & Investments',
    'Shopping',
    'Personal Care',
    'Entertainment',
    'Subscriptions',
    'Travel',
    'Family & Kids',
    'Pets',
    'Taxes',
    'Business Expenses',
    'Other Expense',
  ],
};

/* ---------------------------------------------------------------- helpers */

const ok = (body, extra = {}) => ({ status: 200, body, ...extra });
const fail = (status, error) => ({ status, body: { error } });

function cleanStr(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function normalizeUsername(value) {
  return cleanStr(value, 24).toLowerCase();
}

function isValidUsername(name) {
  return USERNAME_RE.test(name);
}

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function isValidMonth(value) {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function cleanTags(raw) {
  const source = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
  const out = [];
  const seen = new Set();
  for (const item of source) {
    const tag = cleanStr(item, 24);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= 10) break;
  }
  return out;
}

function parseCookies(header) {
  const jar = {};
  if (!header) return jar;
  for (const part of String(header).split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) jar[k] = decodeURIComponent(v);
  }
  return jar;
}

/**
 * Netlify serves HTTPS (and sets x-forwarded-proto). Localhost accepts Secure
 * cookies over http. Plain LAN addresses do not — so only mark the cookie
 * Secure when the connection actually is, otherwise other devices on the
 * network would silently fail to stay signed in.
 */
function wantsSecureCookie(headers = {}) {
  const proto = headers['x-forwarded-proto'] || headers['x-forwarded-protocol'];
  if (proto) return String(proto).split(',')[0].trim() === 'https';
  const host = String(headers.host || '').toLowerCase();
  return host.startsWith('localhost') || host.startsWith('127.0.0.1') || host.startsWith('[::1]');
}

function sessionCookie(token, secure) {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

function clearCookie(secure) {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

function sameOrigin(headers = {}) {
  const origin = headers.origin || headers.Origin;
  if (!origin) return true;
  const host = headers.host || headers.Host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function publicUser(user) {
  return { username: user.username, role: user.role };
}

/* --------------------------------------------------------------- data ops */

async function loadIndex() {
  return (await dbGet('users')) || { list: [] };
}

async function saveIndex(index) {
  await dbSet('users', index);
}

async function findUser(username) {
  return (await dbGet(`user:${username}`)) || null;
}

async function indexPut(entry) {
  const index = await loadIndex();
  const i = index.list.findIndex((u) => u.username === entry.username);
  if (i === -1) index.list.push(entry);
  else index.list[i] = { ...index.list[i], ...entry };
  await saveIndex(index);
}

async function indexRemove(username) {
  const index = await loadIndex();
  index.list = index.list.filter((u) => u.username !== username);
  await saveIndex(index);
}

async function loadTransactions(username) {
  return (await dbGet(`tx:${username}`)) || [];
}

async function saveTransactions(username, list) {
  await dbSet(`tx:${username}`, list);
}

async function createUser(username, password, role = 'user') {
  if (!isValidUsername(username)) {
    return { error: 'Username must be 3-24 characters: letters, numbers, dot, dash or underscore.' };
  }
  if (typeof password !== 'string' || password.length < 8) {
    return { error: 'Password must be at least 8 characters long.' };
  }
  if (role !== 'user' && role !== 'admin') {
    return { error: 'Role must be "user" or "admin".' };
  }
  const index = await loadIndex();
  if (index.list.some((u) => u.username === username)) {
    return { error: 'That username is already taken.' };
  }
  const pw = await hashPassword(password);
  const now = Date.now();
  const user = { username, role, active: true, pw, createdAt: now, lastLoginAt: 0, failed: 0, lockedUntil: 0 };
  await dbSet(`user:${username}`, user);
  index.list.push({ username, role, active: true, createdAt: now, lastLoginAt: 0 });
  await saveIndex(index);
  return { user };
}

async function deleteSessionsOf(username) {
  const keys = await dbList(SESSION_PREFIX);
  for (const key of keys) {
    const sess = await dbGet(key);
    if (!sess || sess.username === username) await dbDel(key);
  }
}

async function purgeExpiredSessions() {
  const keys = (await dbList(SESSION_PREFIX)).slice(0, 200);
  const now = Date.now();
  for (const key of keys) {
    const sess = await dbGet(key);
    if (!sess || !sess.exp || sess.exp < now) await dbDel(key);
  }
}

async function resolveSession(headers) {
  const token = parseCookies(headers.cookie || headers.Cookie)[COOKIE_NAME];
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const sess = await dbGet(SESSION_PREFIX + token);
  if (!sess) return null;
  if (!sess.exp || sess.exp < Date.now()) {
    await dbDel(SESSION_PREFIX + token);
    return null;
  }
  const user = await findUser(sess.username);
  if (!user || !user.active) return null;
  return { user, token };
}

/* --------------------------------------------------- admin bootstrap (env) */

let seeded = false;
async function seedAdminFromEnv() {
  if (seeded) return;
  const username = normalizeUsername(process.env.ADMIN_USERNAME);
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) {
    seeded = true;
    return;
  }
  try {
    const index = await loadIndex();
    if (index.list.length === 0) {
      const result = await createUser(username, password, 'admin');
      if (result.error) console.error('[pocket-fortress] Admin seed failed:', result.error);
      else console.log('[pocket-fortress] Main admin seeded from environment variables.');
    }
    seeded = true;
  } catch (err) {
    seeded = false; // retry on next request
    throw err;
  }
}

/* ------------------------------------------------------------ input checks */

function validateTransactionInput(body) {
  const type = body?.type;
  if (type !== 'income' && type !== 'expense') {
    return { error: 'Type must be income or expense.' };
  }
  const amountCents = body?.amountCents;
  if (!Number.isInteger(amountCents) || amountCents < 1 || amountCents > MAX_AMOUNT_CENTS) {
    return { error: 'Enter a valid amount greater than zero.' };
  }
  const date = body?.date;
  if (!isValidDate(date)) return { error: 'Enter a valid date (YYYY-MM-DD).' };
  const category = cleanStr(body?.category, 40);
  if (!category) return { error: 'Pick a category.' };
  const note = cleanStr(body?.note, 300);
  const tags = cleanTags(body?.tags);
  return { value: { type, amountCents, date, category, note, tags } };
}

/* ------------------------------------------------------------------ routes */

async function routeState(headers) {
  const auth = await resolveSession(headers);
  const index = await loadIndex();
  return ok({
    setupRequired: index.list.length === 0,
    user: auth ? publicUser(auth.user) : null,
    storage: storageMode(),
  });
}

async function routeSetup(body, headers) {
  const index = await loadIndex();
  if (index.list.length > 0) return fail(400, 'Setup has already been completed.');
  const username = normalizeUsername(body?.username);
  const password = typeof body?.password === 'string' ? body.password : '';
  const result = await createUser(username, password, 'admin');
  if (result.error) return fail(400, result.error);
  const token = newToken();
  await dbSet(SESSION_PREFIX + token, {
    username,
    exp: Date.now() + SESSION_DAYS * 86400000,
    createdAt: Date.now(),
  });
  return ok({ user: publicUser(result.user), storage: storageMode() }, {
    headers: { 'set-cookie': sessionCookie(token, wantsSecureCookie(headers)) },
  });
}

async function routeLogin(body, headers) {
  const username = normalizeUsername(body?.username);
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!username || !password) return fail(400, 'Enter your username and password.');

  const user = await findUser(username);
  if (!user) {
    await verifyPassword(password, DUMMY_PASSWORD_RECORD); // keep timing uniform
    return fail(401, 'Invalid username or password.');
  }

  const now = Date.now();
  if (user.lockedUntil && user.lockedUntil > now) {
    const minutes = Math.max(1, Math.ceil((user.lockedUntil - now) / 60000));
    return fail(429, `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
  }

  const valid = await verifyPassword(password, user.pw);
  if (!valid) {
    user.failed = (user.failed || 0) + 1;
    if (user.failed >= MAX_LOGIN_FAILS) {
      user.lockedUntil = now + LOCK_MINUTES * 60000;
      user.failed = 0;
      await dbSet(`user:${username}`, user);
      return fail(429, `Too many failed attempts. Try again in ${LOCK_MINUTES} minutes.`);
    }
    await dbSet(`user:${username}`, user);
    return fail(401, 'Invalid username or password.');
  }

  if (!user.active) return fail(403, 'This account has been disabled. Contact the main admin.');

  user.failed = 0;
  user.lockedUntil = 0;
  user.lastLoginAt = now;
  await dbSet(`user:${username}`, user);
  await indexPut({ username, lastLoginAt: now });

  const token = newToken();
  await dbSet(SESSION_PREFIX + token, { username, exp: now + SESSION_DAYS * 86400000, createdAt: now });
  await purgeExpiredSessions();

  return ok({ user: publicUser(user), storage: storageMode() }, {
    headers: { 'set-cookie': sessionCookie(token, wantsSecureCookie(headers)) },
  });
}

async function routeLogout(auth, headers) {
  await dbDel(SESSION_PREFIX + auth.token);
  return ok({ ok: true }, { headers: { 'set-cookie': clearCookie(wantsSecureCookie(headers)) } });
}

async function routeChangePassword(auth, body) {
  const current = typeof body?.currentPassword === 'string' ? body.currentPassword : '';
  const next = typeof body?.newPassword === 'string' ? body.newPassword : '';
  if (!current || !next) return fail(400, 'Both current and new password are required.');
  if (next.length < 8) return fail(400, 'New password must be at least 8 characters long.');

  const user = await findUser(auth.user.username);
  const valid = await verifyPassword(current, user.pw);
  if (!valid) return fail(401, 'Current password is incorrect.');

  user.pw = await hashPassword(next);
  await dbSet(`user:${user.username}`, user);
  return ok({ ok: true });
}

async function routeTransactions(auth, method, match, query, body) {
  const username = auth.user.username;

  if (method === 'GET') {
    let list = await loadTransactions(username);
    const month = query?.month;
    if (month && isValidMonth(month)) list = list.filter((t) => t.date.startsWith(month));
    list = list.slice().sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : b.date < a.date ? -1 : 1));
    return ok({ transactions: list });
  }

  if (method === 'POST') {
    const check = validateTransactionInput(body);
    if (check.error) return fail(400, check.error);
    const list = await loadTransactions(username);
    if (list.length >= MAX_TRANSACTIONS) return fail(400, 'Transaction limit reached for this account.');
    const now = Date.now();
    const tx = { id: newId(), ...check.value, note: check.value.note, createdAt: now, updatedAt: now };
    list.push(tx);
    await saveTransactions(username, list);
    return ok({ transaction: tx });
  }

  const id = match[1];
  const list = await loadTransactions(username);
  const index = list.findIndex((t) => t.id === id);
  if (index === -1) return fail(404, 'Transaction not found.');

  if (method === 'PUT') {
    const existing = list[index];
    const check = validateTransactionInput({ ...existing, ...body });
    if (check.error) return fail(400, check.error);
    const updated = { ...existing, ...check.value, id: existing.id, createdAt: existing.createdAt, updatedAt: Date.now() };
    list[index] = updated;
    await saveTransactions(username, list);
    return ok({ transaction: updated });
  }

  if (method === 'DELETE') {
    list.splice(index, 1);
    await saveTransactions(username, list);
    return ok({ ok: true });
  }

  return fail(405, 'Method not allowed.');
}

async function routeCategories(auth, method, match, body) {
  const username = auth.user.username;

  if (method === 'GET') {
    const custom = (await dbGet(`cat:${username}`)) || [];
    return ok({ presets: PRESET_CATEGORIES, custom });
  }

  if (method === 'POST') {
    const name = cleanStr(body?.name, 40);
    const kind = body?.kind;
    if (!name) return fail(400, 'Category name is required.');
    if (kind !== 'income' && kind !== 'expense') return fail(400, 'Category kind must be income or expense.');
    const custom = (await dbGet(`cat:${username}`)) || [];
    const taken = (list) => list.some((c) => c.toLowerCase() === name.toLowerCase());
    if (taken(PRESET_CATEGORIES[kind]) || taken(custom.filter((c) => c.kind === kind).map((c) => c.name))) {
      return fail(400, 'That category already exists.');
    }
    if (custom.length >= MAX_CUSTOM_CATEGORIES) return fail(400, 'Category limit reached.');
    const entry = { id: newId(), name, kind, createdAt: Date.now() };
    custom.push(entry);
    await dbSet(`cat:${username}`, custom);
    return ok({ category: entry });
  }

  const id = match[1];
  const custom = (await dbGet(`cat:${username}`)) || [];
  const next = custom.filter((c) => c.id !== id);
  if (next.length === custom.length) return fail(404, 'Category not found.');
  await dbSet(`cat:${username}`, next);
  return ok({ ok: true });
}

async function routeBudgets(auth, method, query, body) {
  const username = auth.user.username;
  const month = isValidMonth(query?.month) ? query.month : new Date().toISOString().slice(0, 7);
  const all = (await dbGet(`bud:${username}`)) || {};

  if (method === 'GET') {
    return ok({ month, limits: all[month] || {} });
  }

  if (method === 'PUT') {
    const raw = body?.limits;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail(400, 'Budget limits object is required.');
    const limits = {};
    const entries = Object.entries(raw);
    if (entries.length > MAX_BUDGET_ROWS) return fail(400, 'Too many budget rows.');
    for (const [categoryRaw, value] of entries) {
      const category = cleanStr(categoryRaw, 40);
      if (!category) return fail(400, 'Budget category names cannot be empty.');
      if (!Number.isInteger(value) || value < 0 || value > MAX_AMOUNT_CENTS) {
        return fail(400, `Invalid budget amount for "${category}".`);
      }
      if (value > 0) limits[category] = value;
    }
    all[month] = limits;
    await dbSet(`bud:${username}`, all);
    return ok({ month, limits });
  }

  return fail(405, 'Method not allowed.');
}

async function routeAdminUsers(auth, method, match, body) {
  if (auth.user.role !== 'admin') return fail(403, 'Admin access required.');
  const index = await loadIndex();

  if (method === 'GET') {
    const list = index.list.slice().sort((a, b) => a.username.localeCompare(b.username));
    return ok({ users: list });
  }

  if (method === 'POST') {
    const username = normalizeUsername(body?.username);
    const password = typeof body?.password === 'string' ? body.password : '';
    const role = body?.role === 'admin' ? 'admin' : 'user';
    const result = await createUser(username, password, role);
    if (result.error) return fail(400, result.error);
    return ok({ user: { ...publicUser(result.user), active: true, createdAt: result.user.createdAt, lastLoginAt: 0 } });
  }

  const target = match[1];
  const user = await findUser(target);
  if (!user) return fail(404, 'User not found.');
  const isSelf = target === auth.user.username;

  if (method === 'PUT') {
    const changes = {};
    if (body && typeof body.password === 'string' && body.password) {
      if (body.password.length < 8) return fail(400, 'Password must be at least 8 characters long.');
      user.pw = await hashPassword(body.password);
      changes.passwordChanged = true;
      await deleteSessionsOf(target); // force re-login with the new password
    }
    if (typeof body?.active === 'boolean') {
      if (isSelf && !body.active) return fail(400, 'You cannot disable your own account.');
      user.active = body.active;
      changes.active = body.active;
      if (!body.active) await deleteSessionsOf(target);
    }
    if (body && (body.role === 'admin' || body.role === 'user')) {
      if (isSelf && body.role !== 'admin') {
        const admins = index.list.filter((u) => u.role === 'admin' && u.active);
        if (admins.length <= 1) return fail(400, 'You are the last admin — promote another admin first.');
      }
      user.role = body.role;
      changes.role = body.role;
    }
    if (Object.keys(changes).length === 0) return fail(400, 'Nothing to update.');
    await dbSet(`user:${target}`, user);
    await indexPut({ username: target, role: user.role, active: user.active });
    return ok({ user: { username: target, role: user.role, active: user.active } });
  }

  if (method === 'DELETE') {
    if (isSelf) return fail(400, 'You cannot delete your own account.');
    if (user.role === 'admin') {
      const admins = index.list.filter((u) => u.role === 'admin' && u.active && u.username !== target);
      if (admins.length === 0) return fail(400, 'Cannot delete the last admin account.');
    }
    await dbDel(`user:${target}`);
    await dbDel(`tx:${target}`);
    await dbDel(`cat:${target}`);
    await dbDel(`bud:${target}`);
    await deleteSessionsOf(target);
    await indexRemove(target);
    return ok({ ok: true });
  }

  return fail(405, 'Method not allowed.');
}

async function routeSettings(auth, method, body) {
  const user = await findUser(auth.user.username);
  if (!user) return fail(401, 'Please sign in.');

  if (method === 'GET') {
    return ok({ prefs: user.prefs || { currency: 'USD' } });
  }

  if (method === 'PUT') {
    const currency = cleanStr(body?.currency, 8).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) return fail(400, 'Choose a valid currency code.');
    user.prefs = { ...(user.prefs || {}), currency };
    await dbSet(`user:${user.username}`, user);
    return ok({ prefs: user.prefs });
  }

  return fail(405, 'Method not allowed.');
}

/* ---------------------------------------------------------------- dispatch */

export async function handleRequest({ method = 'GET', path = '/', query = {}, body = null, headers = {} }) {
  try {
    await seedAdminFromEnv();

    const verb = String(method).toUpperCase();
    if (verb === 'OPTIONS') return { status: 204, body: {} };
    if (verb !== 'GET' && verb !== 'HEAD' && !sameOrigin(headers)) return fail(403, 'Bad request origin.');

    let p = String(path || '/');
    if (p.startsWith('/.netlify/functions/api')) p = p.slice('/.netlify/functions/api'.length);
    else if (p.startsWith('/api')) p = p.slice(4);
    if (!p.startsWith('/')) p = `/${p}`;
    if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
    const q = query || {};

    // ---- public routes
    if (verb === 'GET' && p === '/state') return routeState(headers);
    if (verb === 'GET' && p === '/health') return ok({ ok: true, storage: storageMode() });
    if (verb === 'POST' && p === '/setup') return routeSetup(body, headers);
    if (verb === 'POST' && p === '/login') return routeLogin(body, headers);

    // ---- authenticated routes
    const auth = await resolveSession(headers);
    if (!auth) return fail(401, 'Please sign in.');

    if (verb === 'POST' && p === '/logout') return routeLogout(auth, headers);
    if (verb === 'POST' && p === '/password') return routeChangePassword(auth, body);
    if ((verb === 'GET' || verb === 'PUT') && p === '/settings') return routeSettings(auth, verb, body);

    if ((verb === 'GET' || verb === 'POST') && p === '/transactions') {
      return routeTransactions(auth, verb, null, q, body);
    }
    let m = p.match(/^\/transactions\/([a-f0-9]{24})$/);
    if (m) return routeTransactions(auth, verb, m, q, body);

    if ((verb === 'GET' || verb === 'POST') && p === '/categories') {
      return routeCategories(auth, verb, null, body);
    }
    m = p.match(/^\/categories\/([a-f0-9]{24})$/);
    if (m) return routeCategories(auth, verb, m, body);

    if ((verb === 'GET' || verb === 'PUT') && p === '/budgets') return routeBudgets(auth, verb, q, body);

    if ((verb === 'GET' || verb === 'POST') && p === '/admin/users') {
      return routeAdminUsers(auth, verb, null, body);
    }
    m = p.match(/^\/admin\/users\/([a-z0-9._-]{3,24})$/);
    if (m) return routeAdminUsers(auth, verb, m, body);

    return fail(404, 'Not found.');
  } catch (err) {
    console.error('[pocket-fortress] request failed:', err);
    return fail(500, 'Server error. Please try again.');
  }
}
