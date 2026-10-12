const { SlashCommandBuilder } = require('discord.js');
const music = require('../../utils/musicManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Set the playback volume (0–200%)')
    .addIntegerOption((o) =>
      o.setName('amount').setDescription('Volume percent').setRequired(true).setMinValue(0).setMaxValue(200),
    ),

  async execute(interaction) {
    const amount = interaction.options.getInteger('amount');
    const applied = music.setVolume(interaction.guildId, amount);
    if (applied === null) {
      return interaction.reply({ embeds: [music.errorEmbed('Nothing is playing right now.')] });
    }
    return interaction.reply({ embeds: [music.infoEmbed('volume', `Volume set to **${applied}%**.`)] });
  },
};
