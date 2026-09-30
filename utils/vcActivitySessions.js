// Tracks "who's currently in voice, and since when" purely in memory.
// Deliberately NOT persisted to disk - if the bot restarts mid-call, we lose
// the original join time for anyone already in voice (their next leave just
// won't produce a duration message, which is a fine, harmless edge case).
// Keyed as sessions.get(guildId).get(userId) -> { startedAt, channelName }

const sessions = new Map();

function _guildMap(guildId) {
  if (!sessions.has(guildId)) sessions.set(guildId, new Map());
  return sessions.get(guildId);
}

function startSession(guildId, userId, channelName) {
  _guildMap(guildId).set(userId, { startedAt: Date.now(), channelName });
}

// Updates the tracked channel name without resetting the start time -
// call this when someone switches VCs mid-session so the eventual leave
// message reports the channel they were actually in when they left.
function updateChannel(guildId, userId, channelName) {
  const session = _guildMap(guildId).get(userId);
  if (session) session.channelName = channelName;
}

// Ends the session and returns { durationMs, channelName }, or null if we
// had no record of them (e.g. bot restarted while they were already in voice).
function endSession(guildId, userId) {
  const map = _guildMap(guildId);
  const session = map.get(userId);
  if (!session) return null;
  map.delete(userId);
  return { durationMs: Date.now() - session.startedAt, channelName: session.channelName };
}

function hasSession(guildId, userId) {
  return _guildMap(guildId).has(userId);
}

// e.g. 12m 34s / 1h 04m / 45s
function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}

module.exports = { startSession, updateChannel, endSession, hasSession, formatDuration };
