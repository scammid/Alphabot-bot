require('dotenv').config();
const { Client, GatewayIntentBits, Events, REST, Routes, EmbedBuilder } = require('discord.js');
const { handleInteraction } = require('./handlers/interactionHandler');
const { buildControlPanel } = require('./utils/panelBuilder');
const { runLoop } = require('./services/autoEnter');
const db = require('./services/database');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
  ],
});

const commands = [
  { name: 'panel', description: 'Open your private AlphaBot Auto-Enter control panel' },
  { name: 'setup', description: 'How to get your Alphabot API key' },
  {
    name: 'setdelay',
    description: 'Set delay between raffle entries (1-300 seconds)',
    options: [{ name: 'seconds', description: 'Delay in seconds', type: 4, required: true, min_value: 1, max_value: 300 }]
  },
  {
    name: 'setteams',
    description: 'Set custom team IDs',
    options: [{ name: 'ids', description: 'Comma-separated team IDs', type: 3, required: true }]
  },
  { name: 'stats', description: 'View your raffle entry stats' },
];

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    console.log('[Bot] Registering slash commands...');
    const route = process.env.GUILD_ID
      ? Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID)
      : Routes.applicationCommands(process.env.CLIENT_ID);
    await rest.put(route, { body: commands });
    console.log('[Bot] Slash commands registered.');
  } catch (err) {
    console.error('[Bot] Failed to register commands:', err.message);
  }
}

// Send DM to user
async function dmUser(discordId, content) {
  try {
    const user = await client.users.fetch(discordId);
    if (typeof content === 'string') {
      await user.send(content);
    } else {
      await user.send(content);
    }
  } catch (_) {}
}

// Send control panel to user's DMs
async function sendPanelDM(discordId) {
  try {
    const user = await client.users.fetch(discordId);
    const dbUser = await db.getUser(discordId);
    const panel = buildControlPanel(dbUser);
    const dm = await user.createDM();
    // Delete old panel if exists
    const old = await dm.messages.fetch({ limit: 20 });
    const oldPanel = old.find(m => m.author.id === client.user.id && m.embeds.length > 0);
    if (oldPanel) await oldPanel.delete().catch(() => {});
    await user.send(panel);
  } catch (_) {}
}

// Welcome DM for new members
async function sendWelcomeDM(member) {
  try {
    await member.send({
      embeds: [
        new EmbedBuilder()
          .setTitle('👋 Welcome to AlphaBot Auto-Enter!')
          .setDescription(
            `Hey **${member.user.username}**! I automatically enter Alphabot raffles for you 24/7.\n\n` +
            `**Getting started is easy:**\n` +
            `1️⃣ Get your API key from https://alphabot.app → Settings → Developer settings\n` +
            `2️⃣ Click the **📝 Submit API Key** button below\n` +
            `3️⃣ Click **🟢 Start** and I'll handle the rest!\n\n` +
            `Your control panel is below 👇`
          )
          .setColor(0x5865f2)
          .setFooter({ text: 'AlphaBot Auto-Enter • Fully Private • 24/7' })
      ]
    });
    await db.upsertUser(member.user.id, member.user.username);
    await sendPanelDM(member.user.id);
  } catch (_) {}
}

client.once(Events.ClientReady, async () => {
  console.log(`[Bot] Logged in as ${client.user.tag}`);
  await db.getAllRunningUsers();
  console.log('[Bot] Database ready.');
  await registerCommands();

  // ── Notify callback — DM after every tick ──────────────
  const notifyCallback = async (discordId, stats) => {
    if (stats.rateLimited) return;
    const dbUser = await db.getUser(discordId);
    const mode = dbUser?.mode || 'all';
    const modeLabel = mode === 'communities' ? 'Community' : mode === 'custom' ? 'Custom Teams' : 'All Raffles';
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

    const msg = [
      `📋 **Active Raffles Loaded**`,
      ``,
      `✅ **${stats.entered}** new raffle(s) entered`,
      `⏭ **${stats.skipped}** skipped (already tried / ineligible)`,
      stats.failed > 0 ? `❌ **${stats.failed}** failed` : null,
      ``,
      `🎯 **Scope:** ${modeLabel}`,
      `🕐 **Time:** ${now}`,
    ].filter(l => l !== null).join('\n');

    await dmUser(discordId, msg);
  };

  // ── Alert callback — critical issues ─────────────────────────
  const alertCallback = async (discordId, type, data) => {
    if (type === 'invalid_key') {
      await db.setRunning(discordId, false);
      await dmUser(discordId,
        `⚠️ **API Key Expired or Invalid**\n\n` +
        `Your Alphabot API key is no longer valid. The bot has been **stopped**.\n\n` +
        `**To fix:**\n` +
        `1. Go to https://alphabot.app → Settings → Developer settings\n` +
        `2. Generate a new API key\n` +
        `3. Click **📝 Submit API Key** in your panel and re-enter it\n` +
        `4. Click **🟢 Start** again`
      );
      await sendPanelDM(discordId);
    }

    if (type === 'rate_limited') {
      await dmUser(discordId,
        `⏳ **Rate Limited by Alphabot**\n\n` +
        `The bot has been rate limited. It will automatically resume in **10 minutes**.\n` +
        `No action needed!`
      );
    }

    if (type === 'win' && data) {
      await dmUser(discordId,
        `🏆 **YOU WON A RAFFLE!**\n\n` +
        `**Raffle:** ${data.name || data.slug}\n` +
        `**Link:** https://alphabot.app/${data.slug}\n\n` +
        `Check your Alphabot account for next steps! 🎉`
      );
    }

    if (type === 'twitter_issue') {
      await dmUser(discordId,
        `⚠️ **X (Twitter) Account Issue Detected**\n\n` +
        `The bot couldn't complete X/Twitter requirements. This usually means:\n\n` +
        `• Your X account is **suspended or restricted**\n` +
        `• Your X account has been **disconnected** from Alphabot\n\n` +
        `**To fix:**\n` +
        `1. Go to https://alphabot.app → Settings\n` +
        `2. Disconnect and reconnect your X account\n` +
        `3. Make sure your X account is not suspended\n\n` +
        `Raffles with X requirements will be skipped until resolved.`
      );
    }
  };

  runLoop(notifyCallback, alertCallback);
});

// ── New member joins → send welcome DM ───────────────────
client.on(Events.GuildMemberAdd, async member => {
  console.log(`[Bot] New member: ${member.user.username}`);
  await sendWelcomeDM(member);
});

// ── Slash commands ────────────────────────────────────────
client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isChatInputCommand()) {

    if (interaction.commandName === 'panel') {
      await interaction.reply({ content: '📨 Check your DMs! Your private control panel has been sent.', ephemeral: true });
      await db.upsertUser(interaction.user.id, interaction.user.username);
      await sendPanelDM(interaction.user.id);
      return;
    }

    if (interaction.commandName === 'setup') {
      return interaction.reply({
        ephemeral: true,
        content: [
          '## 🔑 How to get your Alphabot API Key',
          '1. Go to **https://alphabot.app** and log in',
          '2. Click your profile → **Settings**',
          '3. Scroll to **Developer settings** → copy your API key',
          '4. Use `/panel` to open your control panel and submit your key',
          '',
          '> ⚠️ Keep your API key private — never share it!',
        ].join('\n'),
      });
    }

    if (interaction.commandName === 'setdelay') {
      const seconds = interaction.options.getInteger('seconds');
      await db.upsertUser(interaction.user.id, interaction.user.username);
      await db.setDelay(interaction.user.id, seconds);
      await sendPanelDM(interaction.user.id);
      return interaction.reply({ content: `✅ Delay set to **${seconds}s**. Panel updated in your DMs!`, ephemeral: true });
    }

    if (interaction.commandName === 'setteams') {
      const ids = interaction.options.getString('ids');
      await db.upsertUser(interaction.user.id, interaction.user.username);
      await db.setCustomTeamIds(interaction.user.id, ids);
      return interaction.reply({ content: `✅ Custom team IDs saved!`, ephemeral: true });
    }

    if (interaction.commandName === 'stats') {
      await db.upsertUser(interaction.user.id, interaction.user.username);
      const { user: u, recent } = await db.getStats(interaction.user.id);
      const lines = recent.length > 0
        ? recent.map(r => {
            const icon = r.status === 'won' ? '🏆' : r.status === 'failed' ? '❌' : '✅';
            return `${icon} **${r.raffle_name}**`;
          }).join('\n')
        : '_No entries yet. Use `/panel` to get started!_';

      const embed = new EmbedBuilder()
        .setTitle('📊 Your Raffle Stats')
        .setColor(0x5865f2)
        .addFields(
          { name: '🎟 Total Entered', value: String(u?.total_entered || 0), inline: true },
          { name: '🏆 Total Won', value: String(u?.total_won || 0), inline: true },
          { name: '📈 Win Rate', value: u?.total_entered > 0 ? `${((u.total_won / u.total_entered) * 100).toFixed(1)}%` : 'N/A', inline: true },
          { name: 'Recent Entries (last 10)', value: lines }
        )
        .setTimestamp();

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }

  // Button/modal interactions (from DM panel)
  await handleInteraction(interaction, client);
});

client.on(Events.Error, err => console.error('[Bot] Client error:', err));
process.on('unhandledRejection', err => console.error('[Bot] Unhandled rejection:', err));

client.login(process.env.DISCORD_TOKEN);
