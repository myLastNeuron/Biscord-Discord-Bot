// Reaction Approval handlers: reactionapproval:approve/reject (buttons)

const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, PermissionFlagsBits } = require('discord.js');
const {
  getGuildSettings,
  getReactionApproval,
  updateReactionApproval,
  canReviewReactionApprovals,
} = require('../utils/db');
const { parseEmojiList } = require('../utils/autoReactMatcher');
const { err } = require('../utils/logger');

function match(interaction) {
  return interaction.isButton() && (interaction.customId.startsWith('reactionapproval:approve:') || interaction.customId.startsWith('reactionapproval:reject:'));
}

async function execute(interaction) {
  const customId = interaction.customId;

  try {
    const [, action, token] = customId.split(':');

    if (!canReviewReactionApprovals(interaction)) {
      return interaction.reply({ content: 'You do not have permission to review reaction approval requests.', ephemeral: true });
    }

    const record = getReactionApproval(token);
    if (!record) {
      return interaction.reply({ content: "This request no longer exists — it may have already been handled or the data was reset.", ephemeral: true });
    }
    if (record.status !== 'pending') {
      return interaction.reply({ content: `This request was already ${record.status} by someone else.`, ephemeral: true });
    }

    const originalEmbed = interaction.message.embeds[0];
    const updatedEmbed = EmbedBuilder.from(originalEmbed);

    const originalChannel = await interaction.guild.channels.fetch(record.sourceChannelId).catch(() => null);
    const originalMessage = originalChannel ? await originalChannel.messages.fetch(record.messageId).catch(() => null) : null;

    const newEmojiValue = action === 'approve' ? record.approvedEmojiValue : record.rejectedEmojiValue;
    const newEmojiRaw = action === 'approve' ? record.approvedEmojiRaw : record.rejectedEmojiRaw;

    if (!originalMessage) {
      updatedEmbed.setColor(0xed4245).setTitle(`Reaction Approval — ⚠️ ${action === 'approve' ? 'Approved' : 'Rejected'} (original message not found)`);
    } else {
      const pendingReaction = originalMessage.reactions.cache.find((r) =>
        r.emoji.id ? r.emoji.id === record.pendingEmojiValue : r.emoji.name === record.pendingEmojiValue,
      );
      if (pendingReaction) {
        await pendingReaction.users.remove(interaction.client.user.id).catch((err) => {
          console.error('[reactionApproval] Failed to remove pending reaction:', err.message);
        });
      }
      await originalMessage.react(newEmojiValue).catch((err) => {
        console.error('[reactionApproval] Failed to add resolution reaction:', err.message);
      });

      updatedEmbed.setColor(action === 'approve' ? 0x57f287 : 0xed4245).setTitle(`Reaction Approval — ${action === 'approve' ? 'Approved' : 'Rejected'}`);
    }

    updatedEmbed.addFields({ name: `${action === 'approve' ? 'Approved' : 'Rejected'} by`, value: `${interaction.user} (now reacted with ${newEmojiRaw})`, inline: false });
    updateReactionApproval(token, { status: action === 'approve' ? 'approved' : 'rejected', resolvedBy: interaction.user.id, resolvedAt: Date.now() });

    const disabledRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('reactionapproval:approve:done').setLabel('Approve').setStyle(ButtonStyle.Success).setDisabled(true),
      new ButtonBuilder().setCustomId('reactionapproval:reject:done').setLabel('Reject').setStyle(ButtonStyle.Danger).setDisabled(true),
    );

    await interaction.update({ embeds: [updatedEmbed], components: [disabledRow] });
    return;
  } catch (error) {
    err(error, { tag: 'handlers:reactionApproval', customId: interaction.customId, userId: interaction.user.id });
    throw error;
  }
}

module.exports = { match, execute };