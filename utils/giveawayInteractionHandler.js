// Handles the giveaway system's public "Enter" button on a posted giveaway
// message. Extracted from events/interactionCreate.js — follows the same
// handle*Interaction(interaction) => boolean pattern used by
// ticketInteractionHandler.js and pollInteractionHandler.js.
//
// NOTE: This does NOT cover panel:giveawayEndNow: or panel:giveawayReroll:,
// which are staff actions on the /panel dashboard and currently live nested
// inside interactionCreate.js's large shared `panel:` button block. Those
// are left untouched for now — extracting them means pulling branches out
// of a big shared conditional, which is riskier and deserves its own
// careful pass rather than being bundled into this change.
const { MessageFlags } = require('discord.js');
const { getGiveaway, updateGiveaway, getGuildSettings } = require('../utils/db');
const { buildGiveawayEmbed, buildGiveawayButtons } = require('../utils/giveawayBuilder');

// ---------- Giveaways: public "Enter" button on a posted giveaway ----------
async function handleGiveawayEnter(interaction) {
  const token = interaction.customId.split(':')[2];
  const giveaway = getGiveaway(token);

  if (!giveaway || giveaway.status !== 'active') {
    return interaction.reply({ content: '⏰ This giveaway has already ended.', flags: MessageFlags.Ephemeral }).catch(() => null);
  }

  // Cross-guild guard: giveaways are keyed by a global token.
  if (giveaway.guildId !== interaction.guild.id) {
    return interaction.reply({ content: '❌ This giveaway belongs to another server.', flags: MessageFlags.Ephemeral }).catch(() => null);
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
}

// Entry point matching the codebase's existing handle*Interaction(interaction)
// => boolean convention. Returns true if this module handled the
// interaction (caller should stop processing / return), false otherwise.
async function handleGiveawayInteraction(interaction) {
  if (interaction.isButton() && interaction.customId.startsWith('giveaway:enter:')) {
    await handleGiveawayEnter(interaction);
    return true;
  }

  return false;
}

module.exports = { handleGiveawayInteraction };
