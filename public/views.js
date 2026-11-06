// Main views: Dashboard, Transactions, Budgets, Reports.
import {
  api, state, router, esc, icon, toast, money, signedMoney, fromCents, toCents,
  fmtDate, monthLabel, monthShort, shiftMonth, currentMonth, today,
  categoriesFor, expenseCategories, sumIncome, sumExpense, loadTransactions,
  loadCategories, loadBudgets,
} from './core.js';

/* ==================================================== helpers */

function txRow(t, { actions = false } = {}) {
  return `
    <div class="tx-row" data-id="${esc(t.id)}">
      <div class="tx-icon ${t.type}">${icon(t.type === 'income' ? 'down' : 'up')}</div>
      <div class="tx-main">
        <div class="t1">${esc(t.category)}</div>
        <div class="t2">
          <span class="tiny muted num">${fmtDate(t.date)}</span>
          ${(t.tags || []).map((tag) => `<span class="tag">${esc(tag)}</span>`).join('')}
          ${t.note ? `<span class="tiny muted">&middot; ${esc(t.note)}</span>` : ''}
        </div>
      </div>
      <div class="tx-amount ${t.type} num">${signedMoney(t.type, t.amountCents)}</div>
      ${actions ? `
        <div class="tx-actions">
          <button class="icon-btn" data-act="edit" data-id="${esc(t.id)}" title="Edit" aria-label="Edit">${icon('pencil')}</button>
          <button class="icon-btn" data-act="delete" data-id="${esc(t.id)}" title="Delete" aria-label="Delete">${icon('trash')}</button>
        </div>` : ''}
    </div>`;
}

function emptyState(title, text, btn = '') {
  return `
    <div class="empty">
      ${icon('inbox')}
      <b>${esc(title)}</b>
      <span class="small">${text}</span>
      ${btn}
    </div>`;
}

/* ==================================================== Dashboard */

export function renderDashboard(root) {
  const tx = state.transactions;
  const m = currentMonth();
  const monthTx = tx.filter((t) => t.date.startsWith(m));
  const income = sumIncome(monthTx);
  const expense = sumExpense(monthTx);
  const net = income - expense;
  const balance = sumIncome(tx) - sumExpense(tx);
  const paychecks = monthTx.filter((t) => t.type === 'income').length;

  const limits = state.budgets?.limits || {};
  const budgetRows = Object.entries(limits)
    .filter(([, v]) => v > 0)
    .map(([cat, limit]) => {
      const spent = sumExpense(monthTx.filter((t) => t.category === cat));
      return { cat, limit, spent, pct: Math.min(1, spent / limit) };
    })
    .sort((a, b) => b.spent / b.limit - a.spent / a.limit)
    .slice(0, 4);

  const recent = tx.slice().sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : b.date < a.date ? 1 : -1)).slice(0, 6);

  root.innerHTML = `
    <div class="view-head">
      <div>
        <h1>Dashboard</h1>
        <div class="sub">Welcome back, ${esc(state.user.username)} &middot; ${monthLabel(m)}</div>
      </div>
      <div class="actions">
        <button class="btn btn-income" data-go="income">${icon('down')} Add income</button>
        <button class="btn btn-primary" data-go="expense">${icon('up')} Add expense</button>
      </div>
    </div>

    <div class="grid">
      <div class="stat hero">
        <div class="label">Total balance</div>
        <div class="value num">${money(balance)}</div>
        <div class="hint">${tx.length} ${tx.length === 1 ? 'entry' : 'entries'} recorded &middot; every income counted once</div>
      </div>
    </div>

    <div class="grid grid-3" style="margin-top:16px">
      <div class="stat income">
        <div class="label">Income this month</div>
        <div class="value num">${money(income)}</div>
        <div class="hint">${paychecks} one-time ${paychecks === 1 ? 'entry' : 'entries'}</div>
      </div>
      <div class="stat expense">
        <div class="label">Expenses this month</div>
        <div class="value num">${money(expense)}</div>
        <div class="hint">${monthTx.filter((t) => t.type === 'expense').length} ${monthTx.filter((t) => t.type === 'expense').length === 1 ? 'entry' : 'entries'}</div>
      </div>
      <div class="stat">
        <div class="label">Net this month</div>
        <div class="value num" style="color:${net >= 0 ? 'var(--income)' : 'var(--expense)'}">${money(net)}</div>
        <div class="hint">Income minus expenses</div>
      </div>
    </div>

    ${tx.length === 0 ? `
      <div class="card" style="margin-top:16px">
        <div class="empty">
          ${icon('wallet')}
          <b>Your ledger is empty</b>
          <span class="small">Record your first paycheck. <b>Rule:</b> every income that comes in is logged as a <b>one-time entry</b> — never as a repeating amount.</span><br/>
          <button class="btn btn-income" data-go="income">${icon('down')} Log a paycheck</button>
          <button class="btn btn-primary" data-go="expense">${icon('up')} Log an expense</button>
        </div>
      </div>` : `
      <div class="grid grid-2" style="margin-top:16px">
        <div class="card">
          <div class="card-head">
            <h2>Budget status</h2>
            <button class="btn btn-ghost btn-sm" data-nav="budgets">Manage ${icon('right')}</button>
          </div>
          ${budgetRows.length === 0
            ? emptyState('No budgets set yet', 'Set monthly limits per category to track spending as it happens.', `<button class="btn btn-primary btn-sm" data-nav="budgets">Set budgets</button>`)
            : budgetRows.map((b) => `
              <div class="budget-row" style="padding-top:6px">
                <div class="budget-top">
                  <div class="name">${esc(b.cat)}</div>
                  <div class="budget-figures num">
                    <b>${money(b.spent)}</b><span class="muted">/ ${money(b.limit)}</span>
                  </div>
                </div>
                <div class="bar ${b.spent > b.limit ? 'over' : b.pct >= 0.8 ? 'warn' : ''}"><i style="width:${Math.round(b.pct * 100)}%"></i></div>
              </div>`).join('')}
        </div>

        <div class="card">
          <div class="card-head">
            <h2>Recent activity</h2>
            <button class="btn btn-ghost btn-sm" data-nav="transactions">View all ${icon('right')}</button>
          </div>
          <div class="tx-list">${recent.map((t) => txRow(t)).join('')}</div>
        </div>
      </div>`}
  `;

  root.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => router.go(btn.dataset.nav));
  });
  root.querySelectorAll('[data-go]').forEach((btn) => {
    btn.addEventListener('click', () => startEntry(btn.dataset.go === 'income' ? 'income' : 'expense'));
  });
}

/* ==================================================== Transactions */

let txForm = null;
let txFilters = { month: currentMonth(), type: 'all', category: 'all', q: '' };
let showNewCat = false;

function blankForm(type) {
  return {
    mode: 'add',
    type,
    id: null,
    values: { amount: '', date: today(), category: '', note: '', tags: '' },
    error: '',
  };
}

export function startEntry(type) {
  txForm = blankForm(type);
  showNewCat = false;
  router.go('transactions');
}

function categorySelect(form) {
  const cats = categoriesFor(form.type);
  const current = form.values.category;
  const options = cats.map((c) => `<option value="${esc(c)}" ${c === current ? 'selected' : ''}>${esc(c)}</option>`).join('');
  const extra = current && !cats.includes(current)
    ? `<option value="${esc(current)}" selected>${esc(current)}</option>` : '';
  return `${options}${extra}<option value="__new">+ New category&hellip;</option>`;
}

function formCard() {
  const form = txForm;
  const isEdit = form.mode === 'edit';
  return `
    <div class="card" id="tx-form-card">
      <div class="seg" role="tablist">
        <button type="button" data-seg="expense" class="${form.type === 'expense' ? 'active-expense' : ''}">Expense</button>
        <button type="button" data-seg="income" class="${form.type === 'income' ? 'active-income' : ''}">Income</button>
      </div>
      ${form.type === 'income'
        ? `<p class="rule-chip" style="margin-bottom:14px">${icon('coin')} One-time rule &mdash; each paycheck is logged once, never on repeat</p>`
        : ''}
      <div class="form-error ${form.error ? 'show' : ''}">${esc(form.error || '')}</div>
      <form id="tx-form" novalidate>
        <div class="form-row">
          <div class="field">
            <label>Amount</label>
            <input name="amount" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${esc(form.values.amount)}" />
          </div>
          <div class="field">
            <label>Date</label>
            <input name="date" type="date" value="${esc(form.values.date)}" />
          </div>
          <div class="field">
            <label>Category</label>
            <select name="category">${categorySelect(form)}</select>
          </div>
        </div>
        ${showNewCat ? `
          <div class="form-row" style="margin-top:13px">
            <div class="field">
              <label>New ${form.type} category</label>
              <input id="new-cat-name" placeholder="e.g. School supplies" autocomplete="off" />
            </div>
            <div class="field">
              <label>&nbsp;</label>
              <button class="btn" type="button" id="new-cat-add">${icon('plus')} Add category</button>
            </div>
          </div>` : ''}
        <div class="form-row" style="margin-top:13px">
          <div class="field">
            <label>Tags <span class="muted">(optional, comma separated)</span></label>
            <input name="tags" autocomplete="off" placeholder="weekly, cash" value="${esc(form.values.tags)}" />
          </div>
          <div class="field">
            <label>Note <span class="muted">(optional)</span></label>
            <input name="note" autocomplete="off" placeholder="What was this for?" value="${esc(form.values.note)}" />
          </div>
        </div>
        <div class="form-actions">
          ${isEdit ? '<button type="button" class="btn" id="tx-cancel">Cancel</button>' : ''}
          <button class="btn btn-primary" type="submit">${icon('check')} ${isEdit ? 'Save changes' : 'Add entry'}</button>
        </div>
      </form>
    </div>`;
}

function filteredTx() {
  let list = state.transactions.slice();
  const f = txFilters;
  if (f.month !== 'all') list = list.filter((t) => t.date.startsWith(f.month));
  if (f.type !== 'all') list = list.filter((t) => t.type === f.type);
  if (f.category !== 'all') list = list.filter((t) => t.category === f.category);
  if (f.q.trim()) {
    const q = f.q.trim().toLowerCase();
    list = list.filter((t) =>
      t.category.toLowerCase().includes(q)
      || (t.note || '').toLowerCase().includes(q)
      || (t.tags || []).some((tag) => tag.toLowerCase().includes(q)));
  }
  return list.sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : b.date < a.date ? 1 : -1));
}

function txListHtml() {
  const list = filteredTx();
  if (list.length === 0) {
    if (state.transactions.length === 0) {
      return emptyState('No entries yet', 'Add your first paycheck or expense using the form above.');
    }
    return emptyState('Nothing matches', 'No entries match the current filters.', '<button class="btn btn-sm" id="btn-clear-filters">Clear filters</button>');
  }
  const inc = sumIncome(list);
  const exp = sumExpense(list);
  return `
    <div class="tx-list">${list.map((t) => txRow(t, { actions: true })).join('')}</div>
    <div class="divider"></div>
    <div class="budget-top">
      <span class="small muted">${list.length} ${list.length === 1 ? 'entry' : 'entries'} shown</span>
      <span class="small num">
        <b style="color:var(--income)">+ ${money(inc)}</b>
        &nbsp;&nbsp;<b style="color:var(--expense)">&minus; ${money(exp)}</b>
        &nbsp;&nbsp;<b>Net ${money(inc - exp)}</b>
      </span>
    </div>`;
}

function monthOptions() {
  const set = new Set(state.transactions.map((t) => t.date.slice(0, 7)));
  set.add(currentMonth());
  if (txFilters.month !== 'all') set.add(txFilters.month);
  const months = [...set].sort().reverse();
  return months.map((m) => `<option value="${m}" ${txFilters.month === m ? 'selected' : ''}>${monthLabel(m)}</option>`).join('')
    + `<option value="all" ${txFilters.month === 'all' ? 'selected' : ''}>All time</option>`;
}

export async function renderTransactions(root) {
  if (!txForm) txForm = blankForm('expense');
  const f = txFilters;

  const catFilterCats = f.type !== 'all' ? categoriesFor(f.type) : [...categoriesFor('income'), ...categoriesFor('expense')];
  const catOptions = [
    `<option value="all">All categories</option>`,
    ...catFilterCats.map((c) => `<option value="${esc(c)}" ${f.category === c ? 'selected' : ''}>${esc(c)}</option>`),
    ...(f.category !== 'all' && !catFilterCats.includes(f.category)
      ? [`<option value="${esc(f.category)}" selected>${esc(f.category)}</option>`] : []),
  ].join('');

  root.innerHTML = `
    <div class="view-head">
      <div>
        <h1>Transactions</h1>
        <div class="sub">One-time entries only &mdash; income is never repeated automatically.</div>
      </div>
      <div class="actions">
        <button class="btn btn-primary" id="btn-focus-add">${icon('plus')} New entry</button>
      </div>
    </div>

    ${formCard()}

    <div class="card">
      <div class="card-head"><h2>Entries</h2></div>
      <div class="filters">
        <select data-filter="month">${monthOptions()}</select>
        <select data-filter="type">
          <option value="all" ${f.type === 'all' ? 'selected' : ''}>Income &amp; expenses</option>
          <option value="income" ${f.type === 'income' ? 'selected' : ''}>Income only</option>
          <option value="expense" ${f.type === 'expense' ? 'selected' : ''}>Expenses only</option>
        </select>
        <select data-filter="category">${catOptions}</select>
        <input class="grow" data-filter="q" placeholder="Search note, tag or category&hellip;" value="${esc(f.q)}" />
      </div>
      <div id="tx-list-wrap">${txListHtml()}</div>
    </div>`;

  /* --- form interactions --- */
  root.querySelectorAll('[data-seg]').forEach((btn) => {
    btn.addEventListener('click', () => {
      txForm.type = btn.dataset.seg;
      txForm.error = '';
      txForm.values.category = '';
      showNewCat = false;
      router.refresh();
    });
  });

  const form = root.querySelector('#tx-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    txForm.values = {
      amount: String(fd.get('amount') || ''),
      date: String(fd.get('date') || ''),
      category: String(fd.get('category') || ''),
      note: String(fd.get('note') || ''),
      tags: String(fd.get('tags') || ''),
    };
    const v = txForm.values;

    const amountCents = toCents(v.amount);
    if (!amountCents) return failForm('Enter an amount greater than zero.');
    if (!v.date) return failForm('Pick a date for this entry.');
    if (!v.category || v.category === '__new') return failForm('Choose a category (or add a new one first).');

    const payload = {
      type: txForm.type,
      amountCents,
      date: v.date,
      category: v.category,
      note: v.note,
      tags: v.tags.split(',').map((s) => s.trim()).filter(Boolean),
    };

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving…';
    try {
      if (txForm.mode === 'edit') {
        await api(`/transactions/${txForm.id}`, { method: 'PUT', body: payload });
        toast('Entry updated.', 'success');
        txForm = blankForm(txForm.type);
      } else {
        await api('/transactions', { method: 'POST', body: payload });
        toast(txForm.type === 'income' ? 'Paycheck recorded once.' : 'Expense recorded.', 'success');
        txForm = blankForm(txForm.type);
        txForm.values.date = v.date;
        txForm.values.category = v.category;
      }
      showNewCat = false;
      await loadTransactions();
      router.refresh();
    } catch (err) {
      txForm.error = err.message;
      router.refresh();
    }
  });

  function failForm(message) {
    txForm.error = message;
    router.refresh();
  }

  const cancelBtn = root.querySelector('#tx-cancel');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      txForm = blankForm(txForm.type);
      showNewCat = false;
      router.refresh();
    });
  }

  const catSelect = form.querySelector('select[name="category"]');
  catSelect.addEventListener('change', () => {
    if (catSelect.value === '__new') {
      showNewCat = true;
      router.refresh();
      setTimeout(() => document.getElementById('new-cat-name')?.focus(), 30);
    }
  });

  const addCatBtn = root.querySelector('#new-cat-add');
  if (addCatBtn) {
    addCatBtn.addEventListener('click', async () => {
      const name = document.getElementById('new-cat-name').value.trim();
      if (!name) return toast('Type a category name first.', 'error');
      try {
        await api('/categories', { method: 'POST', body: { name, kind: txForm.type } });
        await loadCategories();
        txForm.values.category = name;
        showNewCat = false;
        toast(`Category "${name}" added.`, 'success');
        router.refresh();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  const focusAdd = root.querySelector('#btn-focus-add');
  focusAdd.addEventListener('click', () => {
    if (txForm.mode === 'edit') {
      txForm = blankForm(txForm.type);
      showNewCat = false;
      router.refresh();
    }
    setTimeout(() => {
      document.getElementById('tx-form-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      form.querySelector('input[name="amount"]')?.focus();
    }, 30);
  });

  /* --- filters --- */
  root.querySelectorAll('[data-filter]').forEach((el) => {
    const key = el.dataset.filter;
    if (el.tagName === 'INPUT') {
      let timer = null;
      el.addEventListener('input', () => {
        txFilters.q = el.value;
        clearTimeout(timer);
        timer = setTimeout(() => {
          document.getElementById('tx-list-wrap').innerHTML = txListHtml();
          wireList();
        }, 220);
      });
    } else {
      el.addEventListener('change', () => {
        txFilters[key] = el.value;
        if (key === 'type') txFilters.category = 'all';
        router.refresh();
      });
    }
  });

  wireList();

  function wireList() {
    const wrap = document.getElementById('tx-list-wrap');
    if (!wrap) return;

    wrap.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const tx = state.transactions.find((t) => t.id === id);
        if (!tx) return;
        if (btn.dataset.act === 'edit') {
          txForm = {
            mode: 'edit',
            type: tx.type,
            id: tx.id,
            values: {
              amount: fromCents(tx.amountCents),
              date: tx.date,
              category: tx.category,
              note: tx.note || '',
              tags: (tx.tags || []).join(', '),
            },
            error: '',
          };
          showNewCat = false;
          router.refresh();
          setTimeout(() => document.getElementById('tx-form-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
        } else {
          if (!confirm('Delete this entry? This cannot be undone.')) return;
          try {
            await api(`/transactions/${id}`, { method: 'DELETE' });
            await loadTransactions();
            toast('Entry deleted.', 'success');
            router.refresh();
          } catch (err) {
            toast(err.message, 'error');
          }
        }
      });
    });

    const clear = wrap.querySelector('#btn-clear-filters');
    if (clear) {
      clear.addEventListener('click', () => {
        txFilters = { month: 'all', type: 'all', category: 'all', q: '' };
        router.refresh();
      });
    }
  }
}

/* ==================================================== Budgets */

let budgetDraft = null; // { month, limits } loaded but not saved yet

export async function renderBudgets(root) {
  if (!state.budgets || !state.budgets.month) await loadBudgets(currentMonth());
  const month = state.budgets.month || currentMonth();
  const saved = state.budgets.limits || {};
  const draft = budgetDraft && budgetDraft.month === month ? budgetDraft.limits : {};
  const cats = expenseCategories();
  const monthTx = state.transactions.filter((t) => t.date.startsWith(month) && t.type === 'expense');
  const anyBudget = cats.some((c) => (draft[c] ?? saved[c]) > 0);

  const rows = cats.map((cat) => {
    const limit = draft[cat] ?? saved[cat] ?? 0;
    const spent = sumExpense(monthTx.filter((t) => t.category === cat));
    const pct = limit > 0 ? Math.min(1, spent / limit) : 0;
    const cls = limit > 0 && spent > limit ? 'over' : pct >= 0.8 ? 'warn' : '';
    const left = limit - spent;
    return `
      <div class="budget-row">
        <div class="budget-top">
          <div class="name">${esc(cat)}</div>
          <div class="budget-figures num">
            <span class="tiny muted">spent ${money(spent)}</span>
            <label class="tiny muted" for="b-${esc(cat)}">limit</label>
            <input id="b-${esc(cat)}" data-budget-cat="${esc(cat)}" inputmode="decimal" placeholder="none" value="${fromCents(limit) || ''}" />
          </div>
        </div>
        ${limit > 0 ? `
          <div class="bar ${cls}"><i style="width:${Math.round(pct * 100)}%"></i></div>
          <div class="budget-meta">
            <span>${Math.round(pct * 100)}% used</span>
            <span>${left >= 0 ? `${money(left)} left` : `${money(-left)} over budget`}</span>
          </div>` : `
          <div class="budget-meta"><span class="muted">No limit set</span><span class="muted">${money(spent)} spent</span></div>`}
      </div>`;
  }).join('');

  root.innerHTML = `
    <div class="view-head">
      <div>
        <h1>Budgets</h1>
        <div class="sub">Monthly limits per category &middot; spending resets each month.</div>
      </div>
      <div class="actions">
        <button class="btn" id="btn-copy-prev">${icon('copy')} Copy previous month</button>
        <button class="btn btn-primary" id="btn-save-budgets">${icon('check')} Save budgets</button>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <div style="display:flex;align-items:center;gap:8px">
          <button class="icon-btn" id="btn-prev-month" style="color:var(--text-2)" aria-label="Previous month">${icon('left')}</button>
          <h2>${monthLabel(month)}</h2>
          <button class="icon-btn" id="btn-next-month" style="color:var(--text-2)" aria-label="Next month">${icon('right')}</button>
        </div>
        <span class="muted small num">
          Budgeted ${money(Object.values(saved).reduce((s, v) => s + v, 0))} &middot; spent ${money(sumExpense(monthTx))}
        </span>
      </div>

      ${Object.keys(draft).length > 0 ? `
        <div class="privacy-note">${icon('info')}<div>Previous month's limits loaded below &mdash; review them and press <b>Save budgets</b> to apply.</div></div>` : ''}

      ${anyBudget ? '' : `
        <div class="privacy-note">${icon('target')}<div>Type a <b>limit</b> next to any category to create a budget, then press <b>Save budgets</b>.</div></div>`}

      <div id="budget-rows">${rows}</div>

      <div class="form-actions">
        <button class="btn btn-primary" id="btn-save-budgets-2">${icon('check')} Save budgets</button>
      </div>
    </div>`;

  root.querySelector('#btn-prev-month').addEventListener('click', () => switchMonth(-1));
  root.querySelector('#btn-next-month').addEventListener('click', () => switchMonth(1));

  async function switchMonth(delta) {
    budgetDraft = null;
    await loadBudgets(shiftMonth(month, delta));
    router.refresh();
  }

  root.querySelector('#btn-copy-prev').addEventListener('click', async () => {
    try {
      const prev = await api(`/budgets?month=${encodeURIComponent(shiftMonth(month, -1))}`);
      budgetDraft = { month, limits: prev.limits || {} };
      if (Object.keys(budgetDraft.limits).length === 0) {
        budgetDraft = null;
        return toast('The previous month has no budgets to copy.', 'error');
      }
      toast('Previous month loaded — press Save budgets to apply.', 'success');
      router.refresh();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  const save = async () => {
    const limits = {};
    root.querySelectorAll('[data-budget-cat]').forEach((input) => {
      const cents = toCents(input.value);
      if (cents && cents > 0) limits[input.dataset.budgetCat] = cents;
    });
    try {
      const res = await api(`/budgets?month=${encodeURIComponent(month)}`, { method: 'PUT', body: { limits } });
      state.budgets = res;
      budgetDraft = null;
      toast('Budgets saved.', 'success');
      router.refresh();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  root.querySelector('#btn-save-budgets').addEventListener('click', save);
  root.querySelector('#btn-save-budgets-2').addEventListener('click', save);
}

/* ==================================================== Reports */

let reportRange = 6;
const charts = [];

function destroyCharts() {
  while (charts.length) {
    try { charts.pop().destroy(); } catch { /* already gone */ }
  }
}

function monthsBack(count) {
  const out = [];
  let m = currentMonth();
  for (let i = 0; i < count; i++) {
    out.unshift(m);
    m = shiftMonth(m, -1);
  }
  return out;
}

export async function renderReports(root) {
  destroyCharts();

  const months = monthsBack(reportRange);
  const rows = months.map((m) => {
    const list = state.transactions.filter((t) => t.date.startsWith(m));
    const income = sumIncome(list);
    const expense = sumExpense(list);
    return { month: m, income, expense, net: income - expense, count: list.length };
  });

  const totalIncome = rows.reduce((s, r) => s + r.income, 0);
  const totalExpense = rows.reduce((s, r) => s + r.expense, 0);

  // Expense breakdown by category over the selected range
  const byCat = {};
  for (const t of state.transactions) {
    if (t.type !== 'expense' || !months.includes(t.date.slice(0, 7))) continue;
    byCat[t.category] = (byCat[t.category] || 0) + t.amountCents;
  }
  const catRows = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const topCats = catRows.slice(0, 6);
  const otherCats = catRows.slice(6).reduce((s, [, v]) => s + v, 0);
  if (otherCats > 0) topCats.push(['Other', otherCats]);

  const hasData = totalIncome > 0 || totalExpense > 0;

  root.innerHTML = `
    <div class="view-head">
      <div>
        <h1>Reports</h1>
        <div class="sub">Income vs spending &mdash; every paycheck counted once, in the month it arrived.</div>
      </div>
      <div class="actions">
        <div class="seg" style="margin:0;min-width:180px">
          <button data-range="6" class="${reportRange === 6 ? 'active-expense' : ''}" style="${reportRange === 6 ? 'background:var(--primary);box-shadow:none' : ''}">6 months</button>
          <button data-range="12" class="${reportRange === 12 ? 'active-expense' : ''}" style="${reportRange === 12 ? 'background:var(--primary);box-shadow:none' : ''}">12 months</button>
        </div>
      </div>
    </div>

    <div class="grid grid-3">
      <div class="stat income">
        <div class="label">Income (${reportRange}m)</div>
        <div class="value num">${money(totalIncome)}</div>
        <div class="hint">All one-time entries</div>
      </div>
      <div class="stat expense">
        <div class="label">Expenses (${reportRange}m)</div>
        <div class="value num">${money(totalExpense)}</div>
        <div class="hint">${catRows.length} categories used</div>
      </div>
      <div class="stat">
        <div class="label">Net (${reportRange}m)</div>
        <div class="value num" style="color:${totalIncome - totalExpense >= 0 ? 'var(--income)' : 'var(--expense)'}">${money(totalIncome - totalExpense)}</div>
        <div class="hint">Income minus expenses</div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-head"><h2>Monthly trend</h2></div>
      <div class="chart-box" id="chart-trend">${hasData ? '<canvas aria-label="Monthly income vs expenses"></canvas>' : emptyState('No data yet', 'Add income and expenses to see your monthly trend.')}</div>
      <div class="chart-note">Green = income received &middot; Red = money spent</div>
    </div>

    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <div class="card-head"><h2>Where the money went</h2></div>
        <div class="chart-box" id="chart-cats">${catRows.length ? '<canvas aria-label="Expenses by category"></canvas>' : emptyState('No expenses yet', 'Your expense breakdown will appear here.')}</div>
      </div>

      <div class="card">
        <div class="card-head"><h2>Top categories</h2></div>
        ${catRows.length === 0
          ? emptyState('Nothing to show yet', 'Expenses by category appear here once you log spending.')
          : catRows.slice(0, 8).map(([cat, cents]) => {
              const share = totalExpense ? Math.round((cents / totalExpense) * 100) : 0;
              return `
                <div class="budget-row" style="padding-top:8px">
                  <div class="budget-top">
                    <div class="name">${esc(cat)}</div>
                    <div class="budget-figures num"><b>${money(cents)}</b><span class="muted">${share}%</span></div>
                  </div>
                  <div class="bar"><i style="width:${share}%"></i></div>
                </div>`;
            }).join('')}
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-head"><h2>Month by month</h2></div>
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr><th>Month</th><th class="right">Income</th><th class="right">Expenses</th><th class="right">Net</th></tr>
          </thead>
          <tbody>
            ${rows.slice().reverse().map((r) => `
              <tr>
                <td>${monthLabel(r.month)}</td>
                <td class="right num" style="color:var(--income)">${money(r.income)}</td>
                <td class="right num" style="color:var(--expense)">${money(r.expense)}</td>
                <td class="right num"><b>${money(r.net)}</b></td>
              </tr>`).join('')}
            <tr style="background:var(--surface-2)">
              <td><b>Total</b></td>
              <td class="right num"><b>${money(totalIncome)}</b></td>
              <td class="right num"><b>${money(totalExpense)}</b></td>
              <td class="right num"><b>${money(totalIncome - totalExpense)}</b></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>`;

  root.querySelectorAll('[data-range]').forEach((btn) => {
    btn.addEventListener('click', () => {
      reportRange = Number(btn.dataset.range);
      router.refresh();
    });
  });

  // Charts (Chart.js may be unavailable offline — tables above remain usable).
  // Draw synchronously: rAF can be throttled in background/hidden windows.
  (function drawCharts() {
    if (typeof window.Chart === 'undefined') {
      const trend = document.getElementById('chart-trend');
      const cats = document.getElementById('chart-cats');
      const msg = '<div class="empty"><span class="small">Chart library not loaded (offline). Use the table below for the same numbers.</span></div>';
      if (trend && hasData) trend.closest('.chart-box').innerHTML = msg;
      if (cats && catRows.length) cats.closest('.chart-box').innerHTML = msg;
      return;
    }

    const trendBox = document.getElementById('chart-trend');
    const trendEl = trendBox ? trendBox.querySelector('canvas') : null;
    if (trendEl && hasData) {
      charts.push(new window.Chart(trendEl, {
        type: 'bar',
        data: {
          labels: months.map(monthShort),
          datasets: [
            { label: 'Income', data: rows.map((r) => r.income), backgroundColor: '#16a34a', borderRadius: 6, maxBarThickness: 34 },
            { label: 'Expenses', data: rows.map((r) => r.expense), backgroundColor: '#dc2626', borderRadius: 6, maxBarThickness: 34 },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } } },
          scales: {
            x: { grid: { display: false } },
            y: { beginAtZero: true, ticks: { callback: (v) => money(v) } },
          },
        },
      }));
    }

    const catsBox = document.getElementById('chart-cats');
    const catsEl = catsBox ? catsBox.querySelector('canvas') : null;
    if (catsEl && catRows.length) {
      const palette = ['#2563eb', '#16a34a', '#dc2626', '#d97706', '#7c3aed', '#0891b2', '#64748b'];
      charts.push(new window.Chart(catsEl, {
        type: 'doughnut',
        data: {
          labels: topCats.map(([c]) => c),
          datasets: [{
            data: topCats.map(([, v]) => v),
            backgroundColor: palette.slice(0, topCats.length),
            borderWidth: 2,
            borderColor: '#ffffff',
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '62%',
          plugins: {
            legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } },
            tooltip: { callbacks: { label: (ctx) => ` ${ctx.label}: ${money(ctx.parsed)}` } },
          },
        },
      }));
    }
  })();
}
