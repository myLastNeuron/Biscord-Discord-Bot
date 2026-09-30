const { refreshUpcomingBoard } = require('./upcomingBoard');

// Public "Refresh" button on the posted upcoming-rosters board message.
async function handleUpcomingBoardInteraction(interaction) {
  if (interaction.isButton() && interaction.customId === 'upcomingBoard:refresh') {
    await interaction.deferUpdate().catch(() => null);
    await refreshUpcomingBoard(interaction.client, interaction.guild.id).catch((err) =>
      console.error('[upcomingBoard] manual refresh failed:', err)
    );
    return true;
  }

  return false;
}

module.exports = { handleUpcomingBoardInteraction };
