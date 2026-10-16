const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { logAction } = require('../../utils/modLog');
const { buildModActionPayload } = require('../../utils/moderationBuilder');
const { PREMIUM_COLORS } = require('../../utils/theme');

// Discord's hard cap for slowmode (6 hours).
const MAX_SECONDS = 21600;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('slowmode')
    .setDescription('Set a channel\'s slowmode (0 disables it).')
    .addIntegerOption((o) =>
      o.setName('seconds')
        .setDescription('Slowmode in seconds (0 = off, max 21600)')
        .setMinValue(0)
        .setMaxValue(MAX_SECONDS)
        .setRequired(true))
    .addChannelOption((o) => o.setName('channel').setDescription('Channel to change (defaults to this one)'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  async execute(interaction) {
    const seconds = interaction.options.getInteger('seconds');
    const channel = interaction.options.getChannel('channel') ?? interaction.channel;

    if (!channel || typeof channel.setRateLimitPerUser !== 'function') {
      return interaction.reply({ content: 'Slowmode only applies to text channels.', ephemeral: true });
    }

    const me = interaction.guild.members.me;
    if (me && !channel.permissionsFor(me)?.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.reply({ content: `I don't have permission to manage ${channel}.`, ephemeral: true });
    }

    try {
      await channel.setRateLimitPerUser(seconds, `Slowmode set by ${interaction.user.tag}`);
    } catch (error) {
      return interaction.reply({ content: `⚠️ Failed to update slowmode for ${channel}: \`${error.message}\`.`, ephemeral: true });
    }

    const summary = seconds === 0
      ? `Slowmode disabled in ${channel}.`
      : `Slowmode set to ${seconds}s in ${channel}.`;

    await interaction.reply(buildModActionPayload({
      color: PREMIUM_COLORS.accent,
      emoji: '✅',
      summary,
      details: [`Moderator: ${interaction.user.tag}`],
    }));

    const logEmbed = new EmbedBuilder()
      .setColor(PREMIUM_COLORS.accent)
      .setTitle('🐌 Slowmode Updated')
      .addFields(
        { name: 'Channel', value: `${channel}`, inline: true },
        { name: 'Slowmode', value: seconds === 0 ? 'Off' : `${seconds}s`, inline: true },
        { name: 'Moderator', value: interaction.user.tag },
      )
      .setTimestamp();
    await logAction(interaction.guild, logEmbed);
  },
};
