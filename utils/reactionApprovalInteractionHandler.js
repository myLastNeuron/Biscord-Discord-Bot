// Handles the Reaction Approval system's Approve/Reject buttons on a
// pending-approval message. Extracted from events/interactionCreate.js —
// follows the same handle*Interaction(interaction) => boolean pattern used
// by ticketInteractionHandler.js, pollInteractionHandler.js,
// giveawayInteractionHandler.js, and roleRequestInteractionHandler.js.
//
// NOTE: canReviewRoleRequests/canReviewReactionApprovals are duplicated
// here rather than imported from interactionCreate.js. Both were only used
// by this reaction-approval block and the just-extracted role-request block
// (see roleRequestInteractionHandler.js, which also duplicates
// canReviewRoleRequests) — interactionCreate.js itself no longer calls
// either, but the functions were left in place there to keep each
// extraction pass additive-only.
const { PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { getGuildSettings, getReactionApproval, updateReactionApproval } = require('../utils/db');

// Returns true if the member is allowed to Approve/Reject role requests /
// reaction approvals. Uses the mod roles configured in /panel if any are
// set; otherwise falls back to requiring Manage Roles so this never
// accidentally opens up to everyone.
function canReviewRoleRequests(interaction) {
  const settings = getGuildSettings(interaction.guild.id);
  const modRoleIds = settings.modRoleIds || [];
  if (modRoleIds.length > 0) {
    return interaction.member.roles.cache.some((role) => modRoleIds.includes(role.id));
  }
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles);
}

// Same permission model as role requests (configured Mod Roles, falling
// back to Manage Roles) - reused for approving/rejecting Reaction Approval
// requests.
function canReviewReactionApprovals(interaction) {
  return canReviewRoleRequests(interaction);
}

// ---------- Reaction Approval: admin clicks Approve or Reject ----------
async function handleReactionApprovalReview(interaction) {
  const [, action, token] = interaction.customId.split(':');

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
    // Remove the bot's own pending reaction, then add the approved/rejected emoji.
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
}

// Entry point matching the codebase's existing handle*Interaction(interaction)
// => boolean convention. Returns true if this module handled the
// interaction (caller should stop processing / return), false otherwise.
async function handleReactionApprovalInteraction(interaction) {
  if (interaction.isButton() && (interaction.customId.startsWith('reactionapproval:approve:') || interaction.customId.startsWith('reactionapproval:reject:'))) {
    await handleReactionApprovalReview(interaction);
    return true;
  }

  return false;
}

module.exports = { handleReactionApprovalInteraction };
