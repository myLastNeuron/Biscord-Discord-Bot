const { PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// "Revoke this invite" button on a join-log message.
async function handleInviteLogInteraction(interaction) {
  if (!(interaction.isButton() && interaction.customId.startsWith('invitelog:revoke:'))) return false;

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({ content: "You need **Manage Server** permission to revoke invites.", ephemeral: true });
    return true;
  }

  const code = interaction.customId.split(':').slice(2).join(':');
  try {
    await interaction.guild.invites.delete(code, `Revoked via invite log by ${interaction.user.tag}`);
  } catch (err) {
    await interaction.reply({
      content: `Couldn't revoke that invite — it may already be gone. (${err.message})`,
      ephemeral: true,
    });
    return true;
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
  await interaction.followUp({ content: `Invite \`${code}\` has been revoked.`, ephemeral: true });
  return true;
}

module.exports = { handleInviteLogInteraction };
