// Ticket handlers: ticket:open / ticket:close

const {
  getGuildSettings,
  getTicketCategoryId,
  getTicketStaffRoleId,
} = require('../utils/db');
const { buildTicketTranscript } = require('../utils/db'); // buildTicketTranscript is in db.js
const { applyDraftPlaceholders, buildEmbedPreview, buildLiveButtonRows } = require('../utils/embedBuilder');
const { ChannelType, PermissionFlagsBits, AttachmentBuilder } = require('discord.js');
const { err } = require('../utils/logger');

const OPEN_ID = 'ticket:open';
const CLOSE_ID = 'ticket:close';

function match(interaction) {
  return interaction.isButton() && (interaction.customId === OPEN_ID || interaction.customId === CLOSE_ID);
}

async function execute(interaction) {
  const customId = interaction.customId;

  try {
    if (customId === OPEN_ID) {
      const categoryId = getTicketCategoryId(interaction.guild.id);
      const staffRoleId = getTicketStaffRoleId(interaction.guild.id);

      const category = await interaction.guild.channels.fetch(categoryId).catch(() => null);
      if (!category) {
        return interaction.reply({ content: 'Ticket category not found — please tell an admin.', ephemeral: true });
      }

      const existing = interaction.guild.channels.cache.find(
        (c) => c.parentId === categoryId && c.topic === interaction.user.id,
      );
      if (existing) {
        return interaction.reply({ content: `You already have an open ticket: ${existing}`, ephemeral: true });
      }

      const channel = await interaction.guild.channels.create({
        name: `ticket-${interaction.user.username}`.toLowerCase().slice(0, 90),
        type: ChannelType.GuildText,
        parent: categoryId,
        topic: interaction.user.id,
        permissionOverwrites: [
          { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          {
            id: interaction.user.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
          },
          {
            id: staffRoleId,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
          },
        ],
      });

      const guildSettings = getGuildSettings(interaction.guild.id);
      const openedDraft = guildSettings.ticketOpenedEmbedDraft
        ? applyDraftPlaceholders(guildSettings.ticketOpenedEmbedDraft, { user: `${interaction.user}` })
        : null;

      const embed = openedDraft
        ? buildEmbedPreview(openedDraft)
        : null;

      const closeRow = new (require('discord.js').ActionRowBuilder)().addComponents(
        new (require('discord.js').ButtonBuilder)().setCustomId('ticket:close').setLabel('Close Ticket').setStyle(require('discord.js').ButtonStyle.Danger),
      );
      const extraRows = openedDraft ? buildLiveButtonRows(openedDraft.buttons) : [];
      const rows = [...extraRows, closeRow].slice(0, 5);

      await channel.send({ content: `<@&${staffRoleId}>`, embeds: embed ? [embed] : [], components: rows });

      return interaction.reply({ content: `Ticket opened: ${channel}`, ephemeral: true });
    }

    if (customId === CLOSE_ID) {
      const staffRoleId = getTicketStaffRoleId(interaction.guild.id);
      const isStaff =
        interaction.member.roles.cache.has(staffRoleId) ||
        interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels);
      const isOpener = interaction.channel.topic === interaction.user.id;

      if (!isStaff && !isOpener) {
        return interaction.reply({ content: 'Only the ticket opener or staff can close this ticket.', ephemeral: true });
      }

      await interaction.reply({ content: 'Closing this ticket in 5 seconds — generating transcript...' });

      const channel = interaction.channel;
      const openerId = channel.topic;
      const settings = getGuildSettings(interaction.guild.id);
      const closerTag = interaction.user.tag;

      setTimeout(async () => {
        try {
          const transcriptBuffer = await buildTicketTranscript(channel);
          const attachment = new AttachmentBuilder(transcriptBuffer, { name: `transcript-${channel.name}.txt` });
          let sentSomewhere = false;

          const placeholders = { channelName: channel.name, closerTag };
          const closeDraft = settings.ticketCloseEmbedDraft
            ? applyDraftPlaceholders(settings.ticketCloseEmbedDraft, placeholders)
            : null;
          const fallbackLines = {
            log: `Transcript for **${channel.name}** — closed by ${closerTag}`,
            dm: `Here's the transcript for your ticket **${channel.name}**.`,
            noConfig: `Transcript for **${channel.name}** (no log channel configured):`,
          };
          const closeEmbed = closeDraft ? buildEmbedPreview(closeDraft) : null;

          if (settings.ticketLogChannelId) {
            const logChannel = await interaction.guild.channels.fetch(settings.ticketLogChannelId).catch(() => null);
            if (logChannel) {
              await logChannel
                .send(closeEmbed ? { embeds: [closeEmbed], files: [attachment] } : { content: fallbackLines.log, files: [attachment] })
                .catch(() => null);
              sentSomewhere = true;
            }
          }

          if (settings.ticketDmTranscriptToOpener && openerId) {
            const opener = await interaction.guild.members.fetch(openerId).catch(() => null);
            if (opener) {
              await opener
                .send(closeEmbed ? { embeds: [closeEmbed], files: [attachment] } : { content: fallbackLines.dm, files: [attachment] })
                .catch(() => null);
              sentSomewhere = true;
            }
          }

          if (!sentSomewhere) {
            await interaction.user
              .send(closeEmbed ? { embeds: [closeEmbed], files: [attachment] } : { content: fallbackLines.noConfig, files: [attachment] })
              .catch(() => null);
          }
        } catch (err) {
          console.error('[ticket] Failed to build/send transcript:', err);
        }

        await channel.delete().catch(() => null);
      }, 5000);

      return;
    }
  } catch (error) {
    err(error, { tag: 'handlers:ticket', customId, userId: interaction.user.id });
    throw error;
  }
}

module.exports = { match, execute };