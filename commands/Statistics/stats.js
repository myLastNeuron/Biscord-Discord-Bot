const { SlashCommandBuilder } = require('discord.js');
const { getUserStats } = require('../../utils/db');
const { buildStatsEmbed } = require('../../utils/statsBuilder');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('View event attendance stats')
    .addUserOption(o => o.setName('user').setDescription('View someone else\'s stats (defaults to you)')),

  async execute(interaction) {
    const target = interaction.options.getUser('user') || interaction.user;
    const stats = getUserStats(interaction.guild.id, target.id);
    const embed = buildStatsEmbed(target, stats);
    await interaction.reply({ embeds: [embed] });
  },
};
