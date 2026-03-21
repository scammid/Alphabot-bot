const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

// Use /data directory if it exists (Railway volume), otherwise local
const DATA_DIR = fs.existsSync('/data') ? '/data' : path.join(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'users.db');

let db;

async function getDb() {
  if (db) return db;
  const SQL = await initSqlJs();
  
  fs.mkdirSync(DATA_DIR, { recursive: true });
  
  if (fs.existsSync(DB_PATH)) {
    db = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      discord_id TEXT PRIMARY KEY,
      discord_username TEXT,
      alphabot_api_key TEXT,
      webhook_url TEXT,
      is_running INTEGER DEFAULT 0,
      mode TEXT DEFAULT 'all',
      custom_team_ids TEXT DEFAULT '',
      delay_seconds INTEGER DEFAULT 5,
      total_entered INTEGER DEFAULT 0,
      total_won INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS raffle_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_id TEXT,
      raffle_id TEXT,
      raffle_name TEXT,
      team_name TEXT,
      status TEXT DEFAULT 'entered',
      entered_at TEXT DEFAULT (datetime('now'))
    );
  `);
  save();
  return db;
}

function save() {
  if (!db) return;
  try {
    fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
  } catch (err) {
    console.error('[DB] Save error:', err.message);
  }
}

function run(sql, params = []) { db.run(sql, params); save(); }
function one(sql, params = []) {
  const s = db.prepare(sql); s.bind(params);
  const row = s.step() ? s.getAsObject() : null; s.free(); return row;
}
function all(sql, params = []) {
  const s = db.prepare(sql); s.bind(params);
  const rows = []; while (s.step()) rows.push(s.getAsObject()); s.free(); return rows;
}

async function getUser(id)             { await getDb(); return one('SELECT * FROM users WHERE discord_id = ?', [id]); }
async function upsertUser(id, name)    { await getDb(); run(`INSERT INTO users (discord_id, discord_username) VALUES (?,?) ON CONFLICT(discord_id) DO UPDATE SET discord_username=excluded.discord_username, updated_at=datetime('now')`, [id, name]); }
async function setApiKey(id, key, wh) { await getDb(); run(`UPDATE users SET alphabot_api_key=?, webhook_url=?, updated_at=datetime('now') WHERE discord_id=?`, [key, wh||null, id]); }
async function setRunning(id, v)       { await getDb(); run(`UPDATE users SET is_running=?, updated_at=datetime('now') WHERE discord_id=?`, [v?1:0, id]); }
async function setMode(id, mode)       { await getDb(); run(`UPDATE users SET mode=?, updated_at=datetime('now') WHERE discord_id=?`, [mode, id]); }
async function setCustomTeamIds(id, v) { await getDb(); run(`UPDATE users SET custom_team_ids=?, mode='custom', updated_at=datetime('now') WHERE discord_id=?`, [v, id]); }
async function setDelay(id, sec)       { await getDb(); run(`UPDATE users SET delay_seconds=?, updated_at=datetime('now') WHERE discord_id=?`, [sec, id]); }
async function removeUser(id)          { await getDb(); run('DELETE FROM raffle_entries WHERE discord_id=?', [id]); run('DELETE FROM users WHERE discord_id=?', [id]); }
async function getAllRunningUsers()    { await getDb(); return all('SELECT * FROM users WHERE is_running=1 AND alphabot_api_key IS NOT NULL'); }
async function getAllUsersWithKey()    { await getDb(); return all('SELECT * FROM users WHERE alphabot_api_key IS NOT NULL'); }

async function getStats(id) {
  await getDb();
  return {
    user: one('SELECT total_entered, total_won FROM users WHERE discord_id=?', [id]),
    recent: all(`SELECT raffle_name, team_name, status, entered_at FROM raffle_entries WHERE discord_id=? ORDER BY entered_at DESC LIMIT 10`, [id])
  };
}

async function logEntry(id, raffleId, name, team, status) {
  await getDb();
  run(`INSERT INTO raffle_entries (discord_id, raffle_id, raffle_name, team_name, status) VALUES (?,?,?,?,?)`, [id, raffleId, name, team, status]);
  if (status === 'entered' || status === 'won') {
    run(`UPDATE users SET total_entered=total_entered+1, total_won=total_won+?, updated_at=datetime('now') WHERE discord_id=?`, [status==='won'?1:0, id]);
  }
}

module.exports = { getUser, upsertUser, setApiKey, setRunning, setMode, setCustomTeamIds, setDelay, removeUser, getAllRunningUsers, getAllUsersWithKey, getStats, logEntry };
