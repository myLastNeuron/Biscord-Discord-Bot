const { SlashCommandBuilder } = require('discord.js');
const music = require('../../utils/musicManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Remove a song from the queue by its position')
    .addIntegerOption((o) =>
      o.setName('position').setDescription('Queue position (see /queue)').setRequired(true).setMinValue(1),
    ),

  async execute(interaction) {
    const pos = interaction.options.getInteger('position');
    const removed = music.removeAt(interaction.guildId, pos);
    if (!removed) {
      return interaction.reply({ embeds: [music.errorEmbed(`No song at position **#${pos}**.`)] });
    }
    return interaction.reply({ embeds: [music.infoEmbed('removed', `Removed **${removed.title}** from the queue.`)] });
  },
};
