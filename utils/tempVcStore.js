const fs = require('fs');
const { dataPath, writeJsonAtomic } = require('./safeFile');

const FILE_PATH = dataPath('tempVcSettings.json');

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
    console.error('[tempVcStore] Failed to read/parse file, resetting.', err);
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

const DEFAULTS = {
  enabled: false,
  triggerChannelId: null, // the "join to create" VC
  categoryId: null,       // where new temp VCs get created - null = same category as the trigger channel
  roleId: null,           // role applied only while someone is in a temp VC (not the trigger channel itself)
  autoRoleEnabled: false,
  autoStatusEnabled: false, // live member-count voice channel status
  activeChannels: {},     // channelId -> { ownerId, createdAt } - only temp VCs the bot created, never the trigger channel
};

function getSettings(guildId) {
  const all = loadAll();
  const stored = all[guildId] || {};
  return {
    ...DEFAULTS,
    ...stored,
    activeChannels: { ...(stored.activeChannels || {}) },
  };
}

// Shallow-merges patch into the guild's settings. Does not touch
// activeChannels - use addActiveChannel/removeActiveChannel for that so
// concurrent writes (a settings change + a channel join happening at the
// same moment) can't clobber each other.
function setSettings(guildId, patch) {
  const all = loadAll();
  const current = { ...DEFAULTS, ...(all[guildId] || {}) };
  const { activeChannels, ...rest } = patch;
  all[guildId] = { ...current, ...rest };
  saveAll(all);
  return getSettings(guildId);
}

function isActiveChannel(guildId, channelId) {
  const all = loadAll();
  return !!(all[guildId] && all[guildId].activeChannels && all[guildId].activeChannels[channelId]);
}

function addActiveChannel(guildId, channelId, ownerId) {
  const all = loadAll();
  if (!all[guildId]) all[guildId] = { ...DEFAULTS };
  if (!all[guildId].activeChannels) all[guildId].activeChannels = {};
  all[guildId].activeChannels[channelId] = { ownerId, createdAt: new Date().toISOString() };
  saveAll(all);
}

function removeActiveChannel(guildId, channelId) {
  const all = loadAll();
  if (!all[guildId] || !all[guildId].activeChannels || !all[guildId].activeChannels[channelId]) return;
  delete all[guildId].activeChannels[channelId];
  saveAll(all);
}

// Wipes a guild's temp-VC config (trigger channel, category, role, toggles)
// back to DEFAULTS, including forgetting any activeChannels it was
// tracking. Used by db.js's resetEverythingForGuild().
//
// NOTE: this only clears the bot's *record* of active temp VCs — it does
// NOT delete the actual voice channels in Discord if any are live right
// now. Any such channels become untracked: the bot will no longer
// auto-delete them when they empty out, since it won't recognize them as
// ones it created. Same "records vs. real posted objects" tradeoff already
// documented for resetEverythingForGuild()'s other purges.
function clearSettings(guildId) {
  const all = loadAll();
  if (all[guildId]) {
    delete all[guildId];
    saveAll(all);
  }
}

module.exports = {
  getSettings,
  setSettings,
  isActiveChannel,
  addActiveChannel,
  removeActiveChannel,
  clearSettings,
};
