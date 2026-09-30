// Upcoming board handlers: upcomingBoard:refresh (button)

const { refreshUpcomingBoard } = require('../utils/upcomingBoard');
const { err } = require('../utils/logger');

const ID = 'upcomingBoard:refresh';

function match(interaction) {
  return interaction.isButton() && interaction.customId === ID;
}

async function execute(interaction) {
  try {
    await interaction.deferUpdate().catch(() => null);
    await refreshUpcomingBoard(interaction.client, interaction.guild.id).catch((err) => console.error('[upcomingBoard] manual refresh failed:', err));
    return;
  } catch (error) {
    err(error, { tag: 'handlers:upcomingBoard', customId: interaction.customId, userId: interaction.user.id });
    throw error;
  }
}

module.exports = { match, execute };