const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');

// Shared panel shown in server — generic, not user-specific
function buildSharedPanel() {
  const embed = new EmbedBuilder()
    .setTitle('🤖 AlphaBot Auto-Enter')
    .setDescription(
      `Welcome to **AlphaBot Auto-Enter**!\n\n` +
      `This bot automatically enters Alphabot raffles for you 24/7.\n\n` +
      `**To get started:**\n` +
      `1️⃣ Click **📝 Submit API Key** below\n` +
      `2️⃣ Paste your key from alphabot.app → Settings → Developer settings\n` +
      `3️⃣ Click **🟢 Start** — the bot runs 24/7!\n\n` +
      `> All your settings and responses are **private** — only you can see them.`
    )
    .setColor(0x5865f2)
    .setFooter({ text: 'AlphaBot Auto-Enter • Click any button to manage your account' })
    .setTimestamp();

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('submit_api_key').setLabel('Submit API Key').setEmoji('📝').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('start').setLabel('Start').setEmoji('🟢').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('stop').setLabel('Stop').setEmoji('🔴').setStyle(ButtonStyle.Danger),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('mode_all').setLabel('All Raffles').setEmoji('🌐').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('mode_communities').setLabel('My Communities').setEmoji('👥').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('mode_custom').setLabel('Custom Teams').setEmoji('📌').setStyle(ButtonStyle.Secondary),
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('manage_blocklist').setLabel('Blocklist').setEmoji('🚫').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('manage_blocklist_add').setLabel('Block Project').setEmoji('➕').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('settings').setLabel('Settings').setEmoji('⚙️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('stats').setLabel('Stats').setEmoji('📊').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('logs').setLabel('Logs').setEmoji('📋').setStyle(ButtonStyle.Secondary),
  );

  const row4 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('my_status').setLabel('My Status').setEmoji('👤').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('remove_data').setLabel('Remove My Data').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
  );

  return { embeds: [embed], components: [row1, row2, row3, row4] };
}

// User-specific status embed (shown ephemerally when they click My Status)
function buildUserStatus(user) {
  const hasKey = !!user?.alphabot_api_key;
  const isRunning = !!user?.is_running;
  const mode = user?.mode || 'all';
  const delayMin = user?.delay_min || 3;
  const delayMax = user?.delay_max || 8;
  const instantFcfs = user?.instant_fcfs !== 0;
  const modeLabel = { all: '🌐 All Raffles', communities: '👥 My Communities', custom: '📌 Custom Teams' }[mode];

  return new EmbedBuilder()
    .setTitle('👤 Your Status')
    .setDescription(
      hasKey
        ? [
            `📡 **Status:** ${isRunning ? '🟢 Running' : '🔴 Stopped'}`,
            `🎯 **Mode:** ${modeLabel}`,
            `⏱ **Delay:** ${delayMin}-${delayMax}s ${instantFcfs ? '| ⚡ FCFS: Instant' : ''}`,
            `🎟 **Total Entered:** ${user?.total_entered || 0}`,
            `🏆 **Total Won:** ${user?.total_won || 0}`,
          ].join('\n')
        : '⚠️ No API key set. Click **📝 Submit API Key** to get started.'
    )
    .setColor(isRunning ? 0x57f287 : hasKey ? 0xed4245 : 0xfee75c)
    .setTimestamp();
}

function buildApiKeyModal() {
  return new ModalBuilder()
    .setCustomId('modal_api_key')
    .setTitle('Connect Alphabot Account')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('api_key_input').setLabel('Alphabot API Key')
          .setStyle(TextInputStyle.Short).setPlaceholder('From alphabot.app → Settings → Developer settings').setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('forward_webhook').setLabel('Forward Webhook (optional)')
          .setStyle(TextInputStyle.Short).setPlaceholder('Discord webhook URL for notifications').setRequired(false)
      )
    );
}

function buildBlocklistModal() {
  return new ModalBuilder()
    .setCustomId('modal_add_blocklist')
    .setTitle('Add to Blocklist')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('block_type').setLabel('Type: project or team')
          .setStyle(TextInputStyle.Short).setPlaceholder('project').setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('block_value').setLabel('Name or Team ID to block')
          .setStyle(TextInputStyle.Short).setPlaceholder('e.g. BoredApe or team123').setRequired(true)
      )
    );
}

function buildSettingsModal(user) {
  return new ModalBuilder()
    .setCustomId('modal_settings')
    .setTitle('Your Settings')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('delay_min').setLabel('Min delay between entries (seconds)')
          .setStyle(TextInputStyle.Short).setPlaceholder('3').setValue(String(user?.delay_min || 3)).setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('delay_max').setLabel('Max delay between entries (seconds)')
          .setStyle(TextInputStyle.Short).setPlaceholder('8').setValue(String(user?.delay_max || 8)).setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('instant_fcfs').setLabel('Instant FCFS? (yes/no)')
          .setStyle(TextInputStyle.Short).setPlaceholder('yes').setValue(user?.instant_fcfs !== 0 ? 'yes' : 'no').setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('forward_webhook').setLabel('Forward Webhook URL (optional)')
          .setStyle(TextInputStyle.Short).setPlaceholder('Discord webhook for notifications').setValue(user?.forward_webhook || '').setRequired(false)
      )
    );
}

module.exports = { buildSharedPanel, buildUserStatus, buildApiKeyModal, buildBlocklistModal, buildSettingsModal };
