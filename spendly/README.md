# Spendly

**App:** https://arshbhatia8.github.io/claude-projects/ (GitHub Pages, published from the `gh-pages` branch)

A private personal finance tracker for one person, in Indian Rupees, designed first for iPhone.
It is free to run: no server, no subscription, no install. Spendly runs in your browser, and your data is encrypted with your password and stays on your device.

- **My Finance dashboard**: liquid balance, income credited, expenses debited, net cash flow, investments, total assets, liabilities and net worth for any month. It also shows charts, insights and recent activity.
- **Privacy eye**: every amount is hidden (`₹••••••`) until you tap the eye. The eye shows or hides all amounts in the app at once, including chart labels and tooltips.
- **Quick Add**: short category tiles — Breakfast, Lunch, Snacks, Dinner, Groceries, Transport, Shopping, Bills, Personal Care, Other Expenses. Tap *Breakfast*, type *Dosa* in Description, enter the amount and tap **Save Expense**. Items like Dosa, Idli or Samosa are always descriptions, never categories, so reports group them under Breakfast or Snacks. Recent descriptions appear as one-tap chips. Optional templates (e.g. a fixed “Office lunch”) can be created, pinned, edited and deleted; that never changes past transactions. Choose which categories appear as tiles in **Edit categories**.
- **Smart Entry**: type or say a sentence such as “I spent ₹40 on dosa for breakfast today”, “Salary ₹54,000 credited into HDFC”, “I opened an FD with XYZ Bank for ₹50,000 at 6.5% maturing 16 Oct 2027” or “I invested ₹2,000 in stocks”. Spendly fills in the right form (expense, income, FD/RD asset, investment, card or loan) and **nothing is saved until you review and confirm it**. It never invents missing amounts, dates, banks or rates, asks when it is unsure, asks whether to update an FD that already exists, and does not record future payments. You can teach it your own words (e.g. *chai → Snacks*) in Edit categories.
- **Voice entry** (optional): the microphone uses the browser's built-in speech recognition. It asks for your consent first, listens for one sentence only (20 s limit), and puts the text in the box for you to check. If voice isn't available, use the 🎤 key on the iPhone keyboard instead.
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

## Data model (schema v3)

`settings`, `categories` (income/expense, with subcategories, can be archived), `accounts`, `assets`, `liabilities`, `transactions`, `templates` (with use count and last-used time), `goals`, `snapshots` (reconciliations and valuations), `netWorthHistory`, `gmail` (connection metadata, no tokens), `gmailCandidates` (the review queue).

All money fields are **integer paise**. Each transaction stores its type, amount, date, optional time, description, category and subcategory, `from`/`to` links (account, asset or liability), payment method, notes, source (manual / gmail / demo), external reference, Gmail message id, the template used, and created/updated timestamps.

**Migration**: if a vault from the earlier version of this app (“Ledger”) is found, unlocking it with its old password converts every record to the current schema (v3). Vaults from the previous Spendly version (schema v2) are upgraded in place: default categories get their short names (e.g. *Travel and Transport* → *Transport*), the new Quick Add categories are added, old built-in item templates such as *Breakfast – Dosa* become templates in the Breakfast category, and no transaction is changed. The new vault is saved first, and the old one is removed only after that save succeeds. This is covered by tests.

---

## Using it

1. Open the app link and **create a password** (8+ characters). If you forget it, the data can't be recovered, so download a backup from Settings now and then.
2. Add your **bank accounts & cash** with opening balances. Add the last 4 digits so Gmail alerts can be matched to the right account.
3. Add **credit cards / loans** under Liabilities, and **FDs, RDs, stocks, gold** under Assets. For something you already own, choose *I already own it* so it doesn't take money out of an account.
4. Use **Quick Add**: tap a category tile, type what it was, enter the amount and save. Or use the Smart Entry box at the top of Home and Quick Add.
5. To look around first, use **Settings → Load demo data**. It adds clearly marked sample records: ₹65,000 income and ₹25,500 expenses in the current month. **Remove demo data** deletes only those records.

### Connect Gmail (optional, free, read-only)

1. Open [Google Cloud Console](https://console.cloud.google.com/projectcreate) and create a project. You don't need billing.
2. Enable the [Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com).
3. Go to **Google Auth Platform → Audience**, choose **External**, and add your own Gmail under **Test users**.
4. Go to **Data access** and add only `https://www.googleapis.com/auth/gmail.readonly`.
5. Go to **Clients → Create client → Web application**. Under **Authorized JavaScript origins**, add exactly `https://arshbhatia8.github.io` (no path, no trailing slash). You don't need a redirect URI or a client secret.
6. In Spendly, open **Gmail Imports**, paste the Client ID and press **Connect Gmail**. Then press **Sync now** whenever you like.

Google will warn that the app "hasn't been verified". That's expected for your own personal client, so continue. Every detected email waits under **Pending**, where you can **Approve & import**, **Edit first**, **Mark reviewed** or **Reject**. Spendly also flags possible duplicates (the same email, the same reference number such as a forwarded alert, or the same amount within a day). Approving the same email twice can't create two transactions.

---

## Using Spendly on iPhone

- Open the link in **Safari** (not a Private tab). The bottom bar has Home, Activity, a big **+** for Quick Add, Assets and **More**, which holds the other six sections.
- **Quick Add**: tap a category tile (or a favourite on Home). Description gets focus; the amount uses the number pad. Use the **Today / Yesterday** chips or pick a date, then tap **Save Expense**. Return on the keyboard only closes it; nothing is saved until you tap Save. Half-typed entries are kept as drafts (for 30 days) and offered again if the page reloads.
- **Backups and CSVs** open the iOS share sheet. Choose **Save to Files** (or iCloud Drive). To restore, go to Settings → Restore backup, pick the file in Files, and enter the password the backup was made with.
- **Add to Home Screen** (Share → Add to Home Screen) is the best way to use Spendly on iPhone. See *Why data disappeared after 7 days* below. A Home Screen icon has its **own separate storage**, so after adding it, move your data with Settings → Backup in Safari, then Restore in the Home Screen app.

### Why data disappeared after 7 days

Spendly's code has **no expiry, cleanup or auto-delete for financial records** (this is checked by a test). The only things it ever removes are: the old “Ledger” vault after a successful migration, everything after an explicit “Forgot password → type DELETE” reset, and the per-tab session key when you lock or close the tab (the data stays, you just enter the password again).

The 7-day loss comes from **Safari's Intelligent Tracking Prevention**: after 7 days of using Safari without visiting a website, Safari deletes all of that website's script-written storage, including Spendly's encrypted vault. Spendly cannot switch this off. What it does now:
- asks the browser for **persistent storage** and shows in **Settings → Storage & data safety** whether it was granted (a grant lowers the risk but is not a guarantee);
- shows the last successful save, the last backup, space used, and whether you opened it from Safari or the Home Screen;
- checks every save by reading it back, and shows **“Not saved: …”** (keeping your typed form open) if the browser refused or dropped it — it never shows a success message for a failed save;
- reminds you to back up; it never deletes anything because you haven't backed up.

Best protection: use it from the **Home Screen icon** (Home Screen web apps aren't subject to the 7-day rule while you use them), and keep an encrypted backup in Files/iCloud Drive. Clearing Safari website data or using Private Browsing still removes data.

## Deployment (GitHub Pages)

`npm run build` copies `public/` into `dist/`. It adds the commit hash to the page (shown at the bottom of Settings) and creates a `404.html` that sends paths like `/claude-projects/quick` back to `/#quick`. It then **refuses to finish** if any check fails: every asset path must be relative (so the app works under `/claude-projects/`), every module import must resolve, no credential patterns or database/env files may be present, and the security policy and viewport tags must be present. The contents of `dist/` are committed to the `gh-pages` branch, which GitHub Pages serves.

To publish an update: run `npm test`, then `npm run build`, then copy `dist/` into a checkout of `gh-pages`, commit and push. No force-push is needed.

## Running the tests (developers only)

```bash
cd spendly
npm test          # 60 tests: accounting, store, migrations, retention, categories, Smart Entry, voice, Gmail review, parser, duplicates, build checks
npm run build     # produces dist/ for GitHub Pages and runs the publishing checks
npm start         # serves public/ at http://localhost:4000 (needs Node 20+)
```

The tests cover:
- each rule in the accounting table above
- reconciliation, FD maturity and a zero cost basis
- rollback when a save fails
- Quick Add categories, templates and the v2 → v3 category migration
- Smart Entry parsing (examples A–F, ambiguity, future payments, duplicates)
- voice input (feature detection, denied permission, one utterance, time limit)
- retention: records survive 8, 31 and 400 days unopened; drafts are kept ≥30 days and cleanup touches nothing else; failed or silently dropped saves are never reported as saved
- Gmail approval idempotency and re-syncs
- migration from the old format
- encrypted backups and changing the password

The browser flows were also checked end to end in headless Chromium at the iPhone 15 size (393 px), plus tall, landscape and desktop sizes: privacy masking on every screen, Quick Add categories, Smart Entry (expense, salary, FD, RD, stocks, ambiguous and future sentences), voice with a simulated recognizer (consent, denied permission, unsupported fallback), drafts after reload, a simulated full-storage save failure, backups, CSV, restore, Gmail review, reload, lock/unlock, and no horizontal scrolling.

## Known limitations

- **Real voice input** was tested only with a simulated speech recognizer, not with a real microphone on an iPhone. Safari's support for the speech API depends on iOS version and Siri & Dictation settings; when it isn't available Spendly says so and you can use the keyboard 🎤 key.
- **Safari/WebKit itself** was not available in the test environment; tests ran in Chromium with the iPhone 15 screen size.
- **Old “Food and Dining” transactions** are kept as they were; that category is now called *Eating Out*. Spendly doesn't guess which past meals were breakfast or lunch.

- **Gmail** has been tested with sample alert text, not against your inbox. Bank alert formats vary, so check the suggested category and account before approving. Google sign-in doesn't work inside embedded previews; open the app on its own page.
- **Data is per browser.** Your phone and laptop each keep their own copy. Use encrypted backup and restore to move data between them.
- **Asset values, interest and maturity amounts are what you enter.** Spendly doesn't calculate maturity amounts or fetch market prices.
- **Planned or recurring transactions aren't automated.** Only transactions you save count.
