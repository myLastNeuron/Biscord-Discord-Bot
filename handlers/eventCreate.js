// Event creation modal: eventCreate:<token>

const { MessageFlags } = require('discord.js');
const { getGuildSettings, getEvent, saveEvent, saveScheduledEvent } = require('../utils/db');
const { buildRosterEmbed, buildRosterButtons } = require('../utils/rosterBuilder');
const { joinRoster, leaveRoster, toggleLock, recordLockAttendance } = require('../utils/rosterActions');
const { err } = require('../utils/logger');

const PREFIX = 'eventCreate:';
const IMMEDIATE_THRESHOLD_MS = 15 * 1000;

function match(interaction) {
  return interaction.isModalSubmit() && interaction.customId.startsWith(PREFIX);
}

async function execute(interaction) {
  try {
    const token = interaction.customId.split(':')[1];
    const pending = interaction.client.pendingEventCreations?.get(token);
    interaction.client.pendingEventCreations?.delete(token);

    if (!pending) {
      return interaction.reply({ content: 'That creation session expired — please run /event create again.', ephemeral: true });
    }

    const channel = await interaction.guild.channels.fetch(pending.channelId).catch(() => null);
    if (!channel) return interaction.reply({ content: 'That channel no longer exists.', ephemeral: true });

    const title = interaction.fields.getTextInputValue('title');
    const description = interaction.fields.getTextInputValue('description') || '';
    const category = interaction.fields.getTextInputValue('category').trim();

    const [mainRaw, subRaw] = interaction.fields.getTextInputValue('slots').split(',').map((s) => s.trim());
    const mainSlots = Math.max(1, parseInt(mainRaw, 10) || 10);
    const subSlots = Math.max(0, parseInt(subRaw, 10) || 0);

    const lockAfterRaw = interaction.fields.getTextInputValue('lockAfter').trim();
    const lockAfterOverride = lockAfterRaw === '' ? null : Math.max(0, parseInt(lockAfterRaw, 10) || 0);

    const thumbnail = pending.thumbnail || null;
    const scheduledFor = pending.scheduledFor || null;

    const guildSettings = getGuildSettings(interaction.guild.id);
    const lockAfterMinutes = lockAfterOverride ?? guildSettings.rosterAutoLockMinutes ?? 15;

    const event = {
      guildId: interaction.guild.id,
      channelId: channel.id,
      hostId: interaction.user.id,
      hostTag: interaction.user.tag,
      title,
      description,
      category,
      thumbnail,
      scheduledFor,
      lockAfterMinutes,
      autoLockTriggered: false,
      mainSlots,
      subSlots,
      main: new Array(mainSlots).fill(null),
      subs: new Array(subSlots).fill(null),
      attendedRecorded: [],
      locked: false,
      createdAt: Date.now(),
      editedAt: Date.now(),
    };

    if (scheduledFor && scheduledFor > Date.now() + IMMEDIATE_THRESHOLD_MS) {
      const scheduleToken = `sched-${Date.now()}-${interaction.user.id}`;
      saveScheduledEvent(scheduleToken, event);
      const unix = Math.floor(scheduledFor / 1000);
      return interaction.reply({
        content: `Panel scheduled — it will be posted automatically in ${channel} at <t:${unix}:F> (<t:${unix}:R>).`,
        ephemeral: true,
      });
    }

    try {
      const message = await channel.send({
        embeds: [buildRosterEmbed(event, interaction.guild)],
      });

      saveEvent(message.id, event);
      await message.edit({ components: buildRosterButtons(message.id, false) });

      return interaction.reply({ content: `Event panel created in ${channel}.`, ephemeral: true });
    } catch (err) {
      console.error('[event create] Failed to post panel or attach buttons:', err);
      const payload = { content: `Something went wrong creating the panel: \`${err.message}\`. Check the bot console for details.`, ephemeral: true };
      if (interaction.replied || interaction.deferred) return interaction.followUp(payload).catch(() => null);
      return interaction.reply(payload).catch(() => null);
    }
  } catch (error) {
    err(error, { tag: 'handlers:eventCreate', customId: interaction.customId, userId: interaction.user.id });
    throw error;
  }
}

module.exports = { match, execute };