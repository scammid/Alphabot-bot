const db = require('./database');
const alphabot = require('./alphabot');

const enteredThisSession = new Map(); // discordId -> Set of slugs

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getEntered(discordId) {
  if (!enteredThisSession.has(discordId)) {
    enteredThisSession.set(discordId, new Set());
  }
  return enteredThisSession.get(discordId);
}

async function processUser(user) {
  const { discord_id, alphabot_api_key, mode, custom_team_ids, delay_seconds } = user;
  const entered = getEntered(discord_id);
  const delay = (delay_seconds || 5) * 1000;

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
    console.error(`[${discord_id}] Failed to fetch raffles: ${result.error}`);
    return { entered: 0, failed: 0, skipped: 0 };
  }

  const raffles = result.raffles;
  let enteredCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  for (const raffle of raffles) {
    const slug = raffle.slug;
    const name = raffle.name || 'Unknown Raffle';
    const teamName = raffle.teamId || 'Unknown Team';

    // Skip anything already processed this session (entered, failed, ineligible)
    if (entered.has(slug)) {
      skippedCount++;
      continue;
    }

    const res = await alphabot.enterRaffle(alphabot_api_key, slug);

    // Always cache the slug so we never retry in this session
    entered.add(slug);

    if (res.alreadyEntered) {
      skippedCount++;
    } else if (res.success) {
      enteredCount++;
      await db.logEntry(discord_id, slug, name, teamName, 'entered');
      console.log(`[${discord_id}] ✅ Entered: ${name}`);
    } else if (res.ineligible) {
      skippedCount++;
      console.log(`[${discord_id}] ⏭ Ineligible: ${name} - ${res.error}`);
    } else {
      failedCount++;
      console.error(`[${discord_id}] ❌ Failed: ${name} - ${res.error}`);
    }

    await sleep(delay);
  }

  return { entered: enteredCount, failed: failedCount, skipped: skippedCount };
}

let loopRunning = false;
let loopTimer = null;

async function runLoop(notifyCallback) {
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
        const stats = await processUser(fresh);
        if (stats.entered > 0 && notifyCallback) {
          notifyCallback(user.discord_id, stats);
        }
      } catch (err) {
        console.error(`[Engine] Error for ${user.discord_id}:`, err.message);
      }
    }
  };

  await tick();
  // Run every 15 minutes to avoid rate limiting
  loopTimer = setInterval(tick, 15 * 60 * 1000);
}

function stopLoop() {
  if (loopTimer) { clearInterval(loopTimer); loopTimer = null; }
  loopRunning = false;
}

function clearSessionCache(discordId) {
  enteredThisSession.delete(discordId);
}

module.exports = { runLoop, stopLoop, clearSessionCache, processUser };
