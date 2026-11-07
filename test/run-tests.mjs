// Exercise the real Postgres storage queries against an isolated test database.
import { randomBytes } from 'node:crypto';
import { registerHooks } from 'node:module';
import { testDatabase } from './test-database.mjs';

// Existing deployment credentials must never seed accounts in the test database.
delete process.env.ADMIN_USERNAME;
delete process.env.ADMIN_PASSWORD;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '../db/index.mjs') {
      return { url: new URL('./test-database.mjs', import.meta.url).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { handleRequest } = await import('../src/handler.mjs');

let passed = 0;
let failed = 0;
const failures = [];

function check(label, condition, extra) {
  if (condition) {
    passed += 1;
    console.log(`  ok  ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`FAIL  ${label}${extra ? ` :: ${extra}` : ''}`);
  }
}

async function call(method, p, body = null, opts = {}) {
  const headers = {};
  if (opts.cookie !== null && opts.cookie !== undefined) headers.cookie = `pocket_fortress_session=${opts.cookie}`;
  if (opts.origin) headers.origin = opts.origin;
  if (opts.host) headers.host = opts.host;
  if (opts.proto) headers['x-forwarded-proto'] = opts.proto;
  if (opts.origin && !opts.host) headers.host = new URL(opts.origin).host;
  const res = await handleRequest({ method, path: p, query: opts.query || {}, body, headers });
  const setCookie = res.headers?.['set-cookie'] || '';
  const match = setCookie.match(/pocket_fortress_session=([^;]*)/);
  return { ...res, token: match ? match[1] : null };
}

const getCookie = (r) => (r.token && r.token.length > 0 ? r.token : null);

console.log('\n--- setup & auth ---');

let r = await call('GET', '/api/state');
check('initial state requires setup', r.body.setupRequired === true && r.body.user === null);

r = await call('POST', '/api/setup', { username: 'boss', password: 'adminpass1', currency: 'USD' });
check('one-time setup creates admin', r.status === 200 && r.body.user?.role === 'admin', JSON.stringify(r.body));
const bossCookie = getCookie(r);
check('setup returns session cookie', Boolean(bossCookie));

r = await call('POST', '/api/setup', { username: 'sneak', password: 'anotherpass' });
check('setup cannot run twice', r.status === 400);

r = await call('GET', '/api/state', null, { cookie: bossCookie });
check('admin session visible in state', r.body.user?.username === 'boss' && r.body.setupRequired === false);

r = await call('POST', '/api/login', { username: 'boss', password: 'wrong-password' });
check('wrong password rejected', r.status === 401 && /Invalid username or password/.test(r.body.error));

r = await call('POST', '/api/login', { username: 'ghost', password: 'whatever123' });
check('unknown user rejected with same message', r.status === 401 && /Invalid username or password/.test(r.body.error));

r = await call('POST', '/api/login', { username: 'boss', password: 'adminpass1' });
check('correct password accepted', r.status === 200 && Boolean(getCookie(r)));
const bossLogin = getCookie(r);

console.log('\n--- admin creates users ---');

r = await call('POST', '/api/admin/users', { username: 'maria', password: 'mariapass1' }, { cookie: bossLogin });
check('admin creates user account', r.status === 200 && r.body.user?.role === 'user');

r = await call('POST', '/api/admin/users', { username: 'maria', password: 'mariapass1' }, { cookie: bossLogin });
check('duplicate username rejected', r.status === 400);

r = await call('POST', '/api/admin/users', { username: 'weak', password: 'abc' }, { cookie: bossLogin });
check('weak password rejected', r.status === 400 && /at least 8/.test(r.body.error));

r = await call('POST', '/api/admin/users', { username: 'x', password: 'goodpassword' }, { cookie: bossLogin });
check('short username rejected', r.status === 400);

r = await call('POST', '/api/admin/users', { username: 'pedro', password: 'pedropass1' }, { cookie: bossLogin });
check('second user created', r.status === 200);

r = await call('GET', '/api/admin/users', null, { cookie: bossLogin });
check('admin lists accounts only', r.status === 200 && r.body.users.length === 3
  && r.body.users.every((u) => 'username' in u && !('pw' in u) && !('transactions' in u)));

r = await call('GET', '/api/admin/users', null, {});
check('non-admin cannot reach admin routes', r.status === 401);

r = await call('POST', '/api/login', { username: 'maria', password: 'mariapass1' });
const mariaCookie = getCookie(r);
check('new user can sign in', r.status === 200 && Boolean(mariaCookie));

r = await call('GET', '/api/admin/users', null, { cookie: mariaCookie });
check('regular user has no admin access', r.status === 403);

console.log('\n--- transactions (one-time income rule) ---');

r = await call('POST', '/api/transactions', {
  type: 'income', amountCents: 500000, date: '2026-11-01', category: 'Salary / Paycheck', note: 'Nov 1 paycheck', tags: ['paycheck'],
}, { cookie: mariaCookie });
check('income entry saved', r.status === 200 && r.body.transaction?.type === 'income');
const txId = r.body.transaction?.id;

r = await call('POST', '/api/transactions', {
  type: 'income', amountCents: 500000, date: '2026-11-15', category: 'Salary / Paycheck', note: 'Nov 15 paycheck',
}, { cookie: mariaCookie });
check('second paycheck is a separate one-time entry', r.status === 200);

r = await call('POST', '/api/transactions', {
  type: 'expense', amountCents: 120050, date: '2026-11-03', category: 'Groceries', note: 'weekly shop',
}, { cookie: mariaCookie });
const expenseId = r.body.transaction?.id;
check('expense entry saved', r.status === 200 && Boolean(expenseId));

r = await call('POST', '/api/transactions', {
  type: 'income', amountCents: 0, date: '2026-11-03', category: 'Salary / Paycheck',
}, { cookie: mariaCookie });
check('zero amount rejected', r.status === 400);

r = await call('POST', '/api/transactions', {
  type: 'income', amountCents: -500, date: '2026-11-03', category: 'Salary / Paycheck',
}, { cookie: mariaCookie });
check('negative amount rejected', r.status === 400);

r = await call('POST', '/api/transactions', {
  type: 'income', amountCents: 100, date: '2026-13-45', category: 'Salary / Paycheck',
}, { cookie: mariaCookie });
check('invalid date rejected', r.status === 400);

r = await call('POST', '/api/transactions', {
  type: 'recurring', amountCents: 100, date: '2026-11-03', category: 'Salary / Paycheck',
}, { cookie: mariaCookie });
check('non one-time type rejected (no recurring income)', r.status === 400);

r = await call('GET', '/api/transactions', null, { cookie: mariaCookie });
check('owner sees all their entries', r.status === 200 && r.body.transactions.length === 3);
const mariaTotal = r.body.transactions.reduce((s, t) => (t.type === 'income' ? s + t.amountCents : s - t.amountCents), 0);
check('balance math: 5000+5000-1200.50 = 8799.50', mariaTotal === 879950, String(mariaTotal));

r = await call('GET', '/api/transactions', null, { cookie: mariaCookie, query: { month: '2026-11' } });
check('month filter works', r.body.transactions.length === 3);
r = await call('GET', '/api/transactions', null, { cookie: mariaCookie, query: { month: '2026-10' } });
check('empty month filter returns none', r.body.transactions.length === 0);

r = await call('PUT', `/api/transactions/${expenseId}`, { amountCents: 130000 }, { cookie: mariaCookie });
check('entry editable by owner', r.status === 200 && r.body.transaction.amountCents === 130000);

r = await call('PUT', `/api/transactions/${expenseId}`, { amountCents: 50000000000 }, { cookie: mariaCookie });
check('oversized amount rejected', r.status === 400);

r = await call('DELETE', `/api/transactions/${txId}`, null, { cookie: mariaCookie });
check('entry deletable by owner', r.status === 200);

r = await call('DELETE', `/api/transactions/${txId}`, null, { cookie: mariaCookie });
check('double delete reports missing', r.status === 404);

console.log('\n--- privacy between users ---');

r = await call('POST', '/api/login', { username: 'pedro', password: 'pedropass1' });
const pedroCookie = getCookie(r);
await call('POST', '/api/transactions', {
  type: 'income', amountCents: 99999, date: '2026-11-02', category: 'Bonus',
}, { cookie: pedroCookie });

r = await call('GET', '/api/transactions', null, { cookie: mariaCookie });
check("maria cannot see pedro's entries", r.body.transactions.every((t) => t.amountCents !== 99999));

r = await call('GET', '/api/transactions', null, { cookie: pedroCookie });
check('pedro sees only his own entries', r.body.transactions.length === 1);

r = await call('GET', '/api/transactions', null, { cookie: bossLogin });
check("admin's own ledger starts empty (no backdoor to others)", r.body.transactions.length === 0);

r = await call('GET', '/api/transactions', null, {});
check('unauthenticated access rejected', r.status === 401);

console.log('\n--- categories ---');

r = await call('GET', '/api/categories', null, { cookie: mariaCookie });
check('preset categories returned', r.status === 200 && r.body.presets.income.includes('Salary / Paycheck') && r.body.presets.expense.length > 10);

r = await call('POST', '/api/categories', { name: 'Pet Food', kind: 'expense' }, { cookie: mariaCookie });
const customId = r.body.category?.id;
check('custom category created', r.status === 200 && Boolean(customId));

r = await call('POST', '/api/categories', { name: 'pet food', kind: 'expense' }, { cookie: mariaCookie });
check('duplicate category rejected', r.status === 400);

r = await call('POST', '/api/categories', { name: 'Groceries', kind: 'expense' }, { cookie: mariaCookie });
check('preset name cannot be duplicated', r.status === 400);

r = await call('DELETE', `/api/categories/${customId}`, null, { cookie: pedroCookie });
check("another user cannot delete someone else's category", r.status === 404);

r = await call('DELETE', `/api/categories/${customId}`, null, { cookie: mariaCookie });
check('owner deletes custom category', r.status === 200);

console.log('\n--- budgets ---');

r = await call('GET', '/api/budgets', null, { cookie: mariaCookie, query: { month: '2026-11' } });
check('budgets default empty', r.status === 200 && Object.keys(r.body.limits).length === 0);

r = await call('PUT', '/api/budgets', { limits: { Groceries: 40000, Transport: 15000 } }, { cookie: mariaCookie, query: { month: '2026-11' } });
check('budgets saved for month', r.status === 200 && r.body.limits.Groceries === 40000);

r = await call('GET', '/api/budgets', null, { cookie: mariaCookie, query: { month: '2026-11' } });
check('budgets persist', r.body.limits.Groceries === 40000 && r.body.limits.Transport === 15000);

r = await call('GET', '/api/budgets', null, { cookie: mariaCookie, query: { month: '2026-12' } });
check('budgets are per month', Object.keys(r.body.limits).length === 0);

r = await call('PUT', '/api/budgets', { limits: { Groceries: -5 } }, { cookie: mariaCookie, query: { month: '2026-11' } });
check('negative budget rejected', r.status === 400);

r = await call('GET', '/api/budgets', null, { cookie: pedroCookie, query: { month: '2026-11' } });
check("budgets are private per user", Object.keys(r.body.limits).length === 0);

console.log('\n--- settings & password ---');

r = await call('PUT', '/api/settings', { currency: 'PHP' }, { cookie: mariaCookie });
check('currency setting saved', r.status === 200 && r.body.prefs.currency === 'PHP');

r = await call('PUT', '/api/settings', { currency: 'nope' }, { cookie: mariaCookie });
check('invalid currency rejected', r.status === 400);

r = await call('POST', '/api/password', { currentPassword: 'wrongpass1', newPassword: 'brandnewpass1' }, { cookie: mariaCookie });
check('password change needs current password', r.status === 401);

r = await call('POST', '/api/password', { currentPassword: 'mariapass1', newPassword: 'short' }, { cookie: mariaCookie });
check('new password length enforced', r.status === 400);

r = await call('POST', '/api/password', { currentPassword: 'mariapass1', newPassword: 'brandnewpass1' }, { cookie: mariaCookie });
check('password change succeeds', r.status === 200);

r = await call('POST', '/api/login', { username: 'maria', password: 'mariapass1' });
check('old password no longer works', r.status === 401);

r = await call('POST', '/api/login', { username: 'maria', password: 'brandnewpass1' });
const mariaNew = getCookie(r);
check('new password works', r.status === 200 && Boolean(mariaNew));

console.log('\n--- admin controls ---');

r = await call('PUT', '/api/admin/users/maria', { password: 'resetpass123' }, { cookie: bossLogin });
check('admin resets password', r.status === 200);

r = await call('GET', '/api/transactions', null, { cookie: mariaNew });
check("reset signs the user's sessions out", r.status === 401);

r = await call('POST', '/api/login', { username: 'maria', password: 'resetpass123' });
const mariaReset = getCookie(r);
check('reset password works', r.status === 200);

r = await call('PUT', '/api/admin/users/maria', { active: false }, { cookie: bossLogin });
check('admin disables account', r.status === 200);

r = await call('GET', '/api/transactions', null, { cookie: mariaReset });
check('disabled account loses access', r.status === 401);

r = await call('POST', '/api/login', { username: 'maria', password: 'resetpass123' });
check('disabled account cannot sign in', r.status === 403 && /disabled/.test(r.body.error));

r = await call('PUT', '/api/admin/users/maria', { active: true }, { cookie: bossLogin });
r = await call('POST', '/api/login', { username: 'maria', password: 'resetpass123' });
const mariaBack = getCookie(r);
check('re-enabled account signs in again', r.status === 200);

r = await call('PUT', '/api/admin/users/boss', { active: false }, { cookie: bossLogin });
check('admin cannot disable own account', r.status === 400);

r = await call('DELETE', '/api/admin/users/boss', null, { cookie: bossLogin });
check('admin cannot delete own account', r.status === 400);

r = await call('DELETE', '/api/admin/users/maria', null, { cookie: bossLogin });
check('admin deletes user', r.status === 200);

r = await call('GET', '/api/transactions', null, { cookie: mariaBack });
check('deleted user data is gone', r.status === 401);

r = await call('POST', '/api/login', { username: 'maria', password: 'resetpass123' });
check('deleted user cannot sign in', r.status === 401);

console.log('\n--- sessions ---');

r = await call('POST', '/api/logout', null, { cookie: pedroCookie });
check('logout succeeds', r.status === 200);

r = await call('GET', '/api/transactions', null, { cookie: pedroCookie });
check('session invalid after logout', r.status === 401);

r = await call('GET', '/api/transactions', null, { cookie: 'f'.repeat(64) });
check('forged session token rejected', r.status === 401);

console.log('\n--- login lockout ---');

r = await call('POST', '/api/login', { username: 'pedro', password: 'badpassword1' });
check('attempt 1 of lockout fails quietly', r.status === 401);
let lock;
for (let i = 0; i < 9; i += 1) {
  lock = await call('POST', '/api/login', { username: 'pedro', password: 'badpassword1' });
  if (lock.status === 429) break;
}
check('repeated failures lock the account (429)', lock.status === 429 && /Too many failed/.test(lock.body.error), `status ${lock.status}`);

const unlock = await call('POST', '/api/login', { username: 'pedro', password: 'pedropass1' });
check('even the right password is blocked while locked', unlock.status === 429);

console.log('\n--- request guards ---');

r = await call('POST', '/api/login', { username: 'boss', password: 'adminpass1' }, {
  origin: 'https://evil.example', host: 'pocket-fortress.netlify.app',
});
check('cross-origin POST rejected', r.status === 403);

r = await call('POST', '/api/login', { username: 'boss', password: 'adminpass1' }, {
  origin: 'https://pocket-fortress.netlify.app', host: 'pocket-fortress.netlify.app',
});
check('same-origin POST allowed', r.status === 200);

r = await call('POST', '/api/login', { username: 'boss', password: 'adminpass1' }, {
  host: 'pocket-fortress.netlify.app', proto: 'https',
});
check('session cookie is Secure on HTTPS (Netlify)', /;\s*Secure/i.test(r.headers['set-cookie'] || ''));

r = await call('POST', '/api/login', { username: 'boss', password: 'adminpass1' }, {
  host: '192.168.100.46:8787', proto: 'http',
});
check('session cookie is NOT Secure on plain LAN HTTP (mobile devices)', !/;\s*Secure/i.test(r.headers['set-cookie'] || ''));

r = await call('POST', '/api/login', { username: 'boss', password: 'adminpass1' }, {
  host: 'localhost:8787',
});
check('session cookie is Secure on localhost', /;\s*Secure/i.test(r.headers['set-cookie'] || ''));

r = await call('GET', '/api/nope', null, { cookie: bossLogin });
check('unknown route 404s when signed in', r.status === 404);

r = await call('GET', '/api/nope');
check('unknown route hides existence when signed out', r.status === 401);

r = await call('GET', '/api/health');
check('health endpoint ok', r.status === 200 && r.body.ok === true);

console.log('\n--- database regressions ---');
const { dbGet, dbSet, dbDel, dbList } = await import('../src/store.mjs');
await dbSet('test:literal_%', { count: 1 });
await dbSet('test:literal_other', { count: 2 });
await dbSet('test:literal_%', { count: 3 });
check('database upserts replace existing records', (await dbGet('test:literal_%')).count === 3);
check('prefix search treats SQL wildcards literally', (await dbList('test:literal_%')).length === 1);
await dbDel('test:literal_%');
check('deleted records stay deleted', await dbGet('test:literal_%') === null);
check('storage is database even without NETLIFY flag', r.body.storage === 'database');

// Reproduce first-boot seeding without using configured deployment credentials.
await testDatabase.exec('TRUNCATE ledger_records');
process.env.ADMIN_USERNAME = 'seed-test-admin';
process.env.ADMIN_PASSWORD = randomBytes(24).toString('hex');
const { handleRequest: seededHandler } = await import('../src/handler.mjs?seed-regression');
let seededResult = await seededHandler({ path: '/api/state' });
check('admin bootstrap persists successfully without filesystem access',
  seededResult.status === 200 && seededResult.body.setupRequired === false);
seededResult = await seededHandler({ method: 'POST', path: '/api/login',
  body: { username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD } });
check('seeded admin credentials allow login', seededResult.status === 200 && seededResult.body.user?.role === 'admin');
delete process.env.ADMIN_USERNAME;
delete process.env.ADMIN_PASSWORD;

await testDatabase.exec('DROP TABLE ledger_records');
for (const endpoint of ['/api/state', '/api/health']) {
  const failure = await seededHandler({ path: endpoint });
  check(`storage outage returns a controlled error for ${endpoint}`, failure.status === 500 && failure.body.error === 'Server error. Please try again.');
}

/* -------------------------------------------------------------- summary */

await testDatabase.close();
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  console.log('Failing checks:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
