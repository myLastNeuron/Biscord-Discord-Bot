const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
   const { connectToChannel, isKeptAlive } = require('../../keepAlive');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('connect')
    .setDescription('Join your voice channel and stay connected.')
    // Taking over the bot's voice presence is a moderation action, not
    // something any member should be able to do.
    .setDefaultMemberPermissions(PermissionFlagsBits.MoveMembers),

  async execute(interaction) {
    const member = interaction.member;
    const channel = member.voice?.channel;

    if (!channel) {
      return interaction.reply({
        content: 'You need to be in a voice channel for me to join.',
        ephemeral: true,
      });
    }

    if (isKeptAlive(interaction.guildId)) {
      return interaction.reply({
        content: `I'm already keeping a voice channel alive in this server. Use \`/leave\` first if you want to switch.`,
        ephemeral: true,
      });
    }

    connectToChannel(channel);

    return interaction.reply({
      content: `Connected to **${channel.name}** and staying put.`,
      ephemeral: true,
    });
  },
};
