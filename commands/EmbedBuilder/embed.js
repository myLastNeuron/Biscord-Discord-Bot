const {
  SlashCommandBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const sessionStore = require('../../utils/embedSessionStore');
const templateStore = require('../../utils/embedTemplateStore');
const {
  buildEmbedFromDraft,
  buildLiveButtonRows,
  buildPanelComponents,
  buildGuideText,
  draftFromEmbed,
} = require('../../utils/embedBuilder');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('embed')
    .setDescription('Build and send custom embeds')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand((sub) =>
      sub.setName('new')
        .setDescription('Open the embed builder panel')
        .addChannelOption((opt) =>
          opt.setName('channel').setDescription('Where to send when finished (defaults to this channel)'))
    )
    .addSubcommand((sub) =>
      sub.setName('template-edit')
        .setDescription('Edit a saved template in the builder')
        .addStringOption((opt) => opt.setName('name').setDescription('Template name').setRequired(true).setAutocomplete(true))
        .addChannelOption((opt) =>
          opt.setName('channel').setDescription('Where to send when finished (defaults to this channel)'))
    )
    .addSubcommand((sub) =>
      sub.setName('edit')
        .setDescription('Edit a previously sent embed message')
        .addStringOption((opt) =>
          opt.setName('message_id')
            .setDescription('The ID of the message to edit (right-click message → Copy Message ID)')
            .setRequired(true))
        .addChannelOption((opt) =>
          opt.setName('channel')
            .setDescription('Channel the message is in (defaults to current channel)')
            .setRequired(false))
    )
    .addSubcommand((sub) =>
      sub.setName('send')
        .setDescription('Send a saved template directly, no builder')
        .addStringOption((opt) => opt.setName('name').setDescription('Template name').setRequired(true).setAutocomplete(true))
        .addChannelOption((opt) => opt.setName('channel').setDescription('Where to send (defaults to this channel)'))
    )
    .addSubcommand((sub) =>
      sub.setName('list').setDescription('List saved templates')
    )
    .addSubcommand((sub) =>
      sub.setName('delete')
        .setDescription('Delete a saved template')
        .addStringOption((opt) => opt.setName('name').setDescription('Template name').setRequired(true).setAutocomplete(true))
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused();
    const names = templateStore.listTemplateNames(interaction.guildId);
    const filtered = names.filter((n) => n.toLowerCase().includes(focused.toLowerCase())).slice(0, 25);
    await interaction.respond(filtered.map((n) => ({ name: n, value: n })));
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'new' || sub === 'template-edit') {
      const channel = interaction.options.getChannel('channel') || interaction.channel;
      let existingDraft = null;
      let name = null;

      if (sub === 'template-edit') {
        name = interaction.options.getString('name');
        const template = templateStore.getTemplate(interaction.guildId, name);
        if (!template) {
          return interaction.reply({ content: `No template named **${name}** found.`, ephemeral: true });
        }
        existingDraft = template.embed;
      }

      const session = sessionStore.createSession(interaction.user.id, {
        guildId: interaction.guildId,
        channelId: channel.id,
        name,
        existingDraft,
      });

      const embed = buildEmbedFromDraft(session.draft);
      const components = buildPanelComponents(session);
      await interaction.reply({
        content: `Building for <#${channel.id}>. Use the menus below - this preview updates live.\n\n${buildGuideText(session)}`,
        embeds: [embed],
        components,
        ephemeral: true,
      });
      return;
    }

    if (sub === 'edit') {
      const messageId = interaction.options.getString('message_id');
      const channelOption = interaction.options.getChannel('channel');
      const targetChannelId = channelOption ? channelOption.id : interaction.channelId;

      await interaction.deferReply({ ephemeral: true });

      // Fetch via client to get a full channel object with .messages available
      let targetChannel;
      try {
        targetChannel = await interaction.client.channels.fetch(targetChannelId);
      } catch (err) {
        console.error('[embed edit] Failed to fetch channel:', err.message);
        return interaction.editReply({
          content: `Couldn't access <#${targetChannelId}>. Make sure I have permission to view it.`,
        });
      }

      if (!targetChannel) {
        return interaction.editReply({
          content: `Couldn't find that channel. Make sure I have permission to view it.`,
        });
      }

      if (!targetChannel.messages) {
        console.error('[embed edit] Fetched channel has no .messages manager. Channel type:', targetChannel.type);
        return interaction.editReply({
          content: `<#${targetChannelId}> isn't a text-based channel I can fetch messages from.`,
        });
      }

      let targetMessage;
      try {
        targetMessage = await targetChannel.messages.fetch(messageId);
      } catch (err) {
        console.error('[embed edit] Failed to fetch message:', err.message);
        return interaction.editReply({
          content: `Couldn't find message \`${messageId}\` in <#${targetChannelId}>.\n\nPossible reasons:\n• The message ID is wrong\n• The message was deleted\n• I don't have **Read Message History** permission in that channel`,
        });
      }

      if (!targetMessage) {
        return interaction.editReply({
          content: `Message \`${messageId}\` not found in <#${targetChannelId}>.`,
        });
      }

      // Defensive: on some setups (missing intents, edge-case message types)
      // Discord/discord.js can hand back a message without a populated author.
      // Without this check that used to crash the whole interaction.
      if (!targetMessage.author) {
        console.error(
          '[embed edit] Fetched message has no author field. Raw message:',
          JSON.stringify(targetMessage.toJSON ? targetMessage.toJSON() : targetMessage)
        );
        return interaction.editReply({
          content: `I fetched that message but Discord didn't return author info for it, so I can't verify I sent it. This usually means the bot's Gateway Intents (GuildMessages) aren't fully set up — check the console log I just printed for the raw message data.`,
        });
      }

      if (targetMessage.author.id !== interaction.client.user.id) {
        return interaction.editReply({
          content: `That message wasn't sent by me, so I can't edit it. Only messages I originally sent can be edited this way.`,
        });
      }

      const sourceEmbed = targetMessage.embeds[0];
      if (!sourceEmbed) {
        return interaction.editReply({
          content: `That message doesn't contain an embed. Only embed messages can be edited with this command.`,
        });
      }

      const existingDraft = draftFromEmbed(sourceEmbed.data, targetMessage.components);

      const session = sessionStore.createSession(interaction.user.id, {
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        editMessageId: messageId,
        editChannelId: targetChannelId,
        existingDraft,
      });

      const embed = buildEmbedFromDraft(session.draft);
      const components = buildPanelComponents(session);
      return interaction.editReply({
        content: `Editing message in <#${targetChannelId}>. Make your changes and click **Update Message** when done.\n-# Reactions on the original message will not be changed.\n\n${buildGuideText(session)}`,
        embeds: [embed],
        components,
      });
    }

    if (sub === 'send') {
      const name = interaction.options.getString('name');
      const channel = interaction.options.getChannel('channel') || interaction.channel;
      const template = templateStore.getTemplate(interaction.guildId, name);
      if (!template) {
        return interaction.reply({ content: `No template named **${name}** found.`, ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });
      const embed = buildEmbedFromDraft(template.embed);
      const buttonRows = buildLiveButtonRows(template.buttons || []);
      const sentMessage = await channel.send({ embeds: [embed], components: buttonRows });

      for (const emoji of template.reactions || []) {
        try {
          await sentMessage.react(emoji);
        } catch (err) {
          console.error(`[embed command] Failed to react with ${emoji}:`, err.message);
        }
      }

      return interaction.editReply({ content: `Sent **${name}** to <#${channel.id}>.` });
    }

    if (sub === 'list') {
      const names = templateStore.listTemplateNames(interaction.guildId);
      if (!names.length) {
        return interaction.reply({ content: 'No saved templates yet.', ephemeral: true });
      }
      return interaction.reply({
        content: `**Saved templates (${names.length}):**\n${names.map((n) => `• ${n}`).join('\n')}`,
        ephemeral: true,
      });
    }

    if (sub === 'delete') {
      const name = interaction.options.getString('name');
      const deleted = templateStore.deleteTemplate(interaction.guildId, name);
      return interaction.reply({
        content: deleted ? `Deleted template **${name}**.` : `No template named **${name}** found.`,
        ephemeral: true,
      });
    }
  },
};
