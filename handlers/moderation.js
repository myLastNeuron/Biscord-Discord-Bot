// Moderation handlers: warnings:refresh (already in warnings.js), warnings modal/flow if any

const { MessageFlags } = require('discord.js');
const { getGuildSettings, addWarning, removeWarning, clearWarnings } = require('../utils/db');
const { buildWarningEmbed, buildWarningComponents } = require('../utils/rosterBuilder'); // reuse roster builder or create moderation builder
const { err } = require('../utils/logger');

function match(interaction) {
  // This handler covers any moderation-specific interactions not already handled
  // Currently warnings:refresh is in warnings.js
  // Future: warning modals, ban/kick modals, etc.
  if (interaction.isButton() && interaction.customId === 'moderation:refresh') return true;
  if (interaction.isModalSubmit() && interaction.customId.startsWith('moderation:')) return true;
  return false;
}

async function execute(interaction) {
  const customId = interaction.customId;

  try {
    // Refresh warnings list
    if (customId === 'moderation:refresh') {
      const settings = getGuildSettings(interaction.guild.id);
      return interaction.update({
        content: '✅ Refreshed moderation panel.',
        components: [],
      });
    }

    // Future moderation modals would go here
    // e.g., moderation:banModal, moderation:kickModal, etc.

  } catch (error) {
    err(error, { tag: 'handlers:moderation', customId, userId: interaction.user.id });
    throw error;
  }
}

module.exports = { match, execute };