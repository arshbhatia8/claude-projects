# Ledger — personal finance tracker

A private, self-hosted finance tracker for one person. It's free to run: no paid services, no accounts and no cloud. Everything is saved in one SQLite file on your own computer.

- **Credit / Debit / Invested**: every transaction has one of these three types. Investments also record *where* the money went: the type (Mutual Fund SIP, Stocks, FD, PPF, NPS, Gold, Crypto…), the fund or stock, and the platform (Groww, Zerodha…).
- **Manual entry** with suggested categories for each type, payment mode (UPI, card, net banking, cash…), account/card, date and notes. You can also type your own category.
- **Overview**: totals for the month, how much you kept, a 12-month chart, where your money went, and where you invested.
- **Transactions**: search, filter by type, month or source, edit, delete, and export to CSV.
- **Gmail import (read-only)**: reads bank, UPI, card and SIP alert emails and adds them as transactions.
- **Private**: the app is password-locked and listens on `127.0.0.1` only, so other devices on your network can't reach it.

## Run it

You need Node.js 22.13 or newer. It uses Node's built-in SQLite, so there's nothing to compile.

```bash
cd finance-tracker
npm install
npm start
```

Open http://localhost:4000. On the first visit you choose a password.

Your data is stored in `finance-tracker/data/finance.db`. To back it up, copy that file. `.gitignore` keeps it out of git.

## Connect Gmail (optional, free)

Google needs you to create your own free OAuth client. This takes about 5 minutes and you only do it once:

1. Create a project in [Google Cloud Console](https://console.cloud.google.com/projectcreate). You don't need billing.
2. Enable the [Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com).
3. Go to **OAuth consent screen**, choose **External**, and add your own Gmail address under **Test users**.
4. Go to **Credentials**, then **Create credentials**, then **OAuth client ID**, and pick **Web application**. Add this redirect URI:
   `http://localhost:4000/api/gmail/callback`
5. In the app, open **Settings**, paste the client ID and secret, click **Connect Gmail**, then **Sync now**.

You can put `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in a `.env` file instead (see `.env.example`).

### Why it can't change your mail

- The app asks Google for only one permission: `https://www.googleapis.com/auth/gmail.readonly`. With that token Google itself blocks deleting, sending, archiving, labelling and marking mail as read.
- The code only sends `GET` requests to the Gmail API (`server/gmail.js`).
- When you delete a transaction, it is removed from the app's own database only. Synced emails are remembered, so a deleted transaction won't come back on the next sync.
- **Disconnect** cancels the app's access at Google.

Tip: if non-bank emails get imported, add a sender filter in Settings, for example
`from:(alerts@hdfcbank.net OR credit_cards@icicibank.com OR noreply@groww.in)`.

Imported transactions show a **GMAIL** badge. The parser makes its best guess at the amount, type, merchant and category, so check them and edit anything it got wrong.

## Project layout

```
server/
  index.js         Express app (binds to 127.0.0.1)
  db.js            SQLite schema & settings
  auth.js          single-user password + session cookie
  transactions.js  CRUD, summary, CSV export
  gmail.js         read-only OAuth + sync
  parser.js        turns alert emails into transactions
public/            frontend (plain HTML/CSS/JS, dark gradient theme)
```

Run the tests with `npm test`.
