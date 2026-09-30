const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { buildModActionPayload } = require('../../utils/moderationBuilder');
const { PREMIUM_COLORS } = require('../../utils/theme');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Bulk delete recent messages in this channel')
    .addIntegerOption(o => o.setName('amount').setDescription('Number of messages to delete (1-100)').setRequired(true).setMinValue(1).setMaxValue(100))
    .addUserOption(o => o.setName('user').setDescription('Only delete messages from this user'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction) {
    // The IsComponentsV2 flag is permanent once a message is first sent
    // with it, and can't be added afterward via editReply() — so it has to
    // be set here, on the initial deferred reply, not just on the final
    // editReply() below.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2 });
    const amount = interaction.options.getInteger('amount');
    const user = interaction.options.getUser('user');

    const messages = await interaction.channel.messages.fetch({ limit: 100 });
    let toDelete = [...messages.values()];
    if (user) toDelete = toDelete.filter(m => m.author.id === user.id);
    toDelete = toDelete.slice(0, amount);

    const deleted = await interaction.channel.bulkDelete(toDelete, true).catch(() => null);

    await interaction.editReply(deleted
      ? buildModActionPayload({ color: PREMIUM_COLORS.success, emoji: '✅', summary: `Deleted ${deleted.size} message(s).` })
      : buildModActionPayload({ color: PREMIUM_COLORS.danger, emoji: '❌', summary: 'Failed to delete messages (they may be older than 14 days).' }));
  },
};
