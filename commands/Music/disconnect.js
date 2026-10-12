const { SlashCommandBuilder } = require('discord.js');
const music = require('../../utils/musicManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('disconnect')
    .setDescription('Stop music and disconnect the bot from voice'),

  async execute(interaction) {
    const { session, connection } = music.leave(interaction.guildId);
    if (!session && !connection) {
      return interaction.reply({ embeds: [music.errorEmbed('I’m not in a voice channel.')] });
    }
    return interaction.reply({ embeds: [music.stoppedEmbed()] });
  },
};
