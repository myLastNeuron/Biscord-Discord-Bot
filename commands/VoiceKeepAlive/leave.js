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

    // Stop live TTS FIRST so it can hand the connection back to music (if it
    // was ducked) before keep-alive destroys the connection object. Music
    // itself is left alone on purpose — /music stop/leave owns that path.
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
