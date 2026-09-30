const { PermissionFlagsBits } = require('discord.js');
const { buildWarningsListEmbed, buildRefreshRow } = require('../commands/Moderation/warnings');

// Refresh button on the posted /warnings list embed.
async function handleWarningsInteraction(interaction) {
  if (!(interaction.isButton() && interaction.customId === 'warnings:refresh')) return false;

  // The refresh button can be clicked by anyone who can see the embed — make
  // sure only members with the same permission as the /warnings command can
  // refresh (and sees the private list).
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
    await interaction.reply({
      content: 'You do not have permission to view warnings.',
      ephemeral: true,
    });
    return true;
  }

  const { embed, empty } = await buildWarningsListEmbed(interaction.guild);

  if (empty) {
    await interaction.update({ content: 'No members have any warnings.', embeds: [], components: [] });
    return true;
  }

  await interaction.update({ embeds: [embed], components: [buildRefreshRow()] });
  return true;
}

module.exports = { handleWarningsInteraction };
