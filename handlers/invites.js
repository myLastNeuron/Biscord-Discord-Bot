// Invite handlers: invitelog:revoke (button)

const { ButtonBuilder, ButtonStyle, ActionRowBuilder, PermissionFlagsBits } = require('discord.js');
const { err } = require('../utils/logger');

const PREFIX = 'invitelog:revoke:';

function match(interaction) {
  return interaction.isButton() && interaction.customId.startsWith(PREFIX);
}

async function execute(interaction) {
  try {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: "You need **Manage Server** permission to revoke invites.", ephemeral: true });
    }

    const code = interaction.customId.split(':').slice(2).join(':');
    try {
      await interaction.guild.invites.delete(code, `Revoked via invite log by ${interaction.user.tag}`);
    } catch (err) {
      return interaction.reply({
        content: `Couldn't revoke that invite — it may already be gone. (${err.message})`,
        ephemeral: true,
      });
    }

    const disabledRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('invitelog:revoked')
        .setLabel('Invite Revoked')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
    );
    await interaction.update({ components: [disabledRow] }).catch(() => null);
    return interaction.followUp({ content: `Invite \`${code}\` has been revoked.`, ephemeral: true });
  } catch (error) {
    err(error, { tag: 'handlers:invites', customId: interaction.customId, userId: interaction.user.id });
    throw error;
  }
}

module.exports = { match, execute };