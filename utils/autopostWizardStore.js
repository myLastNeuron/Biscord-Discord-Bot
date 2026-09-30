// Tiny in-memory session store for the multi-step "Add/Edit Autopost" wizard
// in the Autopost Settings panel. Not persisted to disk on purpose - losing
// an in-progress wizard on a bot restart is fine, same tradeoff as the
// auto-react wizard's session store.

const sessions = new Map(); // key: `${guildId}:${userId}` -> draft
const SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes of inactivity

function key(guildId, userId) {
  return `${guildId}:${userId}`;
}

// initial can prefill fields for an "Edit" flow (editingToken, channelId,
// scheduleType, hour, titleRaw, descriptionRaw, categoryRaw, slotsRaw,
// minuteLockRaw).
function startSession(guildId, userId, initial = {}) {
  const draft = {
    editingToken: null,
    channelId: null,
    scheduleType: 'daily', // 'daily' (once a day at hour:minute) | 'hourly' (every hour at :minute)
    hour: null,
    titleRaw: '',
    descriptionRaw: '',
    categoryRaw: '',
    slotsRaw: '',
    minuteLockRaw: '', // combined "minute, lock-after minutes" text shown in the final modal
    ...initial,
    updatedAt: Date.now(),
  };
  sessions.set(key(guildId, userId), draft);
  return draft;
}

function getSession(guildId, userId) {
  const k = key(guildId, userId);
  const draft = sessions.get(k);
  if (!draft) return null;
  if (Date.now() - draft.updatedAt > SESSION_TTL_MS) {
    sessions.delete(k);
    return null;
  }
  return draft;
}

function updateSession(guildId, userId, patch) {
  const current = getSession(guildId, userId) || startSession(guildId, userId);
  const updated = { ...current, ...patch, updatedAt: Date.now() };
  sessions.set(key(guildId, userId), updated);
  return updated;
}

function endSession(guildId, userId) {
  sessions.delete(key(guildId, userId));
}

module.exports = { startSession, getSession, updateSession, endSession };
