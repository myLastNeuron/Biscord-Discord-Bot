// Tiny in-memory session store for the multi-step "Add/Edit Rule" wizard in
// the Auto-React panel. Not persisted to disk on purpose - losing an
// in-progress wizard on a bot restart is fine, same tradeoff as the embed
// builder's session store.

const sessions = new Map(); // key: `${guildId}:${userId}` -> draft
const SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes of inactivity

function key(guildId, userId) {
  return `${guildId}:${userId}`;
}

// initial can prefill fields for an "Edit" flow (editingId, trigger,
// matchAll, channelId, emojisRaw, keywordsRaw).
function startSession(guildId, userId, initial = {}) {
  const draft = {
    editingId: null,
    trigger: null,
    matchAll: false,
    channelId: null,
    emojisRaw: '',
    keywordsRaw: '',
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
