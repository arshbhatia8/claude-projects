# Spendly

A private personal finance tracker for one person, in Indian Rupees.
It is free to run: no server, no subscription, no install. Spendly runs in your browser, and your data is encrypted with your password and stays on your device.

- **My Finance dashboard**: liquid balance, income credited, expenses debited, net cash flow, investments, total assets, liabilities and net worth for any month. It also shows charts, insights and recent activity.
- **Privacy eye**: every amount is hidden (`₹••••••`) until you tap the eye. The eye shows or hides all amounts in the app at once, including chart labels and tooltips.
- **Quick Add**: reusable templates such as *Breakfast – Dosa*, *Lunch* and *Cab / Auto*. Tap one, check the amount, and save. You can pin, search and filter templates, and see the ones you use most and used last.
- **Transactions**: income, expense, transfer, investment, refund and reversal. You can filter, search, sort and export to CSV.
- **Bank Accounts & Cash, Liabilities**: credit cards and loans, with manual reconciliation.
- **Assets & Investments**: FDs, RDs, stocks, mutual funds, ETFs, digital gold and other assets. You enter all values yourself; Spendly never fetches live prices.
- **Savings Goals**: savings rate, where your money is, goals and insights.
- **Reports & Analytics**: yearly and monthly reports, month-on-month comparison, category trends, allocation and net-worth history.
- **Gmail Imports**: read-only. Spendly finds bank, UPI and card alerts, and **you approve each one** before it affects any total.
- **Dark theme** (default) and a light theme. The layout works on phones and on desktop.

---

## How it is built (and why)

The previous version needed Node.js on your computer, which you don't have. So Spendly is now a **static web app**: plain HTML, CSS and JavaScript modules, with no build step. It can be opened from GitHub Pages or any static host.

| Concern | Where it lives |
|---|---|
| UI (screens, forms, charts) | `public/js/ui/*` |
| Data layer (validation, atomic writes, migrations): what a backend would normally do | `public/js/core/store.js` |
| Accounting engine (pure functions) | `public/js/core/ledger.js` |
| Money handling (whole paise, never floating-point) | `public/js/core/money.js` |
| Gmail OAuth + sync (read-only) | `public/js/core/gmail.js` |
| Email alert parser, duplicate detection | `public/js/core/parser.js`, `public/js/core/duplicates.js` |
| Default categories, sample templates, demo data | `public/js/core/defaults.js` |

### How this differs from the spec

The spec asks for server-side validation and server-side token storage. Spendly has no server, so it does the following instead. This is the safest option that works without one:

- **Validation** runs in the data layer (`store.js`) for every write, whichever screen made it. Invalid data is rejected before it is saved.
- **No OAuth tokens are stored anywhere.** Google's browser sign-in gives a short-lived, read-only access token. Spendly keeps it only in memory for the open tab, and Google issues no refresh token. You may be asked to sign in to Google again when you sync after an hour or more.
- **Data is stored in this browser** (`localStorage`), encrypted with **AES-256-GCM**. The encryption key is made from your password with PBKDF2-SHA256 (310,000 rounds). Each browser has its own separate storage, so other devices don't see your data. Use **Settings → Download encrypted backup** to move your data or keep it safe.

---

## Accounting model

Every transaction turns into **balance changes ("postings")** and **income/expense lines**. Every total and report is calculated from those two lists. This is what keeps the rules below true.

| Type | Balance changes | Counts as |
|---|---|---|
| Income | account +₹ | income |
| Expense | account −₹ **or** credit card owed +₹ | expense, once, when incurred |
| Refund | account +₹ **or** card owed −₹ | negative expense in the same category |
| Transfer | from −₹, to +₹ (for a liability: owed goes down) | nothing, so a card bill payment isn't counted as spending again |
| Investment | account −₹, asset +₹ | nothing, so net worth doesn't change |
| Reversal | exact opposite of the original (or part of it) | opposite of the original |

- **Balances** = opening balance + all postings. If you record a manual reconciliation (*Adjust balance*, *Update value* or *Update outstanding*), the latest one replaces the opening amount, and only postings dated after it are added. Gmail imports never change a reconciliation.
- **Assets**: *current value* = your latest recorded value + money added later − money withdrawn later. *Invested* (cost basis) follows the money moved in and out. Gain = value − invested. When invested is ₹0, the gain percentage shows “—”.
- **FD/RD maturity or closure**: the recorded value goes back to your bank as a transfer. Anything extra is recorded as *Interest Income*. If you receive less than the recorded value, the asset's value is written down; it isn't recorded as spending.
- **Savings rate** = (Income − Expenses) ÷ Income × 100. It shows “not available” when income is ₹0.
- **Net-worth history** comes only from monthly snapshots saved while you use the app. Past months are never estimated.
- **Templates** are shortcuts, not transactions. Using one creates a separate transaction only after you press Save. Editing or deleting a template never changes past transactions.

## Data model (schema v2)

`settings`, `categories` (income/expense, with subcategories, can be archived), `accounts`, `assets`, `liabilities`, `transactions`, `templates` (with use count and last-used time), `goals`, `snapshots` (reconciliations and valuations), `netWorthHistory`, `gmail` (connection metadata, no tokens), `gmailCandidates` (the review queue).

All money fields are **integer paise**. Each transaction stores its type, amount, date, optional time, description, category and subcategory, `from`/`to` links (account, asset or liability), payment method, notes, source (manual / gmail / demo), external reference, Gmail message id, the template used, and created/updated timestamps.

**Migration**: if a vault from the earlier version of this app (“Ledger”) is found, unlocking it with its old password converts every record to schema v2. The new vault is saved first, and the old one is removed only after that save succeeds. This is covered by tests.

---

## Using it

1. Open the app link and **create a password** (8+ characters). If you forget it, the data can't be recovered, so download a backup from Settings now and then.
2. Add your **bank accounts & cash** with opening balances. Add the last 4 digits so Gmail alerts can be matched to the right account.
3. Add **credit cards / loans** under Liabilities, and **FDs, RDs, stocks, gold** under Assets. For something you already own, choose *I already own it* so it doesn't take money out of an account.
4. Go to **Quick Add → Add suggested templates** (Breakfast – Dosa, Lunch, Tea / Coffee…), then pin your favourites.
5. To look around first, use **Settings → Load demo data**. It adds clearly marked sample records: ₹65,000 income and ₹25,500 expenses in the current month. **Remove demo data** deletes only those records.

### Connect Gmail (optional, free, read-only)

1. Open [Google Cloud Console](https://console.cloud.google.com/projectcreate) and create a project. You don't need billing.
2. Enable the [Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com).
3. Go to **Google Auth Platform → Audience**, choose **External**, and add your own Gmail under **Test users**.
4. Go to **Data access** and add only `https://www.googleapis.com/auth/gmail.readonly`.
5. Go to **Clients → Create client → Web application**. Under **Authorized JavaScript origins**, add the origin the app runs on. For GitHub Pages that is `https://arshbhatia8.github.io`. You don't need a redirect URI or a client secret.
6. In Spendly, open **Gmail Imports**, paste the Client ID and press **Connect Gmail**. Then press **Sync now** whenever you like.

Google will warn that the app "hasn't been verified". That's expected for your own personal client, so continue. Every detected email waits under **Pending**, where you can **Approve & import**, **Edit first**, **Mark reviewed** or **Reject**. Spendly also flags possible duplicates (the same email, the same reference number such as a forwarded alert, or the same amount within a day). Approving the same email twice can't create two transactions.

---

## Running the tests (developers only)

```bash
cd spendly
npm test          # 29 tests: accounting rules, store, migration, Gmail review, parser, duplicates
npm start         # serves public/ at http://localhost:4000 (needs Node 20+)
```

The tests cover:
- each rule in the accounting table above
- reconciliation, FD maturity and a zero cost basis
- rollback when a save fails
- Quick Add template flows
- Gmail approval idempotency and re-syncs
- migration from the old format
- encrypted backups and changing the password

The browser flows were also checked end to end in headless Chromium: privacy masking on every screen, approving and editing Gmail imports, paying a card bill, reversals, FD maturity, templates, reload, lock/unlock, and no horizontal scrolling at 375 px.

## Known limitations

- **Gmail** has been tested with sample alert text, not against your inbox. Bank alert formats vary, so check the suggested category and account before approving. Google sign-in doesn't work inside embedded previews; open the app on its own page.
- **Data is per browser.** Your phone and laptop each keep their own copy. Use encrypted backup and restore to move data between them.
- **Asset values, interest and maturity amounts are what you enter.** Spendly doesn't calculate maturity amounts or fetch market prices.
- **Planned or recurring transactions aren't automated.** Only transactions you save count.
