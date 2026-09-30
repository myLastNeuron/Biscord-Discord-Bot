const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { logAction } = require('../../utils/modLog');
const { buildModActionPayload } = require('../../utils/moderationBuilder');
const { PREMIUM_COLORS } = require('../../utils/theme');

const UNIT_MS = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Timeout (mute) a member for a duration')
    .addUserOption(o => o.setName('user').setDescription('User to timeout').setRequired(true))
    .addIntegerOption(o => o.setName('duration').setDescription('Length of the timeout').setMinValue(1).setRequired(true))
    .addStringOption(o => o.setName('unit').setDescription('Unit for duration')
      .addChoices(
        { name: 'Minutes', value: 'minutes' },
        { name: 'Hours', value: 'hours' },
        { name: 'Days', value: 'days' },
      ).setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for the timeout'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    const target = interaction.options.getUser('user');
    const amount = interaction.options.getInteger('duration');
    const unit = interaction.options.getString('unit');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const ms = amount * UNIT_MS[unit];

    if (ms <= 0) {
      return interaction.reply({ content: 'Duration must be at least 1 minute.', ephemeral: true });
    }

    if (ms > 28 * 86_400_000) {
      return interaction.reply({ content: 'Discord timeouts cannot exceed 28 days.', ephemeral: true });
    }

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!member) return interaction.reply({ content: 'That user is not in this server.', ephemeral: true });
    // Hierarchy guard: the invoker must outrank the target. (Discord only
    // enforces the BOT's hierarchy via `moderatable`, so without this anyone
    // with ModerateMembers could timeout people above them.)
    if (target.id === interaction.user.id) {
      return interaction.reply({ content: "You can't timeout yourself.", ephemeral: true });
    }
    if (target.id === interaction.client.user.id) {
      return interaction.reply({ content: "I can't timeout myself.", ephemeral: true });
    }
    if (member.id === interaction.guild.ownerId) {
      return interaction.reply({ content: `I can't timeout ${target.tag} — they own the server.`, ephemeral: true });
    }
    const invoker = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!invoker) {
      return interaction.reply({ content: "Couldn't verify your roles — try again.", ephemeral: true });
    }
    const invokerPos = invoker.roles?.highest?.position ?? -1;
    const targetPos = member.roles?.highest?.position ?? -1;
    if (interaction.user.id !== interaction.guild.ownerId && invokerPos <= targetPos) {
      return interaction.reply({ content: `You can't timeout ${target.tag} — their role is higher than or equal to yours.`, ephemeral: true });
    }
    if (!member.moderatable) {
      return interaction.reply({ content: `I can't timeout ${target.tag} — they may have a higher role than me.`, ephemeral: true });
    }

    await member.timeout(ms, `${reason} | by ${interaction.user.tag}`);

    await interaction.reply(buildModActionPayload({
      color: PREMIUM_COLORS.timeout,
      emoji: '✅',
      summary: `${target.tag} was timed out for ${amount} ${unit}.`,
      details: [`Reason: ${reason}`, `Moderator: ${interaction.user.tag}`],
    }));

    const logEmbed = new EmbedBuilder()
      .setColor(PREMIUM_COLORS.timeout)
      .setTitle('🔇 Member Timed Out')
      .addFields(
        { name: 'User', value: `${target.tag} (${target.id})` },
        { name: 'Duration', value: `${amount} ${unit}` },
        { name: 'Moderator', value: `${interaction.user.tag}` },
        { name: 'Reason', value: reason },
      )
      .setTimestamp();
    await logAction(interaction.guild, logEmbed);
  },
};
