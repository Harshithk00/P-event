const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const session = require('express-session');
const { openDatabase } = require('./db');

function createApp({ db = openDatabase(), sessionSecret = process.env.SESSION_SECRET } = {}) {
  const app = express();
  app.locals.db = db;
  // "2026-11-02 09:00" -> "Mon, 2 Nov 2026, 9:00 am"
  app.locals.fmtDate = (s) => (s
    ? new Date(String(s).replace(' ', 'T')).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '');

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));

  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use(express.urlencoded({ extended: false }));
  app.use(session({
    secret: sessionSecret || crypto.randomBytes(32).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 },
  }));

  // Load the current user and expose shared template locals.
  app.use((req, res, next) => {
    req.user = req.session.userId
      ? db.prepare('SELECT id, name, email, role, department, roll_no FROM users WHERE id = ?').get(req.session.userId)
      : null;
    res.locals.currentUser = req.user;
    res.locals.flash = req.session.flash;
    res.locals.path = req.path;
    delete req.session.flash;
    next();
  });

  app.use(require('./routes/auth'));
  app.use(require('./routes/events'));
  app.use(require('./routes/dashboard'));
  app.use('/admin', require('./routes/admin'));

  app.get('/', (req, res) => {
    const upcoming = db.prepare(`
      SELECT e.*, (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id) AS registered
      FROM events e
      WHERE e.status = 'published' AND e.end_time >= datetime('now', 'localtime')
      ORDER BY e.start_time LIMIT 6`).all();
    const stats = db.prepare(`
      SELECT (SELECT COUNT(*) FROM events WHERE status = 'published') AS events,
             (SELECT COUNT(*) FROM users WHERE role = 'student') AS students,
             (SELECT COUNT(*) FROM registrations) AS registrations`).get();
    res.render('home', { title: 'Home', upcoming, stats });
  });

  app.use((req, res) => res.status(404).render('error', { title: 'Not found', message: 'The page you are looking for does not exist.' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).render('error', { title: 'Error', message: 'Something went wrong. Please try again.' });
  });

  return app;
}

module.exports = { createApp };
