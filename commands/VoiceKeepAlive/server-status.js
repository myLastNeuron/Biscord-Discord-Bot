const { SlashCommandBuilder } = require('discord.js');
const { registerStatusMessage, buildStatusContent } = require('../../serverStatusTracker');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('server-status')
    .setDescription('Show total members and how many are online, idle, or DND. Auto-refreshes every 30s.'),

  async execute(interaction) {
    await interaction.deferReply();

    const guild = interaction.guild;

    // buildStatusContent() reads from guild.members.cache (kept live by the
    // GuildMembers + GuildPresences intents) - no gateway fetch here, same
    // fix as before, so this is safe to call every 30s from the tracker too.
    const content = buildStatusContent(guild);

    const reply = await interaction.editReply({ content });

    // Hand this message off to serverStatusTracker.js, which will edit it
    // in place every 30 seconds with fresh numbers. Running the command
    // again just replaces the tracked message for this guild.
    registerStatusMessage(guild.id, interaction.channelId, reply.id);

    return reply;
  },
};
