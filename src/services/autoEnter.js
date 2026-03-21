const db = require('./database');
const alphabot = require('./alphabot');

const enteredThisSession = new Map();  // discordId -> Set of slugs
const knownWins = new Map();           // discordId -> Set of slugs already notified
const rateLimitUntil = new Map();      // discordId -> timestamp when cooldown ends
const twitterWarned = new Map();       // discordId -> bool, warned about twitter this session

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getEntered(discordId) {
  if (!enteredThisSession.has(discordId)) enteredThisSession.set(discordId, new Set());
  return enteredThisSession.get(discordId);
}

function getKnownWins(discordId) {
  if (!knownWins.has(discordId)) knownWins.set(discordId, new Set());
  return knownWins.get(discordId);
}

async function processUser(user, alertCallback) {
  const { discord_id, alphabot_api_key, mode, custom_team_ids, delay_seconds } = user;
  const entered = getEntered(discord_id);
  const wins = getKnownWins(discord_id);
  const delay = (delay_seconds || 5) * 1000;

  // Check rate limit cooldown
  const cooldown = rateLimitUntil.get(discord_id);
  if (cooldown && Date.now() < cooldown) {
    const remaining = Math.ceil((cooldown - Date.now()) / 1000 / 60);
    console.log(`[${discord_id}] ⏳ Rate limited, waiting ${remaining} more minute(s)`);
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

  // Handle fetch errors
  if (!result.success) {
    if (result.invalidKey) {
      await db.setRunning(discord_id, false);
      if (alertCallback) alertCallback(discord_id, 'invalid_key', null);
      return { entered: 0, failed: 0, skipped: 0 };
    }
    if (result.rateLimited) {
      rateLimitUntil.set(discord_id, Date.now() + 10 * 60 * 1000); // 10 min cooldown
      if (alertCallback) alertCallback(discord_id, 'rate_limited', null);
      return { entered: 0, failed: 0, skipped: 0, rateLimited: true };
    }
    console.error(`[${discord_id}] Failed to fetch raffles: ${result.error}`);
    return { entered: 0, failed: 0, skipped: 0 };
  }

  // ── Check for wins ───────────────────────────────────────────
  const winCheck = await alphabot.checkWins(alphabot_api_key);
  if (winCheck.success && winCheck.wins.length > 0) {
    for (const raffle of winCheck.wins) {
      const slug = raffle.slug;
      if (!wins.has(slug)) {
        wins.add(slug);
        await db.logEntry(discord_id, slug, raffle.name || slug, raffle.teamId || '', 'won');
        if (alertCallback) alertCallback(discord_id, 'win', raffle);
      }
    }
  }

  // ── Enter raffles ────────────────────────────────────────────
  const raffles = result.raffles;
  let enteredCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  let twitterIssueFound = false;

  for (const raffle of raffles) {
    const slug = raffle.slug;
    const name = raffle.name || 'Unknown Raffle';
    const teamName = raffle.teamId || 'Unknown Team';

    if (entered.has(slug)) { skippedCount++; continue; }

    const res = await alphabot.enterRaffle(alphabot_api_key, slug);
    entered.add(slug); // always cache regardless of result

    if (res.rateLimited) {
      rateLimitUntil.set(discord_id, Date.now() + 10 * 60 * 1000);
      if (alertCallback) alertCallback(discord_id, 'rate_limited', null);
      console.log(`[${discord_id}] ⏳ Rate limited mid-loop, pausing`);
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
      await db.logEntry(discord_id, slug, name, teamName, 'entered');
      console.log(`[${discord_id}] ✅ Entered: ${name}`);
    } else if (res.twitterIssue) {
      skippedCount++;
      twitterIssueFound = true;
      console.log(`[${discord_id}] ⚠️ Twitter issue on: ${name}`);
    } else if (res.ineligible) {
      skippedCount++;
    } else {
      failedCount++;
      console.error(`[${discord_id}] ❌ Failed: ${name} - ${res.error}`);
    }

    await sleep(delay);
  }

  // Warn about Twitter issue once per session
  if (twitterIssueFound && !twitterWarned.get(discord_id)) {
    twitterWarned.set(discord_id, true);
    if (alertCallback) alertCallback(discord_id, 'twitter_issue', null);
  }

  return { entered: enteredCount, failed: failedCount, skipped: skippedCount };
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
        if (notifyCallback) notifyCallback(user.discord_id, stats);
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

function clearSessionCache(discordId) {
  enteredThisSession.delete(discordId);
  twitterWarned.delete(discordId);
  rateLimitUntil.delete(discordId);
}

module.exports = { runLoop, stopLoop, clearSessionCache, processUser };
