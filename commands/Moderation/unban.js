const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { logAction } = require('../../utils/modLog');
const { buildModActionPayload } = require('../../utils/moderationBuilder');
const { PREMIUM_COLORS } = require('../../utils/theme');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Unban a user by their ID.')
    // Banned users can't be picked from a user option, so this takes a raw
    // snowflake ID (same as Dyno's unban).
    .addStringOption((o) =>
      o.setName('user_id').setDescription('The ID of the banned user').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason for the unban'))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  async execute(interaction) {
    const userId = interaction.options.getString('user_id').trim();
    const reason = interaction.options.getString('reason') || 'No reason provided';

    if (!/^\d{17,20}$/.test(userId)) {
      return interaction.reply({ content: "That doesn't look like a valid user ID.", ephemeral: true });
    }

    // Also acts as the "is this person actually banned?" check — a ban fetch
    // throws (caught -> null) if there's no matching ban.
    const ban = await interaction.guild.bans.fetch(userId).catch(() => null);
    if (!ban) {
      return interaction.reply({ content: `\`${userId}\` isn't banned from this server.`, ephemeral: true });
    }

    await interaction.guild.members.unban(userId, `${reason} | by ${interaction.user.tag}`);

    await interaction.reply(buildModActionPayload({
      color: PREMIUM_COLORS.untimeout,
      emoji: '✅',
      summary: `${ban.user.tag} was unbanned.`,
      details: [`Reason: ${reason}`, `Moderator: ${interaction.user.tag}`],
    }));

    const logEmbed = new EmbedBuilder()
      .setColor(PREMIUM_COLORS.untimeout)
      .setTitle('🔓 Member Unbanned')
      .addFields(
        { name: 'User', value: `${ban.user.tag} (${ban.user.id})` },
        { name: 'Moderator', value: interaction.user.tag },
        { name: 'Reason', value: reason },
      )
      .setTimestamp();
    await logAction(interaction.guild, logEmbed);
  },
};
