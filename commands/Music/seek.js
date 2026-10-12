const { SlashCommandBuilder } = require('discord.js');
const music = require('../../utils/musicManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('seek')
    .setDescription('Seek to a timestamp in the current song')
    .addStringOption((o) =>
      o.setName('time').setDescription('Timestamp — e.g. 90, 1:30, or 1:02:30').setRequired(true),
    ),

  async execute(interaction) {
    const seconds = music.parseTime(interaction.options.getString('time'));
    if (seconds === null) {
      return interaction.reply({ embeds: [music.errorEmbed('Give me a timestamp like `90`, `1:30`, or `1:02:30`.')] });
    }
    const ok = music.seek(interaction.guildId, seconds);
    if (!ok) {
      return interaction.reply({ embeds: [music.errorEmbed('Nothing is playing right now.')] });
    }
    return interaction.reply({ embeds: [music.infoEmbed('seeked', `Jumped to \`${music.fmtTime(seconds)}\`.`)] });
  },
};
