const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
} = require('discord.js');
const { getGuildSettings } = require('../../utils/db');
const { buildEmbedFromDraft, buildLiveButtonRows } = require('../../utils/embedBuilder');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Support ticket panel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('panel')
        .setDescription('Post the Open Ticket button in a channel')
        .addChannelOption((opt) =>
          opt
            .setName('channel')
            .setDescription('Channel to post the panel in (defaults to this channel)')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(false),
        ),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'panel') {
      const channel = interaction.options.getChannel('channel') || interaction.channel;
      const settings = getGuildSettings(interaction.guild.id);
      const panelDraft = settings.ticketPanelEmbedDraft;

      const embed = panelDraft
        ? buildEmbedFromDraft(panelDraft)
        : new EmbedBuilder()
            .setTitle('Support Tickets')
            .setDescription('Need help? Click the button below to open a private ticket with staff.')
            .setColor(0x5865f2);

      const openRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket:open').setLabel('Open Ticket').setStyle(ButtonStyle.Primary),
      );
      // Any decorative link/role buttons from the custom draft go first, the
      // functional Open Ticket button is always appended last and can't be
      // removed via the builder. Capped at 5 rows total (Discord's limit).
      const extraRows = panelDraft ? buildLiveButtonRows(panelDraft.buttons) : [];
      const rows = [...extraRows, openRow].slice(0, 5);

      await channel.send({ embeds: [embed], components: rows });
      return interaction.reply({ content: `Ticket panel posted in ${channel}.`, ephemeral: true });
    }
  },
};
