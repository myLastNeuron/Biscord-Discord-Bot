// Tiny JSON-file "database". No external DB needed — good for small/medium servers.
// Everything lives in /data as plain JSON so you can inspect or back it up easily.

const fs = require('fs');
const path = require('path');
const { clearGuildRules: clearAutoReactRules } = require('./autoReactStore');
const { clearSettings: clearTempVcSettings } = require('./tempVcStore');

const { DATA_DIR, writeJsonAtomic } = require('./safeFile');

fs.mkdirSync(DATA_DIR, { recursive: true });

const FILES = {
  guilds: path.join(DATA_DIR, 'guildSettings.json'),   // per-guild config (welcome, mod roles, log channel...)
  events: path.join(DATA_DIR, 'events.json'),          // every posted roster/event panel, keyed by messageId
  scheduled: path.join(DATA_DIR, 'scheduledEvents.json'), // panels waiting for their scheduled time, keyed by token
  scheduledMessages: path.join(DATA_DIR, 'scheduledMessages.json'), // plain messages waiting to be sent, keyed by token
  autopostRosters: path.join(DATA_DIR, 'autopostRosters.json'), // recurring daily roster configs, keyed by token
  warnings: path.join(DATA_DIR, 'warnings.json'),      // per-guild per-user warning history
  stats: path.join(DATA_DIR, 'stats.json'),            // per-guild per-user event attendance stats
  restartFlag: path.join(DATA_DIR, 'restartFlag.json'), // set right before an intentional /panel restart, read once on next boot
  reactionApprovals: path.join(DATA_DIR, 'reactionApprovals.json'), // pending/resolved Reaction Approval requests, keyed by token
  giveaways: path.join(DATA_DIR, 'giveaways.json'), // active/ended giveaways, keyed by token
  polls: path.join(DATA_DIR, 'polls.json'), // active/ended polls, keyed by token
  invites: path.join(DATA_DIR, 'invites.json'), // per-guild invite tracker stats + join->inviter map
};

// In-memory cache for all JSON data files to prevent repeated disk reads
const memoryCache = {
  guilds: new Map(),
  events: new Map(),
  scheduled: new Map(),
  scheduledMessages: new Map(),
  autopostRosters: new Map(),
  warnings: new Map(), // { guildId: { userId: warning[] } }
  stats: new Map(), // { guildId: { userId: stats } }
  reactionApprovals: new Map(),
  giveaways: new Map(),
  polls: new Map(),
  invites: new Map(), // { guildId: { stats: {}, joins: {} } }
};

// TTL for cache entries in milliseconds
const CACHE_TTL_MS = 60_000; // 1 minute
const LAST_REFRESH = {};

function _isCacheValid(file) {
  const now = Date.now();
  return LAST_REFRESH[file] && now - LAST_REFRESH[file] < CACHE_TTL_MS;
}

function _refreshCache(file, data) {
  const map = memoryCache[file];
  if (!map) return;
  map.clear();
  const nested = file === 'warnings' || file === 'stats' || file === 'invites';
  for (const [key, value] of Object.entries(data)) {
    if (nested && typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const inner = new Map();
      for (const [k2, v2] of Object.entries(value)) inner.set(k2, v2);
      map.set(key, inner);
    } else {
      map.set(key, value);
    }
  }
  LAST_REFRESH[file] = Date.now();
}

function _read(file) {
  if (_isCacheValid(file)) {
    const data = memoryCache[file] || new Map();
    const nested = file === 'warnings' || file === 'stats' || file === 'invites';
    const result = {};
    for (const [key, value] of data.entries()) {
      if (nested && value instanceof Map) {
        result[key] = Object.fromEntries(value);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  try {
    if (!fs.existsSync(FILES[file])) return {};
    const raw = fs.readFileSync(FILES[file], 'utf8').trim();
    const data = raw ? JSON.parse(raw) : {};
    _refreshCache(file, data);
    return data;
  } catch (err) {
    console.error(`[db] Failed to read ${file}:`, err);
    return {};
  }
}

// Returns the live cache Map (or reads from disk and caches it).
// Callers that read→modify→write should use this instead of _read
// so two concurrent callers both modify the same live Map.
function _readMutable(file) {
  if (_isCacheValid(file)) {
    return memoryCache[file];
  }
  // Cache expired — re-read from disk into cache
  try {
    if (!fs.existsSync(FILES[file])) {
      memoryCache[file] = new Map();
      LAST_REFRESH[file] = Date.now();
      return memoryCache[file];
    }
    const raw = fs.readFileSync(FILES[file], 'utf8').trim();
    const data = raw ? JSON.parse(raw) : {};
    _refreshCache(file, data);
    return memoryCache[file];
  } catch (err) {
    console.error(`[db] Failed to read ${file}:`, err);
    memoryCache[file] = new Map();
    LAST_REFRESH[file] = Date.now();
    return memoryCache[file];
  }
}

// ---------- Writes ----------
// Two guarantees this write path provides:
//   1. Atomicity — the new contents go to a temp file which is then renamed
//      over the real one, so a crash mid-write can never leave a corrupt
//      half-written JSON file behind.
//   2. Coalescing — every mutation to a file within the same tick collapses
//      into a single disk write, so a burst of roster clicks or giveaway
//      entries doesn't block the event loop once per entry.
// Readers never wait on this: the in-memory cache is refreshed synchronously,
// so getters see the new value immediately even though the disk write is
// deferred. Pass { immediate: true } for the rare writes that MUST be durable
// before the process exits (e.g. the restart flag).
const pendingWrites = new Map();
let flushScheduled = false;

function _writeFileAtomic(file, data) {
  // Temp-file + rename; see utils/safeFile.js.
  writeJsonAtomic(FILES[file], data);
}

function _flushWrites() {
  flushScheduled = false;
  if (!pendingWrites.size) return;
  const batch = [...pendingWrites];
  pendingWrites.clear();
  for (const [file, data] of batch) {
    try {
      _writeFileAtomic(file, data);
    } catch (err) {
      console.error(`[db] Failed to write ${file}:`, err);
    }
  }
}

function _write(file, data, { immediate = false } = {}) {
  // Getters and _readMutable must observe the change right away.
  _refreshCache(file, data);

  if (immediate) {
    pendingWrites.delete(file); // a queued, now-stale snapshot must not win
    try {
      _writeFileAtomic(file, data);
    } catch (err) {
      console.error(`[db] Failed to write ${file}:`, err);
    }
    return;
  }

  pendingWrites.set(file, data);
  if (!flushScheduled) {
    flushScheduled = true;
    setImmediate(_flushWrites);
  }
}

// Best-effort durability if the process exits with writes still queued.
process.on('exit', () => {
  try { _flushWrites(); } catch { /* nothing we can do at exit */ }
});


// Converts a 2-level Map (Map<guildId, Map<key, value>>) to a plain object
// for JSON serialization. Used by nested collections (warnings, stats, invites).
function _nestedMapToObject(map) {
  const result = {};
  for (const [guildId, inner] of map.entries()) {
    if (inner instanceof Map) {
      result[guildId] = Object.fromEntries(inner);
    } else {
      result[guildId] = inner;
    }
  }
  return result;
}

const DEFAULT_GUILD_SETTINGS = {
  welcomeChannelId: null,
  welcomeMessage: 'Welcome {user} to **{server}**! You are member #{memberCount}.',
  welcomeImage: null,
  welcomeEmbedDraft: null,
  logChannelId: null,
  muteRoleId: null,
  modRoleIds: [],
  roleRequestLogChannelId: null,
  roleRequestApproveRoleId: null,
  ticketCategoryId: null,
  ticketStaffRoleId: null,
  ticketLogChannelId: null,
  ticketDmTranscriptToOpener: true,
  // Optional ticket types for the panel's Open Ticket dropdown. Empty = the
  // panel shows a plain Open Ticket button (original behavior). Each entry:
  // { label: 'Help Hand', emoji: null }. Set via the ticket panel embed builder.
  ticketTypes: [],
  // Master switch for the ticket-types dropdown. When ON the panel shows the
  // dropdown and the plain Open Ticket button is removed; when OFF the button
  // is shown and the dropdown is hidden. The two are mutually exclusive and
  // the bot auto-disables whichever isn't in use.
  ticketTypesEnabled: false,
  upcomingBoardChannelId: null,
  upcomingBoardEnabled: false,
  upcomingBoardMessageId: null,
  upcomingBoardTitle: '📅 Upcoming Rosters',
  upcomingBoardColor: 0x5865f2,
  upcomingBoardHeaderText: null,
  upcomingBoardFooterText: null,
  upcomingBoardShowSlots: false,
  upcomingBoardSortBy: 'time',
  rosterAutoLockMinutes: 15,
  reactionApprovalEnabled: false,
  reactionApprovalSourceChannelId: null,
  reactionApprovalChannelId: null,
  reactionApprovalTriggerType: null,
  reactionApprovalKeywords: [],
  reactionApprovalMatchAll: false,
  reactionApprovalFormatTemplate: null,
  reactionApprovalPendingEmoji: null,
  reactionApprovalApprovedEmoji: null,
  reactionApprovalRejectedEmoji: null,
  giveawayJoinButtonLabel: 'Join',
  giveawayJoinButtonEmoji: '🎉',
  giveawayEmbedTitle: null,
  giveawayEmbedDescription: null,
  giveawayEmbedFooter: null,
  giveawayEmbedColor: null,
  giveawayEmbedThumbnail: null,
  giveawayEmbedImage: null,
  botEnabled: true,
  inviteTrackerEnabled: false,
  inviteLogChannelId: null,
  inviteLogShowRevokeButton: false,
  auditLogChannelId: null,
  auditLogEnabled: false,
};

function getGuildSettings(guildId) {
  const all = _read('guilds');
  return all[guildId] || { ...DEFAULT_GUILD_SETTINGS };
}

function setGuildSettings(guildId, patch) {
  const all = _readMutable('guilds');
  all.set(guildId, { ...getGuildSettings(guildId), ...patch });
  _write('guilds', Object.fromEntries(all));
  return all.get(guildId);
}

function resetGuildSettings(guildId) {
  const all = _readMutable('guilds');
  all.delete(guildId);
  _write('guilds', Object.fromEntries(all));
  return { ...DEFAULT_GUILD_SETTINGS };
}

function resetEverythingForGuild(guildId) {
  const settings = resetGuildSettings(guildId);

  const purgeByGuildId = (file, guildField = 'guildId') => {
    const all = _read(file);
    let changed = false;
    for (const [key, record] of Object.entries(all)) {
      if (record?.[guildField] === guildId) {
        delete all[key];
        changed = true;
      }
    }
    if (changed) _write(file, all);
  };

  purgeByGuildId('events');
  purgeByGuildId('scheduled');
  purgeByGuildId('scheduledMessages');
  purgeByGuildId('autopostRosters');
  purgeByGuildId('reactionApprovals');
  purgeByGuildId('giveaways');
  purgeByGuildId('polls');

  {
    const all = _read('warnings');
    if (all[guildId]) {
      delete all[guildId];
      _write('warnings', all);
    }
  }
  {
    const all = _read('stats');
    if (all[guildId]) {
      delete all[guildId];
      _write('stats', all);
    }
  }
  {
    const all = _read('invites');
    if (all[guildId]) {
      delete all[guildId];
      _write('invites', all);
    }
  }

  clearAutoReactRules(guildId);
  clearTempVcSettings(guildId);

  return settings;
}

function getEvent(messageId) {
  const all = _read('events');
  return all[messageId] || null;
}

function saveEvent(messageId, eventData) {
  const all = _readMutable('events');
  all.set(messageId, eventData);
  _write('events', Object.fromEntries(all));
  return eventData;
}

function deleteEvent(messageId) {
  const all = _readMutable('events');
  all.delete(messageId);
  _write('events', Object.fromEntries(all));
}

function listEvents(guildId) {
  const all = _read('events');
  return Object.entries(all)
    .filter(([, ev]) => ev.guildId === guildId)
    .map(([messageId, ev]) => ({ messageId, ...ev }));
}

function listAllEvents() {
  const all = _read('events');
  return Object.entries(all).map(([messageId, ev]) => ({ messageId, ...ev }));
}

function getScheduledEvents() {
  return _read('scheduled');
}

function getScheduledEvent(token) {
  const all = _read('scheduled');
  return all[token] || null;
}

function saveScheduledEvent(token, eventData) {
  const all = _readMutable('scheduled');
  all.set(token, eventData);
  _write('scheduled', Object.fromEntries(all));
  return eventData;
}

function deleteScheduledEvent(token) {
  const all = _readMutable('scheduled');
  all.delete(token);
  _write('scheduled', Object.fromEntries(all));
}

function listScheduledEvents(guildId) {
  const all = _read('scheduled');
  return Object.entries(all)
    .filter(([, ev]) => ev.guildId === guildId)
    .map(([token, ev]) => ({ token, ...ev }));
}

function getScheduledMessages() {
  return _read('scheduledMessages');
}

function saveScheduledMessage(token, data) {
  const all = _readMutable('scheduledMessages');
  all.set(token, data);
  _write('scheduledMessages', Object.fromEntries(all));
  return data;
}

function deleteScheduledMessage(token) {
  const all = _readMutable('scheduledMessages');
  all.delete(token);
  _write('scheduledMessages', Object.fromEntries(all));
}

function listScheduledMessages(guildId) {
  const all = _read('scheduledMessages');
  return Object.entries(all)
    .filter(([, m]) => m.guildId === guildId)
    .map(([token, m]) => ({ token, ...m }));
}

function getAutopostRosters() {
  return _read('autopostRosters');
}

function saveAutopostRoster(token, data) {
  const all = _readMutable('autopostRosters');
  all.set(token, data);
  _write('autopostRosters', Object.fromEntries(all));
  return data;
}

function deleteAutopostRoster(token) {
  const all = _readMutable('autopostRosters');
  all.delete(token);
  _write('autopostRosters', Object.fromEntries(all));
}

function getAutopostRoster(token) {
  const all = _read('autopostRosters');
  return all[token] || null;
}

function updateAutopostRoster(token, patch) {
  const all = _readMutable('autopostRosters');
  const existing = all.get(token);
  if (!existing) return null;
  const updated = { ...existing, ...patch };
  all.set(token, updated);
  _write('autopostRosters', Object.fromEntries(all));
  return updated;
}

function listAutopostRosters(guildId) {
  const all = _read('autopostRosters');
  return Object.entries(all)
    .filter(([, r]) => r.guildId === guildId)
    .map(([token, r]) => ({ token, ...r }));
}

function getWarnings(guildId, userId) {
  const all = _read('warnings');
  return (all[guildId] && all[guildId][userId]) || [];
}

function addWarning(guildId, userId, warning) {
  const all = _readMutable('warnings');
  let inner = all.get(guildId);
  if (!inner) {
    inner = new Map();
    all.set(guildId, inner);
  }
  const warnings = inner.get(userId) || [];
  warnings.push(warning);
  inner.set(userId, warnings);
  _write('warnings', _nestedMapToObject(all));
  return warnings;
}

function clearWarnings(guildId, userId) {
  const all = _readMutable('warnings');
  const inner = all.get(guildId);
  if (inner) {
    inner.delete(userId);
    if (inner.size === 0) all.delete(guildId);
  }
  _write('warnings', _nestedMapToObject(all));
}

function listWarnings(guildId) {
  const all = _read('warnings');
  const guildWarnings = all[guildId] || {};
  return Object.entries(guildWarnings)
    .map(([userId, warnings]) => ({ userId, count: warnings.length, warnings }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count);
}

function getUserStats(guildId, userId) {
  const all = _read('stats');
  return (all[guildId] && all[guildId][userId]) || {
    total: 0,
    lastAttendance: null,
    categories: {},
  };
}

function recordAttendance(guildId, userId, category) {
  const all = _readMutable('stats');
  let inner = all.get(guildId);
  if (!inner) {
    inner = new Map();
    all.set(guildId, inner);
  }
  const stats = inner.get(userId) || { total: 0, lastAttendance: null, categories: {} };

  stats.total += 1;
  stats.lastAttendance = Date.now();
  const key = category || 'Uncategorized';
  stats.categories[key] = (stats.categories[key] || 0) + 1;

  inner.set(userId, stats);
  _write('stats', _nestedMapToObject(all));
  return stats;
}

function clearUserStats(guildId, userId) {
  const all = _readMutable('stats');
  const inner = all.get(guildId);
  if (inner) {
    inner.delete(userId);
    if (inner.size === 0) all.delete(guildId);
  }
  _write('stats', _nestedMapToObject(all));
}

function getRestartFlag() {
  const data = _read('restartFlag');
  return data.active ? data : null;
}

function setRestartFlag(data) {
  const payload = { active: true, timestamp: Date.now(), ...data };
  // Must hit disk before run.js sees the nonzero exit that follows.
  _write('restartFlag', payload, { immediate: true });
  return payload;
}

function clearRestartFlag() {
  _write('restartFlag', {}, { immediate: true });
}

function getReactionApproval(token) {
  const all = _read('reactionApprovals');
  return all[token] || null;
}

function saveReactionApproval(token, data) {
  const all = _readMutable('reactionApprovals');
  all.set(token, data);
  _write('reactionApprovals', Object.fromEntries(all));
  return all.get(token);
}

function updateReactionApproval(token, patch) {
  const all = _readMutable('reactionApprovals');
  const existing = all.get(token);
  if (!existing) return null;
  const updated = { ...existing, ...patch };
  all.set(token, updated);
  _write('reactionApprovals', Object.fromEntries(all));
  return updated;
}

function findPendingReactionApproval(guildId, messageId) {
  const all = _read('reactionApprovals');
  return Object.entries(all).find(([, r]) =>
    r.guildId === guildId &&
    r.messageId === messageId &&
    r.status === 'pending'
  )?.[1] || null;
}

function getGiveaway(token) {
  const all = _read('giveaways');
  return all[token] || null;
}

function saveGiveaway(token, data) {
  const all = _readMutable('giveaways');
  all.set(token, data);
  _write('giveaways', Object.fromEntries(all));
  return all.get(token);
}

function updateGiveaway(token, patch) {
  const all = _readMutable('giveaways');
  const existing = all.get(token);
  if (!existing) return null;
  const updated = { ...existing, ...patch };
  all.set(token, updated);
  _write('giveaways', Object.fromEntries(all));
  return updated;
}

function deleteGiveaway(token) {
  const all = _readMutable('giveaways');
  all.delete(token);
  _write('giveaways', Object.fromEntries(all));
}

function listGiveaways(guildId) {
  const all = _read('giveaways');
  return Object.entries(all)
    .filter(([, g]) => g.guildId === guildId)
    .map(([token, g]) => ({ token, ...g }));
}

function listActiveGiveaways() {
  const all = _read('giveaways');
  return Object.entries(all)
    .filter(([, g]) => g.status === 'active')
    .map(([token, g]) => ({ token, ...g }));
}

function getPoll(token) {
  const all = _read('polls');
  return all[token] || null;
}

function savePoll(token, data) {
  const all = _readMutable('polls');
  all.set(token, data);
  _write('polls', Object.fromEntries(all));
  return all.get(token);
}

function updatePoll(token, patch) {
  const all = _readMutable('polls');
  const existing = all.get(token);
  if (!existing) return null;
  const updated = { ...existing, ...patch };
  all.set(token, updated);
  _write('polls', Object.fromEntries(all));
  return updated;
}

function deletePoll(token) {
  const all = _readMutable('polls');
  all.delete(token);
  _write('polls', Object.fromEntries(all));
}

function listPolls(guildId) {
  const all = _read('polls');
  return Object.entries(all)
    .filter(([, p]) => p.guildId === guildId)
    .map(([token, p]) => ({ token, ...p }));
}

function listActivePolls() {
  const all = _read('polls');
  return Object.entries(all)
    .filter(([, p]) => p.status === 'active')
    .map(([token, p]) => ({ token, ...p }));
}

function _getGuildInviteData(guildId) {
  const all = _readMutable('invites');
  const inner = all.get(guildId);
  if (!inner) return { stats: {}, joins: {} };
  // inner is a Map<"stats"|"joins", object> from _refreshCache
  return {
    stats: inner.get('stats') || {},
    joins: inner.get('joins') || {},
  };
}

function _setGuildInviteData(guildId, data) {
  const all = _readMutable('invites');
  const inner = new Map();
  inner.set('stats', data.stats);
  inner.set('joins', data.joins);
  all.set(guildId, inner);
  _write('invites', _nestedMapToObject(all));
}

function _withTotal(stats) {
  return { ...stats, total: stats.regular + stats.bonus - stats.leaves };
}

function getInviteStats(guildId, userId) {
  const data = _getGuildInviteData(guildId);
  return _withTotal(data.stats[userId] || { regular: 0, bonus: 0, leaves: 0 });
}

function listInviteStats(guildId) {
  const data = _getGuildInviteData(guildId);
  return Object.entries(data.stats)
    .map(([userId, s]) => ({ userId, ..._withTotal(s) }))
    .sort((a, b) => b.total - a.total);
}

function addInviteUse(guildId, inviterId) {
  const data = _getGuildInviteData(guildId);
  const s = data.stats[inviterId] || { regular: 0, bonus: 0, leaves: 0 };
  s.regular += 1;
  data.stats[inviterId] = s;
  _setGuildInviteData(guildId, data);
  return _withTotal(s);
}

function addBonusInvites(guildId, userId, amount) {
  const data = _getGuildInviteData(guildId);
  const s = data.stats[userId] || { regular: 0, bonus: 0, leaves: 0 };
  s.bonus += amount;
  data.stats[userId] = s;
  _setGuildInviteData(guildId, data);
  return _withTotal(s);
}

function recordInviteLeave(guildId, inviterId) {
  const data = _getGuildInviteData(guildId);
  const s = data.stats[inviterId] || { regular: 0, bonus: 0, leaves: 0 };
  s.leaves += 1;
  data.stats[inviterId] = s;
  _setGuildInviteData(guildId, data);
  return _withTotal(s);
}

function recordJoinInviter(guildId, memberId, inviterId, code) {
  const data = _getGuildInviteData(guildId);
  data.joins[memberId] = { inviterId, code, joinedAt: Date.now() };
  _setGuildInviteData(guildId, data);
}

function getJoinInviter(guildId, memberId) {
  const data = _getGuildInviteData(guildId);
  return data.joins[memberId] || null;
}

function removeJoinInviter(guildId, memberId) {
  const data = _getGuildInviteData(guildId);
  if (data.joins[memberId]) {
    delete data.joins[memberId];
    _setGuildInviteData(guildId, data);
  }
}

function resetInviteStats(guildId, userId) {
  const data = _getGuildInviteData(guildId);
  delete data.stats[userId];
  _setGuildInviteData(guildId, data);
}

function resetAllInviteStats(guildId) {
  _setGuildInviteData(guildId, { stats: {}, joins: {} });
}

module.exports = {
  DATA_DIR,
  DEFAULT_GUILD_SETTINGS,
  // Force any queued (coalesced) writes to disk now. Mainly for tests/shutdown.
  flush: _flushWrites,
  getGuildSettings,
  setGuildSettings,
  resetGuildSettings,
  resetEverythingForGuild,
  getEvent,
  saveEvent,
  deleteEvent,
  listEvents,
  listAllEvents,
  getScheduledEvents,
  getScheduledEvent,
  saveScheduledEvent,
  deleteScheduledEvent,
  listScheduledEvents,
  getScheduledMessages,
  saveScheduledMessage,
  deleteScheduledMessage,
  listScheduledMessages,
  getAutopostRosters,
  saveAutopostRoster,
  deleteAutopostRoster,
  getAutopostRoster,
  updateAutopostRoster,
  listAutopostRosters,
  getWarnings,
  addWarning,
  clearWarnings,
  listWarnings,
  getUserStats,
  recordAttendance,
  clearUserStats,
  getRestartFlag,
  setRestartFlag,
  clearRestartFlag,
  getReactionApproval,
  saveReactionApproval,
  updateReactionApproval,
  findPendingReactionApproval,
  getGiveaway,
  saveGiveaway,
  updateGiveaway,
  deleteGiveaway,
  listGiveaways,
  listActiveGiveaways,
  getPoll,
  savePoll,
  updatePoll,
  deletePoll,
  listPolls,
  listActivePolls,
  getInviteStats,
  listInviteStats,
  addInviteUse,
  addBonusInvites,
  recordInviteLeave,
  recordJoinInviter,
  getJoinInviter,
  removeJoinInviter,
  resetInviteStats,
  resetAllInviteStats,
};