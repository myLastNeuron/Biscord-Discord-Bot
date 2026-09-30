const fs = require('fs');
const { dataPath, writeJsonAtomic } = require('./safeFile');

const DATA_PATH = dataPath('botConfig.json');

const DEFAULTS = {
  status: 'online',       // online | idle | dnd | invisible
  activityType: null,     // Playing | Watching | Listening | Competing | Custom | null (cleared)
  activityText: '',
  lastUsername: null,     // informational only - Discord is the source of truth
  lastAvatarUrl: null,
};

const _cache = { data: null, expires: 0 };
const CACHE_TTL_MS = 60_000;

function ensureFile() {
  if (!fs.existsSync(DATA_PATH)) {
    writeJsonAtomic(DATA_PATH, DEFAULTS);
  }
}

function getBotConfig() {
  if (_cache.data && Date.now() < _cache.expires) return _cache.data;
  ensureFile();
  let data;
  try {
    const raw = fs.readFileSync(DATA_PATH, 'utf8');
    data = { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    data = { ...DEFAULTS };
  }
  _cache.data = data;
  _cache.expires = Date.now() + CACHE_TTL_MS;
  return data;
}

function setBotConfig(patch) {
  const current = getBotConfig();
  const updated = { ...current, ...patch };
  ensureFile();
  writeJsonAtomic(DATA_PATH, updated);
  _cache.data = updated;
  _cache.expires = Date.now() + CACHE_TTL_MS;
  return updated;
}

module.exports = { getBotConfig, setBotConfig };
