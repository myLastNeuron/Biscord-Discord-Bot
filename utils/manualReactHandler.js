const { parseEmojiList, applyReactions } = require('./autoReactMatcher');

// Returns true if it handled the interaction, so interactionCreate.js knows
// not to fall through to other handlers.
async function handleManualReactInteraction(interaction) {
  if (!interaction.isModalSubmit() || !interaction.customId.startsWith('manualreact:modal:')) {
    return false;
  }

  try {
    const [, , channelId, messageId] = interaction.customId.split(':');
    const emojis = parseEmojiList(interaction.fields.getTextInputValue('emojis'));

    if (!emojis.length) {
      await interaction.reply({ content: "I couldn't find any emojis in that.", ephemeral: true });
      return true;
    }

    await interaction.deferReply({ ephemeral: true });

    const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
    const message = channel ? await channel.messages.fetch(messageId).catch(() => null) : null;

    if (!message) {
      await interaction.editReply('That message no longer exists, or I lost access to the channel.');
      return true;
    }

    await applyReactions(message, emojis);
    await interaction.editReply(`Reacted with ${emojis.map((e) => e.raw).join(' ')}`);
  } catch (err) {
    console.error('[manualReact] Unhandled error:', err);
    const msg = { content: 'Something went wrong reacting to that message.', ephemeral: true };
    try {
      if (interaction.deferred || interaction.replied) await interaction.followUp(msg);
      else await interaction.reply(msg);
    } catch {
      // interaction already unrecoverable, nothing more to do
    }
  }

  return true;
}

module.exports = { handleManualReactInteraction };
