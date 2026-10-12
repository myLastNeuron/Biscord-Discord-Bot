const { SlashCommandBuilder } = require('discord.js');
const music = require('../../utils/musicManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a song or add it to the queue')
    .addStringOption((o) =>
      o.setName('query').setDescription('Song name or URL').setRequired(true),
    ),

  async execute(interaction) {
    await interaction.deferReply();
    const ctx = {
      guildId: interaction.guildId,
      member: interaction.member,
      userId: interaction.user.id,
      tag: interaction.user.tag,
      textChannelId: interaction.channelId,
    };

    try {
      const result = await music.play(ctx, interaction.options.getString('query'));
      const message = await interaction.editReply({
        embeds: [music.playResultEmbed(result)],
        components: result.nowPlaying ? music.playerComponents(result.session) : [],
      });
      if (result.nowPlaying) music.attachPlayerMessage(interaction.guildId, message);
      return;
    } catch (err) {
      if (err instanceof music.UserError) {
        return interaction.editReply({ embeds: [music.errorEmbed(err.message)] });
      }
      throw err;
    }
  },
};
