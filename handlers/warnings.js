// Warnings handlers: warnings:refresh (button)

const { buildWarningsListEmbed, buildRefreshRow } = require('../commands/Moderation/warnings');
const { err } = require('../utils/logger');

const ID = 'warnings:refresh';

function match(interaction) {
  return interaction.isButton() && interaction.customId === ID;
}

async function execute(interaction) {
  try {
    const { embed, empty } = await buildWarningsListEmbed(interaction.guild);

    if (empty) {
      return interaction.update({ content: 'No members have any warnings.', embeds: [], components: [] });
    }

    return interaction.update({ embeds: [embed], components: [buildRefreshRow()] });
  } catch (error) {
    err(error, { tag: 'handlers:warnings', customId: interaction.customId, userId: interaction.user.id });
    throw error;
  }
}

module.exports = { match, execute };