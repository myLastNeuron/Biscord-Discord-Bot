/**
 * /serverinfo
 * A single-embed snapshot of the current server: owner, size, channel/role/
 * emoji counts, boost level and verification. Read straight off the cached
 * guild object — no extra API calls beyond resolving the owner.
 */

const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');
const { PREMIUM_COLORS } = require('../../utils/theme');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('serverinfo')
    .setDescription('Show information about this server.'),

  async execute(interaction) {
    const { guild } = interaction;
    const owner = await guild.fetchOwner().catch(() => null);

    const counts = (types) => guild.channels.cache.filter((c) => types.includes(c.type)).size;
    const textChannels = counts([ChannelType.GuildText, ChannelType.GuildAnnouncement]);
    const voiceChannels = counts([ChannelType.GuildVoice, ChannelType.GuildStageVoice]);
    const categories = counts([ChannelType.GuildCategory]);

    const embed = new EmbedBuilder()
      .setColor(PREMIUM_COLORS.accent)
      .setAuthor({ name: guild.name, iconURL: guild.iconURL({ size: 256 }) ?? undefined })
      .setThumbnail(guild.iconURL({ size: 256 }))
      .addFields(
        { name: 'Owner', value: owner ? owner.user.toString() : 'Unknown', inline: true },
        { name: 'Server ID', value: guild.id, inline: true },
        { name: 'Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },
        { name: 'Members', value: `${guild.memberCount}`, inline: true },
        { name: 'Channels', value: `💬 ${textChannels} · 🔊 ${voiceChannels} · 📁 ${categories}`, inline: true },
        { name: 'Roles', value: `${guild.roles.cache.size}`, inline: true },
        { name: 'Emojis', value: `${guild.emojis.cache.size}`, inline: true },
        { name: 'Boosts', value: `Level ${guild.premiumTier} · ${guild.premiumSubscriptionCount ?? 0} boost(s)`, inline: true },
        { name: 'Verification', value: `Level ${guild.verificationLevel}`, inline: true },
      );

    const banner = guild.bannerURL({ size: 1024 });
    if (banner) embed.setImage(banner);

    embed.setFooter({ text: `Requested by ${interaction.user.tag}` });

    await interaction.reply({ embeds: [embed] });
  },
};
