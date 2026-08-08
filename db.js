const { DatabaseSync } = require("node:sqlite");
const bcrypt = require("bcryptjs");
const path = require("path");
const fs = require("fs");

const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Uses Node's built-in SQLite (node:sqlite, stable since Node 22.5) — no
// native module compilation required, so `npm install` never needs a
// build toolchain on the deploy host.
const db = new DatabaseSync(path.join(DATA_DIR, "pse.db"));

db.exec(`
CREATE TABLE IF NOT EXISTS candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  password_hash TEXT NOT NULL,
  specialization TEXT,
  years_experience TEXT,
  giga_project_experience TEXT,
  cv_filename TEXT,
  cv_original_name TEXT,
  status TEXT NOT NULL DEFAULT 'New',
  admin_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  contact_name TEXT,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'New',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// seed a default admin if none exists (credentials printed once, change on first login)
const adminCount = db.prepare("SELECT COUNT(*) AS c FROM admins").get().c;
if (adminCount === 0) {
  const defaultEmail = "admin@pseconsulting.com";
  const defaultPassword = "PSE-Admin-2026!";
  const hash = bcrypt.hashSync(defaultPassword, 10);
  db.prepare("INSERT INTO admins (name, email, password_hash) VALUES (?, ?, ?)")
    .run("PSE Administrator", defaultEmail, hash);
  console.log("=".repeat(60));
  console.log("Seeded default admin account:");
  console.log("  email:    " + defaultEmail);
  console.log("  password: " + defaultPassword);
  console.log("  (change this after first login — see README)");
  console.log("=".repeat(60));
}

module.exports = { db, UPLOADS_DIR };
