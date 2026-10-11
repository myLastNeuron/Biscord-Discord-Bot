const { SlashCommandBuilder } = require('discord.js');
   const { stopKeepAlive, isKeptAlive } = require('../../keepAlive');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leave')
    .setDescription('Disconnect the bot from voice and stop keep-alive.'),

  async execute(interaction) {
    if (!isKeptAlive(interaction.guildId)) {
      return interaction.reply({
        content: "I'm not in a voice channel.",
        ephemeral: true,
      });
    }

    // Stop live TTS first so it releases the connection before keep-alive destroys it.
    try {
      require('../../utils/ttsLiveManager').stop(interaction.guildId);
    } catch { /* TTS already off — ignore */ }

    stopKeepAlive(interaction.guildId);

    return interaction.reply({
      content: 'Disconnected.',
      ephemeral: true,
    });
  },
};
