// Role Request handlers: rolerequest:open (button), rolerequest:submit (modal),
// rolerequest:approve/reject (buttons)

const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const {
  getGuildSettings,
  setGuildSettings,
} = require('../utils/db');
const { getRoleRequestLogChannelId, getRoleRequestApproveRoleId, canReviewRoleRequests } = require('../utils/db');
const { err } = require('../utils/logger');

const OPEN_ID = 'rolerequest:open';
const SUBMIT_ID = 'rolerequest:submit';

function match(interaction) {
  if (interaction.isButton() && interaction.customId === OPEN_ID) return true;
  if (interaction.isModalSubmit() && interaction.customId === SUBMIT_ID) return true;
  if (interaction.isButton() && (interaction.customId.startsWith('rolerequest:approve:') || interaction.customId.startsWith('rolerequest:reject:'))) return true;
  return false;
}

async function execute(interaction) {
  const customId = interaction.customId;

  try {
    // Open modal button
    if (customId === OPEN_ID) {
      const modal = new ModalBuilder().setCustomId(SUBMIT_ID).setTitle('Request Role');

      const idInput = new TextInputBuilder()
        .setCustomId('charId')
        .setLabel('ID')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const nameInput = new TextInputBuilder()
        .setCustomId('charName')
        .setLabel('Name')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const rankInput = new TextInputBuilder()
        .setCustomId('rank')
        .setLabel('Rank')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const montagesInput = new TextInputBuilder()
        .setCustomId('montages')
        .setLabel('Montages (write null if none)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const screenshotInput = new TextInputBuilder()
        .setCustomId('screenshot')
        .setLabel('Screenshot link (of you being in family)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Paste an image link (imgur, Discord CDN, etc.)')
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder().addComponents(idInput),
        new ActionRowBuilder().addComponents(nameInput),
        new ActionRowBuilder().addComponents(rankInput),
        new ActionRowBuilder().addComponents(montagesInput),
        new ActionRowBuilder().addComponents(screenshotInput),
      );

      return interaction.showModal(modal);
    }

    // Modal submit -> post to log channel for review
    if (customId === SUBMIT_ID) {
      const charId = interaction.fields.getTextInputValue('charId');
      const charName = interaction.fields.getTextInputValue('charName');
      const rank = interaction.fields.getTextInputValue('rank');
      const montages = interaction.fields.getTextInputValue('montages');
      const screenshot = interaction.fields.getTextInputValue('screenshot');

      const logChannel = await interaction.guild.channels.fetch(getRoleRequestLogChannelId(interaction.guild.id)).catch(() => null);
      if (!logChannel) {
        return interaction.reply({ content: 'Could not reach the review channel — please tell an admin.', ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setTitle('New Role Request')
        .setColor(0x5865f2)
        .addFields(
          { name: 'Requested by', value: `${interaction.user} (${interaction.user.tag})`, inline: false },
          { name: 'ID', value: charId, inline: true },
          { name: 'Name', value: charName, inline: true },
          { name: 'Rank', value: rank, inline: true },
          { name: 'Montages', value: montages, inline: false },
          { name: 'Screenshot', value: screenshot, inline: false },
        )
        .setFooter({ text: `User ID: ${interaction.user.id}` })
        .setTimestamp();

      if (/^https?:\/\/.+\.(png|jpe?g|gif|webp)(\?.*)?$/i.test(screenshot.trim())) {
        embed.setImage(screenshot.trim());
      }

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`rolerequest:approve:${interaction.user.id}`)
          .setLabel('Approve')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`rolerequest:reject:${interaction.user.id}`)
          .setLabel('Reject')
          .setStyle(ButtonStyle.Danger),
      );

      await logChannel.send({ embeds: [embed], components: [row] });

      return interaction.reply({ content: 'Your role request has been sent for review. You will be given the role once approved.', ephemeral: true });
    }

    // Approve/Reject buttons
    if (customId.startsWith('rolerequest:approve:') || customId.startsWith('rolerequest:reject:')) {
      const [, action, requesterId] = customId.split(':');

      if (!canReviewRoleRequests(interaction)) {
        return interaction.reply({ content: 'You do not have permission to review role requests.', ephemeral: true });
      }

      const originalEmbed = interaction.message.embeds[0];
      const updatedEmbed = EmbedBuilder.from(originalEmbed);

      if (action === 'approve') {
        const member = await interaction.guild.members.fetch(requesterId).catch(() => null);
        if (!member) {
          return interaction.reply({ content: 'That user is no longer in the server.', ephemeral: true });
        }

        const roleId = getRoleRequestApproveRoleId(interaction.guild.id);
        let roleAddError = null;
        try {
          await member.roles.add(roleId);
        } catch (err) {
          roleAddError = err;
          console.error(`[rolerequest] Failed to add role ${roleId} to ${member.id} in guild ${interaction.guild.id}:`, err);
        }

        if (roleAddError) {
          updatedEmbed.setColor(0xed4245).setTitle('Role Request — Approved (⚠️ role NOT given)');
          updatedEmbed.addFields(
            { name: 'Approved by', value: `${interaction.user}`, inline: false },
            {
              name: '⚠️ Role Assignment Failed',
              value: `Could not give <@&${roleId}> to ${member}. Most likely cause: the bot's role isn't positioned **above** <@&${roleId}> in Server Settings → Roles, or the bot is missing **Manage Roles** permission.\n\`${roleAddError.message || roleAddError}\``,
              inline: false,
            },
          );
        } else {
          updatedEmbed.setColor(0x57f287).setTitle('Role Request — Approved');
          updatedEmbed.addFields({ name: 'Approved by', value: `${interaction.user}`, inline: false });
        }

        await member.send('Your role request was approved! 🎉').catch(() => null);
      } else {
        updatedEmbed.setColor(0xed4245).setTitle('Role Request — Rejected');
        updatedEmbed.addFields({ name: 'Rejected by', value: `${interaction.user}`, inline: false });
        const member = await interaction.guild.members.fetch(requesterId).catch(() => null);
        await member?.send('Your role request was rejected.').catch(() => null);
      }

      const disabledRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('rolerequest:approve:done').setLabel('Approve').setStyle(ButtonStyle.Success).setDisabled(true),
        new ButtonBuilder().setCustomId('rolerequest:reject:done').setLabel('Reject').setStyle(ButtonStyle.Danger).setDisabled(true),
      );

      await interaction.update({ embeds: [updatedEmbed], components: [disabledRow] });
      return;
    }
  } catch (error) {
    err(error, { tag: 'handlers:roleRequest', customId, userId: interaction.user.id });
    throw error;
  }
}

module.exports = { match, execute };