const fs = require('fs');
const { dataPath, writeJsonAtomic } = require('./safeFile');

// Deliberately its OWN file (data/panelExtras.json), not db.js/guildSettings —
// keeps these 3 bolt-on features fully isolated from the core settings store
// so nothing here can collide with or corrupt existing guild settings.
const DATA_PATH = dataPath('panelExtras.json');

const _cache = { data: null, expires: 0 };
const CACHE_TTL_MS = 60_000;

function load() {
  if (_cache.data && Date.now() < _cache.expires) return _cache.data;
  let data;
  if (!fs.existsSync(DATA_PATH)) {
    data = {};
  } else {
    try {
      data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    } catch (err) {
      console.error('[panelExtrasStore] Failed to parse panelExtras.json, treating as empty:', err.message);
      data = {};
    }
  }
  _cache.data = data;
  _cache.expires = Date.now() + CACHE_TTL_MS;
  return data;
}

function save(data) {
  writeJsonAtomic(DATA_PATH, data);
  _cache.data = data;
  _cache.expires = Date.now() + CACHE_TTL_MS;
}

const DEFAULT_VC_ACTIVITY = {
  enabled: false,
  channelId: null,
  joinMessage: '🎙️ {user} joined **{vc}**',
  leaveMessage: '👋 {user} left voice after **{duration}**',
};

function getGuild(data, guildId) {
  if (!data[guildId]) {
    data[guildId] = { vcNotify: {}, autoDeletePrefix: {}, autoDeleteUsers: {}, replyBack: [], vcActivity: { ...DEFAULT_VC_ACTIVITY } };
  }
  // Backfill in case an older/partial entry exists.
  data[guildId].vcNotify ||= {};
  data[guildId].autoDeletePrefix ||= {};
  data[guildId].autoDeleteUsers ||= {};
  data[guildId].replyBack ||= [];
  data[guildId].vcActivity = { ...DEFAULT_VC_ACTIVITY, ...(data[guildId].vcActivity || {}) };
  return data[guildId];
}

// ---------- VC Notify ----------
function setVcNotifyRule(guildId, userId, channelId, message) {
  const data = load();
  const g = getGuild(data, guildId);
  g.vcNotify[userId] = { channelId, message };
  save(data);
}

function removeVcNotifyRule(guildId, userId) {
  const data = load();
  const g = getGuild(data, guildId);
  const existed = Boolean(g.vcNotify[userId]);
  delete g.vcNotify[userId];
  save(data);
  return existed;
}

function getVcNotifyRule(guildId, userId) {
  const data = load();
  return data[guildId]?.vcNotify?.[userId] || null;
}

function listVcNotifyRules(guildId) {
  const data = load();
  return Object.entries(data[guildId]?.vcNotify || {});
}

// ---------- Auto Delete: Prefix ----------
function setAutoDeletePrefixRule(guildId, channelId, prefix) {
  const data = load();
  const g = getGuild(data, guildId);
  g.autoDeletePrefix[channelId] = prefix;
  save(data);
}

function removeAutoDeletePrefixRule(guildId, channelId) {
  const data = load();
  const g = getGuild(data, guildId);
  const existed = Boolean(g.autoDeletePrefix[channelId]);
  delete g.autoDeletePrefix[channelId];
  save(data);
  return existed;
}

function getAutoDeletePrefixRule(guildId, channelId) {
  const data = load();
  return data[guildId]?.autoDeletePrefix?.[channelId] || null;
}

// ---------- Auto Delete: User ----------
function addAutoDeleteUser(guildId, channelId, userId) {
  const data = load();
  const g = getGuild(data, guildId);
  if (!g.autoDeleteUsers[channelId]) g.autoDeleteUsers[channelId] = [];
  if (!g.autoDeleteUsers[channelId].includes(userId)) {
    g.autoDeleteUsers[channelId].push(userId);
  }
  save(data);
}

function removeAutoDeleteUser(guildId, channelId, userId) {
  const data = load();
  const g = getGuild(data, guildId);
  const list = g.autoDeleteUsers[channelId] || [];
  const idx = list.indexOf(userId);
  if (idx === -1) return false;
  list.splice(idx, 1);
  if (!list.length) delete g.autoDeleteUsers[channelId];
  save(data);
  return true;
}

function isAutoDeleteUser(guildId, channelId, userId) {
  const data = load();
  return (data[guildId]?.autoDeleteUsers?.[channelId] || []).includes(userId);
}

// ---------- Reply Back ----------
// channelId is nullable - null means "every channel in the server" (a
// server-wide rule). userId is also nullable - null means "everyone".
// A channel-specific rule always wins over a server-wide one; within each
// of those, a user-specific rule always wins over an "everyone" one.
function addReplyBackRule(guildId, channelId, userId, reply, reactions) {
  const data = load();
  const g = getGuild(data, guildId);
  const cId = channelId || null;
  const uId = userId || null;
  g.replyBack = g.replyBack.filter((r) => !(r.channelId === cId && r.userId === uId));
  g.replyBack.push({ channelId: cId, userId: uId, reply, reactions });
  save(data);
}

function removeReplyBackRule(guildId, channelId, userId) {
  const data = load();
  const g = getGuild(data, guildId);
  const cId = channelId || null;
  const uId = userId || null;
  const before = g.replyBack.length;
  g.replyBack = g.replyBack.filter((r) => !(r.channelId === cId && r.userId === uId));
  save(data);
  return before - g.replyBack.length;
}

function listReplyBackRules(guildId) {
  const data = load();
  return data[guildId]?.replyBack || [];
}

// Matches a message against reply-back rules, most specific first:
// 1. this channel + this user
// 2. this channel + everyone
// 3. every channel (server-wide) + this user
// 4. every channel (server-wide) + everyone
function findReplyBackRule(guildId, channelId, userId) {
  const data = load();
  const rules = data[guildId]?.replyBack || [];
  return (
    rules.find((r) => r.channelId === channelId && r.userId === userId) ||
    rules.find((r) => r.channelId === channelId && r.userId === null) ||
    rules.find((r) => r.channelId === null && r.userId === userId) ||
    rules.find((r) => r.channelId === null && r.userId === null) ||
    null
  );
}

// ---------- VC Activity Log (guild-wide join/leave tracker) ----------
function getVcActivitySettings(guildId) {
  const data = load();
  return getGuild(data, guildId).vcActivity;
}

function setVcActivitySettings(guildId, patch) {
  const data = load();
  const g = getGuild(data, guildId);
  g.vcActivity = { ...g.vcActivity, ...patch };
  save(data);
  return g.vcActivity;
}

module.exports = {
  setVcNotifyRule,
  removeVcNotifyRule,
  getVcNotifyRule,
  listVcNotifyRules,
  setAutoDeletePrefixRule,
  removeAutoDeletePrefixRule,
  getAutoDeletePrefixRule,
  addAutoDeleteUser,
  removeAutoDeleteUser,
  isAutoDeleteUser,
  addReplyBackRule,
  removeReplyBackRule,
  listReplyBackRules,
  findReplyBackRule,
  getVcActivitySettings,
  setVcActivitySettings,
};
