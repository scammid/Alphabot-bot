const db = require('./database');
const alphabot = require('./alphabot');

// Check every 5 minutes for upcoming mints
const BANNER_URL = 'https://raw.githubusercontent.com/scammid/Alphabot-bot/main/63F7A489-69AF-4533-9CC6-72D07ACD11E4.png';

async function startMintReminderLoop(dmCallback) {
  console.log('[Mint] Starting mint reminder loop...');

  const check = async () => {
    try {
      const reminders = await db.getPendingReminders();
      const now = Date.now();

      for (const r of reminders) {
        const mintDate = r.mint_date;
        if (!mintDate || mintDate <= 0) continue;

        const diff = mintDate - now; // ms until mint
        const hoursLeft = diff / (1000 * 60 * 60);

        // 24h reminder
        if (!r.reminded_24h && hoursLeft <= 24 && hoursLeft > 1) {
          await dmCallback(r.discord_id, buildReminderMsg(r, '24 hours'));
          await db.markReminder(r.id, 'reminded_24h');
        }

        // 1h reminder
        if (!r.reminded_1h && hoursLeft <= 1 && hoursLeft > 0) {
          await dmCallback(r.discord_id, buildReminderMsg(r, '1 hour'));
          await db.markReminder(r.id, 'reminded_1h');
        }

        // Mint started
        if (!r.reminded_start && diff <= 0 && diff > -60 * 60 * 1000) {
          await dmCallback(r.discord_id, buildStartMsg(r));
          await db.markReminder(r.id, 'reminded_start');
        }
      }
    } catch (err) {
      console.error('[Mint] Reminder check error:', err.message);
    }
  };

  await check();
  setInterval(check, 5 * 60 * 1000); // every 5 minutes
}

const { EmbedBuilder } = require('discord.js');

function buildReminderMsg(r, timeLeft) {
  const mintDate = new Date(r.mint_date).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const desc = [
    `🎟 **Raffle:** ${r.raffle_name}`,
    `📅 **Mint Date:** ${mintDate}`,
    r.wallet_used ? `👛 **Wallet Submitted:** \`${r.wallet_used}\`` : null,
    `🔗 **Link:** https://alphabot.app/${r.raffle_slug}`,
    ``,
    `Get ready to mint! 🚀`,
  ].filter(l => l !== null).join('\n');

  return { embeds: [new EmbedBuilder()
    .setTitle(`⏰ Mint Reminder — ${timeLeft} to go!`)
    .setDescription(desc)
    .setColor(0x5865f2)
    .setImage(BANNER_URL)
    .setTimestamp()]
  };
}

function buildStartMsg(r) {
  const desc = [
    `🎟 **Raffle:** ${r.raffle_name}`,
    r.wallet_used ? `👛 **Wallet:** \`${r.wallet_used}\`` : null,
    `🔗 **Link:** https://alphabot.app/${r.raffle_slug}`,
    ``,
    `**Go mint NOW!** ⚡`,
  ].filter(l => l !== null).join('\n');

  return { embeds: [new EmbedBuilder()
    .setTitle('🚀 MINT IS LIVE NOW!')
    .setDescription(desc)
    .setColor(0xffd700)
    .setImage(BANNER_URL)
    .setTimestamp()]
  };
}

// Call this when a user wins a raffle — fetch mint date and schedule reminders
async function scheduleReminder(discordId, apiKey, raffleSlug, raffleName, walletUsed) {
  try {
    const result = await alphabot.getRaffleDetails(apiKey, raffleSlug);
    if (!result.success || !result.raffle) return;

    const raffle = result.raffle;
    const mintDate = raffle.mintDate || raffle.projectData?.mintDate || 0;

    if (mintDate && mintDate > Date.now()) {
      await db.addMintReminder(discordId, raffleSlug, raffleName, mintDate, walletUsed);
      console.log(`[Mint] Scheduled reminders for ${discordId} — ${raffleName} mints at ${new Date(mintDate).toISOString()}`);
    } else {
      console.log(`[Mint] No mint date for ${raffleName} — skipping reminder`);
    }
  } catch (err) {
    console.error('[Mint] scheduleReminder error:', err.message);
  }
}

module.exports = { startMintReminderLoop, scheduleReminder };
