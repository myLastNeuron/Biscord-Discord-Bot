const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { listPolls, getPoll, deletePoll } = require('../../utils/db');
const { createAndPostPoll, finalizePoll, syncPollMessage } = require('../../utils/pollManager');
const { buildPollEmbed, buildPollComponents } = require('../../utils/pollBuilder');
const { parseDuration, formatDuration } = require('../../utils/duration');

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 10; // well under Discord's 25-option select-menu cap, kept low so polls stay scannable

// Shared by end/delete/results' autocomplete — matches the focused text
// against each poll's question, most recent first.
async function autocompletePolls(interaction, { statusFilter } = {}) {
  const focused = interaction.options.getFocused().toLowerCase();
  let polls = listPolls(interaction.guild.id);
  if (statusFilter) polls = polls.filter((p) => p.status === statusFilter);
  polls = polls
    .filter((p) => p.question.toLowerCase().includes(focused))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 25);

  await interaction.respond(
    polls.map((p) => ({
      name: `${p.status === 'active' ? '🟢' : '⚪'} ${p.question}`.slice(0, 100),
      value: p.token,
    })),
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Create and manage polls')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand((sub) => sub
      .setName('create')
      .setDescription('Start a new poll')
      .addStringOption((opt) => opt.setName('question').setDescription('The poll question').setRequired(true).setMaxLength(200))
      .addStringOption((opt) => opt.setName('options').setDescription(`${MIN_OPTIONS}-${MAX_OPTIONS} options, separated by commas`).setRequired(true))
      .addStringOption((opt) => opt.setName('duration').setDescription('Auto-end after this long, e.g. 30m, 2h, 1d (default: runs until /poll end)'))
      .addBooleanOption((opt) => opt.setName('multiple').setDescription('Allow voters to pick more than one option (default: false)'))
      .addChannelOption((opt) => opt.setName('channel').setDescription('Channel to post in (default: this channel)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
    .addSubcommand((sub) => sub
      .setName('end')
      .setDescription('End a poll immediately')
      .addStringOption((opt) => opt.setName('poll').setDescription('Which poll').setRequired(true).setAutocomplete(true)))
    .addSubcommand((sub) => sub
      .setName('delete')
      .setDescription('Delete a poll\'s record and disable its message')
      .addStringOption((opt) => opt.setName('poll').setDescription('Which poll').setRequired(true).setAutocomplete(true)))
    .addSubcommand((sub) => sub
      .setName('results')
      .setDescription('View current results for a poll, active or ended')
      .addStringOption((opt) => opt.setName('poll').setDescription('Which poll').setRequired(true).setAutocomplete(true))),

  async autocomplete(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'end') return autocompletePolls(interaction, { statusFilter: 'active' });
    return autocompletePolls(interaction);
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'create') {
      const question = interaction.options.getString('question');
      const rawOptions = interaction.options.getString('options');
      const multiple = interaction.options.getBoolean('multiple') || false;
      const channel = interaction.options.getChannel('channel') || interaction.channel;
      const durationInput = interaction.options.getString('duration');

      const optionTexts = rawOptions.split(',').map((s) => s.trim()).filter(Boolean);
      if (optionTexts.length < MIN_OPTIONS || optionTexts.length > MAX_OPTIONS) {
        return interaction.reply({
          content: `❌ Give between ${MIN_OPTIONS} and ${MAX_OPTIONS} options, separated by commas — got ${optionTexts.length}.`,
          flags: MessageFlags.Ephemeral,
        });
      }
      if (optionTexts.some((t) => t.length > 100)) {
        return interaction.reply({ content: '❌ Each option must be 100 characters or less.', flags: MessageFlags.Ephemeral });
      }

      let endAt = null;
      if (durationInput) {
        const durationMs = parseDuration(durationInput);
        if (!durationMs) {
          return interaction.reply({
            content: `❌ Couldn't parse "${durationInput}" as a duration. Try something like \`30m\`, \`2h\`, or \`1d12h\`.`,
            flags: MessageFlags.Ephemeral,
          });
        }
        endAt = Date.now() + durationMs;
      }

      const poll = await createAndPostPoll({
        channel, guild: interaction.guild, question, optionTexts, multiple, endAt, organiserId: interaction.user.id,
      });

      return interaction.reply({
        content: `📊 Poll posted in ${channel}${endAt ? ` — ends in ${formatDuration(endAt - Date.now())}` : ' — run `/poll end` when you\'re ready to close it'}.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'end') {
      const token = interaction.options.getString('poll');
      const poll = getPoll(token);
      if (!poll) return interaction.reply({ content: '❌ Poll not found.', flags: MessageFlags.Ephemeral });
      if (poll.status !== 'active') return interaction.reply({ content: '⚠️ That poll has already ended.', flags: MessageFlags.Ephemeral });

      await finalizePoll(interaction.client, token);
      return interaction.reply({ content: `✅ Ended the poll: **${poll.question}**.`, flags: MessageFlags.Ephemeral });
    }

    if (sub === 'delete') {
      const token = interaction.options.getString('poll');
      const poll = getPoll(token);
      if (!poll) return interaction.reply({ content: '❌ Poll not found.', flags: MessageFlags.Ephemeral });

      deletePoll(token);
      await syncPollMessage(interaction.client, { ...poll, status: 'ended', endedAt: poll.endedAt || Date.now() }).catch(() => null);
      return interaction.reply({ content: `🗑️ Deleted the poll: **${poll.question}**.`, flags: MessageFlags.Ephemeral });
    }

    if (sub === 'results') {
      const token = interaction.options.getString('poll');
      const poll = getPoll(token);
      if (!poll) return interaction.reply({ content: '❌ Poll not found.', flags: MessageFlags.Ephemeral });

      return interaction.reply({
        embeds: [buildPollEmbed(poll)],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
