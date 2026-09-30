// In-memory session store for the /panel "Create Giveaway" wizard — holds
// the channel picked in step 1 while the user fills out the prize/duration/
// winners modal in step 2. Same shape/pattern as autopostWizardStore and
// autoReactWizardStore: never touches disk, sessions are short-lived and
// per (guild, user), and auto-expire so an abandoned wizard doesn't leak.

const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes
const sessions = new Map();

function key(guildId, userId) {
  return `${guildId}:${userId}`;
}

function startSession(guildId, userId, initial = {}) {
  const session = { guildId, userId, createdAt: Date.now(), ...initial };
  sessions.set(key(guildId, userId), session);
  scheduleExpiry(guildId, userId);
  return session;
}

function getSession(guildId, userId) {
  return sessions.get(key(guildId, userId)) || null;
}

function updateSession(guildId, userId, patch) {
  const existing = getSession(guildId, userId);
  if (!existing) return null;
  const updated = { ...existing, ...patch };
  sessions.set(key(guildId, userId), updated);
  return updated;
}

function endSession(guildId, userId) {
  sessions.delete(key(guildId, userId));
}

function scheduleExpiry(guildId, userId) {
  setTimeout(() => {
    const session = getSession(guildId, userId);
    if (session && Date.now() - session.createdAt >= SESSION_TTL_MS) {
      endSession(guildId, userId);
    }
  }, SESSION_TTL_MS + 1000).unref?.();
}

module.exports = { startSession, getSession, updateSession, endSession };
