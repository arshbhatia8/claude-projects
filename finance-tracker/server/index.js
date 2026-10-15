const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

// Minimal .env loader so there is no extra dependency.
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const { open, getSetting } = require('./db');
const { createAuth } = require('./auth');
const transactions = require('./transactions');
const gmail = require('./gmail');

function createApp(db = open()) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  const auth = createAuth(db);
  auth.routes(app);
  app.use('/api/gmail', (req, res, next) => (req.path === '/callback' ? next() : auth.requireAuth(req, res, next)));
  app.use('/api/gmail', gmail.router(db));
  app.use('/api', auth.requireAuth, transactions.router(db));

  app.use(express.static(path.join(__dirname, '..', 'public')));
  return app;
}

if (require.main === module) {
  const db = open();
  const port = Number(process.env.PORT) || 4000;
  // 127.0.0.1 keeps the app reachable only from this computer.
  const host = process.env.HOST || '127.0.0.1';
  createApp(db).listen(port, host, () => {
    console.log(`Finance tracker running at http://localhost:${port}`);
  });

  // Optional background Gmail sync every 6 hours (turn on in Settings).
  setInterval(() => {
    if (getSetting(db, 'gmail_auto_sync', false) && getSetting(db, 'gmail_tokens')) {
      gmail.sync(db, { days: 3 }).catch((e) => console.error('Auto-sync failed:', e.message));
    }
  }, 6 * 60 * 60 * 1000).unref();
}

module.exports = { createApp };
