const {
  ContextMenuCommandBuilder,
  ApplicationCommandType,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require('discord.js');

module.exports = {
  data: new ContextMenuCommandBuilder()
    .setName('React to Message')
    .setType(ApplicationCommandType.Message)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction) {
    const target = interaction.targetMessage;

    const modal = new ModalBuilder()
      .setCustomId(`manualreact:modal:${target.channelId}:${target.id}`)
      .setTitle('React to Message');

    const input = new TextInputBuilder()
      .setCustomId('emojis')
      .setLabel('Emoji(s), space or comma separated')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
  },
};
