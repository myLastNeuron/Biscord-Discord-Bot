/**
 * /xp [user]
 * Shows XP, level, and progress to the next level. Also available as `!xp`.
 */

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { buildXpEmbed } = require('../../utils/xpEmbed');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('xp')
    .setDescription('Check your (or someone else\'s) level and XP.')
    .addUserOption(o => o.setName('user').setDescription('The user to check').setRequired(false)),

  async execute(interaction) {
    const target = interaction.options.getUser('user') ?? interaction.user;
    await interaction.reply({
      embeds: [buildXpEmbed(target, interaction.guild.id)],
      flags: MessageFlags.Ephemeral,
    });
  },
};
