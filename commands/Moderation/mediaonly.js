const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const { enableMediaOnly, disableMediaOnly, listMediaOnly, MEDIA_ONLY_REASON } = require('../../utils/mediaOnlyManager');
const { logAction } = require('../../utils/modLog');
const { PREMIUM_COLORS } = require('../../utils/theme');

function buildSetupEmbed() {
  return new EmbedBuilder()
    .setColor(PREMIUM_COLORS.warn)
    .setTitle('📸 Screenshots / Media Only')
    .setDescription(
      'This channel is for **screenshots and files only**.\n\n' +
      'Any message **without a picture or file attached** will be **deleted** and you will get a **/warn**.\n\n' +
      `Reason: \`${MEDIA_ONLY_REASON}\``
    )
    .addFields(
      { name: '✅ Allowed', value: 'Pictures, screenshots, videos, files', inline: true },
      { name: '❌ Not allowed', value: 'Plain chat text, no attachment', inline: true },
    )
    .setTimestamp();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('media-only')
    .setDescription('Make a channel file/picture only with auto-delete + auto-warn')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addSubcommand((sub) => sub
      .setName('on')
      .setDescription('Turn on media-only for a channel (defaults to this one)')
      .addChannelOption((o) => o.setName('channel').setDescription('Channel to restrict (defaults to this one)')))
    .addSubcommand((sub) => sub
      .setName('off')
      .setDescription('Turn off media-only for a channel (defaults to this one)')
      .addChannelOption((o) => o.setName('channel').setDescription('Channel to unrestrict (defaults to this one)')))
    .addSubcommand((sub) => sub
      .setName('list')
      .setDescription('List every media-only channel')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const list = listMediaOnly(interaction.guild.id);
      if (!list.length) {
        return interaction.reply({ content: 'No media-only channels set. Use `/media-only on` in a channel.', flags: MessageFlags.Ephemeral });
      }
      const lines = list.map((r) => `<#${r.channelId}> — on <t:${Math.floor((r.enabledAt || Date.now()) / 1000)}:R> by ${r.enabledByTag || 'unknown'}`);
      const embed = new EmbedBuilder()
        .setColor(PREMIUM_COLORS.warn)
        .setTitle(`📸 ${list.length} Media-Only Channel(s)`)
        .setDescription(lines.join('\n'));
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    const channel = interaction.options.getChannel('channel') || interaction.channel;
    if (!channel || !channel.isTextBased || !channel.isTextBased()) {
      return interaction.reply({ content: '⚠️ That is not a text channel.', flags: MessageFlags.Ephemeral });
    }

    if (sub === 'on') {
      enableMediaOnly(interaction.guild.id, channel.id, {
        byId: interaction.user.id,
        byTag: interaction.user.tag,
        channelName: channel.name,
      });

      // Public notice everyone can see in target channel.
      await channel.send({ embeds: [buildSetupEmbed()] }).catch(() => null);

      const logEmbed = new EmbedBuilder()
        .setColor(PREMIUM_COLORS.warn)
        .setTitle('📸 Media-Only Enabled')
        .addFields(
          { name: 'Moderator', value: interaction.user.tag },
          { name: 'Channel', value: `<#${channel.id}>`, inline: true },
        )
        .setTimestamp();
      await logAction(interaction.guild, logEmbed).catch(() => null);

      return interaction.reply({ content: `✅ <#${channel.id}> is now **media-only**. Setup notice posted publicly.`, flags: MessageFlags.Ephemeral });
    }

    // off
    const result = disableMediaOnly(interaction.guild.id, channel.id);
    if (!result.wasEnabled) {
      return interaction.reply({ content: `✅ <#${channel.id}> is **not** media-only — nothing to remove.`, flags: MessageFlags.Ephemeral });
    }

    const offEmbed = new EmbedBuilder()
      .setColor(PREMIUM_COLORS.success)
      .setTitle('📸 Media-Only Disabled')
      .setDescription(`<#${channel.id}> is no longer media-only — normal chat allowed.`)
      .setTimestamp();
    await channel.send({ embeds: [offEmbed] }).catch(() => null);

    return interaction.reply({ content: `✅ <#${channel.id}> media-only **disabled**.`, flags: MessageFlags.Ephemeral });
  },
};
