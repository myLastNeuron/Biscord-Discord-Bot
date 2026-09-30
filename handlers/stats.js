// Stats handlers: panel:statsPanel:selectUser (user select), panel:statsPanel:clearConfirm,
// panel:statsPanel:clearExecute, panel:statsPanel:selectUser (back from confirm)

const { getUserStats, clearUserStats } = require('../utils/db');
const { buildStatsEmbed } = require('../utils/statsBuilder');
const { buildStatsPanelPickerEmbed, buildStatsPanelPickerComponents, buildStatsPanelDetailComponents, buildStatsPanelClearConfirmEmbed, buildStatsPanelClearConfirmComponents } = require('../utils/panelBuilder');
const { err } = require('../utils/logger');

function match(interaction) {
  if (interaction.isUserSelectMenu() && interaction.customId === 'panel:statsPanel:selectUser') return true;
  if (interaction.customId.startsWith('panel:statsPanel:clearConfirm:')) return true;
  if (interaction.customId.startsWith('panel:statsPanel:clearExecute:')) return true;
  if (interaction.customId.startsWith('panel:statsPanel:selectUser:')) return true;
  return false;
}

async function execute(interaction) {
  const customId = interaction.customId;

  try {
    // User select menu from picker
    if (interaction.isUserSelectMenu() && customId === 'panel:statsPanel:selectUser') {
      const targetId = interaction.values[0];
      const targetUser = await interaction.client.users.fetch(targetId).catch(() => null);
      if (!targetUser) return interaction.reply({ content: 'Could not find that user.', ephemeral: true });
      const stats = getUserStats(interaction.guild.id, targetId);
      return interaction.update({
        embeds: [buildStatsEmbed(targetUser, stats)],
        components: buildStatsPanelDetailComponents(targetId),
      });
    }

    // Clear confirm
    if (customId.startsWith('panel:statsPanel:clearConfirm:')) {
      const targetId = customId.split(':')[3];
      const targetUser = await interaction.client.users.fetch(targetId).catch(() => null);
      if (!targetUser) return interaction.reply({ content: 'Could not find that user.', ephemeral: true });
      return interaction.update({
        embeds: [buildStatsPanelClearConfirmEmbed(targetUser)],
        components: buildStatsPanelClearConfirmComponents(targetId),
      });
    }

    // Clear execute
    if (customId.startsWith('panel:statsPanel:clearExecute:')) {
      const targetId = customId.split(':')[3];
      const targetUser = await interaction.client.users.fetch(targetId).catch(() => null);
      clearUserStats(interaction.guild.id, targetId);
      const stats = getUserStats(interaction.guild.id, targetId);
      return interaction.update({
        content: targetUser ? `🗑️ Cleared **${targetUser.tag}**'s event history.` : '🗑️ Cleared that user\'s event history.',
        embeds: targetUser ? [buildStatsEmbed(targetUser, stats)] : [],
        components: targetUser ? buildStatsPanelDetailComponents(targetId) : buildStatsPanelPickerComponents(),
      });
    }

    // Back from clear confirm (selectUser:targetId)
    if (customId.startsWith('panel:statsPanel:selectUser:')) {
      const targetId = customId.split(':')[3];
      const targetUser = await interaction.client.users.fetch(targetId).catch(() => null);
      if (!targetUser) return interaction.reply({ content: 'Could not find that user.', ephemeral: true });
      const stats = getUserStats(interaction.guild.id, targetId);
      return interaction.update({
        embeds: [buildStatsEmbed(targetUser, stats)],
        components: buildStatsPanelDetailComponents(targetId),
      });
    }
  } catch (error) {
    err(error, { tag: 'handlers:stats', customId, userId: interaction.user.id });
    throw error;
  }
}

module.exports = { match, execute };