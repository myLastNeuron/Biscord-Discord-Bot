const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { getGuildSettings, listGiveaways, getGiveaway, deleteGiveaway } = require('../../utils/db');
const { createAndPostGiveaway, finalizeGiveaway, rerollGiveaway, syncGiveawayMessage } = require('../../utils/giveawayManager');
const { parseDuration, formatDuration, MAX_GIVEAWAY_DURATION_MS } = require('../../utils/duration');
const {
  buildGiveawaySettingsEmbed, buildGiveawaySettingsComponents,
} = require('../../utils/panelBuilder');

// Shared by end/reroll/delete's autocomplete — matches the focused text
// against each giveaway's prize, most recent first.
async function autocompleteGiveaways(interaction, { statusFilter } = {}) {
  const focused = interaction.options.getFocused().toLowerCase();
  let giveaways = listGiveaways(interaction.guild.id);
  if (statusFilter) giveaways = giveaways.filter((g) => g.status === statusFilter);
  giveaways = giveaways
    .filter((g) => g.prize.toLowerCase().includes(focused))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 25);

  await interaction.respond(
    giveaways.map((g) => ({
      name: `${g.status === 'active' ? '🟢' : '⚪'} ${g.prize}`.slice(0, 100),
      value: g.token,
    })),
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Create and manage giveaways')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) => sub
      .setName('create')
      .setDescription('Start a new giveaway')
      .addStringOption((opt) => opt.setName('prize').setDescription('What are you giving away?').setRequired(true).setMaxLength(200))
      .addStringOption((opt) => opt.setName('duration').setDescription('How long it runs, e.g. 30m, 2h, 1d12h').setRequired(true))
      .addIntegerOption((opt) => opt.setName('winners').setDescription('Number of winners (default 1)').setMinValue(1).setMaxValue(50))
      .addChannelOption((opt) => opt.setName('channel').setDescription('Channel to post in (default: this channel)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
    .addSubcommand((sub) => sub
      .setName('end')
      .setDescription('End a giveaway immediately and draw winner(s)')
      .addStringOption((opt) => opt.setName('giveaway').setDescription('Which giveaway').setRequired(true).setAutocomplete(true)))
    .addSubcommand((sub) => sub
      .setName('reroll')
      .setDescription('Re-draw winner(s) for an ended giveaway')
      .addStringOption((opt) => opt.setName('giveaway').setDescription('Which giveaway').setRequired(true).setAutocomplete(true))
      .addIntegerOption((opt) => opt.setName('winners').setDescription('Number of winners to draw (default: original count)').setMinValue(1).setMaxValue(50)))
    .addSubcommand((sub) => sub
      .setName('delete')
      .setDescription('Delete a giveaway\'s record and disable its message')
      .addStringOption((opt) => opt.setName('giveaway').setDescription('Which giveaway').setRequired(true).setAutocomplete(true)))
    .addSubcommand((sub) => sub
      .setName('list')
      .setDescription('View and manage this server\'s giveaways')),

  async autocomplete(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'end') return autocompleteGiveaways(interaction, { statusFilter: 'active' });
    if (sub === 'reroll') return autocompleteGiveaways(interaction, { statusFilter: 'ended' });
    if (sub === 'delete') return autocompleteGiveaways(interaction);
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const settings = getGuildSettings(interaction.guild.id);

    if (sub === 'create') {
      const prize = interaction.options.getString('prize');
      const durationInput = interaction.options.getString('duration');
      const winnerCount = interaction.options.getInteger('winners') || 1;
      const channel = interaction.options.getChannel('channel') || interaction.channel;

      const durationMs = parseDuration(durationInput);
      if (!durationMs) {
        return interaction.reply({
          content: `❌ Couldn't parse "${durationInput}" as a duration. Try something like \`30m\`, \`2h\`, or \`1d12h\`.`,
          flags: MessageFlags.Ephemeral,
        });
      }
      if (durationMs > MAX_GIVEAWAY_DURATION_MS) {
        return interaction.reply({
          content: `❌ Giveaways can't run longer than 30 days.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      const giveaway = await createAndPostGiveaway({
        channel, guild: interaction.guild, settings, prize, winnerCount, durationMs, organiserId: interaction.user.id,
      });

      return interaction.reply({
        content: `🎉 Giveaway for **${prize}** posted in ${channel} — ends in ${formatDuration(durationMs)} with ${winnerCount} winner(s).`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'end') {
      const token = interaction.options.getString('giveaway');
      const giveaway = getGiveaway(token);
      if (!giveaway) return interaction.reply({ content: '❌ Giveaway not found.', flags: MessageFlags.Ephemeral });
      if (giveaway.status !== 'active') return interaction.reply({ content: '⚠️ That giveaway has already ended.', flags: MessageFlags.Ephemeral });

      await finalizeGiveaway(interaction.client, token, settings);
      return interaction.reply({ content: `✅ Ended the giveaway for **${giveaway.prize}** and drew winner(s).`, flags: MessageFlags.Ephemeral });
    }

    if (sub === 'reroll') {
      const token = interaction.options.getString('giveaway');
      const giveaway = getGiveaway(token);
      if (!giveaway) return interaction.reply({ content: '❌ Giveaway not found.', flags: MessageFlags.Ephemeral });
      if (giveaway.status !== 'ended') return interaction.reply({ content: '⚠️ That giveaway hasn\'t ended yet.', flags: MessageFlags.Ephemeral });

      const winnerCount = interaction.options.getInteger('winners');
      await rerollGiveaway(interaction.client, token, settings, winnerCount);
      return interaction.reply({ content: `🔁 Rerolled winner(s) for **${giveaway.prize}**.`, flags: MessageFlags.Ephemeral });
    }

    if (sub === 'delete') {
      const token = interaction.options.getString('giveaway');
      const giveaway = getGiveaway(token);
      if (!giveaway) return interaction.reply({ content: '❌ Giveaway not found.', flags: MessageFlags.Ephemeral });

      deleteGiveaway(token);
      await syncGiveawayMessage(interaction.client, { ...giveaway, status: 'ended', winners: giveaway.winners || [] }, settings).catch(() => null);
      return interaction.reply({ content: `🗑️ Deleted the giveaway for **${giveaway.prize}**.`, flags: MessageFlags.Ephemeral });
    }

    if (sub === 'list') {
      const giveaways = listGiveaways(interaction.guild.id);
      return interaction.reply({
        embeds: [buildGiveawaySettingsEmbed(interaction.guild, giveaways, settings)],
        components: buildGiveawaySettingsComponents(giveaways),
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
