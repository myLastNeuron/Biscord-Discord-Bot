/**
 * /avatar [user] [server]
 * Shows a member's avatar at full size with a link button. By default the
 * global avatar is shown; pass server:true to prefer the per-server avatar
 * (falls back to the global one when none is set).
 */

const {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const { PREMIUM_COLORS } = require('../../utils/theme');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('avatar')
    .setDescription('Show a member\'s avatar in full size.')
    .addUserOption((o) => o.setName('user').setDescription('The member (defaults to you)'))
    .addBooleanOption((o) => o.setName('server').setDescription('Show the server-specific avatar instead of the global one')),

  async execute(interaction) {
    const target = interaction.options.getUser('user') ?? interaction.user;
    const useServer = interaction.options.getBoolean('server') ?? false;

    const member = interaction.guild.members.cache.get(target.id)
      ?? await interaction.guild.members.fetch(target.id).catch(() => null);

    const guildAvatar = member?.avatarURL({ size: 1024 }) ?? null;
    const url = (useServer && guildAvatar) ? guildAvatar : target.displayAvatarURL({ size: 1024 });

    const embed = new EmbedBuilder()
      .setColor(PREMIUM_COLORS.accent)
      .setTitle(`${target.username}'s avatar`)
      .setImage(url);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('Open in browser').setStyle(ButtonStyle.Link).setURL(url),
    );

    await interaction.reply({ embeds: [embed], components: [row] });
  },
};
