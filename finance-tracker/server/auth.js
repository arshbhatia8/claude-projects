// Single-user password lock. The first visit asks you to set a password;
// after that every API call needs the session cookie.
const crypto = require('node:crypto');
const { getSetting, setSetting } = require('./db');

const COOKIE = 'ft_session';
const SESSION_DAYS = 30;

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, stored) {
  const { hash } = hashPassword(password, stored.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(stored.hash, 'hex'));
}

function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').map((p) => p.trim().split('=')).filter(([k]) => k).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))])
  );
}

function createAuth(db) {
  const isSetUp = () => Boolean(getSetting(db, 'password'));

  function issueSession(res) {
    const token = crypto.randomBytes(32).toString('hex');
    const expires = Date.now() + SESSION_DAYS * 864e5;
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
    db.prepare('INSERT INTO sessions (token, expires_at) VALUES (?, ?)').run(token, expires);
    res.setHeader(
      'Set-Cookie',
      `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`
    );
  }

  function sessionValid(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token) return false;
    const row = db.prepare('SELECT expires_at FROM sessions WHERE token = ?').get(token);
    return Boolean(row && row.expires_at > Date.now());
  }

  function requireAuth(req, res, next) {
    if (sessionValid(req)) return next();
    res.status(401).json({ error: 'Not signed in' });
  }

  function routes(app) {
    app.get('/api/auth/status', (req, res) => {
      res.json({ setUp: isSetUp(), signedIn: sessionValid(req) });
    });

    app.post('/api/auth/setup', (req, res) => {
      if (isSetUp()) return res.status(400).json({ error: 'Password already set' });
      const { password } = req.body || {};
      if (!password || password.length < 6) {
        return res.status(400).json({ error: 'Use at least 6 characters' });
      }
      setSetting(db, 'password', hashPassword(password));
      issueSession(res);
      res.json({ ok: true });
    });

    app.post('/api/auth/login', (req, res) => {
      const stored = getSetting(db, 'password');
      const { password } = req.body || {};
      if (!stored || !password || !verifyPassword(password, stored)) {
        return res.status(401).json({ error: 'Wrong password' });
      }
      issueSession(res);
      res.json({ ok: true });
    });

    app.post('/api/auth/logout', (req, res) => {
      const token = parseCookies(req.headers.cookie)[COOKIE];
      if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
      res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
      res.json({ ok: true });
    });

    app.post('/api/auth/change-password', requireAuth, (req, res) => {
      const { current, next: nextPassword } = req.body || {};
      const stored = getSetting(db, 'password');
      if (!current || !verifyPassword(current, stored)) {
        return res.status(401).json({ error: 'Current password is wrong' });
      }
      if (!nextPassword || nextPassword.length < 6) {
        return res.status(400).json({ error: 'Use at least 6 characters' });
      }
      setSetting(db, 'password', hashPassword(nextPassword));
      res.json({ ok: true });
    });
  }

  return { requireAuth, routes };
}

module.exports = { createAuth };
