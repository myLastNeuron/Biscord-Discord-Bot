const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { addWarning } = require('../../utils/db');
const { logAction } = require('../../utils/modLog');
const { buildModActionPayload } = require('../../utils/moderationBuilder');
const { PREMIUM_COLORS } = require('../../utils/theme');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Issue a warning to a member')
    .addUserOption(o => o.setName('user').setDescription('User to warn').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for the warning').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason');

    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!member) {
      return interaction.reply({ content: 'That user is not in this server.', ephemeral: true });
    }
    if (targetUser.id === interaction.user.id) {
      return interaction.reply({ content: "You can't warn yourself.", ephemeral: true });
    }
    if (targetUser.id === interaction.client.user.id) {
      return interaction.reply({ content: "I can't warn myself.", ephemeral: true });
    }
    if (member.id === interaction.guild.ownerId) {
      return interaction.reply({ content: `I can't warn ${targetUser.tag} — they own the server.`, ephemeral: true });
    }
    const invoker = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!invoker) {
      return interaction.reply({ content: "Couldn't verify your roles — try again.", ephemeral: true });
    }
    const invokerPos = invoker.roles?.highest?.position ?? -1;
    const targetPos = member.roles?.highest?.position ?? -1;
    if (interaction.user.id !== interaction.guild.ownerId && invokerPos <= targetPos) {
      return interaction.reply({ content: `You can't warn ${targetUser.tag} — their role is higher than or equal to yours.`, ephemeral: true });
    }

    const history = addWarning(interaction.guild.id, targetUser.id, {
      reason,
      moderator: interaction.user.tag,
      timestamp: Date.now(),
    });

    await interaction.reply(buildModActionPayload({
      color: PREMIUM_COLORS.warn,
      emoji: '✅',
      summary: `${targetUser.tag} was warned.`,
      details: [`Reason: ${reason}`, `Moderator: ${interaction.user.tag}`, `Total warnings: ${history.length}`],
    }));

    const logEmbed = new EmbedBuilder()
      .setColor(PREMIUM_COLORS.warn)
      .setTitle('⚠️ Member Warned')
      .addFields(
        { name: 'User', value: `${targetUser.tag} (${targetUser.id})` },
        { name: 'Moderator', value: `${interaction.user.tag}` },
        { name: 'Reason', value: reason },
        { name: 'Total Warnings', value: `${history.length}` },
      )
      .setTimestamp();
    await logAction(interaction.guild, logEmbed);

    // Best-effort DM notice
    await targetUser.send(`You were warned in **${interaction.guild.name}** for: ${reason}`).catch(() => null);
  },
};
