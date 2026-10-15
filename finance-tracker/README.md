# Ledger — personal finance tracker

A private finance tracker for one person. **Nothing to install and nothing to pay for.** It runs entirely in your browser and is hosted free on GitHub Pages.

**Open it:** https://arshbhatia8.github.io/claude-projects/

- **Credit / Debit / Invested**: every transaction has one of these three types. Investments also record *where* the money went: the type (Mutual Fund SIP, Stocks, FD, PPF, NPS, Gold, Crypto…), the fund or stock, and the platform (Groww, Zerodha…).
- **Manual entry** with suggested categories for each type, payment mode (UPI, card, net banking, cash…), account/card, date and notes.
- **Overview**: totals for the month, how much you kept, a 12-month chart, where your money went, and where you invested.
- **Transactions**: search, filter by type, month or source, edit, delete, and export to CSV.
- **Gmail import (read-only)**: reads bank, UPI, card and SIP alert emails and adds them as transactions.

## Privacy: how "for me only" works

- There is no server and no database in the cloud. GitHub only serves the app's files.
- Your transactions are **encrypted with your password** (AES-256-GCM, with the key made from your password using PBKDF2) and saved only in **your browser**. Anyone else who opens the same link gets their own empty app and can't see your data.
- If you forget the password, the data can't be recovered. Use **Settings → Download backup** regularly. A backup is also how you move your data to another phone or laptop: download it on one device and restore it on the other.
- Clearing your browser's site data deletes what's stored in the app, so keep a backup.

## Connect Gmail (optional, free, read-only)

Google needs you to create your own free client ID. This takes about 5 minutes and you only do it once:

1. Create a project in [Google Cloud Console](https://console.cloud.google.com/projectcreate). You don't need billing.
2. Enable the [Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com).
3. Go to **Google Auth Platform → Audience** (OAuth consent screen), choose **External**, and add your own Gmail address under **Test users**.
4. Go to **Clients → Create client → Web application**. Under **Authorized JavaScript origins** add
   `https://arshbhatia8.github.io`
5. In the app, open **Settings**, paste the client ID (it ends in `.apps.googleusercontent.com`) and click **Connect Gmail**. Then click **Sync now** whenever you want to import.

Google will say the app "hasn't been verified". That's expected for your own personal client, so click **Continue**.

### Why it can't change your mail

- The app asks Google for only one permission: `https://www.googleapis.com/auth/gmail.readonly`. With that permission Google itself blocks deleting, sending, archiving, labelling and marking mail as read.
- The code only sends `GET` (read) requests to the Gmail API (`public/js/gmail.js`).
- When you delete a transaction, it is removed from the app only. Synced emails are remembered, so a deleted transaction won't come back on the next sync.
- The page's Content-Security-Policy only lets it talk to Google sign-in and the Gmail API.

Tip: if non-bank emails get imported, add a sender filter in Settings, for example
`from:(alerts@hdfcbank.net OR credit_cards@icicibank.com OR noreply@groww.in)`.

## Project layout

```
public/              the whole app (static files, deployed to GitHub Pages)
  index.html         screens
  styles.css         dark gradient theme
  js/app.js          frontend: views, forms, charts
  js/backend.js      in-browser backend: encrypted storage, API, summaries
  js/gmail.js        read-only Gmail OAuth + sync
  js/parser.js       turns bank/UPI/card/SIP alert emails into transactions
  js/categories.js   category & payment-mode lists
test/                Node tests for the backend and the email parser
```

For developers: `npm test` runs the tests (Node 20+). `npm start` serves the app locally.
