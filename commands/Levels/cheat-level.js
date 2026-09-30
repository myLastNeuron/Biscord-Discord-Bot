/**
 * /cheat-level
 * Mod-only: set a user's level or XP directly.
 * Subcommands: setlevel, setxp, addxp
 */

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { setUserLevel, setUserXP, awardXP, getUser, getLevelDefinitions } = require('../../utils/levelStore');
const { notifyLevelUp } = require('../../utils/levelNotify');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cheat-level')
    .setDescription('(Mod) Directly modify a user\'s level or XP.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    .addSubcommand(sub => sub
      .setName('setlevel')
      .setDescription('Set a user\'s level directly.')
      .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
      .addIntegerOption(o => o.setName('level').setDescription('Level to set').setMinValue(0).setRequired(true))
    )

    .addSubcommand(sub => sub
      .setName('setxp')
      .setDescription('Set a user\'s XP to an exact number.')
      .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
      .addIntegerOption(o => o.setName('xp').setDescription('XP amount').setMinValue(0).setRequired(true))
    )

    .addSubcommand(sub => sub
      .setName('addxp')
      .setDescription('Add (or subtract) XP from a user.')
      .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
      .addIntegerOption(o => o.setName('amount').setDescription('XP to add (negative to remove)').setRequired(true))
    ),

  async execute(interaction) {
    const sub    = interaction.options.getSubcommand();
    const target = interaction.options.getUser('user');
    const member = interaction.guild.members.cache.get(target.id)
      ?? await interaction.guild.members.fetch(target.id).catch(() => null);

    const defs = getLevelDefinitions(interaction.guild.id);

    if (sub === 'setlevel') {
      const level = interaction.options.getInteger('level');
      const def   = setUserLevel(interaction.guild.id, target.id, level);

      const embed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle('✅ Level Set')
        .setDescription(`${target}'s level has been set to **${level}** — **${def?.name ?? '?'}**.`);

      await interaction.reply({ embeds: [embed], ephemeral: true });

      // Notify and assign role
      if (member && def?.roleId) {
        await notifyLevelUp({
          member, channel: interaction.channel, client: interaction.client,
          newLevel: level, levelName: def?.name ?? `Level ${level}`,
          totalXp: getUser(interaction.guild.id, target.id).totalXp, roleId: def?.roleId ?? null,
        });
      }
    }

    else if (sub === 'setxp') {
      const xp = interaction.options.getInteger('xp');
      setUserXP(interaction.guild.id, target.id, xp);

      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('✅ XP Set')
          .setDescription(`${target}'s XP has been set to **${xp.toLocaleString()}**.`)],
        ephemeral: true,
      });
    }

    else if (sub === 'addxp') {
      const amount = interaction.options.getInteger('amount');
      const result = awardXP(interaction.guild.id, target.id, amount);

      const embed = new EmbedBuilder()
        .setColor(amount >= 0 ? 0x57f287 : 0xed4245)
        .setTitle(amount >= 0 ? '✅ XP Added' : '✅ XP Removed')
        .setDescription(`${amount >= 0 ? 'Added' : 'Removed'} **${Math.abs(amount).toLocaleString()} XP** ${amount >= 0 ? 'to' : 'from'} ${target}.`)
        .addFields({ name: 'New Level', value: `${result.newLevel}`, inline: true });

      await interaction.reply({ embeds: [embed], ephemeral: true });

      if (result.leveledUp && member) {
        await notifyLevelUp({
          member, channel: interaction.channel, client: interaction.client,
          newLevel: result.newLevel, levelName: result.levelDef?.name ?? `Level ${result.newLevel}`,
          totalXp: getUser(interaction.guild.id, target.id).totalXp, roleId: result.levelDef?.roleId ?? null,
        });
      }
    }
  },
};
