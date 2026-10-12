const { SlashCommandBuilder } = require('discord.js');
const music = require('../../utils/musicManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('nowplaying')
    .setDescription('Show what is playing right now'),

  async execute(interaction) {
    const session = music.getSession(interaction.guildId);
    if (!session?.current) {
      return interaction.reply({ embeds: [music.errorEmbed('Nothing is playing right now.')] });
    }
    const message = await interaction.reply({
      embeds: [music.nowPlayingEmbed(session)],
      components: music.playerComponents(session),
      fetchReply: true,
    });
    music.attachPlayerMessage(interaction.guildId, message);
  },
};
