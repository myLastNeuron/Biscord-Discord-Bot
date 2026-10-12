const { SlashCommandBuilder } = require('discord.js');
const music = require('../../utils/musicManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Show the current queue'),

  async execute(interaction) {
    const session = music.getSession(interaction.guildId);
    if (!session) {
      return interaction.reply({ embeds: [music.errorEmbed('The queue is empty.')] });
    }
    return interaction.reply({ embeds: [music.queueEmbed(session)] });
  },
};
