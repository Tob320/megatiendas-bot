const fs = require('fs-extra');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
const LOGS_DIR = path.join(DATA_DIR, 'logs');
const DB_PATH  = path.join(DATA_DIR, 'kpi.db');

let db;

async function init() {
  await fs.ensureDir(LOGS_DIR);
  await fs.ensureDir(path.join(DATA_DIR, 'sessions'));

  db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS kpi_events (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      phone           TEXT    NOT NULL,
      category        TEXT    NOT NULL,
      timestamp       TEXT    NOT NULL,
      message_preview TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_phone     ON kpi_events(phone);
    CREATE INDEX IF NOT EXISTS idx_category  ON kpi_events(category);
    CREATE INDEX IF NOT EXISTS idx_timestamp ON kpi_events(timestamp);

    CREATE TABLE IF NOT EXISTS employee_emails (
      phone      TEXT PRIMARY KEY,
      email      TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  console.log('[STORAGE] Base de datos y directorios listos.');
}

// ─── JSON per-conversation ────────────────────────────────────────────────────

function logPath(phone) {
  const now   = new Date();
  const year  = now.getFullYear().toString();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day   = String(now.getDate()).padStart(2, '0');
  return path.join(LOGS_DIR, year, month, day, `${phone}.json`);
}

async function saveMessage({ phone, role, content, category }) {
  const p = logPath(phone);
  await fs.ensureDir(path.dirname(p));

  let log = [];
  if (await fs.pathExists(p)) log = await fs.readJson(p);

  log.push({ timestamp: new Date().toISOString(), role, content, category: category || 'General' });
  await fs.writeJson(p, log, { spaces: 2 });
}

// ─── SQLite KPI ───────────────────────────────────────────────────────────────

function saveKPIEvent({ phone, category, messagePreview }) {
  db.prepare(
    'INSERT INTO kpi_events (phone, category, timestamp, message_preview) VALUES (?, ?, ?, ?)'
  ).run(phone, category, new Date().toISOString(), (messagePreview || '').substring(0, 120));
}

function getKPIStats() {
  const today = new Date().toISOString().split('T')[0];
  return {
    todayCount:    db.prepare("SELECT COUNT(*) AS c FROM kpi_events WHERE timestamp LIKE ?").get(`${today}%`).c,
    totalCount:    db.prepare("SELECT COUNT(*) AS c FROM kpi_events").get().c,
    uniqueUsers:   db.prepare("SELECT COUNT(DISTINCT phone) AS c FROM kpi_events").get().c,
    recentMessages: db.prepare(
      "SELECT phone, category, timestamp, message_preview FROM kpi_events ORDER BY timestamp DESC LIMIT 15"
    ).all()
  };
}

function getCategoryStats() {
  return db.prepare(
    "SELECT category, COUNT(*) AS count FROM kpi_events GROUP BY category ORDER BY count DESC"
  ).all();
}

// ─── Conversation explorer ────────────────────────────────────────────────────

async function getConversations({ phone, month, year }) {
  const results = [];
  const searchYear = year || new Date().getFullYear().toString();
  const baseDir = month
    ? path.join(LOGS_DIR, searchYear, month.padStart(2, '0'))
    : path.join(LOGS_DIR, searchYear);

  if (!(await fs.pathExists(baseDir))) return results;

  async function walk(dir) {
    for (const item of await fs.readdir(dir)) {
      const full = path.join(dir, item);
      if ((await fs.stat(full)).isDirectory()) {
        await walk(full);
      } else if (item.endsWith('.json')) {
        const filePhone = item.replace('.json', '');
        if (!phone || filePhone.includes(phone)) {
          const parts = full.split(path.sep);
          const li    = parts.indexOf('logs') + 1;
          results.push({
            phone:    filePhone,
            date:     `${parts[li]}/${parts[li + 1]}/${parts[li + 2]}`,
            messages: await fs.readJson(full)
          });
        }
      }
    }
  }

  await walk(baseDir);
  return results.sort((a, b) => b.date.localeCompare(a.date));
}

// ─── Employee emails ──────────────────────────────────────────────────────────

function saveEmployeeEmail(phone, email) {
  db.prepare(
    'INSERT INTO employee_emails (phone, email, created_at) VALUES (?, ?, ?) ON CONFLICT(phone) DO UPDATE SET email = excluded.email'
  ).run(phone, email, new Date().toISOString());
}

function getEmployeeEmail(phone) {
  const row = db.prepare('SELECT email FROM employee_emails WHERE phone = ?').get(phone);
  return row ? row.email : null;
}

module.exports = { init, saveMessage, saveKPIEvent, getKPIStats, getCategoryStats, getConversations, saveEmployeeEmail, getEmployeeEmail };
