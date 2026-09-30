const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { logAction } = require('../../utils/modLog');
const { buildModActionPayload } = require('../../utils/moderationBuilder');
const { PREMIUM_COLORS } = require('../../utils/theme');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('untimeout')
    .setDescription('Remove an active timeout from a member')
    .addUserOption(o => o.setName('user').setDescription('User to un-timeout').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    const target = interaction.options.getUser('user');
    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!member) return interaction.reply({ content: 'That user is not in this server.', ephemeral: true });

    await member.timeout(null, `Timeout removed by ${interaction.user.tag}`);

    await interaction.reply(buildModActionPayload({
      color: PREMIUM_COLORS.untimeout,
      emoji: '✅',
      summary: `${target.tag}'s timeout was removed.`,
      details: [`Moderator: ${interaction.user.tag}`],
    }));

    const logEmbed = new EmbedBuilder()
      .setColor(PREMIUM_COLORS.untimeout)
      .setTitle('🔊 Timeout Removed')
      .addFields(
        { name: 'User', value: `${target.tag} (${target.id})` },
        { name: 'Moderator', value: `${interaction.user.tag}` },
      )
      .setTimestamp();
    await logAction(interaction.guild, logEmbed);
  },
};
