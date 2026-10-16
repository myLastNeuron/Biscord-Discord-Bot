// Persists reaction-role messages: which emoji, on which sent message,
// grants which role. Keyed by messageId at the top level (Discord snowflakes
// are globally unique), with the owning guildId stored on each record so a
// per-guild reset can scan and drop just that guild's entries.
//
// Deliberately separate from autoReactRules.json (Auto-React) and from
// guildSettings: a reaction role is a live binding between a *sent* message
// and a role, not a standing rule that runs on every matching message.
const fs = require('fs');
const { dataPath, writeJsonAtomic } = require('./safeFile');

const FILE_PATH = dataPath('reactionRoles.json');

const _cache = { data: null, expires: 0 };
const CACHE_TTL_MS = 60_000;

function ensureFile() {
  if (!fs.existsSync(FILE_PATH)) {
    writeJsonAtomic(FILE_PATH, {});
  }
}

function loadAll() {
  if (_cache.data && Date.now() < _cache.expires) return _cache.data;
  ensureFile();
  let data;
  try {
    const raw = fs.readFileSync(FILE_PATH, 'utf8');
    data = JSON.parse(raw || '{}');
  } catch (err) {
    console.error('[reactionRoleStore] Failed to read/parse file, resetting.', err);
    data = {};
  }
  _cache.data = data;
  _cache.expires = Date.now() + CACHE_TTL_MS;
  return data;
}

function saveAll(data) {
  writeJsonAtomic(FILE_PATH, data);
  _cache.data = data;
  _cache.expires = Date.now() + CACHE_TTL_MS;
}

// record: { guildId, channelId, toggleOnRemove, mappings: [{ emojiRaw, emojiKey, roleId }] }
function saveMapping(messageId, record) {
  const all = loadAll();
  all[messageId] = { ...record, messageId, createdAt: new Date().toISOString() };
  saveAll(all);
  return all[messageId];
}

function getByMessage(messageId) {
  return loadAll()[messageId] || null;
}

// Drops every reaction-role message owned by a guild. Called by db.js's
// resetEverythingForGuild() — safe to call even when the guild has none.
function clearGuildMappings(guildId) {
  const all = loadAll();
  let changed = false;
  for (const [messageId, record] of Object.entries(all)) {
    if (record?.guildId === guildId) {
      delete all[messageId];
      changed = true;
    }
  }
  if (changed) saveAll(all);
}

module.exports = {
  saveMapping,
  getByMessage,
  clearGuildMappings,
};
