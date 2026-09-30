// Handles the poll system's two interactions: casting a vote via the select
// menu on a posted poll, and staff ending a poll early via the "End Poll"
// button. Extracted from events/interactionCreate.js — follows the same
// handle*Interaction(interaction) => boolean pattern used by
// embedInteractionHandler.js, manualReactHandler.js, and
// ticketInteractionHandler.js.
const { PermissionFlagsBits, MessageFlags } = require('discord.js');
const { castVote, finalizePoll } = require('../utils/pollManager');
const { getPoll } = require('../utils/db');
const { buildPollEmbed, buildPollComponents } = require('../utils/pollBuilder');

// ---------- Polls: public vote select menu on a posted poll ----------
async function handlePollVote(interaction) {
  const token = interaction.customId.split(':')[2];

  // Cross-guild guard: polls are keyed by a global token.
  const existing = getPoll(token);
  if (existing && existing.guildId !== interaction.guild.id) {
    return interaction.reply({ content: '❌ This poll belongs to another server.', flags: MessageFlags.Ephemeral }).catch(() => null);
  }

  const { poll, error } = castVote(token, interaction.user.id, interaction.values);

  if (error === 'not_found') {
    return interaction.reply({ content: '❌ This poll no longer exists.', flags: MessageFlags.Ephemeral }).catch(() => null);
  }
  if (error === 'ended') {
    return interaction.reply({ content: '⏰ This poll has already ended.', flags: MessageFlags.Ephemeral }).catch(() => null);
  }
  if (error === 'invalid_option') {
    return interaction.reply({ content: '❌ That option is no longer valid.', flags: MessageFlags.Ephemeral }).catch(() => null);
  }

  return interaction.update({
    embeds: [buildPollEmbed(poll)],
    components: buildPollComponents(poll),
  }).catch(() => null);
}

// ---------- Polls: "End Poll" button on a posted poll ----------
// Not gated by the /poll command's default member permissions, since this is
// a separate interaction on an already-posted public message — anyone can
// see and click it, so the permission check has to happen here explicitly,
// not just at the slash-command level.
async function handlePollEndNow(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
    return interaction.reply({ content: "❌ You need the **Manage Messages** permission to end this poll.", flags: MessageFlags.Ephemeral }).catch(() => null);
  }

  const token = interaction.customId.split(':')[2];

  const existing = getPoll(token);
  if (existing && existing.guildId !== interaction.guild.id) {
    return interaction.reply({ content: '❌ This poll belongs to another server.', flags: MessageFlags.Ephemeral }).catch(() => null);
  }

  const updated = await finalizePoll(interaction.client, token);
  if (!updated) {
    return interaction.reply({ content: '❌ This poll no longer exists.', flags: MessageFlags.Ephemeral }).catch(() => null);
  }

  return interaction.update({
    embeds: [buildPollEmbed(updated)],
    components: buildPollComponents(updated),
  }).catch(() => null);
}

// Entry point matching the codebase's existing handle*Interaction(interaction)
// => boolean convention. Returns true if this module handled the
// interaction (caller should stop processing / return), false otherwise.
async function handlePollInteraction(interaction) {
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('poll:vote:')) {
    await handlePollVote(interaction);
    return true;
  }

  if (interaction.isButton() && interaction.customId.startsWith('poll:endNow:')) {
    await handlePollEndNow(interaction);
    return true;
  }

  return false;
}

module.exports = { handlePollInteraction };
