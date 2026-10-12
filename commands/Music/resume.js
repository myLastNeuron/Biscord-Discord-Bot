const { SlashCommandBuilder } = require('discord.js');
const music = require('../../utils/musicManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('resume')
    .setDescription('Resume playback'),

  async execute(interaction) {
    const ok = music.resume(interaction.guildId);
    if (!ok) {
      return interaction.reply({ embeds: [music.errorEmbed('Nothing is paused right now.')] });
    }
    return interaction.reply({ embeds: [music.infoEmbed('resumed', 'Playback resumed.')] });
  },
};
