// Populates the database with demo users and events. Safe to re-run: it skips if events already exist.
const bcrypt = require('bcryptjs');
const { openDatabase } = require('./db');

const db = openDatabase();

if (db.prepare('SELECT COUNT(*) AS n FROM events').get().n > 0) {
  console.log('Database already has events; skipping seed.');
  process.exit(0);
}

const hash = bcrypt.hashSync('password123', 10);
const addUser = db.prepare('INSERT OR IGNORE INTO users (name, email, password, role, department, roll_no) VALUES (?, ?, ?, ?, ?, ?)');
const userId = (email) => db.prepare('SELECT id FROM users WHERE email = ?').get(email).id;

addUser.run('Priya Sharma', 'organizer@college.edu', hash, 'organizer', 'Computer Science', null);
addUser.run('Rahul Verma', 'student@college.edu', hash, 'student', 'Electronics', 'EC2023045');
addUser.run('Ananya Iyer', 'ananya@college.edu', hash, 'student', 'Mechanical', 'ME2022012');

const organizer = userId('organizer@college.edu');

// Dates relative to today so the demo always has upcoming events.
const at = (days, hour) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:00`;
};

const addEvent = db.prepare(`
  INSERT INTO events (title, description, category, venue, start_time, end_time, registration_deadline, capacity, organizer_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

const events = [
  ['CodeSprint 24h Hackathon', 'Form teams of up to 4 and build something amazing in 24 hours. Prizes, food and mentors provided.', 'Hackathon', 'Main Auditorium', at(7, 9), at(8, 9), at(5, 23), 120],
  ['Annual Cultural Fest - Rhythm', 'Music, dance and drama performances from all departments. Open to all students.', 'Cultural', 'Open Air Theatre', at(14, 17), at(14, 22), null, 0],
  ['Intro to Machine Learning Workshop', 'Hands-on session covering Python, scikit-learn and building your first model. Bring your laptop.', 'Workshop', 'CS Lab 3', at(3, 10), at(3, 13), at(2, 18), 40],
  ['Inter-Department Football Cup', 'Knockout football tournament between departments. Register as an individual; teams are formed by department.', 'Sports', 'College Ground', at(10, 7), at(10, 12), at(8, 20), 66],
  ['Careers in Cloud Computing', 'Guest seminar by industry engineers on careers in cloud and DevOps, followed by Q&A.', 'Seminar', 'Seminar Hall B', at(5, 14), at(5, 16), null, 200],
  ['Robotics Club Orientation', 'Meet the robotics club, see past projects, and learn how to join this semester.', 'Club', 'Electronics Block, Room 204', at(-3, 15), at(-3, 17), null, 50],
];
events.forEach((e) => addEvent.run(...e, organizer));

const reg = db.prepare('INSERT OR IGNORE INTO registrations (event_id, user_id, attended) VALUES (?, ?, ?)');
const student = userId('student@college.edu');
const ananya = userId('ananya@college.edu');
reg.run(1, student, 0);
reg.run(3, student, 0);
reg.run(6, student, 1);
reg.run(1, ananya, 0);
reg.run(4, ananya, 0);

console.log('Seeded demo data:');
console.log('  admin@college.edu     / admin123     (admin)');
console.log('  organizer@college.edu / password123  (organizer)');
console.log('  student@college.edu   / password123  (student)');
