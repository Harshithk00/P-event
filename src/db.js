const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    email       TEXT    NOT NULL UNIQUE,
    password    TEXT    NOT NULL,
    role        TEXT    NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'organizer', 'admin')),
    department  TEXT,
    roll_no     TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS events (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    title                 TEXT    NOT NULL,
    description           TEXT    NOT NULL,
    category              TEXT    NOT NULL,
    venue                 TEXT    NOT NULL,
    start_time            TEXT    NOT NULL,
    end_time              TEXT    NOT NULL,
    registration_deadline TEXT,
    capacity              INTEGER NOT NULL DEFAULT 0,
    status                TEXT    NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'cancelled')),
    organizer_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at            TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS registrations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id    INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    attended    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (event_id, user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_events_start ON events(start_time);
  CREATE INDEX IF NOT EXISTS idx_reg_user ON registrations(user_id);
`;

const CATEGORIES = ['Technical', 'Cultural', 'Sports', 'Workshop', 'Seminar', 'Hackathon', 'Club', 'Other'];

function openDatabase(file = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'events.db')) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  ensureAdmin(db);
  return db;
}

// Guarantees there is always an admin account to log in with on a fresh install.
function ensureAdmin(db) {
  const exists = db.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get();
  if (exists) return;
  const email = process.env.ADMIN_EMAIL || 'admin@college.edu';
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
    .run('Administrator', email, bcrypt.hashSync(password, 10), 'admin');
}

module.exports = { openDatabase, CATEGORIES };
