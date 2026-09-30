// Giveaway handlers: giveaway:enter (public join button)

const { getGiveaway, listGiveaways, updateGiveaway } = require('../utils/db');
const { getGuildSettings } = require('../utils/db');
const { buildGiveawayEmbed, buildGiveawayButtons } = require('../utils/giveawayBuilder');
const { MessageFlags } = require('discord.js');
const { err } = require('../utils/logger');

const PREFIX = 'giveaway:enter:';

function match(interaction) {
  return interaction.isButton() && interaction.customId.startsWith(PREFIX);
}

async function execute(interaction) {
  try {
    const token = interaction.customId.split(':')[2];
    const giveaway = getGiveaway(token);

    if (!giveaway || giveaway.status !== 'active') {
      return interaction.reply({ content: '⏰ This giveaway has already ended.', flags: MessageFlags.Ephemeral }).catch(() => null);
    }

    if (giveaway.entries.includes(interaction.user.id)) {
      return interaction.reply({ content: "✅ You're already entered in this giveaway. Good luck!", flags: MessageFlags.Ephemeral }).catch(() => null);
    }

    const updated = updateGiveaway(token, { entries: [...giveaway.entries, interaction.user.id] });
    const settings = getGuildSettings(interaction.guild.id);
    await interaction.message.edit({
      embeds: [buildGiveawayEmbed(updated, settings, interaction.guild)],
      components: buildGiveawayButtons(updated, settings),
    }).catch(() => null);

    return interaction.reply({ content: `🎉 You're entered for **${updated.prize}**! Good luck.`, flags: MessageFlags.Ephemeral }).catch(() => null);
  } catch (error) {
    err(error, { tag: 'handlers:giveaway', customId: interaction.customId, userId: interaction.user.id });
    throw error;
  }
}

module.exports = { match, execute };