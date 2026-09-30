// Roster handlers: roster:join / roster:leave / roster:lock

const { getEvent, saveEvent } = require('../utils/db');
const { buildRosterEmbed, buildRosterButtons } = require('../utils/rosterBuilder');
const { joinRoster, leaveRoster, toggleLock, recordLockAttendance } = require('../utils/rosterActions');
const { PermissionFlagsBits } = require('discord.js');
const { info, err } = require('../utils/logger');

const PREFIX = 'roster:';

function match(interaction) {
  return interaction.isButton() && interaction.customId.startsWith(PREFIX);
}

async function execute(interaction) {
  const [, action, eventId] = interaction.customId.split(':');
  const event = getEvent(eventId);

  if (!event) {
    return interaction.reply({ content: 'This event panel no longer exists.', ephemeral: true });
  }
  event.attendedRecorded ??= [];

  try {
    if (action === 'join') {
      if (event.locked) return interaction.reply({ content: 'This roster is currently locked.', ephemeral: true });
      const { result } = joinRoster(event, interaction.user.id);
      const messages = {
        'joined-main': 'You joined the main roster! ✅',
        'joined-sub': 'Main roster is full — you were added as a sub. 🪑',
        'already-in': 'You are already on this roster.',
        full: 'This roster is completely full.',
      };
      if (result === 'joined-main' || result === 'joined-sub') {
        event.editedAt = Date.now();
        saveEvent(eventId, event);
        await interaction.update({ embeds: [buildRosterEmbed(event, interaction.guild)], components: buildRosterButtons(eventId, event.locked) });
        return interaction.followUp({ content: messages[result], ephemeral: true });
      }
      return interaction.reply({ content: messages[result], ephemeral: true });
    }

    if (action === 'leave') {
      if (event.locked) return interaction.reply({ content: 'This roster is locked — leaving is disabled.', ephemeral: true });
      const { result, promotedUserId } = leaveRoster(event, interaction.user.id);
      if (result === 'not-in') {
        return interaction.reply({ content: 'You are not on this roster.', ephemeral: true });
      }
      event.editedAt = Date.now();
      saveEvent(eventId, event);
      await interaction.update({ embeds: [buildRosterEmbed(event, interaction.guild)], components: buildRosterButtons(eventId, event.locked) });
      return interaction.followUp({ content: 'You left the roster.', ephemeral: true });
    }

    if (action === 'lock') {
      const isHost = interaction.user.id === event.hostId;
      const isMod = interaction.memberPermissions?.has(PermissionFlagsBits.ManageEvents);
      if (!isHost && !isMod) {
        return interaction.reply({ content: 'Only the host or an event manager can lock/unlock this roster.', ephemeral: true });
      }
      toggleLock(event);
      if (event.locked) recordLockAttendance(event);
      event.editedAt = Date.now();
      saveEvent(eventId, event);
      await interaction.update({ embeds: [buildRosterEmbed(event, interaction.guild)], components: buildRosterButtons(eventId, event.locked) });
      return;
    }
  } catch (error) {
    err(error, { tag: 'handlers:roster', customId: interaction.customId, eventId, userId: interaction.user.id });
    throw error;
  }
}

module.exports = { match, execute };