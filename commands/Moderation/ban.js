const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { getGuildSettings } = require('../../utils/db');
const { logAction } = require('../../utils/modLog');
const { buildModActionPayload } = require('../../utils/moderationBuilder');
const { PREMIUM_COLORS } = require('../../utils/theme');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a member from the server')
    .addUserOption(o => o.setName('user').setDescription('User to ban').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason for the ban').setRequired(false))
    .addIntegerOption(o => o.setName('delete_days').setDescription('Delete messages from the last N days (0-7)').setMinValue(0).setMaxValue(7))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  async execute(interaction) {
    const target = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    const deleteDays = interaction.options.getInteger('delete_days') || 0;

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    // Hierarchy guard: the invoker must outrank the target. (Discord only
    // enforces the BOT's hierarchy via `bannable`, so without this anyone
    // with BanMembers could ban people above them.)
    // NOTE: bans by ID for users NOT in the server skip this (no roles to
    // compare) — same as Discord's native behaviour.
    if (member) {
      if (target.id === interaction.user.id) {
        return interaction.reply({ content: "You can't ban yourself.", ephemeral: true });
      }
      if (target.id === interaction.client.user.id) {
        return interaction.reply({ content: "I can't ban myself.", ephemeral: true });
      }
      if (member.id === interaction.guild.ownerId) {
        return interaction.reply({ content: `I can't ban ${target.tag} — they own the server.`, ephemeral: true });
      }
      const invoker = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      if (!invoker) {
        return interaction.reply({ content: "Couldn't verify your roles — try again.", ephemeral: true });
      }
      const invokerPos = invoker.roles?.highest?.position ?? -1;
      const targetPos = member.roles?.highest?.position ?? -1;
      if (interaction.user.id !== interaction.guild.ownerId && invokerPos <= targetPos) {
        return interaction.reply({ content: `You can't ban ${target.tag} — their role is higher than or equal to yours.`, ephemeral: true });
      }
      if (!member.bannable) {
        return interaction.reply({ content: `I can't ban ${target.tag} — they may have a higher role than me.`, ephemeral: true });
      }
    }

    await interaction.guild.members.ban(target.id, {
      deleteMessageSeconds: deleteDays * 86400,
      reason: `${reason} | by ${interaction.user.tag}`,
    });

    await interaction.reply(buildModActionPayload({
      color: PREMIUM_COLORS.ban,
      emoji: '✅',
      summary: `${target.tag} was banned.`,
      details: [`Reason: ${reason}`, `Moderator: ${interaction.user.tag}`],
    }));

    const logEmbed = new EmbedBuilder()
      .setColor(PREMIUM_COLORS.ban)
      .setTitle('🔨 Member Banned')
      .addFields(
        { name: 'User', value: `${target.tag} (${target.id})` },
        { name: 'Moderator', value: `${interaction.user.tag}` },
        { name: 'Reason', value: reason },
      )
      .setTimestamp();
    await logAction(interaction.guild, logEmbed);
  },
};
