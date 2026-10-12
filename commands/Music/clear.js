const { SlashCommandBuilder } = require('discord.js');
const music = require('../../utils/musicManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Clear the queued songs (keeps the current one playing)'),

  async execute(interaction) {
    const removed = music.clearQueue(interaction.guildId);
    if (removed <= 0) {
      return interaction.reply({ embeds: [music.errorEmbed('There is nothing queued to clear.')] });
    }
    return interaction.reply({ embeds: [music.infoEmbed('cleared', `Removed **${removed}** song${removed === 1 ? '' : 's'} from the queue.`)] });
  },
};
