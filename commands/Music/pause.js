const { SlashCommandBuilder } = require('discord.js');
const music = require('../../utils/musicManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pause')
    .setDescription('Pause playback'),

  async execute(interaction) {
    const ok = music.pause(interaction.guildId);
    if (!ok) {
      return interaction.reply({ embeds: [music.errorEmbed('Nothing is playing right now.')] });
    }
    return interaction.reply({ embeds: [music.infoEmbed('paused', 'Playback paused. Use `/resume` to continue.')] });
  },
};
