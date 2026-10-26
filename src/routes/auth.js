const express = require('express');
const bcrypt = require('bcryptjs');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Only allow redirects to local paths to avoid open redirects.
function safeNext(next) {
  return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
}

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/dashboard');
  res.render('auth/login', { title: 'Log in', next: req.query.next || '', email: '' });
});

router.post('/login', (req, res, next) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const user = req.app.locals.db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(req.body.password || '', user.password)) {
    return res.status(401).render('auth/login', {
      title: 'Log in', next: req.body.next || '', email,
      flash: { type: 'error', message: 'Invalid email or password.' },
    });
  }
  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.userId = user.id;
    req.session.flash = { type: 'success', message: `Welcome back, ${user.name}!` };
    res.redirect(safeNext(req.body.next));
  });
});

router.get('/register', (req, res) => {
  if (req.user) return res.redirect('/dashboard');
  res.render('auth/register', { title: 'Register', values: {}, errors: [] });
});

router.post('/register', (req, res, next) => {
  const db = req.app.locals.db;
  const values = {
    name: (req.body.name || '').trim(),
    email: (req.body.email || '').trim().toLowerCase(),
    department: (req.body.department || '').trim(),
    roll_no: (req.body.roll_no || '').trim(),
  };
  const password = req.body.password || '';
  const errors = [];
  if (!values.name) errors.push('Name is required.');
  if (!EMAIL_RE.test(values.email)) errors.push('A valid email is required.');
  if (password.length < 6) errors.push('Password must be at least 6 characters.');
  if (password !== req.body.confirm_password) errors.push('Passwords do not match.');
  if (!errors.length && db.prepare('SELECT 1 FROM users WHERE email = ?').get(values.email)) {
    errors.push('An account with this email already exists.');
  }
  if (errors.length) return res.status(400).render('auth/register', { title: 'Register', values, errors });

  // Self-registration always creates a student; admins promote organizers.
  const { lastInsertRowid } = db.prepare(
    'INSERT INTO users (name, email, password, role, department, roll_no) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(values.name, values.email, bcrypt.hashSync(password, 10), 'student', values.department || null, values.roll_no || null);

  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.userId = Number(lastInsertRowid);
    req.session.flash = { type: 'success', message: 'Account created. Welcome!' };
    res.redirect('/events');
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

module.exports = router;
