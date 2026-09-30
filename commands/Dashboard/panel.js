const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { buildPanelPayload } = require('../../utils/panelBuilder');
const { getGuildSettings } = require('../../utils/db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Open the server configuration dashboard (welcome, logging, mod roles)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    const settings = getGuildSettings(interaction.guild.id);
    const payload = buildPanelPayload(interaction.guild, settings);
    await interaction.reply({
      ...payload,
      // buildPanelPayload() already sets flags: MessageFlags.IsComponentsV2 —
      // OR in Ephemeral rather than using the old `ephemeral: true` option
      // (deprecated, and can't coexist with a manually-set `flags` anyway).
      flags: payload.flags | MessageFlags.Ephemeral,
    });
  },
};
