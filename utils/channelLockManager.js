// channelLockManager.js — lock/unlock a single channel for @everyone.
//
// lockChannel() snapshots the @everyone overwrite, then denies SendMessages /
// SendMessagesInThreads / CreatePublicThreads / CreatePrivateThreads /
// AddReactions for @everyone.  unlockChannel() writes the originals back,
// deleting the overwrite when none existed before.
//
// State lives in data/channelLocks.json keyed by channelId, same pattern
// as lockdowns.json.

const fs = require('fs');
const { PermissionFlagsBits } = require('discord.js');
const { dataPath, writeJsonAtomic } = require('./safeFile');

const DATA_PATH = dataPath('channelLocks.json');

const LOCK_FLAGS = [
  'SendMessages',
  'SendMessagesInThreads',
  'CreatePublicThreads',
  'CreatePrivateThreads',
  'AddReactions',
];

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

function isChannelLocked(channelId) {
  const state = readState();
  return !!state[channelId]?.locked;
}

// Snapshots current @everyone values, then denies every lock flag.
async function lockChannel(channel, { byId, byTag = 'Unknown', reason = null } = {}) {
  const state = readState();
  if (state[channel.id]?.locked) {
    return { alreadyLocked: true };
  }

  const overwrite = channel.permissionOverwrites.cache.get(channel.guild.id);
  const original = {};
  const hadOverwrite = !!overwrite;

  for (const flag of LOCK_FLAGS) {
    const bit = PermissionFlagsBits[flag];
    if (overwrite?.deny.has(bit)) original[flag] = false;
    else if (overwrite?.allow.has(bit)) original[flag] = true;
    else original[flag] = null;
  }

  const patch = Object.fromEntries(LOCK_FLAGS.map((f) => [f, false]));
  await channel.permissionOverwrites.edit(channel.guild.id, patch, `Channel locked${reason ? `: ${reason}` : ''}`);

  state[channel.id] = {
    locked: true,
    lockedAt: Date.now(),
    lockedById: byId,
    lockedByTag: byTag,
    reason,
    hadOverwrite,
    original,
    channelName: channel.name,
    guildId: channel.guild.id,
  };
  writeState(state);

  return { locked: true, original, hadOverwrite };
}

// Restores saved @everyone overwrite.
async function unlockChannel(channel) {
  const state = readState();
  const record = state[channel.id];
  if (!record?.locked) return { wasLocked: false };

  const original = record.original;

  // If there was no @everyone overwrite before, delete the now-empty one
  // to hand the channel back exactly as it was.
  if (!record.hadOverwrite) {
    await channel.permissionOverwrites.delete(channel.guild.id, 'Channel unlocked');
  } else {
    await channel.permissionOverwrites.edit(channel.guild.id, original, 'Channel unlocked');
  }

  delete state[channel.id];
  writeState(state);

  return { wasLocked: true, restored: true };
}

function getLockedChannels(guildId) {
  const state = readState();
  return Object.entries(state)
    .filter(([, r]) => r.locked && r.guildId === guildId)
    .map(([channelId, r]) => ({ channelId, ...r }));
}

module.exports = {
  lockChannel,
  unlockChannel,
  isChannelLocked,
  getLockedChannels,
};
