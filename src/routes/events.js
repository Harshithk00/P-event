const express = require('express');
const { CATEGORIES } = require('../db');
const { requireLogin, requireRole, canManage } = require('../middleware/auth');

const router = express.Router();

// <input type="datetime-local"> sends "YYYY-MM-DDTHH:MM"; store "YYYY-MM-DD HH:MM"
// so it compares correctly against SQLite's datetime('now', 'localtime').
const toDb = (v) => (v ? String(v).trim().replace('T', ' ').slice(0, 16) : '');
const toInput = (v) => (v ? String(v).replace(' ', 'T').slice(0, 16) : '');
const DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

function loadEvent(db, id) {
  return db.prepare(`
    SELECT e.*, u.name AS organizer_name, u.email AS organizer_email,
           (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id) AS registered
    FROM events e JOIN users u ON u.id = e.organizer_id
    WHERE e.id = ?`).get(id);
}

function readEventForm(body) {
  const values = {
    title: (body.title || '').trim(),
    description: (body.description || '').trim(),
    category: body.category,
    venue: (body.venue || '').trim(),
    start_time: toDb(body.start_time),
    end_time: toDb(body.end_time),
    registration_deadline: toDb(body.registration_deadline) || null,
    capacity: Number.parseInt(body.capacity, 10) || 0,
    status: ['draft', 'published', 'cancelled'].includes(body.status) ? body.status : 'published',
  };
  const errors = [];
  if (!values.title) errors.push('Title is required.');
  if (!values.description) errors.push('Description is required.');
  if (!CATEGORIES.includes(values.category)) errors.push('Choose a valid category.');
  if (!values.venue) errors.push('Venue is required.');
  if (!DATETIME_RE.test(values.start_time)) errors.push('Start time is required.');
  if (!DATETIME_RE.test(values.end_time)) errors.push('End time is required.');
  if (values.start_time && values.end_time && values.end_time <= values.start_time) errors.push('End time must be after start time.');
  if (values.registration_deadline && !DATETIME_RE.test(values.registration_deadline)) errors.push('Registration deadline is invalid.');
  if (values.registration_deadline && values.start_time && values.registration_deadline > values.start_time) {
    errors.push('Registration deadline must be before the event starts.');
  }
  if (values.capacity < 0) errors.push('Capacity cannot be negative.');
  return { values, errors };
}

function formView(res, { event, values, errors, status = 200 }) {
  const v = { ...values };
  ['start_time', 'end_time', 'registration_deadline'].forEach((k) => { v[k] = toInput(v[k]); });
  res.status(status).render('events/form', {
    title: event ? 'Edit event' : 'New event', event, values: v, errors, categories: CATEGORIES,
  });
}

// Why a user can't register right now, or null if they can.
function registrationBlocker(event, now) {
  if (event.status !== 'published') return 'This event is not open for registration.';
  if (event.start_time <= now) return 'This event has already started.';
  if (event.registration_deadline && event.registration_deadline < now) return 'Registration has closed.';
  if (event.capacity > 0 && event.registered >= event.capacity) return 'This event is full.';
  return null;
}

const nowLocal = (db) => db.prepare("SELECT strftime('%Y-%m-%d %H:%M', 'now', 'localtime') AS now").get().now;

router.get('/events', (req, res) => {
  const db = req.app.locals.db;
  const { q = '', category = '', when = 'upcoming' } = req.query;
  const where = ["e.status = 'published'"];
  const params = [];
  if (q) {
    where.push('(e.title LIKE ? OR e.description LIKE ? OR e.venue LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (category) { where.push('e.category = ?'); params.push(category); }
  if (when === 'upcoming') where.push("e.end_time >= datetime('now', 'localtime')");
  if (when === 'past') where.push("e.end_time < datetime('now', 'localtime')");

  const events = db.prepare(`
    SELECT e.*, (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id) AS registered
    FROM events e WHERE ${where.join(' AND ')}
    ORDER BY e.start_time ${when === 'past' ? 'DESC' : 'ASC'}`).all(...params);

  res.render('events/list', { title: 'Events', events, categories: CATEGORIES, filters: { q, category, when } });
});

router.get('/events/new', requireRole('organizer', 'admin'), (req, res) => {
  formView(res, { values: { capacity: 100, status: 'published', category: CATEGORIES[0] }, errors: [] });
});

router.post('/events', requireRole('organizer', 'admin'), (req, res) => {
  const { values, errors } = readEventForm(req.body);
  if (errors.length) return formView(res, { values, errors, status: 400 });
  const { lastInsertRowid } = req.app.locals.db.prepare(`
    INSERT INTO events (title, description, category, venue, start_time, end_time, registration_deadline, capacity, status, organizer_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    values.title, values.description, values.category, values.venue, values.start_time, values.end_time,
    values.registration_deadline, values.capacity, values.status, req.user.id,
  );
  req.session.flash = { type: 'success', message: 'Event created.' };
  res.redirect(`/events/${lastInsertRowid}`);
});

router.get('/events/:id', (req, res) => {
  const db = req.app.locals.db;
  const event = loadEvent(db, req.params.id);
  const manage = canManage(req.user, event);
  if (!event || (event.status === 'draft' && !manage)) {
    return res.status(404).render('error', { title: 'Not found', message: 'Event not found.' });
  }
  const registration = req.user
    ? db.prepare('SELECT * FROM registrations WHERE event_id = ? AND user_id = ?').get(event.id, req.user.id)
    : null;
  res.render('events/show', {
    title: event.title, event, registration, canManage: manage, blocker: registrationBlocker(event, nowLocal(db)),
  });
});

// Load the event and verify the current user may manage it.
function managedEvent(req, res, next) {
  const event = loadEvent(req.app.locals.db, req.params.id);
  if (!event) return res.status(404).render('error', { title: 'Not found', message: 'Event not found.' });
  if (!canManage(req.user, event)) {
    return res.status(403).render('error', { title: 'Forbidden', message: 'You can only manage your own events.' });
  }
  req.event = event;
  next();
}

router.get('/events/:id/edit', requireRole('organizer', 'admin'), managedEvent, (req, res) => {
  formView(res, { event: req.event, values: req.event, errors: [] });
});

router.post('/events/:id', requireRole('organizer', 'admin'), managedEvent, (req, res) => {
  const { values, errors } = readEventForm(req.body);
  if (errors.length) return formView(res, { event: req.event, values, errors, status: 400 });
  req.app.locals.db.prepare(`
    UPDATE events SET title = ?, description = ?, category = ?, venue = ?, start_time = ?, end_time = ?,
      registration_deadline = ?, capacity = ?, status = ?
    WHERE id = ?`).run(
    values.title, values.description, values.category, values.venue, values.start_time, values.end_time,
    values.registration_deadline, values.capacity, values.status, req.event.id,
  );
  req.session.flash = { type: 'success', message: 'Event updated.' };
  res.redirect(`/events/${req.event.id}`);
});

router.post('/events/:id/delete', requireRole('organizer', 'admin'), managedEvent, (req, res) => {
  req.app.locals.db.prepare('DELETE FROM events WHERE id = ?').run(req.event.id);
  req.session.flash = { type: 'success', message: 'Event deleted.' };
  res.redirect('/dashboard');
});

router.post('/events/:id/register', requireLogin, (req, res) => {
  const db = req.app.locals.db;
  const event = loadEvent(db, req.params.id);
  if (!event) return res.status(404).render('error', { title: 'Not found', message: 'Event not found.' });

  const blocker = registrationBlocker(event, nowLocal(db));
  if (blocker) {
    req.session.flash = { type: 'error', message: blocker };
  } else {
    // Re-check capacity inside the insert so concurrent requests can't overbook.
    const result = db.prepare(`
      INSERT OR IGNORE INTO registrations (event_id, user_id)
      SELECT ?, ? WHERE ? = 0 OR (SELECT COUNT(*) FROM registrations WHERE event_id = ?) < ?`)
      .run(event.id, req.user.id, event.capacity, event.id, event.capacity);
    req.session.flash = result.changes
      ? { type: 'success', message: `You are registered for ${event.title}.` }
      : { type: 'info', message: 'You are already registered, or the event just filled up.' };
  }
  res.redirect(`/events/${event.id}`);
});

router.post('/events/:id/cancel', requireLogin, (req, res) => {
  const db = req.app.locals.db;
  const event = loadEvent(db, req.params.id);
  if (!event) return res.status(404).render('error', { title: 'Not found', message: 'Event not found.' });
  if (event.start_time <= nowLocal(db)) {
    req.session.flash = { type: 'error', message: 'You cannot cancel after the event has started.' };
  } else {
    db.prepare('DELETE FROM registrations WHERE event_id = ? AND user_id = ?').run(event.id, req.user.id);
    req.session.flash = { type: 'info', message: 'Your registration was cancelled.' };
  }
  res.redirect(req.body.back === 'dashboard' ? '/dashboard' : `/events/${event.id}`);
});

router.get('/events/:id/registrations', requireRole('organizer', 'admin'), managedEvent, (req, res) => {
  const attendees = req.app.locals.db.prepare(`
    SELECT r.id, r.attended, r.created_at, u.name, u.email, u.department, u.roll_no
    FROM registrations r JOIN users u ON u.id = r.user_id
    WHERE r.event_id = ? ORDER BY u.name`).all(req.event.id);
  res.render('events/registrations', { title: `Registrations - ${req.event.title}`, event: req.event, attendees });
});

router.post('/events/:id/attendance', requireRole('organizer', 'admin'), managedEvent, (req, res) => {
  const db = req.app.locals.db;
  const present = new Set([].concat(req.body.present || []).map(Number));
  const rows = db.prepare('SELECT id FROM registrations WHERE event_id = ?').all(req.event.id);
  const update = db.prepare('UPDATE registrations SET attended = ? WHERE id = ?');
  db.exec('BEGIN');
  try {
    rows.forEach((r) => update.run(present.has(r.id) ? 1 : 0, r.id));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  req.session.flash = { type: 'success', message: 'Attendance saved.' };
  res.redirect(`/events/${req.event.id}/registrations`);
});

router.get('/events/:id/registrations.csv', requireRole('organizer', 'admin'), managedEvent, (req, res) => {
  const rows = req.app.locals.db.prepare(`
    SELECT u.name, u.email, u.department, u.roll_no, r.attended, r.created_at
    FROM registrations r JOIN users u ON u.id = r.user_id
    WHERE r.event_id = ? ORDER BY u.name`).all(req.event.id);
  // Quote every field, and neutralise leading formula characters for spreadsheet safety.
  const cell = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const lines = [['Name', 'Email', 'Department', 'Roll No', 'Attended', 'Registered At'].map(cell).join(',')];
  rows.forEach((r) => lines.push([r.name, r.email, r.department, r.roll_no, r.attended ? 'Yes' : 'No', r.created_at].map(cell).join(',')));
  res.type('text/csv').attachment(`event-${req.event.id}-registrations.csv`).send(lines.join('\n'));
});

module.exports = router;
