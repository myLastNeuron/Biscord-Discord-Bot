const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder } = require('discord.js');
const { getGuildSettings, setGuildSettings } = require('../../utils/db');
const { buildWelcomeEmbed } = require('../../utils/welcomeBuilder');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('Configure or test the welcomer')
    .addSubcommand(sub => sub.setName('setup')
      .setDescription('Set the welcome channel and message')
      .addChannelOption(o => o.setName('channel').setDescription('Channel to post welcome messages in').addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addStringOption(o => o.setName('message').setDescription('Use {user}, {server}, {memberCount} as placeholders').setRequired(false))
      .addStringOption(o => o.setName('image').setDescription('Image URL to show on the welcome card').setRequired(false)))
    .addSubcommand(sub => sub.setName('test')
      .setDescription('Send a test welcome message for yourself'))
    .addSubcommand(sub => sub.setName('disable')
      .setDescription('Turn off the welcomer'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'setup') {
      const channel = interaction.options.getChannel('channel');
      const message = interaction.options.getString('message');
      const image = interaction.options.getString('image');

      const patch = { welcomeChannelId: channel.id };
      if (message) patch.welcomeMessage = message;
      if (image) patch.welcomeImage = image;
      setGuildSettings(interaction.guild.id, patch);

      return interaction.reply({ content: `Welcomer configured. New members will be greeted in ${channel}.`, ephemeral: true });
    }

    if (sub === 'disable') {
      setGuildSettings(interaction.guild.id, { welcomeChannelId: null });
      return interaction.reply({ content: 'Welcomer disabled.', ephemeral: true });
    }

    if (sub === 'test') {
      const settings = getGuildSettings(interaction.guild.id);
      const embed = buildWelcomeEmbed(interaction.member, settings);
      return interaction.reply({ embeds: [embed] });
    }
  },
};
