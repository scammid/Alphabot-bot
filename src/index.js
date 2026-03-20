require('dotenv').config();
const { Client, GatewayIntentBits, Events, REST, Routes } = require('discord.js');
const { handleInteraction } = require('./handlers/interactionHandler');
const { buildControlPanel } = require('./utils/panelBuilder');
const { runLoop } = require('./services/autoEnter');
const db = require('./services/database');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ],
});

const commands = [
  { name: 'panel', description: 'Spawn the AlphaBot Auto-Enter control panel' },
  { name: 'setup', description: 'Info on how to get your Alphabot API key' },
  {
    name: 'setdelay',
    description: 'Set delay between raffle entries (1-300 seconds)',
    options: [{
      name: 'seconds',
      description: 'Delay in seconds',
      type: 4, // INTEGER
      required: true,
      min_value: 1,
      max_value: 300,
    }]
  },
  {
    name: 'setteams',
    description: 'Set custom team IDs to enter raffles for',
    options: [{
      name: 'ids',
      description: 'Comma-separated team IDs',
      type: 3, // STRING
      required: true,
    }]
  },
  {
    name: 'stats',
    description: 'View your raffle entry stats',
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

client.once(Events.ClientReady, async () => {
  console.log(`[Bot] Logged in as ${client.user.tag}`);
  await db.getAllRunningUsers();
  console.log('[Bot] Database ready.');
  await registerCommands();

  runLoop(async (discordId, stats) => {
    try {
      const user = await client.users.fetch(discordId);
      await user.send(
        `🎉 **Auto-Enter Update:**\n✅ Entered **${stats.entered}** new raffle(s)` +
        (stats.failed > 0 ? `\n❌ ${stats.failed} failed` : '') +
        (stats.skipped > 0 ? `\n⏭ ${stats.skipped} skipped (already entered or ineligible)` : '')
      );
    } catch (_) {}
  });
});

client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isChatInputCommand()) {

    if (interaction.commandName === 'panel') {
      await interaction.deferReply();
      const user = await db.getUser(interaction.user.id);
      const panel = buildControlPanel(user);
      await interaction.deleteReply();
      await interaction.channel.send(panel);
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
          '4. Come back here and click **📝 Submit API Key & Webhook**',
          '',
          '> ⚠️ Keep your API key private!',
        ].join('\n'),
      });
    }

    if (interaction.commandName === 'setdelay') {
      const seconds = interaction.options.getInteger('seconds');
      await db.upsertUser(interaction.user.id, interaction.user.username);
      await db.setDelay(interaction.user.id, seconds);
      // Refresh panel
      try {
        const messages = await interaction.channel.messages.fetch({ limit: 20 });
        const panelMsg = messages.find(m => m.author.id === client.user.id && m.embeds.length > 0);
        if (panelMsg) {
          const updated = await db.getUser(interaction.user.id);
          await panelMsg.edit(buildControlPanel(updated));
        }
      } catch (_) {}
      return interaction.reply({ content: `✅ Delay set to **${seconds} seconds** between entries.`, ephemeral: true });
    }

    if (interaction.commandName === 'setteams') {
      const ids = interaction.options.getString('ids');
      await db.upsertUser(interaction.user.id, interaction.user.username);
      await db.setCustomTeamIds(interaction.user.id, ids);
      return interaction.reply({ content: `✅ Custom team IDs saved! Mode set to Custom Teams.`, ephemeral: true });
    }

    if (interaction.commandName === 'stats') {
      await db.upsertUser(interaction.user.id, interaction.user.username);
      const { user: u, recent } = await db.getStats(interaction.user.id);
      const { EmbedBuilder } = require('discord.js');
      const lines = recent.length > 0
        ? recent.map(r => {
            const icon = r.status === 'won' ? '🏆' : r.status === 'failed' ? '❌' : '✅';
            return `${icon} **${r.raffle_name}**`;
          }).join('\n')
        : '_No entries yet. Click Start to begin!_';

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

  await handleInteraction(interaction, client);
});

client.on(Events.Error, err => console.error('[Bot] Client error:', err));
process.on('unhandledRejection', err => console.error('[Bot] Unhandled rejection:', err));

client.login(process.env.DISCORD_TOKEN);
