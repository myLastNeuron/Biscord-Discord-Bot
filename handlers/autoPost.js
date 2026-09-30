// Autopost event creation modal: eventAutopostCreate:<token>

const { ModalBuilder, MessageFlags } = require('discord.js');
const { getGuildSettings, saveAutopostRoster } = require('../utils/db');
const { refreshUpcomingBoard } = require('../utils/upcomingBoard');
const { err } = require('../utils/logger');

const PREFIX = 'eventAutopostCreate:';

function match(interaction) {
  return interaction.isModalSubmit() && interaction.customId.startsWith(PREFIX);
}

async function execute(interaction) {
  try {
    const token = interaction.customId.split(':')[1];
    const pending = interaction.client.pendingAutopostCreations?.get(token);
    interaction.client.pendingAutopostCreations?.delete(token);

    if (!pending) {
      return interaction.reply({ content: 'That setup session expired — please run /event autopost create again.', ephemeral: true });
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

    const guildSettings = getGuildSettings(interaction.guild.id);
    const lockAfterMinutes = lockAfterOverride ?? guildSettings.rosterAutoLockMinutes ?? 15;

    const autopostToken = `autopost-${Date.now()}-${interaction.user.id}`;
    saveAutopostRoster(autopostToken, {
      guildId: interaction.guild.id,
      channelId: channel.id,
      hostId: interaction.user.id,
      hostTag: interaction.user.tag,
      title,
      description,
      category,
      thumbnail: pending.thumbnail || null,
      mainSlots,
      subSlots,
      hour: pending.hour,
      minute: pending.minute,
      lockAfterMinutes,
      lastPostedDate: null,
    });

    await refreshUpcomingBoard(interaction.client, interaction.guild.id).catch(() => null);

    const time = `${String(pending.hour).padStart(2, '0')}:${String(pending.minute).padStart(2, '0')}`;
    return interaction.reply({
      content: `Set up! A fresh "${title}" roster will be posted in ${channel} every day at ${time} London time.`,
      ephemeral: true,
    });
  } catch (error) {
    err(error, { tag: 'handlers:autoPost', customId: interaction.customId, userId: interaction.user.id });
    throw error;
  }
}

module.exports = { match, execute };