// Poll handlers: poll:vote (select menu), poll:endNow (button)

const { castVote, finalizePoll } = require('../utils/pollManager');
const { buildPollEmbed, buildPollComponents } = require('../utils/pollBuilder');
const { PermissionFlagsBits, MessageFlags } = require('discord.js');
const { err } = require('../utils/logger');

const VOTE_PREFIX = 'poll:vote:';
const END_PREFIX = 'poll:endNow:';

function match(interaction) {
  return (
    (interaction.isStringSelectMenu() && interaction.customId.startsWith(VOTE_PREFIX)) ||
    (interaction.isButton() && interaction.customId.startsWith(END_PREFIX))
  );
}

async function execute(interaction) {
  try {
    // Vote select menu
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith(VOTE_PREFIX)) {
      const token = interaction.customId.split(':')[2];
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

    // End Now button
    if (interaction.isButton() && interaction.customId.startsWith(END_PREFIX)) {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
        return interaction.reply({ content: "❌ You need the **Manage Messages** permission to end this poll.", flags: MessageFlags.Ephemeral }).catch(() => null);
      }

      const token = interaction.customId.split(':')[2];
      const updated = await finalizePoll(interaction.client, token);
      if (!updated) {
        return interaction.reply({ content: '❌ This poll no longer exists.', flags: MessageFlags.Ephemeral }).catch(() => null);
      }

      return interaction.update({
        embeds: [buildPollEmbed(updated)],
        components: buildPollComponents(updated),
      }).catch(() => null);
    }
  } catch (error) {
    err(error, { tag: 'handlers:poll', customId: interaction.customId, userId: interaction.user.id });
    throw error;
  }
}

module.exports = { match, execute };