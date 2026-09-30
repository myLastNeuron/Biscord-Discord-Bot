/**
 * serverStatusTracker.js
 * -----------------------
 * Makes /server-status auto-refresh in place every 30 seconds instead of
 * being a one-off snapshot.
 *
 * How it works:
 * - When /server-status is run, the command builds the content, sends the
 *   reply, then registers that message (guildId -> { channelId, messageId })
 *   with this tracker.
 * - Every 30 seconds, refreshAll() re-reads the live member/presence cache
 *   (no extra gateway fetch, same as the rate-limit fix you already have)
 *   and edits that same message with fresh numbers + a "last updated" time.
 * - Running /server-status again in a guild just overwrites the tracked
 *   message for that guild, so only the newest one keeps auto-updating.
 * - If the tracked message gets deleted, it's dropped from tracking on the
 *   next refresh cycle instead of erroring forever.
 *
 * Setup:
 * 1. Save this file in the project root (same level as keepAlive.js).
 * 2. In index.js, alongside startStatsChannels(client):
 *      const { startServerStatusUpdater } = require('./serverStatusTracker');
 *      ...
 *      startServerStatusUpdater(client);
 */

const UPDATE_INTERVAL_MS = 30 * 1000; // 30 seconds

// guildId -> { channelId, messageId }
const trackedMessages = new Map();

function registerStatusMessage(guildId, channelId, messageId) {
  trackedMessages.set(guildId, { channelId, messageId });
}

function buildStatusContent(guild) {
  const members = guild.members.cache.filter((member) => !member.user.bot);
  const totalMembers = members.size;

  let online = 0;
  let idle = 0;
  let dnd = 0;
  let offline = 0;

  members.forEach((member) => {
    const status = member.presence?.status ?? 'offline';
    switch (status) {
      case 'online':
        online++;
        break;
      case 'idle':
        idle++;
        break;
      case 'dnd':
        dnd++;
        break;
      default:
        offline++;
    }
  });

  const totalOnlineOfAnyStatus = online + idle + dnd;

  const inVoice = guild.channels.cache
    .filter((c) => c.isVoiceBased())
    .reduce((sum, c) => sum + c.members.filter((m) => !m.user.bot).size, 0);

  const timeStr = new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return (
    `**${guild.name}** — Server Status\n` +
    `Total members: **${totalMembers}**\n` +
    `Online (any status): **${totalOnlineOfAnyStatus}**\n` +
    `> 🟢 Online: **${online}**\n` +
    `> 🌙 Idle: **${idle}**\n` +
    `> ⛔ Do Not Disturb: **${dnd}**\n` +
    `> ⚫ Offline/Invisible: **${offline}**\n` +
    `Currently in voice channels: **${inVoice}**\n\n` +
    `-# 🔄 Auto-refreshes every 30s • Last updated ${timeStr}`
  );
}

async function refreshAll(client) {
  for (const [guildId, { channelId, messageId }] of trackedMessages.entries()) {
    try {
      const guild = client.guilds.cache.get(guildId);
      if (!guild) {
        trackedMessages.delete(guildId);
        continue;
      }

      const channel = guild.channels.cache.get(channelId);
      if (!channel) {
        trackedMessages.delete(guildId);
        continue;
      }

      const message = await channel.messages.fetch(messageId).catch(() => null);
      if (!message) {
        // Message was deleted or is otherwise gone - stop tracking it.
        trackedMessages.delete(guildId);
        continue;
      }

      await message.edit({ content: buildStatusContent(guild) });
    } catch (err) {
      console.error(`[serverStatusTracker] Failed to refresh status for guild ${guildId}:`, err.message);
    }
  }
}

function startServerStatusUpdater(client) {
  setTimeout(() => {
    refreshAll(client);
    setInterval(() => refreshAll(client), UPDATE_INTERVAL_MS);
  }, 8000);
}

module.exports = {
  registerStatusMessage,
  buildStatusContent,
  startServerStatusUpdater,
};
