const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rolerequest')
    .setDescription('Role request panel management')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('panel')
        .setDescription('Post the Request Role button in a channel')
        .addChannelOption((opt) =>
          opt
            .setName('channel')
            .setDescription('Channel to post the panel in (defaults to this channel)')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('customize')
        .setDescription('Customize the role request embed'),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'panel') {
      const channel = interaction.options.getChannel('channel') || interaction.channel;

      const embed = new EmbedBuilder()
        .setTitle('Family Role Request')
        .setDescription(
          'Click the button below to request a family role.\n\n' +
          'You will be asked for your **ID**, **Name**, **Rank**, **Montages** ' +
          '(write `null` if you have none), and a **screenshot link** of you being in the family.\n\n' +
          'Your request will be reviewed by Admin/HC.'
        )
        .setColor(0x5865f2);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('rolerequest:open')
          .setLabel('Request Role')
          .setStyle(ButtonStyle.Primary),
      );

      await channel.send({ embeds: [embed], components: [row] });
      return interaction.reply({ content: `Role request panel posted in ${channel}.`, ephemeral: true });
    }

    if (sub === 'customize') {
      const modal = new ModalBuilder()
        .setCustomId('rolerequest:customize')
        .setTitle('Customize Role Request Embed');

      const titleInput = new TextInputBuilder()
        .setCustomId('embedTitle')
        .setLabel('Embed Title')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(256)
        .setValue('Family Role Request')
        .setRequired(true);

      const descriptionInput = new TextInputBuilder()
        .setCustomId('embedDescription')
        .setLabel('Embed Description')
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(4000)
        .setValue('Click the button below to request a family role.\n\nYou will be asked for your **ID**, **Name**, **Rank**, **Montages** (write `null` if you have none), and a **screenshot link** of you being in the family.\n\nYour request will be reviewed by Admin/HC.')
        .setRequired(true);

      const buttonLabelInput = new TextInputBuilder()
        .setCustomId('buttonLabel')
        .setLabel('Button Label')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(80)
        .setValue('Request Role')
        .setRequired(true);

      const colorInput = new TextInputBuilder()
        .setCustomId('embedColor')
        .setLabel('Embed Color (hex, e.g., 5865f2)')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(6)
        .setValue('5865f2')
        .setRequired(true);

      const imageInput = new TextInputBuilder()
        .setCustomId('embedImage')
        .setLabel('Image URL (leave blank for none)')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(2048)
        .setRequired(false);

      modal.addComponents(
        new ActionRowBuilder().addComponents(titleInput),
        new ActionRowBuilder().addComponents(descriptionInput),
        new ActionRowBuilder().addComponents(buttonLabelInput),
        new ActionRowBuilder().addComponents(colorInput),
        new ActionRowBuilder().addComponents(imageInput),
      );

      return interaction.showModal(modal);
    }
  },
};
