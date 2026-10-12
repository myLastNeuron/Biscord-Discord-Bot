const { SlashCommandBuilder } = require('discord.js');
const music = require('../../utils/musicManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Skip the current song'),

  async execute(interaction) {
    const skipped = music.skip(interaction.guildId);
    if (!skipped) {
      return interaction.reply({ embeds: [music.errorEmbed('Nothing is playing right now.')] });
    }
    return interaction.reply({ embeds: [music.infoEmbed('skipped', `Skipped **${skipped.title}**.`)] });
  },
};
