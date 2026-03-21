const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

const DB_PATH = path.join(__dirname, '../../data/users.db');
let db;

async function getDb() {
  if (db) return db;
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    db = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      discord_id TEXT PRIMARY KEY,
      discord_username TEXT,
      alphabot_api_key TEXT,
      forward_webhook TEXT,
      is_running INTEGER DEFAULT 0,
      mode TEXT DEFAULT 'all',
      custom_team_ids TEXT DEFAULT '',
      delay_min INTEGER DEFAULT 3,
      delay_max INTEGER DEFAULT 8,
      instant_fcfs INTEGER DEFAULT 1,
      max_winners INTEGER DEFAULT 0,
      total_entered INTEGER DEFAULT 0,
      total_won INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS wallets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_id TEXT,
      address TEXT,
      blockchain TEXT DEFAULT 'ETH',
      label TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS blocklist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_id TEXT,
      type TEXT,
      value TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS raffle_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_id TEXT,
      raffle_id TEXT,
      raffle_name TEXT,
      team_name TEXT,
      wallet_used TEXT,
      status TEXT DEFAULT 'entered',
      entered_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Migration — add new columns if they don't exist
  const migrations = [
    "ALTER TABLE users ADD COLUMN forward_webhook TEXT",
    "ALTER TABLE users ADD COLUMN delay_min INTEGER DEFAULT 3",
    "ALTER TABLE users ADD COLUMN delay_max INTEGER DEFAULT 8",
    "ALTER TABLE users ADD COLUMN instant_fcfs INTEGER DEFAULT 1",
    "ALTER TABLE users ADD COLUMN max_winners INTEGER DEFAULT 0",
    "ALTER TABLE raffle_entries ADD COLUMN wallet_used TEXT",
    "CREATE TABLE IF NOT EXISTS wallets (id INTEGER PRIMARY KEY AUTOINCREMENT, discord_id TEXT, address TEXT, blockchain TEXT DEFAULT 'ETH', label TEXT, active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')))",
    "CREATE TABLE IF NOT EXISTS blocklist (id INTEGER PRIMARY KEY AUTOINCREMENT, discord_id TEXT, type TEXT, value TEXT, created_at TEXT DEFAULT (datetime('now')))",
  ];
  for (const sql of migrations) {
    try { db.run(sql); } catch (_) {} // ignore if column already exists
  }

  save();
  return db;
}

function save() {
  if (!db) return;
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
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

// ── Users ─────────────────────────────────────────────────────
async function getUser(id) { await getDb(); return one('SELECT * FROM users WHERE discord_id=?', [id]); }
async function upsertUser(id, name) {
  await getDb();
  run(`INSERT INTO users (discord_id, discord_username) VALUES (?,?)
    ON CONFLICT(discord_id) DO UPDATE SET discord_username=excluded.discord_username, updated_at=datetime('now')`, [id, name]);
}
async function setApiKey(id, key) { await getDb(); run(`UPDATE users SET alphabot_api_key=?, updated_at=datetime('now') WHERE discord_id=?`, [key, id]); }
async function setForwardWebhook(id, webhook) { await getDb(); run(`UPDATE users SET forward_webhook=?, updated_at=datetime('now') WHERE discord_id=?`, [webhook, id]); }
async function setRunning(id, v) { await getDb(); run(`UPDATE users SET is_running=?, updated_at=datetime('now') WHERE discord_id=?`, [v?1:0, id]); }
async function setMode(id, mode) { await getDb(); run(`UPDATE users SET mode=?, updated_at=datetime('now') WHERE discord_id=?`, [mode, id]); }
async function setCustomTeamIds(id, v) { await getDb(); run(`UPDATE users SET custom_team_ids=?, mode='custom', updated_at=datetime('now') WHERE discord_id=?`, [v, id]); }
async function setDelay(id, min, max) { await getDb(); run(`UPDATE users SET delay_min=?, delay_max=?, updated_at=datetime('now') WHERE discord_id=?`, [min, max, id]); }
async function setInstantFcfs(id, v) { await getDb(); run(`UPDATE users SET instant_fcfs=?, updated_at=datetime('now') WHERE discord_id=?`, [v?1:0, id]); }
async function setMaxWinners(id, v) { await getDb(); run(`UPDATE users SET max_winners=?, updated_at=datetime('now') WHERE discord_id=?`, [v, id]); }
async function removeUser(id) {
  await getDb();
  run('DELETE FROM raffle_entries WHERE discord_id=?', [id]);
  run('DELETE FROM wallets WHERE discord_id=?', [id]);
  run('DELETE FROM blocklist WHERE discord_id=?', [id]);
  run('DELETE FROM users WHERE discord_id=?', [id]);
}
async function getAllRunningUsers() { await getDb(); return all('SELECT * FROM users WHERE is_running=1 AND alphabot_api_key IS NOT NULL'); }

// ── Wallets ───────────────────────────────────────────────────
async function getWallets(id) { await getDb(); return all('SELECT * FROM wallets WHERE discord_id=? AND active=1', [id]); }
async function addWallet(id, address, blockchain, label) {
  await getDb();
  run('INSERT INTO wallets (discord_id, address, blockchain, label) VALUES (?,?,?,?)', [id, address, blockchain || 'ETH', label || address.slice(0,8)]);
}
async function removeWallet(id, walletId) { await getDb(); run('DELETE FROM wallets WHERE id=? AND discord_id=?', [walletId, id]); }
async function getNextWallet(id, blockchain) {
  await getDb();
  const wallets = all('SELECT * FROM wallets WHERE discord_id=? AND active=1 AND blockchain=?', [id, blockchain || 'ETH']);
  if (!wallets.length) return null;
  // Rotate: pick wallet least recently used
  const lastEntry = one('SELECT wallet_used FROM raffle_entries WHERE discord_id=? ORDER BY entered_at DESC LIMIT 1', [id]);
  if (!lastEntry?.wallet_used) return wallets[0].address;
  const lastIdx = wallets.findIndex(w => w.address === lastEntry.wallet_used);
  return wallets[(lastIdx + 1) % wallets.length].address;
}

// ── Blocklist ─────────────────────────────────────────────────
async function getBlocklist(id) { await getDb(); return all('SELECT * FROM blocklist WHERE discord_id=?', [id]); }
async function addToBlocklist(id, type, value) {
  await getDb();
  const exists = one('SELECT id FROM blocklist WHERE discord_id=? AND type=? AND value=?', [id, type, value.toLowerCase()]);
  if (!exists) run('INSERT INTO blocklist (discord_id, type, value) VALUES (?,?,?)', [id, type, value.toLowerCase()]);
}
async function removeFromBlocklist(id, blocklistId) { await getDb(); run('DELETE FROM blocklist WHERE id=? AND discord_id=?', [blocklistId, id]); }
async function isBlocked(id, raffleName, teamId) {
  await getDb();
  const list = all('SELECT * FROM blocklist WHERE discord_id=?', [id]);
  for (const item of list) {
    if (item.type === 'project' && raffleName.toLowerCase().includes(item.value)) return true;
    if (item.type === 'team' && teamId?.toLowerCase() === item.value) return true;
  }
  return false;
}

// ── Stats & Entries ───────────────────────────────────────────
async function logEntry(id, raffleId, name, team, status, wallet) {
  await getDb();
  run(`INSERT INTO raffle_entries (discord_id, raffle_id, raffle_name, team_name, wallet_used, status) VALUES (?,?,?,?,?,?)`,
    [id, raffleId, name, team, wallet || null, status]);
  if (status === 'entered' || status === 'won') {
    run(`UPDATE users SET total_entered=total_entered+1, total_won=total_won+?, updated_at=datetime('now') WHERE discord_id=?`,
      [status === 'won' ? 1 : 0, id]);
  }
}
async function getStats(id) {
  await getDb();
  return {
    user: one('SELECT * FROM users WHERE discord_id=?', [id]),
    recent: all(`SELECT * FROM raffle_entries WHERE discord_id=? ORDER BY entered_at DESC LIMIT 10`, [id]),
    wallets: all('SELECT * FROM wallets WHERE discord_id=? AND active=1', [id]),
    blocklist: all('SELECT * FROM blocklist WHERE discord_id=?', [id]),
  };
}

module.exports = {
  getUser, upsertUser, setApiKey, setForwardWebhook, setRunning, setMode,
  setCustomTeamIds, setDelay, setInstantFcfs, setMaxWinners, removeUser, getAllRunningUsers,
  getWallets, addWallet, removeWallet, getNextWallet,
  getBlocklist, addToBlocklist, removeFromBlocklist, isBlocked,
  logEntry, getStats,
};
