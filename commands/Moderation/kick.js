const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { logAction } = require('../../utils/modLog');
const { buildModActionPayload } = require('../../utils/moderationBuilder');
const { PREMIUM_COLORS } = require('../../utils/theme');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member from the server')
    .addUserOption(o => o.setName('user').setDescription('User to kick').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for the kick').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

  async execute(interaction) {
    const target = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!member) return interaction.reply({ content: 'That user is not in this server.', ephemeral: true });
    // Hierarchy guard: the invoker must outrank the target. (Discord only
    // enforces the BOT's hierarchy via `kickable`, so without this anyone
    // with KickMembers could kick people above them.)
    if (target.id === interaction.user.id) {
      return interaction.reply({ content: "You can't kick yourself.", ephemeral: true });
    }
    if (target.id === interaction.client.user.id) {
      return interaction.reply({ content: "I can't kick myself.", ephemeral: true });
    }
    if (member.id === interaction.guild.ownerId) {
      return interaction.reply({ content: `I can't kick ${target.tag} — they own the server.`, ephemeral: true });
    }
    const invoker = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!invoker) {
      return interaction.reply({ content: "Couldn't verify your roles — try again.", ephemeral: true });
    }
    const invokerPos = invoker.roles?.highest?.position ?? -1;
    const targetPos = member.roles?.highest?.position ?? -1;
    if (interaction.user.id !== interaction.guild.ownerId && invokerPos <= targetPos) {
      return interaction.reply({ content: `You can't kick ${target.tag} — their role is higher than or equal to yours.`, ephemeral: true });
    }
    if (!member.kickable) {
      return interaction.reply({ content: `I can't kick ${target.tag} — they may have a higher role than me.`, ephemeral: true });
    }

    await member.kick(`${reason} | by ${interaction.user.tag}`);

    await interaction.reply(buildModActionPayload({
      color: PREMIUM_COLORS.kick,
      emoji: '✅',
      summary: `${target.tag} was kicked.`,
      details: [`Reason: ${reason}`, `Moderator: ${interaction.user.tag}`],
    }));

    const logEmbed = new EmbedBuilder()
      .setColor(PREMIUM_COLORS.kick)
      .setTitle('👢 Member Kicked')
      .addFields(
        { name: 'User', value: `${target.tag} (${target.id})` },
        { name: 'Moderator', value: `${interaction.user.tag}` },
        { name: 'Reason', value: reason },
      )
      .setTimestamp();
    await logAction(interaction.guild, logEmbed);
  },
};
