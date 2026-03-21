require('dotenv').config();
const { Client, GatewayIntentBits, Events, REST, Routes, EmbedBuilder } = require('discord.js');
const { handleInteraction } = require('./handlers/interactionHandler');
const { buildSharedPanel } = require('./utils/panelBuilder');
const { runLoop } = require('./services/autoEnter');
const db = require('./services/database');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers],
});

const commands = [
  { name: 'panel', description: 'Open your private AlphaBot control panel' },
  { name: 'setup', description: 'How to get your Alphabot API key' },
  { name: 'stats', description: 'View your raffle stats' },

  {
    name: 'block',
    description: 'Block a project or team from being entered',
    options: [
      { name: 'type', description: 'project or team', type: 3, required: true, choices: [{ name: 'project', value: 'project' }, { name: 'team', value: 'team' }] },
      { name: 'value', description: 'Project name or Team ID', type: 3, required: true },
    ]
  },
  {
    name: 'unblock',
    description: 'Remove something from your blocklist by ID',
    options: [{ name: 'id', description: 'Blocklist entry ID', type: 4, required: true }]
  },
  {
    name: 'setteams',
    description: 'Set custom team IDs to enter raffles for',
    options: [{ name: 'ids', description: 'Comma-separated team IDs', type: 3, required: true }]
  },
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

async function dmUser(discordId, content) {
  try {
    const user = await client.users.fetch(discordId);
    await user.send(content);
  } catch (err) {
    console.error(`[DM] Failed to DM ${discordId}:`, err.message);
  }
}

async function sendPanelDM(discordId) {
  // Panel is now in the server channel — this only sends DM alerts, not panels
}

async function sendWelcomeDM(member) {
  try {
    await db.upsertUser(member.user.id, member.user.username);
    await member.send({
      embeds: [
        new EmbedBuilder()
          .setTitle('👋 Welcome to AlphaBot Auto-Enter!')
          .setDescription(
            `Hey **${member.user.username}**! I auto-enter Alphabot raffles for you 24/7.\n\n` +
            `**Get started:**\n` +
            `1️⃣ Go to the bot channel in the server\n` +
            `2️⃣ Click **📝 Submit API Key** on the panel\n` +
            `3️⃣ Paste your key from https://alphabot.app → Settings → Developer settings\n` +
            `4️⃣ Click **🟢 Start** — done!\n\n` +
            `**Features:**\n` +
            `⚡ Instant FCFS | 🚫 Blocklist | 🏆 Win alerts | 📊 Stats\n\n` +
            `> All your button responses are private — only you can see them!`
          )
          .setColor(0x5865f2)
          .setFooter({ text: 'AlphaBot Auto-Enter • 100% Private • 24/7' })
      ]
    });
  } catch (_) {}
}

client.once(Events.ClientReady, async () => {
  console.log(`[Bot] Logged in as ${client.user.tag}`);
  await db.getAllRunningUsers();
  console.log('[Bot] Database ready.');
  await registerCommands();

  // ── Notify callback ───────────────────────────────────────────
  const notifyCallback = async (discordId, stats, user) => {
    if (stats.rateLimited) return;
    const mode = user?.mode || 'all';
    const modeLabel = mode === 'communities' ? 'Community' : mode === 'custom' ? 'Custom Teams' : 'All Raffles';
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
    const fcfsEntered = stats.enteredRaffles?.filter(r => r.isFcfs).length || 0;
    const normalEntered = stats.enteredRaffles?.filter(r => !r.isFcfs).length || 0;

    const raffleLines = stats.enteredRaffles?.length > 0
      ? stats.enteredRaffles.map(r => `  ${r.isFcfs ? '⚡' : '✅'} ${r.name}`).join('\n')
      : null;

    const msg = [
      `📋 **Raffle Entry Update**`,
      ``,
      stats.entered > 0 ? `✅ **${stats.entered}** entered${fcfsEntered > 0 ? ` (⚡ ${fcfsEntered} FCFS)` : ''}` : `➡️ **0** new entries this tick`,
      raffleLines,
      `⏭ **${stats.skipped}** skipped`,
      stats.failed > 0 ? `❌ **${stats.failed}** failed` : null,
      ``,
      `🎯 **Scope:** ${modeLabel}`,
      `🕐 **Time:** ${now}`,
    ].filter(l => l !== null).join('\n');

    await dmUser(discordId, msg);

    if (user?.forward_webhook) {
      try {
        const axios = require('axios');
        await axios.post(user.forward_webhook, { content: msg }, { timeout: 5000 });
      } catch (err) {
        console.error(`[Webhook] Failed to forward for ${discordId}:`, err.message);
      }
    }
  };

  // ── Alert callback ────────────────────────────────────────────
  const alertCallback = async (discordId, type, data) => {
    if (type === 'invalid_key') {
      await dmUser(discordId,
        `⚠️ **API Key Expired**\n\nYour key is invalid. Bot has been stopped.\n\n` +
        `1. Go to https://alphabot.app → Settings → Developer settings\n` +
        `2. Generate a new key\n3. Click **📝 Submit API Key** in your panel\n4. Click **🟢 Start**`
      );
    }

    if (type === 'rate_limited') {
      await dmUser(discordId, `⏳ **Rate Limited**\n\nAlphabot rate limited your account. Auto-resuming in 10 minutes. No action needed!`);
    }

    if (type === 'win' && data) {
      // Win alert with embed image
      const winEmbed = new EmbedBuilder()
        .setTitle('🏆 YOU WON A RAFFLE!')
        .setDescription(
          `**${data.name || data.slug}**\n\n` +
          `🔗 [View on Alphabot](https://alphabot.app/${data.slug})\n\n` +
          `Check your Alphabot account for next steps! 🎉`
        )
        .setColor(0xffd700)
        .setTimestamp();
      if (data.bannerImageUrl) winEmbed.setImage(data.bannerImageUrl);
      if (data.twitterUrl) winEmbed.addFields({ name: 'Project Twitter', value: data.twitterUrl });

      await dmUser(discordId, { embeds: [winEmbed] });
    }

    if (type === 'twitter_issue') {
      await dmUser(discordId,
        `⚠️ **X (Twitter) Account Issue Detected**\n\n` +
        `The bot failed X/Twitter requirements on one or more raffles.\n\n` +
        `**Possible reasons:**\n` +
        `• Your X account is **suspended or restricted**\n` +
        `• Your X account has been **disconnected** from Alphabot\n` +
        `• X API is temporarily down\n\n` +
        `**How to fix:**\n` +
        `1. Go to https://alphabot.app → Settings\n` +
        `2. Find the **X (Twitter)** connection\n` +
        `3. Disconnect and reconnect your X account\n` +
        `4. Check https://twitter.com to make sure your account isn't suspended\n\n` +
        `Raffles requiring X will be skipped until this is resolved.`
      );
    }
  };

  runLoop(notifyCallback, alertCallback);
});

// ── New member → welcome DM ───────────────────────────────────
client.on(Events.GuildMemberAdd, async member => {
  console.log(`[Bot] New member: ${member.user.username}`);
  await sendWelcomeDM(member);
});

// ── Slash commands ────────────────────────────────────────────
client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isChatInputCommand()) {

if (interaction.commandName === 'panel') {
      await interaction.reply({ content: '✅ Panel posted! Click any button — only you will see your own responses.', ephemeral: true });
      await interaction.channel.send(buildSharedPanel());
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
          '4. Use `/panel` and click **📝 Submit API Key**',
          '5. Add a wallet with `/addwallet`',
          '6. Click **🟢 Start**!',
        ].join('\n'),
      });
    }

    if (interaction.commandName === 'stats') {
      await db.upsertUser(interaction.user.id, interaction.user.username);
      const { user: u, recent } = await db.getStats(interaction.user.id);
      const lines = recent.length > 0
        ? recent.map(r => `${r.status === 'won' ? '🏆' : '✅'} **${r.raffle_name}**`).join('\n')
        : '_No entries yet._';
      const embed = new EmbedBuilder()
        .setTitle('📊 Your Stats').setColor(0x5865f2)
        .addFields(
          { name: '🎟 Entered', value: String(u?.total_entered || 0), inline: true },
          { name: '🏆 Won', value: String(u?.total_won || 0), inline: true },
          { name: '📈 Win Rate', value: u?.total_entered > 0 ? `${((u.total_won / u.total_entered) * 100).toFixed(1)}%` : 'N/A', inline: true },
          { name: 'Recent', value: lines }
        ).setTimestamp();
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (interaction.commandName === 'block') {
      await db.upsertUser(interaction.user.id, interaction.user.username);
      const type = interaction.options.getString('type');
      const value = interaction.options.getString('value');
      await db.addToBlocklist(interaction.user.id, type, value);
      return interaction.reply({ content: `🚫 Blocked **${type}**: ${value}`, ephemeral: true });
    }

    if (interaction.commandName === 'unblock') {
      const id = interaction.options.getInteger('id');
      await db.removeFromBlocklist(interaction.user.id, id);
      return interaction.reply({ content: `✅ Removed from blocklist.`, ephemeral: true });
    }

    if (interaction.commandName === 'setteams') {
      await db.upsertUser(interaction.user.id, interaction.user.username);
      const ids = interaction.options.getString('ids');
      await db.setCustomTeamIds(interaction.user.id, ids);
      return interaction.reply({ content: `✅ Custom team IDs saved!`, ephemeral: true });
    }
  }

  await handleInteraction(interaction, client);
});

client.on(Events.Error, err => console.error('[Bot] Client error:', err));
process.on('unhandledRejection', err => console.error('[Bot] Unhandled rejection:', err));

client.login(process.env.DISCORD_TOKEN);
