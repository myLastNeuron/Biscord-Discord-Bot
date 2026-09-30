const { SlashCommandBuilder, ChannelType } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('vc-members')
    .setDescription('Show how many members are currently in a voice channel.')
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('The voice channel to check')
        .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
        .setRequired(true)
    ),

  async execute(interaction) {
    const channel = interaction.options.getChannel('channel');

    if (!channel || (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice)) {
      return interaction.reply({
        content: 'Please select a valid voice channel.',
        ephemeral: true,
      });
    }

    const members = channel.members; // Collection<Snowflake, GuildMember>
    const count = members.size;

    if (count === 0) {
      return interaction.reply({
        content: `**${channel.name}** currently has no members in it.`,
      });
    }

    const memberList = members
      .map((m) => `• ${m.displayName}`)
      .join('\n');

    return interaction.reply({
      content: `**${channel.name}** — ${count} member${count === 1 ? '' : 's'} connected:\n${memberList}`,
    });
  },
};
