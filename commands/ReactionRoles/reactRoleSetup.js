const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
} = require('discord.js');
const sessionStore = require('../../utils/embedSessionStore');
const { getGuildSettings } = require('../../utils/db');
const {
  buildEmbedFromDraft,
  buildPanelComponents,
  buildGuideText,
} = require('../../utils/embedBuilder');

// Same permission model as warnings / role requests / reaction approvals: the
// mod roles configured in /panel if any are set, otherwise ManageRoles.
//
// Deliberately NOT .setDefaultMemberPermissions() on the command itself: that
// would hide /react-role-setup from configured mod-role members who don't hold
// the raw Manage Roles permission. Gated here in code instead.
function isModerator(interaction) {
  const settings = getGuildSettings(interaction.guild.id);
  const modRoleIds = settings.modRoleIds || [];
  if (modRoleIds.length > 0) {
    return interaction.member.roles.cache.some((role) => modRoleIds.includes(role.id));
  }
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles) ?? false;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('react-role-setup')
    .setDescription('Create a reaction-role message (react with an emoji to get a role)')
    .addChannelOption((opt) =>
      opt
        .setName('channel')
        .setDescription('Where to post the message (defaults to this channel)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),

  async execute(interaction) {
    if (!isModerator(interaction)) {
      return interaction.reply({
        content: "You need to be a configured mod role (see `/panel`) or have **Manage Roles** to use this.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const channel = interaction.options.getChannel('channel') || interaction.channel;

    const session = sessionStore.createSession(interaction.user.id, {
      guildId: interaction.guildId,
      channelId: channel.id,
      purpose: 'reactrole',
    });

    const embed = buildEmbedFromDraft(session.draft);
    const components = buildPanelComponents(session);

    return interaction.reply({
      content:
        `Setting up a **reaction-role** message for <#${channel.id}>.\n` +
        'Use **➕ Add something → 🎭 Add a Reaction Role** to pair an emoji with a role.\n' +
        "When you click **📤 Send Now**, I'll post the message and add the reactions for you.\n\n" +
        buildGuideText(session),
      embeds: [embed],
      components,
      flags: MessageFlags.Ephemeral,
    });
  },
};
