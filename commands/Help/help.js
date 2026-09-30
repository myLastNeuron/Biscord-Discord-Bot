const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { buildHelpOverviewEmbed, buildHelpOverviewComponents } = require('../../utils/helpBuilder');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('See everything the bot can do — every command and feature'),

  async execute(interaction) {
    await interaction.reply({
      embeds: [buildHelpOverviewEmbed(interaction.guild)],
      components: buildHelpOverviewComponents(),
      flags: MessageFlags.Ephemeral,
    });
  },
};