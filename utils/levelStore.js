/**
 * levelStore.js
 * JSON-backed persistence for the entire level system.
 *
 * Data layout  (data/levels.json)
 * ─────────────────────────────────
 * {
 *   settingsByGuild: {
 *     "guildId": {
 *       xpPerMessage:   { min: 5,  max: 15 },   // random range per message
 *       xpPerVoiceMin:  2,                        // xp per minute in voice
 *       xpPerReaction:  3,
 *       xpPerCommand:   1,
 *       cooldownMs:     60000,                    // XP cooldown (ms)
 *       notifyChannel:  null | "channel_id",      // null = same channel / DM
 *       notifyDM:       false,
 *       notifySameChannel: true,
 *       notifyDedicatedChannel: false,
 *     }
 *   },
 *   levelDefinitionsByGuild: {
 *     "guildId": [                               // sorted by level asc
 *       { level: 1, xpRequired: 100,  name: "Newcomer",  roleId: null },
 *       { level: 2, xpRequired: 300,  name: "Member",    roleId: "123" },
 *       ...
 *     ]
 *   },
 *   users: {
 *     "guildId": {
 *       "userId": {
 *         xp: 0,
 *         level: 0,
 *         totalXp: 0,
 *         lastMessageAt: 0,      // epoch ms, cooldown for message/command/reaction XP
 *         voiceJoinedAt: null,   // epoch ms, when they joined a VC
 *       }
 *     }
 *   }
 * }
 *
 * ── Migration ─────────────────────────────────────────────────────────────────
 * Legacy versions of this file stored everything globally (a single `settings`,
 * `levelDefinitions`, and a flat `users` keyed by bare user ID). That meant
 * multi-server bots mixed XP across guilds. On the first per-guild read/write,
 * the legacy data is re-bucketed under that guild's IDs - which is the best we
 * can attribute it to, since the old format never recorded a guild. Going
 * forward every record is namespaced by guildId and no cross-guild data can
 * leak.
 */

const fs = require('fs');
const { dataPath, writeJsonAtomic } = require('./safeFile');

const DATA_PATH = dataPath('levels.json');

// ── defaults ──────────────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  enabled:                   true,   // master on/off for the whole level system (false = no XP awarded anywhere)
  xpPerMessage:              { min: 5, max: 15 },
  xpPerVoiceMin:             2,
  xpPerReaction:             3,
  xpPerCommand:              1,
  cooldownMs:                60_000,
  notifyDM:                  false,
  notifySameChannel:         true,
  notifyDedicatedChannel:    false,
  notifyChannel:             null,
};

const DEFAULT_LEVEL_DEFS = [
  { level: 1,  xpRequired: 100,   name: 'Newcomer',    roleId: null },
  { level: 2,  xpRequired: 300,   name: 'Member',      roleId: null },
  { level: 3,  xpRequired: 600,   name: 'Regular',     roleId: null },
  { level: 4,  xpRequired: 1000,  name: 'Active',      roleId: null },
  { level: 5,  xpRequired: 1500,  name: 'Veteran',     roleId: null },
  { level: 6,  xpRequired: 2100,  name: 'Senior',      roleId: null },
  { level: 7,  xpRequired: 2800,  name: 'Elite',       roleId: null },
  { level: 8,  xpRequired: 3600,  name: 'Champion',    roleId: null },
  { level: 9,  xpRequired: 4500,  name: 'Legend',      roleId: null },
  { level: 10, xpRequired: 5500,  name: 'Mythic',      roleId: null },
];

function emptyUser() {
  return { xp: 0, level: 0, totalXp: 0, lastMessageAt: 0, voiceJoinedAt: null };
}

// ── internal helpers ──────────────────────────────────────────────────────────
const _cache = { data: null, expires: 0 };
const CACHE_TTL_MS = 60_000;

function load() {
  if (_cache.data && Date.now() < _cache.expires) return _cache.data;
  try {
    if (!fs.existsSync(DATA_PATH)) return null;
    const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    _cache.data = data;
    _cache.expires = Date.now() + CACHE_TTL_MS;
    return data;
  } catch { return null; }
}

function save(data) {
  writeJsonAtomic(DATA_PATH, data);
  _cache.data = data;
  _cache.expires = Date.now() + CACHE_TTL_MS;
}

function getStore() {
  let raw = load();
  if (!raw) {
    raw = { settingsByGuild: {}, levelDefinitionsByGuild: {}, users: {} };
    save(raw);
    return raw;
  }
  return raw;
}

// One-time migration from the legacy global layout into per-guild buckets.
// Legacy data is attributed to whichever guild touches the level system first.
function ensureMigrated(store, guildId) {
  const hasLegacy =
    store.settings !== undefined || store.levelDefinitions !== undefined || store.users === undefined;

  let legacyFlatUsers = null;
  if (store.users) {
    const keys = Object.keys(store.users);
    // A legacy flat store maps userId -> user record, so the first value carries
    // user fields (xp/level/...). A per-guild store maps guildId -> { userId: record },
    // so the first value is a bucket object without those fields. Guild IDs and
    // user IDs are both numeric snowflakes, so we discriminate by shape, not key.
    const first = keys.length > 0 ? store.users[keys[0]] : null;
    const isFlat =
      keys.length > 0 &&
      first != null &&
      typeof first === 'object' &&
      ('xp' in first || 'level' in first || 'totalXp' in first);
    if (isFlat) legacyFlatUsers = store.users;
  }

  if (!hasLegacy && !legacyFlatUsers) {
    // Ensure containers exist even for a fresh guild.
    store.settingsByGuild ??= {};
    store.levelDefinitionsByGuild ??= {};
    if (!store.users) store.users = {};
    return;
  }

  store.settingsByGuild ??= {};
  store.levelDefinitionsByGuild ??= {};
  if (!store.users) store.users = {};

  if (store.settings !== undefined) {
    store.settingsByGuild[guildId] = { ...DEFAULT_SETTINGS, ...store.settings };
    delete store.settings;
  }
  if (store.levelDefinitions !== undefined) {
    store.levelDefinitionsByGuild[guildId] = store.levelDefinitions;
    delete store.levelDefinitions;
  }

  if (legacyFlatUsers) {
    // Copy (never reference — the flat map lives under store.users itself,
    // so assigning it in place would create a circular structure) and then
    // drop the old flat keys so a later guild can't re-migrate them.
    const migrated = { ...legacyFlatUsers };
    for (const key of Object.keys(legacyFlatUsers)) {
      delete store.users[key];
    }
    store.users[guildId] = migrated;
  }

  save(store);
}

function getUserRecord(store, guildId, userId) {
  store.users[guildId] ??= {};
  if (!store.users[guildId][userId]) {
    store.users[guildId][userId] = emptyUser();
    save(store);
  }
  return store.users[guildId][userId];
}

function getGuildDefs(store, guildId) {
  return (store.levelDefinitionsByGuild[guildId] ?? DEFAULT_LEVEL_DEFS)
    .slice()
    .sort((a, b) => a.level - b.level);
}

// ── public API ────────────────────────────────────────────────────────────────

/** Returns the full settings object for a single guild */
function getSettings(guildId) {
  const store = getStore();
  ensureMigrated(store, guildId);
  return { ...DEFAULT_SETTINGS, ...(store.settingsByGuild[guildId] ?? {}) };
}

/** Merges partial settings object for a guild and persists */
function updateSettings(guildId, partial) {
  const store = getStore();
  ensureMigrated(store, guildId);
  store.settingsByGuild[guildId] = { ...(store.settingsByGuild[guildId] ?? {}), ...partial };
  save(store);
  return store.settingsByGuild[guildId];
}

/** Returns sorted level definitions array for a guild */
function getLevelDefinitions(guildId) {
  const store = getStore();
  ensureMigrated(store, guildId);
  return getGuildDefs(store, guildId);
}

/** Upsert a level definition for a guild */
function setLevelDefinition(guildId, level, name, xpRequired, roleId = null) {
  const store = getStore();
  ensureMigrated(store, guildId);
  const defs = store.levelDefinitionsByGuild[guildId] ?? [];
  const idx = defs.findIndex(d => d.level === level);
  const def = { level, name, xpRequired, roleId };
  if (idx >= 0) defs[idx] = def;
  else defs.push(def);
  defs.sort((a, b) => a.level - b.level);
  store.levelDefinitionsByGuild[guildId] = defs;
  save(store);
}

/** Remove a level definition for a guild */
function deleteLevelDefinition(guildId, level) {
  const store = getStore();
  ensureMigrated(store, guildId);
  const defs = store.levelDefinitionsByGuild[guildId] ?? [];
  store.levelDefinitionsByGuild[guildId] = defs.filter(d => d.level !== level);
  save(store);
}

/** Get a single user record for a guild (creates if missing) */
function getUser(guildId, userId) {
  const store = getStore();
  ensureMigrated(store, guildId);
  return getUserRecord(store, guildId, userId);
}

/** Get all of a guild's users sorted by totalXp desc */
function getLeaderboard(guildId, limit = 10) {
  const store = getStore();
  ensureMigrated(store, guildId);
  const users = store.users[guildId] ?? {};
  return Object.entries(users)
    .map(([id, data]) => ({ id, ...data }))
    .sort((a, b) => b.totalXp - a.totalXp)
    .slice(0, limit);
}

/**
 * Award XP to a user in a guild.
 * Returns { oldLevel, newLevel, leveledUp, levelDef } where levelDef is the
 * definition object for the new level (if leveled up), or null.
 */
function awardXP(guildId, userId, amount) {
  const store = getStore();
  ensureMigrated(store, guildId);
  const defs = getGuildDefs(store, guildId);
  const user = getUserRecord(store, guildId, userId);

  const oldLevel = user.level;
  user.xp       += amount;
  user.totalXp  += amount;

  // Check level-ups (can level up multiple times in one XP grant)
  let newLevel = oldLevel;
  for (const def of defs) {
    if (def.level > newLevel && user.xp >= def.xpRequired) {
      newLevel = def.level;
    }
  }

  user.level = newLevel;
  save(store);

  const leveledUp = newLevel > oldLevel;
  const levelDef  = leveledUp ? defs.find(d => d.level === newLevel) ?? null : null;
  return { oldLevel, newLevel, leveledUp, levelDef };
}

/** Directly set a user's level (cheat command) */
function setUserLevel(guildId, userId, level) {
  const store = getStore();
  ensureMigrated(store, guildId);
  const defs = getGuildDefs(store, guildId);
  const def  = defs.find(d => d.level === level);
  const user = getUserRecord(store, guildId, userId);

  user.level = level;
  // Set XP to exactly the threshold for that level
  if (def) user.xp = def.xpRequired;
  save(store);
  return def;
}

/** Add or subtract XP directly (cheat/mod command) */
function setUserXP(guildId, userId, xp) {
  const store = getStore();
  ensureMigrated(store, guildId);
  const user = getUserRecord(store, guildId, userId);
  user.xp      = Math.max(0, xp);
  user.totalXp = Math.max(0, xp);
  save(store);
}

/** Completely reset a user within a guild */
function resetUser(guildId, userId) {
  const store = getStore();
  ensureMigrated(store, guildId);
  store.users[guildId] ??= {};
  store.users[guildId][userId] = emptyUser();
  save(store);
}

/** Reset ALL users within a single guild (not every guild on the bot) */
function resetAll(guildId) {
  const store = getStore();
  ensureMigrated(store, guildId);
  store.users[guildId] = {};
  save(store);
}

/** Update XP cooldown timestamp (shared by message/command/reaction XP) */
function setLastMessage(guildId, userId) {
  const store = getStore();
  ensureMigrated(store, guildId);
  getUserRecord(store, guildId, userId).lastMessageAt = Date.now();
  save(store);
}

/** True if the user can currently earn XP (message/command/reaction cooldown) */
function canEarnXP(guildId, userId, cooldownMs) {
  const store = getStore();
  ensureMigrated(store, guildId);
  const user = store.users[guildId]?.[userId];
  if (!user) return true;
  return Date.now() - (user.lastMessageAt || 0) >= cooldownMs;
}

/** Record when a user joins a voice channel */
function setVoiceJoin(guildId, userId) {
  const store = getStore();
  ensureMigrated(store, guildId);
  const user = getUserRecord(store, guildId, userId);
  user.voiceJoinedAt = Date.now();
  save(store);
}

/** Award XP for time spent in voice since voiceJoinedAt, then clear it */
function flushVoiceXP(guildId, userId, xpPerVoiceMin) {
  const store = getStore();
  ensureMigrated(store, guildId);
  const user = store.users[guildId]?.[userId];
  if (!user || !user.voiceJoinedAt) return null;

  const minutes  = Math.floor((Date.now() - user.voiceJoinedAt) / 60_000);
  user.voiceJoinedAt = null;
  save(store);

  if (minutes <= 0 || !xpPerVoiceMin) return null;
  const xp = minutes * xpPerVoiceMin;
  return awardXP(guildId, userId, xp);
}

module.exports = {
  getSettings, updateSettings,
  getLevelDefinitions, setLevelDefinition, deleteLevelDefinition,
  getUser, getLeaderboard,
  awardXP, setUserLevel, setUserXP, resetUser, resetAll,
  setLastMessage, canEarnXP, setVoiceJoin, flushVoiceXP,
};