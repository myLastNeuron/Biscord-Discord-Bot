const { Events, ChannelType, AuditLogEvent } = require('discord.js');
const tempVcStore = require('../utils/tempVcStore');
const { getVcNotifyRule, getVcActivitySettings } = require('../utils/panelExtrasStore');
const vcSessions = require('../utils/vcActivitySessions');
const { handleVoiceStateUpdate: handleMusicLeave } = require('../utils/musicManager');
const { sendAuditLog } = require('../utils/auditLogger');
const { findAuditLogExecutor } = require('../utils/auditLogLookup');

function shortTime() {
  const now = new Date();
  return `[${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}]`;
}

// ---------- VC Notify (bolt-on feature, fully isolated from temp-VC logic) ----------
// Fires only on an actual JOIN (not a leave, not a mute/deafen toggle, and
// not a channel switch counted as a "leave" of the old one - we only care
// that newState now has a channel that's different from before).
async function handleVcNotify(oldState, newState) {
  if (!newState.channel) return;
  if (oldState.channelId === newState.channelId) return;

  const guildId = newState.guild.id;
  const userId = newState.member.id;

  const rule = getVcNotifyRule(guildId, userId);
  if (!rule) return;

  const textChannel = newState.guild.channels.cache.get(rule.channelId);
  if (!textChannel) return;

  const finalMessage = rule.message
    .replace(/\{user\}/gi, `<@${userId}>`)
    .replace(/\{vc\}/gi, newState.channel.name);

  await textChannel.send(finalMessage);
}

// ---------- VC Activity Log (bolt-on feature, guild-wide, fully isolated) ----------
// Join: posts immediately with a native Discord relative timestamp
// (<t:...:R>) so it reads "started a few seconds ago" and keeps counting up
// live in every viewer's client - no bot-side editing/polling needed.
// Leave: posts once with the final calculated duration, then the session is
// cleared. Switching between VCs mid-call does NOT end the session (it's
// tracking total time in voice, not time in one specific channel) - only
// updates which channel name shows up in the eventual leave message.
async function handleVcActivity(oldState, newState) {
  const guild = newState.guild || oldState.guild;
  const settings = getVcActivitySettings(guild.id);
  if (!settings.enabled || !settings.channelId) return;

  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return; // never log bot join/leave noise

  const leftId = oldState.channelId;
  const joinedId = newState.channelId;
  if (leftId === joinedId) return;

  const logChannel = guild.channels.cache.get(settings.channelId);
  if (!logChannel) return;

  // Entered voice from outside it entirely -> start a new session.
  if (joinedId && !leftId) {
    vcSessions.startSession(guild.id, member.id, newState.channel.name);
    const startedUnix = Math.floor(Date.now() / 1000);
    const text = settings.joinMessage
      .replace(/\{user\}/gi, `<@${member.id}>`)
      .replace(/\{vc\}/gi, newState.channel.name);
    await logChannel.send(`${text} ${shortTime()}\n-# In call <t:${startedUnix}:R>`);
    return;
  }

  // Switched channels mid-session -> keep the session, just update the name.
  if (joinedId && leftId) {
    vcSessions.updateChannel(guild.id, member.id, newState.channel.name);
    return;
  }

  // Left voice entirely -> close out the session and report duration.
  if (leftId && !joinedId) {
    const ended = vcSessions.endSession(guild.id, member.id);
    if (!ended) return; // no tracked session (e.g. bot restarted mid-call) - nothing to report
    const text = settings.leaveMessage
      .replace(/\{user\}/gi, `<@${member.id}>`)
      .replace(/\{vc\}/gi, ended.channelName)
      .replace(/\{duration\}/gi, vcSessions.formatDuration(ended.durationMs));
    await logChannel.send(`${text} ${shortTime()}`);
  }
}

// How long an empty temp VC waits before being deleted - avoids the channel
// flickering away and back if someone's connection just hiccups or they're
// quickly switching channels. Only ever applies to channels this bot
// created (tracked in tempVcStore) - never to regular server VCs.
const EMPTY_DELETE_GRACE_MS = 10 * 1000;

// Sets the live "N in call" voice channel status. Requires discord.js
// >= 14.15 (VoiceChannel#setVoiceStatus) and the bot having the "Set Voice
// Channel Status" permission - falls back to a raw REST call on older
// discord.js versions that don't have the helper method yet. Never lets a
// status failure break the rest of the flow.
async function updateStatus(channel) {
  try {
    const count = channel.members.size;
    const status = `${count} in call`;
    if (typeof channel.setVoiceStatus === 'function') {
      await channel.setVoiceStatus(status);
    } else {
      await channel.client.rest.put(`/channels/${channel.id}/voice-status`, { body: { status } });
    }
  } catch (err) {
    console.error(`[tempVc] Failed to set voice status on #${channel.name}:`, err.message);
  }
}

// Deletes a temp VC once it's sat empty for the grace period - re-checks
// membership right before deleting in case someone rejoined during the wait.
function scheduleDeleteIfStillEmpty(guild, channelId) {
  setTimeout(async () => {
    try {
      const channel = guild.channels.cache.get(channelId);
      if (!channel) {
        // Already gone (e.g. manually deleted) - just clean up the tracking entry.
        tempVcStore.removeActiveChannel(guild.id, channelId);
        return;
      }
      if (channel.members.size === 0) {
        await channel.delete('Temp voice channel empty').catch(() => {});
        tempVcStore.removeActiveChannel(guild.id, channelId);
      }
    } catch (err) {
      console.error('[tempVc] Error during delayed empty-channel cleanup:', err);
    }
  }, EMPTY_DELETE_GRACE_MS);
}

module.exports = {
  name: Events.VoiceStateUpdate,
  async execute(oldState, newState) {
    // ---------- Music: auto-leave when the bot is all alone ----------
    // Runs unconditionally (no try/catch needed — it's synchronous and
    // defensive). Fires its own graceful timer, never blocks the rest.
    handleMusicLeave(oldState, newState);

    // ---------- Audit log: voice state changes ----------
    try {
      const member = newState.member || oldState.member;
      const guild = newState.guild || oldState.guild;
      if (member && !member.user.bot) {
        const leftId = oldState.channelId;
        const joinedId = newState.channelId;

        if (leftId === joinedId && leftId) {
          // Same channel — mute/deafen/video/stream toggle
          const changes = [];
          let needsExecutorLookup = false;

          if (oldState.serverMute !== newState.serverMute) {
            changes.push(newState.serverMute ? 'server muted' : 'server unmuted');
            needsExecutorLookup = true;
          }
          if (oldState.serverDeaf !== newState.serverDeaf) {
            changes.push(newState.serverDeaf ? 'server deafened' : 'server undeafened');
            needsExecutorLookup = true;
          }
          if (oldState.selfMute !== newState.selfMute) {
            changes.push(newState.selfMute ? 'self muted' : 'self unmuted');
          }
          if (oldState.selfDeaf !== newState.selfDeaf) {
            changes.push(newState.selfDeaf ? 'self deafened' : 'self undeafened');
          }
          if (oldState.selfVideo !== newState.selfVideo) {
            changes.push(newState.selfVideo ? 'started video' : 'stopped video');
          }
          if (oldState.streaming !== newState.streaming) {
            changes.push(newState.streaming ? 'started streaming' : 'stopped streaming');
          }
          if (changes.length > 0) {
            let who = '';
            if (needsExecutorLookup) {
              const executor = await findAuditLogExecutor(guild, AuditLogEvent.MemberRoleUpdate, member.id);
              if (executor) who = ` by ${executor}`;
            }
            await sendAuditLog(guild, `🎙️ ${member.user.tag}${who}: ${changes.join(', ')}`);
          }
        } else if (joinedId && !leftId) {
          // Joined VC from outside
          await sendAuditLog(guild, `🔊 ${member.user.tag} joined #${newState.channel.name}`);
        } else if (!joinedId && leftId) {
          // Left VC entirely
          await sendAuditLog(guild, `🔇 ${member.user.tag} left #${oldState.channel.name}`);
        } else if (joinedId && leftId) {
          // Switched channels
          await sendAuditLog(guild, `🔀 ${member.user.tag} moved from #${oldState.channel.name} → #${newState.channel.name}`);
        }
      }
    } catch (err) {
      console.error('[auditLog] Error logging voice state update:', err.message);
    }

    // Own try/catch, run independently of the temp-VC logic below - a bad
    // VC Notify rule (e.g. deleted target channel) can never block or break
    // auto-role, auto-status, or temp channel creation/cleanup.
    try {
      await handleVcNotify(oldState, newState);
    } catch (err) {
      console.error('[vcNotify] Error processing voice state update:', err);
    }

    try {
      await handleVcActivity(oldState, newState);
    } catch (err) {
      console.error('[vcActivity] Error processing voice state update:', err);
    }

    // ---------- Live TTS: follow bot moves, clear queue when empty ----------
    // Isolated: never blocks music/temp-VC logic. Full stop only when the bot
    // itself leaves voice; otherwise just drops the pending backlog.
    try {
      require('../utils/ttsLiveManager').handleVoiceStateUpdate(oldState, newState);
    } catch (err) {
      console.error('[tts-live] Error processing voice state update:', err?.message || err);
    }

    try {
      const guild = newState.guild || oldState.guild;
      const leftId = oldState.channelId;
      const joinedId = newState.channelId;
      if (leftId === joinedId) return; // mute/deafen/etc toggle, not a channel change

      const settings = tempVcStore.getSettings(guild.id);

      // ---------- Auto Role: applies to ANY voice channel, server-wide ----------
      // Stays on while moving directly between two voice channels; only
      // added when entering voice from outside it, only removed when
      // leaving voice entirely.
      if (settings.autoRoleEnabled && settings.roleId) {
        if (leftId && !joinedId) {
          const member = oldState.member;
          if (member) {
            await member.roles.remove(settings.roleId).catch((err) =>
              console.error('[tempVc] Failed to remove auto-role:', err.message));
          }
        } else if (joinedId && !leftId) {
          const member = newState.member;
          if (member) {
            await member.roles.add(settings.roleId).catch((err) =>
              console.error('[tempVc] Failed to add auto-role:', err.message));
          }
        }
      }

      // ---------- Auto Status: live member count on ANY voice channel, server-wide ----------
      if (settings.autoStatusEnabled) {
        if (leftId && oldState.channel) await updateStatus(oldState.channel);
        if (joinedId && newState.channel) await updateStatus(newState.channel);
      }

      // ---------- Left a temp VC: clean up if now empty (temp VCs only - never touches regular server VCs) ----------
      if (leftId && tempVcStore.isActiveChannel(guild.id, leftId)) {
        const channel = oldState.channel;
        if (channel && channel.members.size === 0) {
          scheduleDeleteIfStillEmpty(guild, channel.id);
        }
      }

      // ---------- Joined the trigger channel: create a personal temp VC ----------
      if (joinedId && settings.enabled && settings.triggerChannelId && joinedId === settings.triggerChannelId) {
        const member = newState.member;
        const triggerChannel = newState.channel;
        const parent = settings.categoryId
          ? guild.channels.cache.get(settings.categoryId)
          : triggerChannel?.parent;

        let tempChannel;
        try {
          tempChannel = await guild.channels.create({
            name: `${member.displayName}'s Channel`.slice(0, 100),
            type: ChannelType.GuildVoice,
            parent: parent ? parent.id : undefined,
          });
        } catch (err) {
          console.error('[tempVc] Failed to create temp channel:', err.message);
          return;
        }

        tempVcStore.addActiveChannel(guild.id, tempChannel.id, member.id);

        // Let the owner manage/rename/limit their own channel and move people
        // out of it if needed - doesn't touch anyone else's permissions.
        await tempChannel.permissionOverwrites
          .edit(member.id, { ManageChannels: true, MoveMembers: true })
          .catch((err) => console.error('[tempVc] Failed to set owner permissions:', err.message));

        try {
          await member.voice.setChannel(tempChannel);
        } catch (err) {
          console.error('[tempVc] Failed to move member into new channel, rolling back:', err.message);
          await tempChannel.delete('Rollback - failed to move creator in').catch(() => {});
          tempVcStore.removeActiveChannel(guild.id, tempChannel.id);
          return;
        }

        // Note: role/status for the temp channel itself are already handled
        // by the generic "any voice channel" blocks above, which ran earlier
        // in this same event for the trigger-channel join. The actual move
        // (trigger -> temp) fires its own separate voiceStateUpdate event
        // right after this, which the status block picks up automatically.
      }
    } catch (err) {
      // Never let a bad voice event take the whole bot down.
      console.error('[tempVc] Error processing voice state update:', err);
    }
  },
};
