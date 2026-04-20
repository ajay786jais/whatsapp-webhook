const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'app.db');

let db;

function openDatabase() {
  if (db) {
    return db;
  }

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new sqlite3.Database(DB_PATH);
  return db;
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    openDatabase().run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
        return;
      }

      resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    openDatabase().get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(row);
    });
  });
}

async function initDatabase() {
  await run('PRAGMA journal_mode = WAL');

  await run(`
    CREATE TABLE IF NOT EXISTS processed_messages (
      message_id TEXT PRIMARY KEY,
      phone TEXT,
      intent TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function isMessageProcessed(messageId) {
  const row = await get(
    'SELECT message_id FROM processed_messages WHERE message_id = ? LIMIT 1',
    [messageId],
  );

  return Boolean(row);
}

async function markMessageProcessed({ messageId, phone, intent }) {
  await run(
    `INSERT INTO processed_messages (message_id, phone, intent) VALUES (?, ?, ?)
     ON CONFLICT(message_id) DO NOTHING`,
    [messageId, phone, intent],
  );
}

async function checkDatabaseReadiness() {
  const row = await get('SELECT 1 AS ok');
  return row?.ok === 1;
}

module.exports = {
  initDatabase,
  isMessageProcessed,
  markMessageProcessed,
  checkDatabaseReadiness,
};
