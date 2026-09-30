const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { getBotConfig } = require('../../utils/botConfigStore');
const { buildBotConfigPayload } = require('../../utils/botConfigBuilder');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bot-config')
    .setDescription("Edit the bot's status, activity, username, and avatar")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const config = getBotConfig();
    const payload = buildBotConfigPayload(config, interaction.client);

    return interaction.reply({
      ...payload,
      ephemeral: true,
    });
  },
};
