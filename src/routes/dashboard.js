const express = require('express');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();

router.get('/dashboard', requireLogin, (req, res) => {
  const db = req.app.locals.db;
  const registrations = db.prepare(`
    SELECT e.*, r.attended, r.created_at AS registered_at,
           e.start_time > strftime('%Y-%m-%d %H:%M', 'now', 'localtime') AS can_cancel
    FROM registrations r JOIN events e ON e.id = r.event_id
    WHERE r.user_id = ? ORDER BY e.start_time DESC`).all(req.user.id);

  let managed = [];
  if (req.user.role !== 'student') {
    const scope = req.user.role === 'admin' ? '' : 'WHERE e.organizer_id = ?';
    managed = db.prepare(`
      SELECT e.*, (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id) AS registered
      FROM events e ${scope} ORDER BY e.start_time DESC`).all(...(scope ? [req.user.id] : []));
  }
  res.render('dashboard', { title: 'Dashboard', registrations, managed });
});

module.exports = router;
