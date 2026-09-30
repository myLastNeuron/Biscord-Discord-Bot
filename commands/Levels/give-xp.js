/**
 * /give-xp
 * Mod-only: award XP to a user with an optional reason.
 */

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { awardXP, getUser } = require('../../utils/levelStore');
const { notifyLevelUp }    = require('../../utils/levelNotify');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('give-xp')
    .setDescription('(Mod) Award XP to a user.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('XP to award').setMinValue(1).setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason (shown in level-up message)').setRequired(false)),

  async execute(interaction) {
    const target = interaction.options.getUser('user');
    const amount = interaction.options.getInteger('amount');
    const reason = interaction.options.getString('reason') ?? 'Awarded by a moderator';

    const member = interaction.guild.members.cache.get(target.id)
      ?? await interaction.guild.members.fetch(target.id).catch(() => null);

    const result = awardXP(interaction.guild.id, target.id, amount);
    const user   = getUser(interaction.guild.id, target.id);

    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle('✅ XP Awarded')
      .setDescription(`Gave **${amount.toLocaleString()} XP** to ${target}.`)
      .addFields(
        { name: 'Reason',   value: reason,                              inline: false },
        { name: 'Total XP', value: `\`${user.totalXp.toLocaleString()}\``, inline: true },
        { name: 'Level',    value: `\`${user.level}\``,                 inline: true },
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });

    if (result.leveledUp && member) {
      await notifyLevelUp({
        member, channel: interaction.channel, client: interaction.client,
        newLevel: result.newLevel, levelName: result.levelDef?.name ?? `Level ${result.newLevel}`,
        totalXp: user.totalXp, roleId: result.levelDef?.roleId ?? null,
      });
    }
  },
};
