const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType } = require('discord.js');
const { getVcActivitySettings, setVcActivitySettings } = require('../../utils/panelExtrasStore');
const { PREMIUM_COLORS } = require('../../utils/theme');

function statusEmbed(settings) {
  return new EmbedBuilder()
    .setColor(settings.enabled ? PREMIUM_COLORS.success : PREMIUM_COLORS.muted)
    .setTitle('🎙️ VC Activity Log')
    .setDescription(
      'Posts a message when anyone joins voice (with a live "in call for..." timer that counts up on its own), ' +
        'and a follow-up message with the total duration when they leave.',
    )
    .addFields(
      { name: 'Status', value: settings.enabled ? '🟢 Enabled' : '🔴 Disabled', inline: true },
      { name: 'Log Channel', value: settings.channelId ? `<#${settings.channelId}>` : '*Not set*', inline: true },
      { name: 'Join Message', value: `\`${settings.joinMessage}\`` },
      { name: 'Leave Message', value: `\`${settings.leaveMessage}\`` },
    )
    .setFooter({ text: 'Placeholders: {user}, {vc}, {duration} (leave message only)' });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('vcactivity')
    .setDescription('Log when members join/leave voice, with a live duration timer')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('enable')
        .setDescription('Turn on the VC activity log')
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Channel to post join/leave messages in')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) => sub.setName('disable').setDescription('Turn off the VC activity log'))
    .addSubcommand((sub) =>
      sub
        .setName('messages')
        .setDescription('Customize the join/leave message text')
        .addStringOption((o) =>
          o.setName('join').setDescription('Join message. Use {user} and {vc}'),
        )
        .addStringOption((o) =>
          o.setName('leave').setDescription('Leave message. Use {user}, {vc}, and {duration}'),
        ),
    )
    .addSubcommand((sub) => sub.setName('status').setDescription('Show current VC activity log settings')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'enable') {
      const channel = interaction.options.getChannel('channel');
      const settings = setVcActivitySettings(guildId, { enabled: true, channelId: channel.id });
      return interaction.reply({ embeds: [statusEmbed(settings)], ephemeral: true });
    }

    if (sub === 'disable') {
      const settings = setVcActivitySettings(guildId, { enabled: false });
      return interaction.reply({ embeds: [statusEmbed(settings)], ephemeral: true });
    }

    if (sub === 'messages') {
      const join = interaction.options.getString('join');
      const leave = interaction.options.getString('leave');
      const patch = {};
      if (join) patch.joinMessage = join;
      if (leave) patch.leaveMessage = leave;

      if (!Object.keys(patch).length) {
        return interaction.reply({
          content: 'Provide at least a `join` or `leave` message to update.',
          ephemeral: true,
        });
      }

      const settings = setVcActivitySettings(guildId, patch);
      return interaction.reply({ embeds: [statusEmbed(settings)], ephemeral: true });
    }

    if (sub === 'status') {
      const settings = getVcActivitySettings(guildId);
      return interaction.reply({ embeds: [statusEmbed(settings)], ephemeral: true });
    }
  },
};
