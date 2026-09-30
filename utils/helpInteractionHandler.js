const {
  buildHelpOverviewEmbed, buildHelpOverviewComponents,
  buildHelpCategoryEmbed, buildHelpCategoryComponents, getHelpCategory,
} = require('./helpBuilder');

// Routes the /help select-menu/button interactions:
//   help:category  -> show the chosen category's commands
//   help:overview  -> back to the full overview page
// Returns true if it handled the interaction, false otherwise (so the caller
// in interactionCreate.js can fall through to the other dispatch handlers).
async function handleHelpInteraction(interaction) {
  if (!interaction.isMessageComponent()) return false;
  if (typeof interaction.customId !== 'string' || !interaction.customId.startsWith('help:')) return false;

  try {
    if (interaction.isStringSelectMenu() && interaction.customId === 'help:category') {
      const category = getHelpCategory(interaction.values[0]);
      if (!category) return false;

      await interaction.update({
        embeds: [buildHelpCategoryEmbed(interaction.guild, category)],
        components: buildHelpCategoryComponents(category.key),
      });
      return true;
    }

    if (interaction.isButton() && interaction.customId === 'help:overview') {
      await interaction.update({
        embeds: [buildHelpOverviewEmbed(interaction.guild)],
        components: buildHelpOverviewComponents(),
      });
      return true;
    }
  } catch (err) {
    console.error('[help] Failed to handle interaction:', err.message);
    await interaction
      .deferUpdate()
      .catch(() => null);
  }

  return true;
}

module.exports = { handleHelpInteraction };