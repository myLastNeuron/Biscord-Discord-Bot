/**
 * keepAlive.js
 * ------------
 * Manages "keep this guild connected to a VC no matter what" state,
 * and auto-reconnects with exponential backoff if the bot ever drops.
 *
 * Requires: @discordjs/voice, @discordjs/opus (or opusscript) for audio,
 * and libsodium-wrappers or sodium-native for encryption.
 *
 *   npm install @discordjs/voice libsodium-wrappers
 */

const {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState,
} = require('@discordjs/voice');

// guildId -> { channelId, connection }
const keepAliveTargets = new Map();
// guildId -> boolean, true while a reconnect attempt is in progress
const reconnecting = new Map();

function connectToChannel(channel) {
  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: true,
  });

  keepAliveTargets.set(channel.guild.id, {
    channelId: channel.id,
    connection,
  });

  attachDisconnectHandler(connection, channel.guild);

  return connection;
}

function attachDisconnectHandler(connection, guild) {
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    // Discord.js fires this both for "we told it to leave" and for
    // unexpected drops. Race a quick reconnect against a short timeout
    // to tell the difference before we treat it as a real disconnect.
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5000),
      ]);
      // It's reconnecting on its own (e.g. brief network blip) - let it.
    } catch {
      // Genuinely dropped. If we're still supposed to be keeping this
      // guild alive, try to rejoin from scratch with backoff.
      const target = keepAliveTargets.get(guild.id);
      if (target) {
        connection.destroy();
        reconnectWithBackoff(guild, target.channelId);
      }
    }
  });

  connection.on(VoiceConnectionStatus.Destroyed, () => {
    // Connection object is gone. If we still want to be connected
    // (e.g. bot was kicked from the channel rather than /leave being used),
    // try to rejoin.
    const target = keepAliveTargets.get(guild.id);
    if (target && target.connection === connection) {
      reconnectWithBackoff(guild, target.channelId);
    }
  });
}

async function reconnectWithBackoff(guild, channelId, maxRetries = 10) {
  if (reconnecting.get(guild.id)) return; // already retrying
  reconnecting.set(guild.id, true);

  let delay = 2000;
  try {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      // Bail if /leave was called while we were waiting
      if (!keepAliveTargets.has(guild.id)) return;

      const channel = guild.channels.cache.get(channelId);
      if (!channel) {
        keepAliveTargets.delete(guild.id);
        return;
      }

      try {
        const connection = connectToChannel(channel);
        await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
        return; // success
      } catch {
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 2, 60_000); // cap at 60s
      }
    }
    // Ran out of retries - stop trying so we don't loop forever.
    keepAliveTargets.delete(guild.id);
  } finally {
    reconnecting.delete(guild.id);
  }
}

function stopKeepAlive(guildId) {
  const target = keepAliveTargets.get(guildId);
  keepAliveTargets.delete(guildId); // remove FIRST so handlers don't reconnect
  if (target) {
    target.connection.destroy();
  }
}

function isKeptAlive(guildId) {
  return keepAliveTargets.has(guildId);
}

module.exports = {
  connectToChannel,
  reconnectWithBackoff,
  stopKeepAlive,
  isKeptAlive,
  keepAliveTargets,
};
