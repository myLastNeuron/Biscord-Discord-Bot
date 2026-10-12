const { SlashCommandBuilder } = require('discord.js');
const music = require('../../utils/musicManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('jump')
    .setDescription('Jump to a song in the queue by its position')
    .addIntegerOption((o) =>
      o.setName('position').setDescription('Queue position (see /queue)').setRequired(true).setMinValue(1),
    ),

  async execute(interaction) {
    const pos = interaction.options.getInteger('position');
    const track = music.jumpTo(interaction.guildId, pos);
    if (!track) {
      return interaction.reply({ embeds: [music.errorEmbed(`No song at position **#${pos}**.`)] });
    }
    return interaction.reply({ embeds: [music.infoEmbed('jumped', `Now playing **${track.title}**.`)] });
  },
};
