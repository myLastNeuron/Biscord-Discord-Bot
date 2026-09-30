const fs = require('fs');
const { dataPath, writeJsonAtomic } = require('./safeFile');

const FILE_PATH = dataPath('autoReactRules.json');

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
    console.error('[autoReactStore] Failed to read/parse file, resetting.', err);
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

function getGuildRules(guildId) {
  const all = loadAll();
  return all[guildId] || {};
}

// Returns rules as an array with `id` included, since that's what the
// command's list/autocomplete/remove flows all want to iterate over.
function listRules(guildId) {
  const rules = getGuildRules(guildId);
  return Object.entries(rules).map(([id, rule]) => ({ id, ...rule }));
}

function addRule(guildId, ruleData) {
  const all = loadAll();
  if (!all[guildId]) all[guildId] = {};
  const id = `rule-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  all[guildId][id] = { ...ruleData, createdAt: new Date().toISOString() };
  saveAll(all);
  return { id, ...all[guildId][id] };
}

function removeRule(guildId, ruleId) {
  const all = loadAll();
  if (!all[guildId] || !all[guildId][ruleId]) return false;
  delete all[guildId][ruleId];
  saveAll(all);
  return true;
}

// Wipes every auto-react rule for a guild in one shot. Used by db.js's
// resetEverythingForGuild() — safe to call even if the guild has no rules.
function clearGuildRules(guildId) {
  const all = loadAll();
  if (all[guildId]) {
    delete all[guildId];
    saveAll(all);
  }
}

module.exports = {
  getGuildRules,
  listRules,
  addRule,
  removeRule,
  clearGuildRules,
};
