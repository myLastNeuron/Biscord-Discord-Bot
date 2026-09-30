const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType } = require('discord.js');
const {
  setAutoDeletePrefixRule,
  removeAutoDeletePrefixRule,
  addAutoDeleteUser,
  removeAutoDeleteUser,
} = require('../../utils/panelExtrasStore');
const { PREMIUM_COLORS } = require('../../utils/theme');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('autodelete')
    .setDescription('Auto-delete messages by prefix or by user')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('prefix')
        .setDescription('Delete messages starting with a prefix in a channel')
        .addChannelOption((o) =>
          o.setName('channel').setDescription('Channel to monitor').addChannelTypes(ChannelType.GuildText).setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName('prefix')
            .setDescription('Prefix to watch for (e.g. "!"). Use "REMOVE" to delete the rule.')
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('user')
        .setDescription('Auto-delete all messages from a user in a channel')
        .addUserOption((o) => o.setName('user').setDescription('User to watch').setRequired(true))
        .addChannelOption((o) =>
          o.setName('channel').setDescription('Channel to monitor').addChannelTypes(ChannelType.GuildText).setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('user-remove')
        .setDescription('Stop auto-deleting messages from a user in a channel')
        .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true))
        .addChannelOption((o) =>
          o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText).setRequired(true),
        ),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'prefix') {
      const channel = interaction.options.getChannel('channel');
      const prefix = interaction.options.getString('prefix');

      if (prefix.toUpperCase() === 'REMOVE') {
        removeAutoDeletePrefixRule(guildId, channel.id);
        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(PREMIUM_COLORS.success)
              .setTitle('✅ Removed')
              .setDescription(`Auto-delete prefix rule for ${channel} removed.`),
          ],
          ephemeral: true,
        });
      }

      setAutoDeletePrefixRule(guildId, channel.id, prefix);
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(PREMIUM_COLORS.success)
            .setTitle('✅ Auto-Delete Prefix Set')
            .setDescription(
              `Messages starting with \`${prefix}\` in ${channel} will be auto-deleted.\n\n` +
                'To remove this rule, run the command again with prefix `REMOVE`.',
            ),
        ],
        ephemeral: true,
      });
    }

    if (sub === 'user') {
      const user = interaction.options.getUser('user');
      const channel = interaction.options.getChannel('channel');
      addAutoDeleteUser(guildId, channel.id, user.id);
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(PREMIUM_COLORS.success)
            .setTitle('✅ Auto-Delete User Set')
            .setDescription(`All messages from ${user} in ${channel} will be auto-deleted.`),
        ],
        ephemeral: true,
      });
    }

    if (sub === 'user-remove') {
      const user = interaction.options.getUser('user');
      const channel = interaction.options.getChannel('channel');
      const removed = removeAutoDeleteUser(guildId, channel.id, user.id);
      return interaction.reply({
        embeds: [
          removed
            ? new EmbedBuilder().setColor(PREMIUM_COLORS.success).setTitle('✅ Removed').setDescription(`Auto-delete rule for ${user.tag} in ${channel} removed.`)
            : new EmbedBuilder().setColor(PREMIUM_COLORS.danger).setTitle('❌ Not Found').setDescription(`No rule for ${user.tag} in ${channel}.`),
        ],
        ephemeral: true,
      });
    }
  },
};
