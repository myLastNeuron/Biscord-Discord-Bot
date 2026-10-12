const { SlashCommandBuilder } = require('discord.js');
const music = require('../../utils/musicManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('loop')
    .setDescription('Loop the current song, the queue, or turn looping off')
    .addStringOption((o) =>
      o
        .setName('mode')
        .setDescription('Loop mode (omit to cycle)')
        .addChoices(
          { name: 'Song', value: 'track' },
          { name: 'Queue', value: 'queue' },
          { name: 'Off', value: 'off' },
        ),
    ),

  async execute(interaction) {
    const session = music.getSession(interaction.guildId);
    if (!session) {
      return interaction.reply({ embeds: [music.errorEmbed('Nothing is playing right now.')] });
    }
    const mode = interaction.options.getString('mode');
    if (mode) music.setLoop(interaction.guildId, mode);
    else music.cycleLoop(interaction.guildId);

    return interaction.reply({
      embeds: [music.infoEmbed('loop', `Loop mode set to **${music.loopLabel(session.loop)}**.`)],
    });
  },
};
