const { SlashCommandBuilder } = require('discord.js');
const music = require('../../utils/musicManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stop playback, clear the queue, and leave voice'),

  async execute(interaction) {
    const { session } = music.leave(interaction.guildId);
    if (!session) {
      return interaction.reply({ embeds: [music.errorEmbed('I’m not playing anything right now.')] });
    }
    return interaction.reply({ embeds: [music.stoppedEmbed()] });
  },
};
