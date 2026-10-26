const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');

let server;
let base;
let db;

before(async () => {
  db = openDatabase(':memory:');
  server = createApp({ db, sessionSecret: 'test' }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

// Minimal cookie-keeping client.
function client() {
  let cookie = '';
  return async (path, { form, method } = {}) => {
    const res = await fetch(base + path, {
      method: method || (form ? 'POST' : 'GET'),
      redirect: 'manual',
      headers: { ...(cookie && { cookie }), ...(form && { 'content-type': 'application/x-www-form-urlencoded' }) },
      body: form ? new URLSearchParams(form).toString() : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return res;
  };
}

const future = (days) => {
  const d = new Date(Date.now() + days * 86400000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const eventForm = (overrides = {}) => ({
  title: 'Test Fest', description: 'Fun', category: 'Cultural', venue: 'Hall A',
  start_time: future(5), end_time: future(6), capacity: '1', status: 'published', ...overrides,
});

test('home and events pages render', async () => {
  const c = client();
  assert.strictEqual((await c('/')).status, 200);
  assert.strictEqual((await c('/events')).status, 200);
  assert.strictEqual((await c('/nope')).status, 404);
});

test('dashboard requires login', async () => {
  const res = await client()('/dashboard');
  assert.strictEqual(res.status, 302);
  assert.match(res.headers.get('location'), /^\/login/);
});

test('full flow: admin promotes organizer, organizer creates event, students register with capacity', async () => {
  const admin = client();
  assert.strictEqual((await admin('/login', { form: { email: 'admin@college.edu', password: 'admin123' } })).status, 302);

  const org = client();
  await org('/register', { form: { name: 'Org', email: 'org@x.edu', password: 'secret1', confirm_password: 'secret1' } });
  // Students cannot create events.
  assert.strictEqual((await org('/events', { form: eventForm() })).status, 403);

  const orgId = db.prepare("SELECT id FROM users WHERE email = 'org@x.edu'").get().id;
  await admin(`/admin/users/${orgId}/role`, { form: { role: 'organizer' } });

  // Validation errors re-render the form.
  assert.strictEqual((await org('/events', { form: eventForm({ end_time: future(4) }) })).status, 400);

  const created = await org('/events', { form: eventForm() });
  assert.strictEqual(created.status, 302);
  const eventPath = created.headers.get('location');
  const ev = db.prepare('SELECT * FROM events ORDER BY id DESC').get();
  assert.match(ev.start_time, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);

  const s1 = client();
  const s2 = client();
  await s1('/register', { form: { name: 'S1', email: 's1@x.edu', password: 'secret1', confirm_password: 'secret1' } });
  await s2('/register', { form: { name: 'S2', email: 's2@x.edu', password: 'secret1', confirm_password: 'secret1' } });

  await s1(`${eventPath}/register`, { form: {} });
  await s2(`${eventPath}/register`, { form: {} });
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM registrations WHERE event_id = ?').get(ev.id).n, 1, 'capacity enforced');

  // Another student can't see the registration list; the organizer can and can export CSV.
  assert.strictEqual((await s1(`${eventPath}/registrations`)).status, 403);
  const csv = await org(`${eventPath}/registrations.csv`);
  assert.strictEqual(csv.status, 200);
  assert.match(await csv.text(), /"S1","s1@x.edu"/);

  const regId = db.prepare('SELECT id FROM registrations WHERE event_id = ?').get(ev.id).id;
  await org(`${eventPath}/attendance`, { form: { present: String(regId) } });
  assert.strictEqual(db.prepare('SELECT attended FROM registrations WHERE id = ?').get(regId).attended, 1);

  // Cancelling frees the seat for the next student.
  await s1(`${eventPath}/cancel`, { form: {} });
  await s2(`${eventPath}/register`, { form: {} });
  const regs = db.prepare('SELECT u.email FROM registrations r JOIN users u ON u.id = r.user_id WHERE event_id = ?').all(ev.id);
  assert.deepStrictEqual(regs.map((r) => r.email), ['s2@x.edu']);
});

test('rejects bad logins and duplicate registrations', async () => {
  const c = client();
  assert.strictEqual((await c('/login', { form: { email: 'admin@college.edu', password: 'wrong' } })).status, 401);
  assert.strictEqual((await c('/register', { form: { name: 'A', email: 'admin@college.edu', password: 'secret1', confirm_password: 'secret1' } })).status, 400);
});

test('login does not redirect off-site', async () => {
  const res = await client()('/login', { form: { email: 'admin@college.edu', password: 'admin123', next: '//evil.com' } });
  assert.strictEqual(res.headers.get('location'), '/dashboard');
});
