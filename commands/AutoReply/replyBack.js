const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType } = require('discord.js');
const {
  addReplyBackRule,
  removeReplyBackRule,
  listReplyBackRules,
} = require('../../utils/panelExtrasStore');
const { PREMIUM_COLORS } = require('../../utils/theme');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('replyback')
    .setDescription('React and/or reply when a user sends a message in a channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Add a reply-back rule')
        .addStringOption((o) =>
          o
            .setName('reply')
            .setDescription('Reply message. Use {user} for mention. Use [NONE] to skip reply.')
            .setRequired(true),
        )
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Channel to watch. Leave empty to apply server-wide (every channel)')
            .addChannelTypes(ChannelType.GuildText),
        )
        .addUserOption((o) => o.setName('user').setDescription('User to watch (leave empty for everyone)'))
        .addStringOption((o) =>
          o.setName('reactions').setDescription('Emojis to react with, comma-separated (e.g. 👍,❤️,😂)'),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Remove a reply-back rule')
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Channel the rule is on. Leave empty to target the server-wide rule')
            .addChannelTypes(ChannelType.GuildText),
        )
        .addUserOption((o) =>
          o.setName('user').setDescription("User the rule targets (leave empty for the 'everyone' rule)"),
        ),
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('List all active reply-back rules')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'add') {
      const channel = interaction.options.getChannel('channel');
      const reply = interaction.options.getString('reply');
      const user = interaction.options.getUser('user');
      const reactionsRaw = interaction.options.getString('reactions') || '';
      const reactions = reactionsRaw ? reactionsRaw.split(',').map((r) => r.trim()).filter(Boolean) : [];

      addReplyBackRule(guildId, channel?.id || null, user?.id || null, reply, reactions);

      const target = user ? `**${user.tag}**` : '**everyone**';
      const where = channel ? `in ${channel}` : '**server-wide (every channel)**';
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(PREMIUM_COLORS.success)
            .setTitle('✅ Reply-Back Rule Added')
            .setDescription(
              `When ${target} sends a message ${where}:\n` +
                (reactions.length ? `• React with: ${reactions.join(' ')}\n` : '') +
                (reply !== '[NONE]' ? `• Reply: \`${reply}\`` : '• No text reply'),
            ),
        ],
        ephemeral: true,
      });
    }

    if (sub === 'remove') {
      const channel = interaction.options.getChannel('channel');
      const user = interaction.options.getUser('user');
      const removedCount = removeReplyBackRule(guildId, channel?.id || null, user?.id || null);
      const where = channel ? `in ${channel}` : 'the server-wide rule';
      return interaction.reply({
        embeds: [
          removedCount
            ? new EmbedBuilder()
                .setColor(PREMIUM_COLORS.success)
                .setTitle('✅ Removed')
                .setDescription(`Reply-back rule removed for ${user ? user.tag : 'everyone'} — ${where}.`)
            : new EmbedBuilder().setColor(PREMIUM_COLORS.danger).setTitle('❌ Not Found').setDescription('No matching rule found.'),
        ],
        ephemeral: true,
      });
    }

    if (sub === 'list') {
      const rules = listReplyBackRules(guildId);
      if (!rules.length) {
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(PREMIUM_COLORS.accent).setTitle('📋 Reply-Back Rules').setDescription('No rules set yet.')],
          ephemeral: true,
        });
      }
      const lines = rules.map((r) => {
        const who = r.userId ? `<@${r.userId}>` : 'Everyone';
        const where = r.channelId ? `<#${r.channelId}>` : 'Server-wide (every channel)';
        const reacts = r.reactions.length ? r.reactions.join(' ') : 'none';
        return `• ${who} in ${where}\n  Reactions: ${reacts}\n  Reply: \`${r.reply}\``;
      });
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(PREMIUM_COLORS.accent).setTitle('📋 Reply-Back Rules').setDescription(lines.join('\n\n'))],
        ephemeral: true,
      });
    }
  },
};
