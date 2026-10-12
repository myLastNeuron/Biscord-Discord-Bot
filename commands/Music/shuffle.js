const { SlashCommandBuilder } = require('discord.js');
const music = require('../../utils/musicManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('shuffle')
    .setDescription('Shuffle the queued songs'),

  async execute(interaction) {
    const session = music.getSession(interaction.guildId);
    if (!session) {
      return interaction.reply({ embeds: [music.errorEmbed('The queue is empty.')] });
    }
    music.shuffle(interaction.guildId);
    return interaction.reply({ embeds: [music.infoEmbed('shuffled', 'The queue has been shuffled.')] });
  },
};
