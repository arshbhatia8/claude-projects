const test = require('node:test');
const assert = require('node:assert/strict');
const { open } = require('./db');
const { createApp } = require('./index');

test('auth, CRUD and summary', async (t) => {
  const server = createApp(open(':memory:')).listen(0);
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  let cookie = '';
  const call = async (path, method = 'GET', body) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', cookie },
      body: body && JSON.stringify(body),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  assert.equal((await call('/transactions')).status, 401);
  assert.deepEqual((await call('/auth/status')).body, { setUp: false, signedIn: false });
  assert.equal((await call('/auth/setup', 'POST', { password: 'secret123' })).status, 200);

  const month = new Date().toISOString().slice(0, 7);
  const add = (b) => call('/transactions', 'POST', { date: `${month}-01`, ...b });
  assert.equal((await add({ type: 'credit', amount: 50000, category: 'Salary' })).status, 201);
  assert.equal((await add({ type: 'debit', amount: 1200.5, category: 'Groceries', payment_mode: 'UPI' })).status, 201);
  const inv = await add({ type: 'investment', amount: 5000, category: 'Mutual Fund (SIP)', invested_in: 'Nifty 50 Index', platform: 'Groww' });
  assert.equal(inv.body.invested_in, 'Nifty 50 Index');
  assert.equal((await add({ type: 'other', amount: 1 })).status, 400);
  assert.equal((await add({ type: 'debit', amount: -5 })).status, 400);

  const updated = await call(`/transactions/${inv.body.id}`, 'PUT', { ...inv.body, amount: 6000 });
  assert.equal(updated.body.amount, 6000);

  const sum = (await call(`/summary?month=${month}`)).body;
  assert.equal(sum.totals.credit, 50000);
  assert.equal(sum.totals.debit, 1200.5);
  assert.equal(sum.totals.investment, 6000);
  assert.equal(sum.net, 50000 - 1200.5 - 6000);

  assert.equal((await call('/transactions?type=investment')).body.length, 1);
  assert.equal((await call('/transactions?q=nifty')).body.length, 1);
  assert.equal((await call(`/transactions/${inv.body.id}`, 'DELETE')).status, 200);
  assert.equal((await call('/transactions')).body.length, 2);

  await call('/auth/logout', 'POST');
  assert.equal((await call('/transactions')).status, 401);
  assert.equal((await call('/auth/login', 'POST', { password: 'wrong-pass' })).status, 401);
  assert.equal((await call('/auth/login', 'POST', { password: 'secret123' })).status, 200);
});
