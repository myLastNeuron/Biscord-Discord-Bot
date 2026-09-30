// mediaOnlyManager.js — file/picture-only channels.
// State lives in data/mediaOnly.json keyed by guildId -> { channelId: record }.

const fs = require('fs');
const { dataPath, writeJsonAtomic } = require('./safeFile');

const DATA_PATH = dataPath('mediaOnly.json');

const MEDIA_ONLY_REASON = 'Not Following Rules, This Channel Is Media Only';

function readState() {
  try {
    if (!fs.existsSync(DATA_PATH)) return {};
    const raw = fs.readFileSync(DATA_PATH, 'utf8').trim();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeState(state) {
  writeJsonAtomic(DATA_PATH, state);
}

function isMediaOnly(guildId, channelId) {
  const state = readState();
  return !!state[guildId]?.[channelId];
}

function enableMediaOnly(guildId, channelId, meta = {}) {
  const state = readState();
  if (!state[guildId]) state[guildId] = {};
  state[guildId][channelId] = {
    enabledAt: Date.now(),
    enabledById: meta.byId || null,
    enabledByTag: meta.byTag || 'Unknown',
    channelName: meta.channelName || null,
  };
  writeState(state);
  return state[guildId][channelId];
}

function disableMediaOnly(guildId, channelId) {
  const state = readState();
  const rec = state[guildId]?.[channelId];
  if (!rec) return { wasEnabled: false };
  delete state[guildId][channelId];
  if (Object.keys(state[guildId]).length === 0) delete state[guildId];
  writeState(state);
  return { wasEnabled: true };
}

function listMediaOnly(guildId) {
  const state = readState();
  const guild = state[guildId] || {};
  return Object.entries(guild).map(([channelId, r]) => ({ channelId, ...r }));
}

// True when message carries file/picture: any attachment, sticker, or
// image/video embed (covers pasted image links Discord unfurls).
function hasMedia(message) {
  if (message.attachments?.size > 0) return true;
  if (message.stickers?.size > 0) return true;
  if (message.embeds?.length) {
    for (const e of message.embeds) {
      if (e.image || e.video || e.thumbnail) return true;
    }
  }
  const content = message.content || '';
  if (/(https?:\/\/\S+\.(png|jpe?g|gif|webp|bmp|mp4|mov|webm)(\?\S*)?)/i.test(content)) return true;
  return false;
}

module.exports = {
  MEDIA_ONLY_REASON,
  isMediaOnly,
  enableMediaOnly,
  disableMediaOnly,
  listMediaOnly,
  hasMedia,
};
