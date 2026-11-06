# Pocket Fortress

Pocket Fortress is a multi-user financial ledger you open from any device through a browser. One admin
creates the logins, each user tracks their own money in complete privacy, and **every
income is recorded as a one-time entry** — the paycheck rule: money that comes in is
logged once, when it arrives, and is never repeated or estimated automatically.

## Features

- **One-time paycheck rule** — income entries are single events. The data model has no
  recurring/ repeating income at all, by design.
- **Accounts managed by one main admin** — the admin creates a unique username +
  password per person, can reset passwords, disable/enable and delete accounts.
- **Fully private ledgers** — nobody, including the admin, can read another user's
  transactions, budgets or reports. The admin only manages accounts.
- **Dashboard** — balance, income vs expenses this month, budget status, recent activity.
- **Transactions** — income & expenses with categories, tags, notes, month/type/category
  filters and search; edit and delete; running totals.
- **Categories** — generous preset lists plus your own custom categories per account.
- **Budgets** — a monthly limit per expense category, with progress bars
  (under 80% = green, 80%+ = amber, over = red) and one-click "copy previous month".
- **Reports** — 6/12-month income-vs-expense chart, expense-by-category doughnut,
  top categories and a month-by-month table.
- **Settings** — display currency (38 codes), password change, sign out.
- Works on phones, tablets and desktops (responsive layout).

## Quick start (run on this computer)

```bash
npm install
npm run dev
```

Then open **http://localhost:8787**.

The console also prints a **Network** URL (e.g. `http://192.168.100.46:8787`) — open
that on your phone while on the same Wi-Fi and everyone signs in with their own account.

> Local data is stored in `.data/ledger.json` (git-ignored). Delete that folder to
> start over.

## Deploy on Netlify (recommended)

The site is a static front end + one serverless API function, and data lives in
**Netlify Blobs** — no external database to sign up for; it is included with every
Netlify site.

**Important:** do not use plain drag-and-drop upload — it publishes only the static
files and skips the API function. Use one of these two routes:

### Option A — Git (easiest to update later)

1. Push this folder to a GitHub/GitLab/Bitbucket repository.
2. On [netlify.com](https://app.netlify.com): **Add new site → Import an existing
   project** → pick the repository.
3. Netlify reads `netlify.toml` automatically (publish `public/`, functions
   `netlify/functions`). Click **Deploy**.
4. Your Pocket Fortress is live at `https://<site-name>.netlify.app` — open it on any device.

### Option B — Netlify CLI

```bash
npm install -g netlify-cli
netlify login
netlify init            # create a new site
netlify deploy --prod   # build + publish with functions
```

Re-deploy after changes with `netlify deploy --prod`.

### Optional environment variables

Set these in **Site settings → Environment variables** to seed the main admin
automatically; otherwise the site shows a one-time *Create the main admin* screen on
its first visit:

| Variable         | Example   | Purpose                          |
| ---------------- | --------- | -------------------------------- |
| `ADMIN_USERNAME` | `admin`   | Main admin username (lowercase)  |
| `ADMIN_PASSWORD` | `...`     | Main admin password (8+ chars)   |

### After you deploy

1. Open the site → complete the one-time admin setup (or use the seeded admin).
2. Go to **Admin → Create account** for each person and give them their username +
   password.
3. Each person signs in and sees only their own ledger.

## Tests

```bash
npm test
```

81 checks cover setup, login, lockout, sessions, the one-time income rule, amounts and
dates, privacy between users, categories, budgets, settings, admin controls, and
security guards (cross-origin posts, forged cookies, Secure-cookie handling on
HTTPS vs LAN).

## Project layout

```
public/                 Front-end (no build step): app, views, styles
  app.js                Boot, auth screens, shell, routing
  core.js               API client, state, money/date formatting, icons
  views.js              Dashboard, Transactions, Budgets, Reports
  admin.js              Admin (accounts) and Settings
  styles.css            Responsive design (sidebar on desktop, tabs on mobile)
src/
  handler.mjs           The whole API: auth, transactions, budgets, admin…
  store.mjs             Netlify Blobs on Netlify, JSON file locally
  auth.mjs              scrypt password hashing, session tokens
netlify/functions/api.mjs   Serverless entry point (thin adapter)
server.mjs              Local dev server (static + API on one origin)
test/run-tests.mjs      API test suite
netlify.toml            Netlify build + /api/* redirect
```

## Security notes

- Passwords hashed with **scrypt** (N=16384) + per-user salt; compared in constant time.
- 30-day `HttpOnly` + `SameSite=Lax` session cookies. `Secure` is added automatically
  on HTTPS/localhost and omitted on plain LAN addresses so phones can sign in locally.
- Failed logins lock the account for 15 minutes after 8 attempts.
- Cross-origin POSTs are rejected; all writes validate input and amounts server-side.
- Disabling a user or resetting their password signs their sessions out immediately.

## Troubleshooting

- **Charts don't appear** — Chart.js loads from a CDN; without internet the Reports
  page falls back to tables with the same numbers.
- **Phone can't stay signed in on the local server** — make sure you are using the
  printed `http://<LAN-IP>:8787` URL as a whole and that your browser accepts cookies
  for it (the app switches cookies to non-Secure mode automatically for LAN HTTP).
- **Want a fresh start locally** — stop the server and delete `.data/`.
