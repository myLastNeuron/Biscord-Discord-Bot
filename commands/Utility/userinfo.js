/**
 * /userinfo [user]
 * A fuller member card than /profile — account/join dates, nickname, highest
 * role and (capped) role list. Falls back gracefully when the target isn't a
 * member of this server.
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { PREMIUM_COLORS } = require('../../utils/theme');

// Cap the role list so a member with 60 roles doesn't blow past Discord's
// 1024-char field limit.
const MAX_ROLES = 15;

function formatRoles(member) {
  const roles = member.roles.cache
    .filter((r) => r.id !== member.guild.id) // drop @everyone
    .sort((a, b) => b.position - a.position);
  if (!roles.size) return 'None';
  const shown = roles.first(MAX_ROLES).map((r) => r.toString());
  if (roles.size > MAX_ROLES) shown.push(`…and ${roles.size - MAX_ROLES} more`);
  return shown.join(', ');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('Show detailed information about a member.')
    .addUserOption((o) =>
      o.setName('user').setDescription('The member to inspect (defaults to you)')),

  async execute(interaction) {
    const target = interaction.options.getUser('user') ?? interaction.user;
    const member = interaction.guild.members.cache.get(target.id)
      ?? await interaction.guild.members.fetch(target.id).catch(() => null);

    const avatarUrl = (member ?? target).displayAvatarURL({ size: 256 });

    const embed = new EmbedBuilder()
      .setColor(PREMIUM_COLORS.accent)
      .setAuthor({ name: target.username, iconURL: avatarUrl })
      .setThumbnail(avatarUrl)
      .addFields(
        { name: 'ID', value: target.id, inline: true },
        { name: 'Nickname', value: member?.nickname ?? 'None', inline: true },
        { name: 'Account created', value: `<t:${Math.floor(target.createdTimestamp / 1000)}:R>`, inline: true },
      );

    if (member) {
      const highest = member.roles.highest.id === interaction.guild.id ? 'None' : member.roles.highest.toString();
      embed.addFields(
        { name: 'Joined server', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`, inline: true },
        { name: 'Highest role', value: highest, inline: true },
        {
          name: 'Boosting since',
          value: member.premiumSinceTimestamp ? `<t:${Math.floor(member.premiumSinceTimestamp / 1000)}:R>` : 'Not boosting',
          inline: true,
        },
        { name: 'Roles', value: formatRoles(member) },
      );
    } else {
      embed.addFields({ name: 'Server', value: 'Not a member of this server' });
    }

    embed.setFooter({ text: target.tag });

    await interaction.reply({ embeds: [embed] });
  },
};
