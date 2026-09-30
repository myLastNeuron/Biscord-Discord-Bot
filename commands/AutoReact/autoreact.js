const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const store = require('../../utils/autoReactStore');
const { parseEmojiList, describeRule } = require('../../utils/autoReactMatcher');

const KEYWORD_TRIGGERS = new Set(['keyword', 'image_keyword']);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('autoreact')
    .setDescription('Automatically react to messages that match a rule')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand((sub) =>
      sub.setName('add')
        .setDescription('Add an auto-react rule')
        .addStringOption((opt) =>
          opt.setName('trigger')
            .setDescription('What should trigger the reaction')
            .setRequired(true)
            .addChoices(
              { name: 'Any message', value: 'any' },
              { name: 'Has image/attachment', value: 'image' },
              { name: 'Contains keyword(s)', value: 'keyword' },
              { name: 'Image + keyword(s)', value: 'image_keyword' },
              { name: 'Fallback (only if exactly one rule is unmatched)', value: 'fallback' },
            ))
        .addStringOption((opt) =>
          opt.setName('emojis')
            .setDescription('Emoji(s) to react with, space or comma separated (e.g. 👍 ❤️)')
            .setRequired(true))
        .addChannelOption((opt) =>
          opt.setName('channel')
            .setDescription('Limit to this channel (leave empty = whole server)')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addStringOption((opt) =>
          opt.setName('keywords')
            .setDescription('Comma-separated patterns (* = anything, % = date/time, ^ = time HH:MM) - for keyword triggers'))
        .addStringOption((opt) =>
          opt.setName('match_mode')
            .setDescription('Default: react if ANY keyword is found. Choose ALL for a fixed multi-line format.')
            .addChoices(
              { name: 'Any keyword/pattern found (default)', value: 'any' },
              { name: 'ALL keywords/patterns must be found', value: 'all' },
            ))
    )
    .addSubcommand((sub) =>
      sub.setName('list')
        .setDescription('List auto-react rules')
        .addChannelOption((opt) => opt.setName('channel').setDescription('Only show rules for this channel'))
    )
    .addSubcommand((sub) =>
      sub.setName('remove')
        .setDescription('Remove an auto-react rule')
        .addStringOption((opt) =>
          opt.setName('id').setDescription('Rule to remove').setRequired(true).setAutocomplete(true))
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const rules = store.listRules(interaction.guildId);
    const options = rules
      .map((r) => ({ name: describeRule(r, interaction.guild).slice(0, 100), value: r.id }))
      .filter((o) => o.name.toLowerCase().includes(focused))
      .slice(0, 25);
    await interaction.respond(options);
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'add') {
      const trigger = interaction.options.getString('trigger');
      const emojisRaw = interaction.options.getString('emojis');
      const channel = interaction.options.getChannel('channel');
      const keywordsRaw = interaction.options.getString('keywords');
      const matchAll = interaction.options.getString('match_mode') === 'all';

      const emojis = parseEmojiList(emojisRaw);
      if (!emojis.length) {
        return interaction.reply({ content: "I couldn't find any emojis in that.", ephemeral: true });
      }

      let keywords = [];
      if (KEYWORD_TRIGGERS.has(trigger)) {
        if (!keywordsRaw) {
          return interaction.reply({
            content: 'That trigger needs the `keywords` option filled in (comma-separated, e.g. `sale, discount, giveaway`).',
            ephemeral: true,
          });
        }
        keywords = keywordsRaw.split(',').map((k) => k.trim()).filter(Boolean);
        if (!keywords.length) {
          return interaction.reply({ content: "I couldn't find any keywords in that.", ephemeral: true });
        }
      }

      const rule = store.addRule(interaction.guildId, {
        channelId: channel?.id || null,
        trigger,
        keywords,
        matchAll,
        emojis,
        createdBy: interaction.user.id,
      });

      return interaction.reply({
        content: `Added rule: ${describeRule(rule, interaction.guild)}`,
        ephemeral: true,
      });
    }

    if (sub === 'list') {
      const channel = interaction.options.getChannel('channel');
      let rules = store.listRules(interaction.guildId);
      if (channel) rules = rules.filter((r) => r.channelId === channel.id);
      if (!rules.length) {
        return interaction.reply({ content: 'No auto-react rules set up yet.', ephemeral: true });
      }
      const lines = rules.map((r) => `• ${describeRule(r, interaction.guild)} (id: \`${r.id}\`)`);
      return interaction.reply({ content: `**Auto-react rules (${rules.length}):**\n${lines.join('\n')}`, ephemeral: true });
    }

    if (sub === 'remove') {
      const id = interaction.options.getString('id');
      const removed = store.removeRule(interaction.guildId, id);
      return interaction.reply({
        content: removed ? 'Rule removed.' : "Couldn't find a rule with that ID.",
        ephemeral: true,
      });
    }
  },
};
