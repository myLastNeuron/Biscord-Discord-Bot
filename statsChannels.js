/**
 * statsChannels.js
 * ----------------
 * Shows live server stats as a VOICE CHANNEL STATUS (the small text under
 * a channel's name). The installed discord.js version doesn't expose a
 * setStatus()/setVoiceStatus() helper method, so this calls Discord's REST
 * API directly via client.rest.put() instead.
 *
 * Setup:
 * 1. Two voice channels already created for you (members, online-members).
 * 2. .env already has STATS_MEMBERS_CHANNEL_ID / STATS_ONLINE_CHANNEL_ID set.
 * 3. Already wired into index.js's clientReady handler.
 *
 * Requires GuildMembers + GuildPresences intents (same as /server-status).
 * The bot also needs the "Set Voice Channel Status" permission in the
 * server (Server Settings -> Roles -> bot's role -> permissions).
 */

const UPDATE_INTERVAL_MS = 30 * 1000; // 30 seconds

async function setVoiceStatus(client, channelId, status) {
  // Discord REST endpoint: PUT /channels/{channel.id}/voice-status
  // Not yet wrapped as a helper method in this discord.js version, so we
  // hit it directly through the low-level REST client.
  await client.rest.put(`/channels/${channelId}/voice-status`, {
    body: { status },
  });
}

async function updateStatsChannels(client) {
  const membersChannelId = process.env.STATS_MEMBERS_CHANNEL_ID;
  const onlineChannelId = process.env.STATS_ONLINE_CHANNEL_ID;

  if (!membersChannelId && !onlineChannelId) return;

  for (const guild of client.guilds.cache.values()) {
    try {
      const members = guild.members.cache.filter((member) => !member.user.bot);
      const totalMembers = members.size;

      let onlineCount = 0;
      members.forEach((member) => {
        const status = member.presence?.status;
        if (status === 'online' || status === 'idle' || status === 'dnd') {
          onlineCount++;
        }
      });

      if (membersChannelId && guild.channels.cache.has(membersChannelId)) {
        await setVoiceStatus(client, membersChannelId, `🌐 Members: ${totalMembers.toLocaleString('en-US')}`);
      }

      if (onlineChannelId && guild.channels.cache.has(onlineChannelId)) {
        await setVoiceStatus(client, onlineChannelId, `🟢 Online: ${onlineCount.toLocaleString('en-US')}`);
      }
    } catch (err) {
      console.error(`[statsChannels] Failed to update stats for guild ${guild.id}:`, err.message);
    }
  }
}

function startStatsChannels(client) {
  updateStatsChannels(client);
  setInterval(() => updateStatsChannels(client), UPDATE_INTERVAL_MS);

  // When someone joins or leaves ANY voice channel, Discord overwrites the
  // VC status text. Re-push our custom status immediately so it doesn't
  // stay broken until the next 30-second tick.
  client.on('voiceStateUpdate', (oldState, newState) => {
    const membersChannelId = process.env.STATS_MEMBERS_CHANNEL_ID;
    const onlineChannelId  = process.env.STATS_ONLINE_CHANNEL_ID;

    const affectedChannelIds = new Set(
      [oldState.channelId, newState.channelId].filter(Boolean)
    );

    // Only bother re-pushing if the join/leave happened in one of our
    // tracked stats channels (avoids unnecessary API calls for every VC event).
    const isTrackedChannel =
      affectedChannelIds.has(membersChannelId) ||
      affectedChannelIds.has(onlineChannelId);

    if (isTrackedChannel) {
      // Small delay so Discord's own state settles before we overwrite it.
      setTimeout(() => updateStatsChannels(client), 1500);
    }
  });

}

module.exports = { startStatsChannels, updateStatsChannels };
