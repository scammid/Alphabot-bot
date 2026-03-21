const { EmbedBuilder } = require('discord.js');
const db = require('../services/database');
const alphabot = require('../services/alphabot');
const { clearSessionCache } = require('../services/autoEnter');
const {
  buildControlPanel,
  buildApiKeyModal,
} = require('../utils/panelBuilder');

function parseTeamIds(input) {
  if (input.includes('alphas=')) {
    const matches = [...input.matchAll(/alphas=([^&\s]+)/g)].map(m => m[1]);
    return matches.join(',');
  }
  return input.split(',').map(s => s.trim()).filter(Boolean).join(',');
}

// Update the panel embed in place
async function refreshPanel(interaction, client, userId) {
  try {
    const updated = await db.getUser(userId);
    await interaction.message.edit(buildControlPanel(updated));
  } catch (err) {
    console.error('[Panel] Failed to refresh panel:', err.message);
  }
}

async function handleInteraction(interaction, client) {
  const userId = interaction.user.id;
  const username = interaction.user.username;

  // ── BUTTONS ──────────────────────────────────────────────────
  if (interaction.isButton()) {

    // Submit API Key — must show modal IMMEDIATELY, no defer allowed
    if (interaction.customId === 'submit_api_key') {
      return interaction.showModal(buildApiKeyModal());
    }

    // All other buttons — defer immediately to prevent timeout
    try {
      await interaction.deferUpdate();
    } catch (_) {
      return; // Already acknowledged
    }

    await db.upsertUser(userId, username);
    const user = await db.getUser(userId);

    switch (interaction.customId) {

      case 'start': {
        if (!user.alphabot_api_key) {
          return interaction.followUp({ content: '⚠️ Please submit your API key first!', ephemeral: true });
        }
        await db.setRunning(userId, true);
        clearSessionCache(userId);
        await refreshPanel(interaction, client, userId);
        return interaction.followUp({ content: '🟢 Auto-enter started! Raffles will be entered every 2 minutes.', ephemeral: true });
      }

      case 'stop': {
        await db.setRunning(userId, false);
        await refreshPanel(interaction, client, userId);
        return interaction.followUp({ content: '🔴 Auto-enter stopped.', ephemeral: true });
      }

      case 'mode_all': {
        await db.setMode(userId, 'all');
        await refreshPanel(interaction, client, userId);
        return interaction.followUp({ content: '🌐 Mode set to All Raffles.', ephemeral: true });
      }

      case 'mode_communities': {
        await db.setMode(userId, 'communities');
        await refreshPanel(interaction, client, userId);
        return interaction.followUp({ content: '👥 Mode set to My Communities.', ephemeral: true });
      }

      case 'custom_teams': {
        await db.setMode(userId, 'custom');
        await refreshPanel(interaction, client, userId);
        return interaction.followUp({ content: '📌 Mode set to Custom Teams. Now click **Input Custom Team IDs** to add your team IDs.', ephemeral: true });
      }

      case 'input_team_ids': {
        return interaction.followUp({
          content: '📌 Please type your team IDs as comma-separated values (e.g. `id1,id2,id3`) or paste a URL with `alphas=` params. Then use `/setteams <ids>` to save them.',
          ephemeral: true
        });
      }

      case 'delay': {
        return interaction.followUp({
          content: `⏱ Current delay: **${user.delay_seconds || 5}s** between entries.\nUse \`/setdelay <seconds>\` to change it (1-300).`,
          ephemeral: true
        });
      }

      case 'stats': {
        const { user: u, recent } = await db.getStats(userId);
        const lines = recent.length > 0
          ? recent.map(r => {
              const icon = r.status === 'won' ? '🏆' : r.status === 'failed' ? '❌' : '✅';
              return `${icon} **${r.raffle_name}** — ${r.team_name}`;
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

        return interaction.followUp({ embeds: [embed], ephemeral: true });
      }

      case 'remove_data': {
        await db.removeUser(userId);
        clearSessionCache(userId);
        await refreshPanel(interaction, client, userId);
        return interaction.followUp({ content: '🗑️ All your data has been wiped.', ephemeral: true });
      }

      default:
        return interaction.followUp({ content: '❓ Unknown action.', ephemeral: true });
    }
  }

  // ── MODALS ────────────────────────────────────────────────────
  if (interaction.isModalSubmit()) {
    // Defer immediately to avoid timeout during API validation
    await interaction.deferReply({ ephemeral: true });
    await db.upsertUser(userId, username);

    if (interaction.customId === 'modal_api_key') {
      const apiKey = interaction.fields.getTextInputValue('api_key_input').trim();
      const webhookUrl = interaction.fields.getTextInputValue('webhook_input').trim();

      // Validate the API key
      const validation = await alphabot.validateApiKey(apiKey);
      if (!validation.valid) {
        return interaction.editReply({ content: `❌ Invalid API key: ${validation.error}\n\nMake sure you copied the full key from alphabot.app - Settings - API.` });
      }

      await db.setApiKey(userId, apiKey, webhookUrl || null);

      // Find and refresh the panel message
      try {
        const messages = await interaction.channel.messages.fetch({ limit: 25 });
        const panelMsg = messages.find(m => m.author.id === client.user.id && m.embeds.length > 0);
        if (panelMsg) {
          const updated = await db.getUser(userId);
          await panelMsg.edit(buildControlPanel(updated));
        }
      } catch (err) {
        console.error('[Panel] Could not refresh after API key save:', err.message);
      }

      return interaction.editReply({ content: '✅ API key validated and saved!\n\nNow click **🟢 Start** on the panel to begin auto-entering raffles.' });
    }
  }
}

module.exports = { handleInteraction };
