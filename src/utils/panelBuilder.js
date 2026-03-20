const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

/**
 * Build the main control panel embed + buttons
 */
function buildControlPanel(user) {
  const hasKey = !!user?.alphabot_api_key;
  const isRunning = !!user?.is_running;
  const mode = user?.mode || 'all';
  const delay = user?.delay_seconds || 5;

  const modeLabel = {
    all: '🌐 All Raffles',
    communities: '👥 My Communities',
    custom: '📌 Custom Teams',
  }[mode] || '🌐 All Raffles';

  const embed = new EmbedBuilder()
    .setTitle('🤖 AlphaBot Auto-Enter Bot')
    .setDescription(
      hasKey
        ? `✅ **API Key connected**\n📡 **Status:** ${isRunning ? '🟢 Running' : '🔴 Stopped'}\n🎯 **Mode:** ${modeLabel}\n⏱ **Delay:** ${delay}s between entries`
        : '⚠️ **No API Key set.**\nClick Submit API Key & Webhook to get started.'
    )
    .setColor(isRunning ? 0x57f287 : hasKey ? 0xed4245 : 0xfee75c)
    .setFooter({ text: 'AlphaBot Auto-Enter • Made with ❤️' })
    .setTimestamp();

  // Row 1: API Key submit
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('submit_api_key')
      .setLabel('Submit API Key & Webhook')
      .setEmoji('📝')
      .setStyle(ButtonStyle.Primary)
  );

  // Row 2: Start / Stop
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('start')
      .setLabel('Start')
      .setEmoji('🟢')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!hasKey || isRunning),
    new ButtonBuilder()
      .setCustomId('stop')
      .setLabel('Stop')
      .setEmoji('🔴')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!isRunning)
  );

  // Row 3: Mode selection
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('mode_all')
      .setLabel('All Raffles')
      .setEmoji('🌐')
      .setStyle(mode === 'all' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('mode_communities')
      .setLabel('My Communities')
      .setEmoji('👥')
      .setStyle(mode === 'communities' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('custom_teams')
      .setLabel('Custom Teams')
      .setEmoji('📌')
      .setStyle(mode === 'custom' ? ButtonStyle.Primary : ButtonStyle.Secondary)
  );

  // Row 4: Input team IDs / Stats / Setup / Delay
  const row4 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('input_team_ids')
      .setLabel('Input Custom Team IDs')
      .setEmoji('🪪')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('stats')
      .setLabel('Stats')
      .setEmoji('📊')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('delay')
      .setLabel('Delay')
      .setEmoji('⏱')
      .setStyle(ButtonStyle.Secondary)
  );

  // Row 5: Remove data
  const row5 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('remove_data')
      .setLabel('Remove My Data')
      .setEmoji('🗑️')
      .setStyle(ButtonStyle.Danger)
  );

  return { embeds: [embed], components: [row1, row2, row3, row4, row5] };
}

// ── Modals ───────────────────────────────────────────────────────────────────

function buildApiKeyModal() {
  return new ModalBuilder()
    .setCustomId('modal_api_key')
    .setTitle('Connect Your Alphabot Account')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('api_key_input')
          .setLabel('Alphabot API Key')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Paste your API key from alphabot.app - Settings - API')
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('webhook_input')
          .setLabel('Webhook URL (optional)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('https://discord.com/api/webhooks/...')
          .setRequired(false)
      )
    );
}

function buildTeamIdsModal(current = '') {
  return new ModalBuilder()
    .setCustomId('modal_team_ids')
    .setTitle('Input Custom Team IDs')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('team_ids_input')
          .setLabel('Team IDs (comma-separated)')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('id1,id2,id3  —  or paste a URL with alphas=...&alphas=...')
          .setValue(current)
          .setRequired(true)
      )
    );
}

function buildDelayModal(current = 5) {
  return new ModalBuilder()
    .setCustomId('modal_delay')
    .setTitle('Set Entry Delay')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('delay_input')
          .setLabel('Seconds between each raffle entry')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g. 5')
          .setValue(String(current))
          .setRequired(true)
      )
    );
}

module.exports = {
  buildControlPanel,
  buildApiKeyModal,
  buildTeamIdsModal,
  buildDelayModal,
};
