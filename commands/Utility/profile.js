/**
 * /profile [user]
 * A minimal member card: avatar, a download link, and how long they've been
 * in this server plus how old their Discord account is.
 */

const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const { PREMIUM_COLORS } = require('../../utils/theme');

// "3 years, 2 months" from a millisecond age. Deliberately coarse — this is a
// profile blurb, not a resume.
function humanAge(ms) {
  const days = Math.floor(ms / 86_400_000);
  const years = Math.floor(days / 365);
  const months = Math.floor((days % 365) / 30);
  if (years) return months ? `${years} year${years > 1 ? 's' : ''}, ${months} month${months > 1 ? 's' : ''}` : `${years} year${years > 1 ? 's' : ''}`;
  if (months) return `${months} month${months > 1 ? 's' : ''}`;
  return `${days} day${days === 1 ? '' : 's'}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('Show a member\'s profile — avatar, join age, and account age.')
    .addUserOption((o) =>
      o.setName('user').setDescription('The member to show (defaults to you)').setRequired(false)),

  async execute(interaction) {
    const target = interaction.options.getUser('user') ?? interaction.user;

    const member = interaction.guild.members.cache.get(target.id)
      ?? await interaction.guild.members.fetch(target.id).catch(() => null);

    const avatarUrl = target.displayAvatarURL({ size: 512 });

    const embed = new EmbedBuilder()
      .setColor(PREMIUM_COLORS.accent)
      .setAuthor({ name: target.username, iconURL: avatarUrl })
      .setThumbnail(avatarUrl)
      .addFields(
        {
          name: 'In this server',
          value: member?.joinedTimestamp
            ? `${humanAge(Date.now() - member.joinedTimestamp)} · <t:${Math.floor(member.joinedTimestamp / 1000)}:R>`
            : 'Not a member',
          inline: true,
        },
        {
          name: 'Account age',
          value: `${humanAge(Date.now() - target.createdTimestamp)} · <t:${Math.floor(target.createdTimestamp / 1000)}:R>`,
          inline: true,
        },
      )
      .setFooter({ text: target.tag });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Download avatar')
        .setStyle(ButtonStyle.Link)
        .setURL(avatarUrl),
    );

    await interaction.reply({ embeds: [embed], components: [row] });
  },
};
