const db = require('./database');
const alphabot = require('./alphabot');

// Track which raffle IDs have already been entered per user this session
const enteredThisSession = new Map(); // discordId -> Set of raffleIds

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getEntered(discordId) {
  if (!enteredThisSession.has(discordId)) {
    enteredThisSession.set(discordId, new Set());
  }
  return enteredThisSession.get(discordId);
}

/**
 * Run one pass of raffle entry for a single user
 */
async function processUser(user) {
  const { discord_id, alphabot_api_key, mode, custom_team_ids, delay_seconds } = user;
  const entered = getEntered(discord_id);
  const delay = (delay_seconds || 5) * 1000;

  let result;

  // Fetch raffles based on mode
  if (mode === 'communities') {
    result = await alphabot.getMyCommunityRaffles(alphabot_api_key);
  } else if (mode === 'custom') {
    const ids = custom_team_ids ? custom_team_ids.split(',').map(s => s.trim()).filter(Boolean) : [];
    result = await alphabot.getOpenRaffles(alphabot_api_key, ids);
  } else {
    // 'all'
    result = await alphabot.getOpenRaffles(alphabot_api_key);
  }

  if (!result.success) {
    console.error(`[${discord_id}] Failed to fetch raffles: ${result.error}`);
    return { entered: 0, failed: 0, skipped: 0, error: result.error };
  }

  const raffles = result.raffles;
  let enteredCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  for (const raffle of raffles) {
    const raffleId = raffle.slug;
    const raffleName = raffle.name || 'Unknown Raffle';
    const teamName = raffle.teamId || 'Unknown Team';

    // Skip if already entered this session
    if (entered.has(raffleId)) {
      skippedCount++;
      continue;
    }

    const entryResult = await alphabot.enterRaffle(alphabot_api_key, raffleId);

    if (entryResult.alreadyEntered) {
      entered.add(raffleId);
      skippedCount++;
      continue;
    }

    if (entryResult.success) {
      entered.add(raffleId);
      enteredCount++;
      await db.logEntry(discord_id, raffleId, raffleName, teamName, 'entered');
      console.log(`[${discord_id}] ✅ Entered: ${raffleName}`);
    } else if (entryResult.ineligible) {
      skippedCount++;
      console.log(`[${discord_id}] ⏭ Ineligible: ${raffleName} - ${entryResult.error}`);
    } else {
      failedCount++;
      console.error(`[${discord_id}] ❌ Failed: ${raffleName} - ${entryResult.error}`);
    }

    // Delay between entries to avoid rate limiting
    await sleep(delay);
  }

  return { entered: enteredCount, failed: failedCount, skipped: skippedCount };
}

/**
 * Main loop - runs every 2 minutes, processes all active users
 */
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
      // Re-check user is still running (they may have stopped mid-loop)
      const fresh = await db.getUser(user.discord_id);
      if (!fresh?.is_running) continue;

      try {
        const stats = await processUser(fresh);
        if (stats.entered > 0 && notifyCallback) {
          notifyCallback(user.discord_id, stats);
        }
      } catch (err) {
        console.error(`[Engine] Unexpected error for ${user.discord_id}:`, err.message);
      }
    }
  };

  // Run immediately, then every 2 minutes
  await tick();
  loopTimer = setInterval(tick, 2 * 60 * 1000);
}

function stopLoop() {
  if (loopTimer) {
    clearInterval(loopTimer);
    loopTimer = null;
  }
  loopRunning = false;
  console.log('[Engine] Loop stopped.');
}

function clearSessionCache(discordId) {
  enteredThisSession.delete(discordId);
}

module.exports = { runLoop, stopLoop, clearSessionCache, processUser };
