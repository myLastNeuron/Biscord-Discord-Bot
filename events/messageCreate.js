const { Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { listRules } = require('../utils/autoReactStore');
const { ruleMatches, applyReactions, templateToRegex } = require('../utils/autoReactMatcher');
const { getGuildSettings, saveReactionApproval, findPendingReactionApproval } = require('../utils/db');
const { handleMusicCommand } = require('../utils/musicPrefixHandler');
const {
  getAutoDeletePrefixRule,
  isAutoDeleteUser,
  findReplyBackRule,
} = require('../utils/panelExtrasStore');

// ---------- Media-Only (file/picture only channels) ----------
// Deletes text-only messages, issues /warn-style warning with fixed reason.
// Immune only: members holding a /panel Mod Role (guildSettings.modRoleIds).
// Everyone else — including admins without a panel mod role — gets enforced.
function isMediaOnlyImmune(message) {
  try {
    const member = message.member;
    if (!member) return false;
    const { getGuildSettings } = require('../utils/db');
    const modRoleIds = getGuildSettings(message.guild.id).modRoleIds || [];
    if (modRoleIds.length > 0 && member.roles?.cache?.some?.((r) => modRoleIds.includes(r.id))) return true;
  } catch {
    // Fail closed to enforcement: not immune on lookup error.
    return false;
  }
  return false;
}

async function handleMediaOnly(message) {
  const { isMediaOnly, hasMedia, MEDIA_ONLY_REASON } = require('../utils/mediaOnlyManager');
  if (!isMediaOnly(message.guild.id, message.channelId)) return false;
  if (hasMedia(message)) return false;

  // Mod immunity: never delete, never warn. Reply once so mod knows bypass hit.
  if (isMediaOnlyImmune(message)) {
    try {
      await message.reply('🛡️ IMMUNE TO THE MEDIA ONLY CHANNEL');
      // Immunity notice stays permanently; no auto-delete.
    } catch (err) {
      console.error('[mediaOnly] Could not send immunity reply:', err?.message || err);
    }
    return false;
  }

  try {
    await message.delete();
  } catch (err) {
    console.error('[mediaOnly] Could not delete message:', err?.message || err);
  }

  try {
    const { addWarning } = require('../utils/db');
    const { logAction } = require('../utils/modLog');
    const { PREMIUM_COLORS } = require('../utils/theme');

    const history = addWarning(message.guild.id, message.author.id, {
      reason: MEDIA_ONLY_REASON,
      moderator: 'AutoMod (Media-Only)',
      timestamp: Date.now(),
    });

    // Public warn everyone can see.
    const warnEmbed = new EmbedBuilder()
      .setColor(PREMIUM_COLORS.warn)
      .setTitle('⚠️ Media-Only Warning')
      .setDescription(`<@${message.author.id}> text messages are not allowed here. Message deleted.`)
      .addFields(
        { name: 'User', value: `${message.author.tag} (<@${message.author.id}>)` },
        { name: 'Reason', value: MEDIA_ONLY_REASON },
        { name: 'Total warnings', value: `${history.length}` },
      )
      .setTimestamp();
    await message.channel.send({ embeds: [warnEmbed] }).catch(() => null);

    const logEmbed = new EmbedBuilder()
      .setColor(PREMIUM_COLORS.warn)
      .setTitle('⚠️ Media-Only Auto Warn')
      .addFields(
        { name: 'User', value: `${message.author.tag} (${message.author.id})` },
        { name: 'Channel', value: `${message.channel}` },
        { name: 'Reason', value: MEDIA_ONLY_REASON },
        { name: 'Total Warnings', value: `${history.length}` },
      )
      .setTimestamp();
    await logAction(message.guild, logEmbed).catch(() => null);

    await message.author.send(`You were warned in **${message.guild.name}** for: ${MEDIA_ONLY_REASON}`).catch(() => null);
  } catch (err) {
    console.error('[mediaOnly] Could not warn user:', err);
  }

  return true;
}

// ---------- Auto Delete (bolt-on feature, fully isolated from Auto-React / Reaction Approval) ----------
// Returns true if the message was deleted, so the caller can skip running
// Auto-React/Reaction Approval against a message that no longer exists.
async function handleAutoDelete(message) {
  const guildId = message.guild.id;
  const channelId = message.channelId;

  const prefix = getAutoDeletePrefixRule(guildId, channelId);
  if (prefix && message.content.startsWith(prefix)) {
    await message.delete();
    console.log(`[AutoDelete:Prefix] Deleted message from ${message.author.tag} in #${message.channel.name}`);
    return true;
  }

  if (isAutoDeleteUser(guildId, channelId, message.author.id)) {
    await message.delete();
    console.log(`[AutoDelete:User] Deleted message from ${message.author.tag} in #${message.channel.name}`);
    return true;
  }

  return false;
}

// ---------- Reply Back (bolt-on feature) ----------
async function handleReplyBack(message) {
  const rule = findReplyBackRule(message.guild.id, message.channelId, message.author.id);
  if (!rule) return;

  if (rule.reactions?.length) {
    for (const emoji of rule.reactions) {
      try {
        await message.react(emoji);
      } catch (err) {
        console.error(`[ReplyBack] Could not react with "${emoji}":`, err);
      }
    }
  }

  if (rule.reply && rule.reply !== '[NONE]') {
    const replyText = rule.reply.replace(/\{user\}/gi, `<@${message.author.id}>`);
    try {
      await message.reply(replyText);
    } catch (err) {
      console.error('[ReplyBack] Could not send reply:', err);
    }
  }
}

// Reaction Approval: checks a submitted message against the admin-configured
// trigger type (any message / has image / keyword(s) / image+keyword(s) / a
// custom format template). Valid submissions get the "pending" reaction and
// a review request in the approval channel; invalid ones just get the
// "rejected" reaction. See the `reactionapproval:approve/reject` handlers in
// interactionCreate.js for what happens once an HC/Admin reviews it.
function messageMatchesReactionApprovalRule(settings, message) {
  const { reactionApprovalTriggerType: triggerType } = settings;

  if (triggerType === 'format') {
    if (!settings.reactionApprovalFormatTemplate) return false;
    return templateToRegex(settings.reactionApprovalFormatTemplate).test(message.content || '');
  }

  // 'any' / 'image' / 'keyword' / 'image_keyword' - reuse Auto-React's own
  // matching logic by building a one-off "rule" shaped the way it expects.
  // channelId is left null since the source-channel check already happened
  // by the time this runs.
  return ruleMatches(
    {
      trigger: triggerType,
      keywords: settings.reactionApprovalKeywords || [],
      matchAll: settings.reactionApprovalMatchAll === true,
      channelId: null,
    },
    message,
  );
}

// Is enough configured for this trigger type to safely evaluate a message?
function reactionApprovalConfigComplete(settings) {
  const { reactionApprovalTriggerType: triggerType } = settings;
  if (!triggerType) return false;
  if (triggerType === 'format' && !settings.reactionApprovalFormatTemplate) return false;
  if ((triggerType === 'keyword' || triggerType === 'image_keyword') && !settings.reactionApprovalKeywords?.length) return false;
  return true;
}

async function handleReactionApproval(message) {
  const settings = getGuildSettings(message.guild.id);
  if (!settings.reactionApprovalEnabled) return;

  const {
    reactionApprovalSourceChannelId,
    reactionApprovalChannelId,
    reactionApprovalPendingEmoji,
    reactionApprovalApprovedEmoji,
    reactionApprovalRejectedEmoji,
  } = settings;

  // Needs every piece configured to safely run.
  if (
    !reactionApprovalSourceChannelId ||
    !reactionApprovalChannelId ||
    !reactionApprovalPendingEmoji ||
    !reactionApprovalApprovedEmoji ||
    !reactionApprovalRejectedEmoji ||
    !reactionApprovalConfigComplete(settings)
  ) return;

  if (message.channelId !== reactionApprovalSourceChannelId) return;

  const isValid = messageMatchesReactionApprovalRule(settings, message);

  if (!isValid) {
    await applyReactions(message, [reactionApprovalRejectedEmoji]);
    return;
  }

  // Guards against double-processing on a restart/race - shouldn't normally trigger.
  if (findPendingReactionApproval(message.guild.id, message.id)) return;

  await applyReactions(message, [reactionApprovalPendingEmoji]);

  const approvalChannel = await message.guild.channels.fetch(reactionApprovalChannelId).catch(() => null);
  if (!approvalChannel) {
    console.error(`[reactionApproval] Approval channel ${reactionApprovalChannelId} not found/accessible in guild ${message.guild.id}`);
    return;
  }

  const token = `ra-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const contentPreview = message.content
    ? (message.content.length > 300 ? `${message.content.slice(0, 300)}…` : message.content)
    : '*[no text content]*';

  const embed = new EmbedBuilder()
    .setColor(0xfee75c)
    .setTitle('Reaction Approval Requested')
    .setDescription(contentPreview)
    .addFields(
      { name: 'Message', value: `[Jump to message](${message.url})`, inline: true },
      { name: 'Channel', value: `${message.channel}`, inline: true },
      { name: 'Submitted by', value: `${message.author}`, inline: true },
    )
    .setFooter({ text: `Token: ${token}` })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`reactionapproval:approve:${token}`).setLabel('Approve').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`reactionapproval:reject:${token}`).setLabel('Reject').setStyle(ButtonStyle.Danger),
  );

  await approvalChannel.send({ embeds: [embed], components: [row] });

  saveReactionApproval(token, {
    guildId: message.guild.id,
    sourceChannelId: message.channelId,
    messageId: message.id,
    authorId: message.author.id,
    pendingEmojiValue: reactionApprovalPendingEmoji.value,
    pendingEmojiRaw: reactionApprovalPendingEmoji.raw,
    approvedEmojiValue: reactionApprovalApprovedEmoji.value,
    approvedEmojiRaw: reactionApprovalApprovedEmoji.raw,
    rejectedEmojiValue: reactionApprovalRejectedEmoji.value,
    rejectedEmojiRaw: reactionApprovalRejectedEmoji.raw,
    status: 'pending',
    createdAt: Date.now(),
  });
}

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (!message.guild || message.author.bot) return;

    // Maintenance mode: turn everything off for this guild (auto-delete,
    // reply-back, auto-react, reaction-approval, prefix music commands) so
    // "bot off" means off.
    const guildSettings = getGuildSettings(message.guild.id);
    if (guildSettings.botEnabled === false) return;

    // ---------- Media-Only: file/picture only enforcement ----------
    // Runs before music / auto-react so text in media-only never slips through.
    try {
      if (await handleMediaOnly(message)) return;
    } catch (err) {
      console.error('[mediaOnly] Error processing message:', err);
    }

    // ---------- Music: `!` prefix commands ----------
    // Handled first so the command message isn't eaten by auto-delete rules
    // and doesn't get auto-reactions slapped on it. Returns true when the
    // message was a music command.
    try {
      if (await handleMusicCommand(message)) return;
    } catch (err) {
      console.error('[music] Error processing prefix command:', err);
    }

    // Own try/catch, runs first and independently of Auto-React / Reaction
    // Approval below. If the message gets deleted here, we skip those two
    // (a deleted message can't be reacted to or matched anyway) but a
    // failure in this block can never block them from running.
    try {
      if (await handleAutoDelete(message)) return;
      await handleReplyBack(message);
    } catch (err) {
      console.error('[panelExtras] Error processing message (auto-delete/reply-back):', err);
    }

    // ---------- Live TTS: speak bound-channel chat in voice ----------
    // Isolated like every other bolt-on here: fire-and-forget, never blocks
    // auto-react / approval / music prefix handling below.
    try {
      const ttsLive = require('../utils/ttsLiveManager');
      if (ttsLive.isEnabled(message.guild.id)) ttsLive.enqueue(message);
    } catch (err) {
      console.error('[tts-live] Error processing message:', err?.message || err);
    }

    try {
      const rules = listRules(message.guild.id);
      if (rules.length) {
        // Fallback rules only fire when exactly ONE of the active rules failed
        // to match this message (not "zero matched" - see autoreact-progress-
        // summary discussion). They're kept separate and checked last.
        const fallbackRules = rules.filter((r) => r.trigger === 'fallback');
        const activeRules = rules.filter((r) => r.trigger !== 'fallback');

        let matchedCount = 0;
        for (const rule of activeRules) {
          if (ruleMatches(rule, message)) {
            matchedCount++;
            await applyReactions(message, rule.emojis);
          }
        }

        const unmatchedCount = activeRules.length - matchedCount;

        if (unmatchedCount === 1) {
          for (const rule of fallbackRules) {
            // Fallback still respects per-channel scoping, just skips content matching.
            if (rule.channelId && rule.channelId !== message.channelId) continue;
            await applyReactions(message, rule.emojis);
          }
        }
      }
    } catch (err) {
      // Never let a bad rule or a Discord API hiccup take the whole bot down.
      console.error('[autoReact] Error processing message:', err);
    }

    try {
      await handleReactionApproval(message);
    } catch (err) {
      console.error('[reactionApproval] Error processing message:', err);
    }
  },
};

