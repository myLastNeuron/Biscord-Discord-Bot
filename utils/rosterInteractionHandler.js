const { PermissionFlagsBits } = require('discord.js');
const { getEvent, saveEvent } = require('./db');
const { buildRosterEmbed, buildRosterButtons } = require('./rosterBuilder');
const { joinRoster, leaveRoster, toggleLock, recordLockAttendance } = require('./rosterActions');

// Roster panel buttons: roster:join:<eventId>, roster:leave:<eventId>, roster:lock:<eventId>
async function handleRosterInteraction(interaction) {
  if (!(interaction.isButton() && interaction.customId.startsWith('roster:'))) return false;

  const [, action, eventId] = interaction.customId.split(':');
  const event = getEvent(eventId);

  if (!event) {
    await interaction.reply({ content: 'This event panel no longer exists.', ephemeral: true });
    return true;
  }

  // Cross-guild guard: rosters are keyed by a global event ID, so verify the
  // panel actually belongs to the guild it's being used in.
  if (event.guildId && event.guildId !== interaction.guild.id) {
    await interaction.reply({ content: 'This event panel belongs to another server.', ephemeral: true });
    return true;
  }
  event.attendedRecorded ??= []; // backward-compat for panels created before stats tracking existed

  if (action === 'join') {
    if (event.locked) {
      await interaction.reply({ content: 'This roster is currently locked.', ephemeral: true });
      return true;
    }
    const { result } = joinRoster(event, interaction.user.id);
    const messages = {
      'joined-main': 'You joined the main roster! ✅',
      'joined-sub': 'Main roster is full — you were added as a sub. 🪑',
      'already-in': 'You are already on this roster.',
      full: 'This roster is completely full.',
    };
    if (result === 'joined-main' || result === 'joined-sub') {
      // Attendance is no longer credited here — only at lock time (see the
      // 'lock' branch and scheduler.js's auto-lock sweep), once via
      // recordLockAttendance. That way someone who joins and leaves before
      // the roster locks never gets credit for the event.
      event.editedAt = Date.now();
      saveEvent(eventId, event);
      await interaction.update({ embeds: [buildRosterEmbed(event, interaction.guild)], components: buildRosterButtons(eventId, event.locked) });
      await interaction.followUp({ content: messages[result], ephemeral: true });
      return true;
    }
    await interaction.reply({ content: messages[result], ephemeral: true });
    return true;
  }

  if (action === 'leave') {
    if (event.locked) {
      await interaction.reply({ content: 'This roster is locked — leaving is disabled.', ephemeral: true });
      return true;
    }
    const { result, promotedUserId } = leaveRoster(event, interaction.user.id);
    if (result === 'not-in') {
      await interaction.reply({ content: 'You are not on this roster.', ephemeral: true });
      return true;
    }
    // promotedUserId (a sub bumped into the opened main slot) is not
    // credited here — only if they're still in a main slot when the
    // roster locks.
    event.editedAt = Date.now();
    saveEvent(eventId, event);
    await interaction.update({ embeds: [buildRosterEmbed(event, interaction.guild)], components: buildRosterButtons(eventId, event.locked) });
    await interaction.followUp({ content: 'You left the roster.', ephemeral: true });
    return true;
  }

  if (action === 'lock') {
    const isHost = interaction.user.id === event.hostId;
    const isMod = interaction.memberPermissions?.has(PermissionFlagsBits.ManageEvents);
    if (!isHost && !isMod) {
      await interaction.reply({ content: 'Only the host or an event manager can lock/unlock this roster.', ephemeral: true });
      return true;
    }
    toggleLock(event);
    if (event.locked) recordLockAttendance(event); // credit anyone still in a main slot right now
    event.editedAt = Date.now();
    saveEvent(eventId, event);
    await interaction.update({ embeds: [buildRosterEmbed(event, interaction.guild)], components: buildRosterButtons(eventId, event.locked) });
    return true;
  }

  // Unrecognized roster: action — original code fell through silently here.
  return false;
}

module.exports = { handleRosterInteraction };
