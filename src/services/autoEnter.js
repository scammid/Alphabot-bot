const db = require('./database');
const alphabot = require('./alphabot');
const { scheduleReminder } = require('./mintReminder');
const axios = require('axios');

const enteredThisSession = new Map();
const knownWins = new Map();
const rateLimitUntil = new Map();
const twitterWarned = new Map();

function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1) + min) * 1000;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getEntered(id) {
  if (!enteredThisSession.has(id)) enteredThisSession.set(id, new Set());
  return enteredThisSession.get(id);
}
async function getKnownWins(id) {
  if (!knownWins.has(id)) {
    const past = await db.getWonSlugs(id);
    knownWins.set(id, new Set(past));
  }
  return knownWins.get(id);
}

// Forward notification via Discord webhook or DM
async function forwardNotification(user, message, embed) {
  if (!user.forward_webhook) return;
  try {
    const payload = embed ? { embeds: [embed] } : { content: message };
    await axios.post(user.forward_webhook, payload, { timeout: 5000 });
  } catch (_) {}
}

async function processUser(user, alertCallback) {
  const { discord_id, alphabot_api_key, mode, custom_team_ids,
    delay_min, delay_max, instant_fcfs, max_winners } = user;
  const entered = getEntered(discord_id);
  const wins = await getKnownWins(discord_id);

  // Check rate limit cooldown
  const cooldown = rateLimitUntil.get(discord_id);
  if (cooldown && Date.now() < cooldown) {
    const remaining = Math.ceil((cooldown - Date.now()) / 1000 / 60);
    console.log(`[${discord_id}] ⏳ Rate limited, ${remaining}min remaining`);
    return { entered: 0, failed: 0, skipped: 0, rateLimited: true };
  }

  // ── Fetch raffles ────────────────────────────────────────────
  let result;
  if (mode === 'communities') {
    result = await alphabot.getMyCommunityRaffles(alphabot_api_key);
  } else if (mode === 'custom') {
    const ids = custom_team_ids ? custom_team_ids.split(',').map(s => s.trim()).filter(Boolean) : [];
    result = await alphabot.getOpenRaffles(alphabot_api_key, ids);
  } else {
    result = await alphabot.getOpenRaffles(alphabot_api_key);
  }

  if (!result.success) {
    if (result.invalidKey) {
      await db.setRunning(discord_id, false);
      if (alertCallback) alertCallback(discord_id, 'invalid_key', null);
      return { entered: 0, failed: 0, skipped: 0 };
    }
    if (result.rateLimited) {
      rateLimitUntil.set(discord_id, Date.now() + 10 * 60 * 1000);
      if (alertCallback) alertCallback(discord_id, 'rate_limited', null);
      return { entered: 0, failed: 0, skipped: 0, rateLimited: true };
    }
    return { entered: 0, failed: 0, skipped: 0 };
  }

  // ── Check for wins ───────────────────────────────────────────
  const winCheck = await alphabot.checkWins(alphabot_api_key);
  if (winCheck.success && winCheck.wins.length > 0) {
    for (const raffle of winCheck.wins) {
      if (!wins.has(raffle.slug)) {
        wins.add(raffle.slug);
        await db.logEntry(discord_id, raffle.slug, raffle.name || raffle.slug, raffle.teamId || '', 'won', null);
        if (alertCallback) alertCallback(discord_id, 'win', raffle);
        await forwardNotification(user, `🏆 YOU WON: ${raffle.name}`);
        // Schedule mint reminders for this win
        await scheduleReminder(discord_id, alphabot_api_key, raffle.slug, raffle.name || raffle.slug, null);
      }
    }
  }

  // ── Enter raffles ────────────────────────────────────────────
  let raffles = result.raffles;

  // Apply max winners filter
  if (max_winners > 0) {
    raffles = raffles.filter(r => !r.winnerCount || r.winnerCount <= max_winners);
  }

  // Separate FCFS from normal raffles
  const fcfsRaffles = raffles.filter(r => r.type === 'fcfs');
  const normalRaffles = raffles.filter(r => r.type !== 'fcfs');

  // Enter FCFS first (instantly, no delay)
  const allRaffles = instant_fcfs ? [...fcfsRaffles, ...normalRaffles] : [...normalRaffles, ...fcfsRaffles];

  let enteredCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  let twitterIssueFound = false;
  const enteredRaffles = [];

  for (const raffle of allRaffles) {
    const slug = raffle.slug;
    const name = raffle.name || 'Unknown Raffle';
    const teamId = raffle.teamId || '';
    const isFcfs = raffle.type === 'fcfs';

    if (entered.has(slug)) { skippedCount++; continue; }

    // Check blocklist
    const blocked = await db.isBlocked(discord_id, name, teamId);
    if (blocked) {
      entered.add(slug);
      skippedCount++;
      console.log(`[${discord_id}] 🚫 Blocked: ${name}`);
      continue;
    }

    // Alphabot handles wallet rotation natively — no need to pass wallet here
    const wallet = null;

    // Enter with retry
    const res = await alphabot.enterRaffle(alphabot_api_key, slug, wallet, 2);
    entered.add(slug);

    if (res.rateLimited) {
      rateLimitUntil.set(discord_id, Date.now() + 10 * 60 * 1000);
      if (alertCallback) alertCallback(discord_id, 'rate_limited', null);
      break;
    }
    if (res.invalidKey) {
      await db.setRunning(discord_id, false);
      if (alertCallback) alertCallback(discord_id, 'invalid_key', null);
      break;
    }
    if (res.alreadyEntered) {
      skippedCount++;
    } else if (res.success) {
      enteredCount++;
      await db.logEntry(discord_id, slug, name, teamId, 'entered', wallet);
      enteredRaffles.push({ name, isFcfs, wallet });
      console.log(`[${discord_id}] ✅ ${isFcfs ? '[FCFS]' : ''} Entered: ${name}`);
    } else if (res.twitterIssue) {
      skippedCount++;
      twitterIssueFound = true;
    } else if (res.ineligible) {
      skippedCount++;
    } else {
      failedCount++;
      console.error(`[${discord_id}] ❌ Failed: ${name} - ${res.error}`);
    }

    // FCFS = instant, normal = human delay
    if (!isFcfs || !instant_fcfs) {
      await sleep(randomDelay(delay_min || 3, delay_max || 8));
    }
  }

  if (twitterIssueFound && !twitterWarned.get(discord_id)) {
    twitterWarned.set(discord_id, true);
    if (alertCallback) alertCallback(discord_id, 'twitter_issue', null);
  }

  return { entered: enteredCount, failed: failedCount, skipped: skippedCount, enteredRaffles };
}

let loopRunning = false;
let loopTimer = null;

async function runLoop(notifyCallback, alertCallback) {
  if (loopRunning) return;
  loopRunning = true;
  console.log('[Engine] Starting auto-enter loop...');

  const tick = async () => {
    const users = await db.getAllRunningUsers();
    console.log(`[Engine] Tick: ${users.length} active user(s)`);
    for (const user of users) {
      const fresh = await db.getUser(user.discord_id);
      if (!fresh?.is_running) continue;
      try {
        const stats = await processUser(fresh, alertCallback);
        if (notifyCallback) notifyCallback(user.discord_id, stats, fresh);
      } catch (err) {
        console.error(`[Engine] Error for ${user.discord_id}:`, err.message);
      }
    }
  };

  await tick();
  loopTimer = setInterval(tick, 15 * 60 * 1000);
}

function stopLoop() {
  if (loopTimer) { clearInterval(loopTimer); loopTimer = null; }
  loopRunning = false;
}

function clearSessionCache(id) {
  enteredThisSession.delete(id);
  twitterWarned.delete(id);
  rateLimitUntil.delete(id);
}

module.exports = { runLoop, stopLoop, clearSessionCache, processUser };
