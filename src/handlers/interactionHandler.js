const { EmbedBuilder } = require('discord.js');
const db = require('../services/database');
const alphabot = require('../services/alphabot');
const { clearSessionCache } = require('../services/autoEnter');
const {
  buildSharedPanel, buildUserStatus, buildApiKeyModal,
  buildBlocklistModal, buildSettingsModal
} = require('../utils/panelBuilder');

async function handleInteraction(interaction, client) {
  const userId = interaction.user.id;
  const username = interaction.user.username;

  // ── BUTTONS ──────────────────────────────────────────────────
  if (interaction.isButton()) {

    // Modals must fire immediately — no defer
    if (interaction.customId === 'submit_api_key') return interaction.showModal(buildApiKeyModal());
    if (interaction.customId === 'manage_blocklist_add') return interaction.showModal(buildBlocklistModal());
    if (interaction.customId === 'settings') {
      const user = await db.getUser(userId);
      return interaction.showModal(buildSettingsModal(user));
    }

    // All other buttons — defer ephemerally so only the clicking user sees the response
    await interaction.deferReply({ ephemeral: true });
    await db.upsertUser(userId, username);
    const user = await db.getUser(userId);

    switch (interaction.customId) {

      case 'start': {
        if (!user?.alphabot_api_key) {
          return interaction.editReply({ content: '⚠️ You haven\'t set up your API key yet!\nClick **📝 Submit API Key** first.' });
        }
        await db.setRunning(userId, true);
        clearSessionCache(userId);
        const updated = await db.getUser(userId);
        return interaction.editReply({
          content: `🟢 **Auto-enter started!**\n\nYou'll get a DM update every 15 minutes.\n\n${buildUserStatus(updated).data.description}`,
          embeds: [buildUserStatus(updated)]
        });
      }

      case 'stop': {
        await db.setRunning(userId, false);
        const updated = await db.getUser(userId);
        return interaction.editReply({
          content: '🔴 **Auto-enter stopped.**',
          embeds: [buildUserStatus(updated)]
        });
      }

      case 'mode_all': {
        await db.setMode(userId, 'all');
        const updated = await db.getUser(userId);
        return interaction.editReply({ content: '🌐 Mode set to **All Raffles**.', embeds: [buildUserStatus(updated)] });
      }

      case 'mode_communities': {
        await db.setMode(userId, 'communities');
        const updated = await db.getUser(userId);
        return interaction.editReply({ content: '👥 Mode set to **My Communities**.', embeds: [buildUserStatus(updated)] });
      }

      case 'mode_custom': {
        await db.setMode(userId, 'custom');
        const updated = await db.getUser(userId);
        return interaction.editReply({ content: '📌 Mode set to **Custom Teams**. Use `/setteams` to add IDs.', embeds: [buildUserStatus(updated)] });
      }

      case 'my_status': {
        return interaction.editReply({ embeds: [buildUserStatus(user)] });
      }

      case 'manage_blocklist': {
        const list = await db.getBlocklist(userId);
        const lines = list.length > 0
          ? list.map(b => `**${b.type}:** ${b.value} — ID: \`${b.id}\``).join('\n')
          : '_Nothing blocked yet._';
        const embed = new EmbedBuilder()
          .setTitle('🚫 Your Blocklist')
          .setDescription(lines + '\n\nUse `/block` to add and `/unblock <id>` to remove.')
          .setColor(0xed4245);
        return interaction.editReply({ embeds: [embed] });
      }

      case 'stats': {
        const { user: u, recent } = await db.getStats(userId);
        const lines = recent.length > 0
          ? recent.map(r => `${r.status === 'won' ? '🏆' : '✅'} **${r.raffle_name}**`).join('\n')
          : '_No entries yet. Click Start to begin!_';
        const embed = new EmbedBuilder()
          .setTitle('📊 Your Stats').setColor(0x5865f2)
          .addFields(
            { name: '🎟 Entered', value: String(u?.total_entered || 0), inline: true },
            { name: '🏆 Won', value: String(u?.total_won || 0), inline: true },
            { name: '📈 Win Rate', value: u?.total_entered > 0 ? `${((u.total_won / u.total_entered) * 100).toFixed(1)}%` : 'N/A', inline: true },
            { name: 'Recent Entries', value: lines }
          ).setTimestamp();
        return interaction.editReply({ embeds: [embed] });
      }

      case 'logs': {
        const { recent } = await db.getStats(userId);
        const lines = recent.length > 0
          ? recent.map(r => `${r.status === 'won' ? '🏆' : '✅'} **${r.raffle_name}** — ${r.entered_at?.slice(0,16)} UTC`).join('\n')
          : '_No logs yet._';
        const embed = new EmbedBuilder().setTitle('📋 Entry Logs (Last 10)').setDescription(lines).setColor(0x57f287).setTimestamp();
        return interaction.editReply({ embeds: [embed] });
      }

      case 'remove_data': {
        await db.removeUser(userId);
        clearSessionCache(userId);
        return interaction.editReply({ content: '🗑️ All your data has been wiped. You can start fresh anytime.' });
      }

      default:
        return interaction.editReply({ content: '❓ Unknown action.' });
    }
  }

  // ── MODALS ────────────────────────────────────────────────────
  if (interaction.isModalSubmit()) {
    await interaction.deferReply({ ephemeral: true });
    await db.upsertUser(userId, username);

    switch (interaction.customId) {

      case 'modal_api_key': {
        const apiKey = interaction.fields.getTextInputValue('api_key_input').trim();
        const forwardWebhook = interaction.fields.getTextInputValue('forward_webhook').trim();
        const validation = await alphabot.validateApiKey(apiKey);
        if (!validation.valid) {
          return interaction.editReply({ content: `❌ **Invalid API key:** ${validation.error}\n\nMake sure you copied the full key from alphabot.app → Settings → Developer settings.` });
        }
        await db.setApiKey(userId, apiKey);
        if (forwardWebhook) await db.setForwardWebhook(userId, forwardWebhook);
        const updated = await db.getUser(userId);
        return interaction.editReply({
          content: '✅ **API key saved!** Click **🟢 Start** to begin auto-entering raffles.',
          embeds: [buildUserStatus(updated)]
        });
      }

      case 'modal_add_blocklist': {
        const type = interaction.fields.getTextInputValue('block_type').trim().toLowerCase();
        const value = interaction.fields.getTextInputValue('block_value').trim();
        if (!['project', 'team'].includes(type)) {
          return interaction.editReply({ content: '⚠️ Type must be **project** or **team**.' });
        }
        await db.addToBlocklist(userId, type, value);
        return interaction.editReply({ content: `🚫 Blocked **${type}**: ${value}\n\nView your blocklist by clicking **🚫 Blocklist** on the panel.` });
      }

      case 'modal_settings': {
        const delayMin = parseInt(interaction.fields.getTextInputValue('delay_min')) || 3;
        const delayMax = parseInt(interaction.fields.getTextInputValue('delay_max')) || 8;
        const instantFcfs = interaction.fields.getTextInputValue('instant_fcfs').trim().toLowerCase() === 'yes';
        const forwardWebhook = interaction.fields.getTextInputValue('forward_webhook').trim();
        await db.setDelay(userId, delayMin, delayMax);
        await db.setInstantFcfs(userId, instantFcfs);
        if (forwardWebhook) await db.setForwardWebhook(userId, forwardWebhook);
        const updated = await db.getUser(userId);
        return interaction.editReply({
          content: `✅ **Settings saved!**`,
          embeds: [buildUserStatus(updated)]
        });
      }

      default:
        return interaction.editReply({ content: '❓ Unknown action.' });
    }
  }
}

module.exports = { handleInteraction };
