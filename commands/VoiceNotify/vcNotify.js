const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType } = require('discord.js');
const {
  setVcNotifyRule,
  removeVcNotifyRule,
  listVcNotifyRules,
} = require('../../utils/panelExtrasStore');
const { PREMIUM_COLORS } = require('../../utils/theme');

function preview(msg, user) {
  return msg.replace(/\{user\}/gi, `@${user.tag}`).replace(/\{vc\}/gi, '#some-vc');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('vcnotify')
    .setDescription('Send a message when a specific user joins a voice channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Watch a user and notify when they join any VC')
        .addUserOption((o) => o.setName('user').setDescription('User to watch').setRequired(true))
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Text channel to send the notification in')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName('message')
            .setDescription('Notification message. Use {user} for mention, {vc} for VC name')
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Remove a VC join notification rule for a user')
        .addUserOption((o) => o.setName('user').setDescription('User whose rule to remove').setRequired(true)),
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('List all active VC join notification rules')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'set') {
      const user = interaction.options.getUser('user');
      const channel = interaction.options.getChannel('channel');
      const message = interaction.options.getString('message');

      setVcNotifyRule(guildId, user.id, channel.id, message);

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(PREMIUM_COLORS.success)
            .setTitle('✅ VC Notify Set')
            .setDescription(
              `When **${user.tag}** joins a VC, I'll send a message in ${channel}.\n\n` +
                `**Message preview:**\n> ${preview(message, user)}`,
            ),
        ],
        ephemeral: true,
      });
    }

    if (sub === 'remove') {
      const user = interaction.options.getUser('user');
      const existed = removeVcNotifyRule(guildId, user.id);
      return interaction.reply({
        embeds: [
          existed
            ? new EmbedBuilder().setColor(PREMIUM_COLORS.success).setTitle('✅ Removed').setDescription(`VC notify rule for ${user.tag} deleted.`)
            : new EmbedBuilder().setColor(PREMIUM_COLORS.danger).setTitle('❌ Not Found').setDescription(`No rule exists for ${user.tag}.`),
        ],
        ephemeral: true,
      });
    }

    if (sub === 'list') {
      const entries = listVcNotifyRules(guildId);
      if (!entries.length) {
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(PREMIUM_COLORS.accent).setTitle('📋 VC Notify Rules').setDescription('No rules set yet.')],
          ephemeral: true,
        });
      }
      const lines = entries.map(([uid, v]) => `• <@${uid}> → <#${v.channelId}>\n  \`${v.message}\``);
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(PREMIUM_COLORS.accent).setTitle('📋 VC Notify Rules').setDescription(lines.join('\n\n'))],
        ephemeral: true,
      });
    }
  },
};
