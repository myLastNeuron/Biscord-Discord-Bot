const fs = require('fs');
const { dataPath, writeJsonAtomic } = require('./safeFile');

const FILE_PATH = dataPath('embedTemplates.json');

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
    console.error('[embedTemplateStore] Failed to read/parse file, resetting.', err);
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

function getGuildTemplates(guildId) {
  const all = loadAll();
  return all[guildId] || {};
}

function getTemplate(guildId, name) {
  const templates = getGuildTemplates(guildId);
  return templates[name] || null;
}

function saveTemplate(guildId, name, templateData) {
  const all = loadAll();
  if (!all[guildId]) all[guildId] = {};
  all[guildId][name] = {
    ...templateData,
    updatedAt: new Date().toISOString(),
  };
  saveAll(all);
  return all[guildId][name];
}

function deleteTemplate(guildId, name) {
  const all = loadAll();
  if (!all[guildId] || !all[guildId][name]) return false;
  delete all[guildId][name];
  saveAll(all);
  return true;
}

function listTemplateNames(guildId) {
  return Object.keys(getGuildTemplates(guildId));
}

module.exports = {
  getGuildTemplates,
  getTemplate,
  saveTemplate,
  deleteTemplate,
  listTemplateNames,
};
