# College Event Management System

A web app for managing campus events: organizers publish events, students browse and register, and admins oversee everything.

Built with **Node.js + Express**, **EJS** templates and **SQLite** (Node's built-in `node:sqlite`, so there's nothing native to compile).

## Features

**Students**
- Sign up with name, college email, department and roll number
- Browse upcoming/past events, search by keyword, filter by category
- Register for events (respects capacity and registration deadline) and cancel before the event starts
- Dashboard listing your registrations and attendance

**Organizers**
- Create, edit, delete and draft/publish/cancel their own events
- View each event's registrations, mark attendance, export the list as CSV

**Admins**
- Everything organizers can do, on every event
- Stats overview (users, events, registrations, attendance rate, per-category breakdown)
- Manage users: promote students to organizer/admin, delete accounts

## Getting started

Requires **Node.js 22.13 or newer**.

```bash
npm install
npm run seed     # optional: demo users and events
npm start        # http://localhost:3000
```

Demo accounts (after `npm run seed`):

| Role      | Email                   | Password      |
|-----------|-------------------------|---------------|
| Admin     | admin@college.edu       | admin123      |
| Organizer | organizer@college.edu   | password123   |
| Student   | student@college.edu     | password123   |

An admin account is always created on first run, even without seeding. New sign-ups are students; an admin promotes them to organizer from the Admin panel.

### Configuration

| Variable         | Default                 | Purpose                                  |
|------------------|-------------------------|------------------------------------------|
| `PORT`           | `3000`                  | HTTP port                                |
| `DB_FILE`        | `data/events.db`        | SQLite database path                     |
| `SESSION_SECRET` | random per start        | Set this so logins survive restarts      |
| `ADMIN_EMAIL`    | `admin@college.edu`     | Initial admin email (first run only)     |
| `ADMIN_PASSWORD` | `admin123`              | Initial admin password (first run only)  |

Change the default admin password before using this anywhere real.

## Development

```bash
npm run dev      # restart on file changes
npm test         # integration tests (node:test, in-memory DB)
```

## Project structure

```
src/
  app.js             Express app setup
  server.js          Entry point
  db.js              Schema and initial admin
  seed.js            Demo data
  middleware/auth.js Login / role guards
  routes/            auth, events, dashboard, admin
views/               EJS templates
public/css/          Stylesheet
test/                Integration tests
```

## Data model

- **users**: name, email, hashed password, role (`student` | `organizer` | `admin`), department, roll number
- **events**: title, description, category, venue, start/end time, registration deadline, capacity (0 = unlimited), status, organizer
- **registrations**: user ↔ event, attendance flag (one registration per user per event)
