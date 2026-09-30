const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { parseEmojiList, applyReactions } = require('../../utils/autoReactMatcher');

// Accepts a full message link (https://discord.com/channels/guild/channel/message)
// or a bare message ID (in which case the `channel` option is required).
function parseMessageReference(input) {
  const linkMatch = input.match(/discord(?:app)?\.com\/channels\/\d+\/(\d+)\/(\d+)/);
  if (linkMatch) return { channelId: linkMatch[1], messageId: linkMatch[2] };
  return { channelId: null, messageId: input.trim() };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('react')
    .setDescription('Make the bot react to a specific message')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addStringOption((opt) =>
      opt.setName('message').setDescription('Message link, or a message ID').setRequired(true))
    .addStringOption((opt) =>
      opt.setName('emojis').setDescription('Emoji(s) to react with, space or comma separated').setRequired(true))
    .addChannelOption((opt) =>
      opt.setName('channel').setDescription('Only needed if you pasted a bare message ID, not a link')),

  async execute(interaction) {
    const messageInput = interaction.options.getString('message').trim();
    const emojisRaw = interaction.options.getString('emojis');
    const channelOpt = interaction.options.getChannel('channel');

    const emojis = parseEmojiList(emojisRaw);
    if (!emojis.length) {
      return interaction.reply({ content: "I couldn't find any emojis in that.", ephemeral: true });
    }

    const ref = parseMessageReference(messageInput);
    const targetChannelId = ref.channelId || channelOpt?.id;
    if (!targetChannelId) {
      return interaction.reply({
        content: 'Paste a full message link, or pick the channel with the `channel` option.',
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const channel = await interaction.client.channels.fetch(targetChannelId).catch(() => null);
    if (!channel) return interaction.editReply("Couldn't find that channel, or I don't have access to it.");

    // Cross-guild guard: a message link can point at another server entirely.
    if (channel.guildId !== interaction.guild.id) {
      return interaction.editReply("That message is in a different server. I can only react to messages in this one.");
    }

    const message = await channel.messages.fetch(ref.messageId).catch(() => null);
    if (!message) return interaction.editReply("Couldn't find that message - check the link/ID.");

    await applyReactions(message, emojis);
    return interaction.editReply(`Reacted with ${emojis.map((e) => e.raw).join(' ')}`);
  },
};
