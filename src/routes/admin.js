const express = require('express');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireRole('admin'));

router.get('/', (req, res) => {
  const db = req.app.locals.db;
  const stats = db.prepare(`
    SELECT (SELECT COUNT(*) FROM users) AS users,
           (SELECT COUNT(*) FROM users WHERE role = 'organizer') AS organizers,
           (SELECT COUNT(*) FROM events) AS events,
           (SELECT COUNT(*) FROM events WHERE end_time >= datetime('now', 'localtime') AND status = 'published') AS upcoming,
           (SELECT COUNT(*) FROM registrations) AS registrations,
           (SELECT COUNT(*) FROM registrations WHERE attended = 1) AS attended`).get();
  const byCategory = db.prepare(`
    SELECT e.category, COUNT(DISTINCT e.id) AS events, COUNT(r.id) AS registrations
    FROM events e LEFT JOIN registrations r ON r.event_id = e.id
    GROUP BY e.category ORDER BY registrations DESC`).all();
  const users = db.prepare('SELECT id, name, email, role, department, roll_no, created_at FROM users ORDER BY created_at DESC').all();
  res.render('admin/index', { title: 'Admin', stats, byCategory, users });
});

router.post('/users/:id/role', (req, res) => {
  const role = req.body.role;
  const id = Number(req.params.id);
  if (!['student', 'organizer', 'admin'].includes(role)) {
    req.session.flash = { type: 'error', message: 'Invalid role.' };
  } else if (id === req.user.id) {
    req.session.flash = { type: 'error', message: 'You cannot change your own role.' };
  } else {
    req.app.locals.db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
    req.session.flash = { type: 'success', message: 'Role updated.' };
  }
  res.redirect('/admin');
});

router.post('/users/:id/delete', (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) {
    req.session.flash = { type: 'error', message: 'You cannot delete your own account.' };
  } else {
    req.app.locals.db.prepare('DELETE FROM users WHERE id = ?').run(id);
    req.session.flash = { type: 'success', message: 'User deleted.' };
  }
  res.redirect('/admin');
});

module.exports = router;
