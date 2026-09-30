// lockdownManager.js — a reversible whole-server lockdown.
//
// lockGuild() walks every text/voice channel and flips a small set of
// @everyone overwrite flags to DENY, saving each channel's original values
// FIRST. unlockGuild() writes those originals straight back (and deletes the
// overwrite again when a channel had none before), so "after the raid" the
// server is exactly how it was. Only the @everyone overwrite is touched —
// admin/mod role overwrites are never modified.
//
// State lives in data/lockdowns.json keyed by guildId, so a mid-raid bot
// restart can't orphan a locked server: /lockdown off still knows exactly
// which flags to restore.

const fs = require('fs');
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { dataPath, writeJsonAtomic } = require('./safeFile');

const DATA_PATH = dataPath('lockdowns.json');

// Branchable error so callers can react to the two obvious states instead of
// string-matching error messages.
class LockdownError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}
const CODES = {
  ALREADY_LOCKED: 'ALREADY_LOCKED',
  NOT_LOCKED: 'NOT_LOCKED',
};

// The only permission flags a lockdown ever toggles. Reversing restores just
// these, so the surface area we can accidentally clobber stays tiny.
const TEXT_FLAGS = ['SendMessages', 'AddReactions'];
const VOICE_FLAGS = ['Connect', 'Speak'];

// Threads, forums and categories are intentionally skipped:
//   - categories don't hold messages (their overwrites only cascade children)
//   - forum/media channels don't take these flags the same way
//   - threads inherit their parent channel's permissions and can't sensibly
//     be locked independently
function flagsFor(channel) {
  if (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement) return TEXT_FLAGS;
  if (channel.isVoiceBased()) return VOICE_FLAGS; // voice + stage
  return null;
}

// ---------- tiny JSON persistence ----------
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

function getLockdownStatus(guildId) {
  const record = readState()[guildId];
  return record && record.locked ? record : null;
}

// The current effective value of each cared-about flag on the @everyone
// overwrite: true (allowed), false (denied) or null (inherited/unset).
function currentOverwriteValues(channel, flags) {
  const overwrite = channel.permissionOverwrites.cache.get(channel.guild.id);
  if (!overwrite) return Object.fromEntries(flags.map((f) => [f, null]));

  const out = {};
  for (const flag of flags) {
    const bit = PermissionFlagsBits[flag];
    if (overwrite.deny.has(bit)) out[flag] = false;
    else if (overwrite.allow.has(bit)) out[flag] = true;
    else out[flag] = null;
  }
  return out;
}

/**
 * Locks every supported channel in the guild. Persists the snapshot FIRST
 * (per channel, as it goes) so an interruption never leave a locked server
 * with no way to revert.
 * @returns Lockdown record ({ locked, lockedAt, lockedByTag, reason,
 *   channelsEdited, channels: { <id>: { hadOverwrite, original } }, failures })
 */
async function lockGuild(guild, { byId, byTag = 'Unknown', reason = null } = {}) {
  const state = readState();
  if (state[guild.id]?.locked) {
    throw new LockdownError('This server is already in lockdown.', CODES.ALREADY_LOCKED);
  }

  const channels = {};
  const failures = [];
  let channelsEdited = 0;

  for (const channel of guild.channels.cache.values()) {
    const flags = flagsFor(channel);
    if (!flags) continue;

    const original = currentOverwriteValues(channel, flags);
    const hadOverwrite = channel.permissionOverwrites.cache.has(guild.id);
    const lockPatch = Object.fromEntries(flags.map((f) => [f, false]));

    try {
      await channel.permissionOverwrites.edit(guild.id, lockPatch, 'Server lockdown');
      channels[channel.id] = { name: channel.name, hadOverwrite, original };
      channelsEdited += 1;
    } catch (err) {
      failures.push({ id: channel.id, name: channel.name, error: err.message });
    }
  }

  const record = {
    locked: true,
    lockedAt: Date.now(),
    lockedById: byId,
    lockedByTag: byTag,
    reason,
    channelsEdited,
    channels,
    failures,
  };

  state[guild.id] = record;
  writeState(state);
  return record;
}

/**
 * Restores every channel the lockdown changed, then removes the guild's
 * record. If some channels can't be restored, the record is kept (minus the
 * ones that succeeded) so a re-run retries only the leftovers.
 * @returns { restored: number, failures: array, allRestored: boolean }
 */
async function unlockGuild(guild) {
  const state = readState();
  const record = state[guild.id];
  if (!record?.locked) {
    throw new LockdownError('This server is not currently in lockdown.', CODES.NOT_LOCKED);
  }

  const remaining = {};
  const failures = [];
  let restored = 0;

  for (const [channelId, meta] of Object.entries(record.channels || {})) {
    const channel =
      guild.channels.cache.get(channelId) ||
      (await guild.channels.fetch(channelId).catch(() => null));
    if (!channel) continue; // channel was deleted mid-lockdown — nothing to revert

    try {
      await channel.permissionOverwrites.edit(guild.id, meta.original, 'Lockdown lifted');
      if (!meta.hadOverwrite) {
        // No @everyone overwrite existed before, so the now-empty overwrite
        // (allow 0 / deny 0) is a leftover — delete it to hand the channel
        // back exactly as it was.
        await channel.permissionOverwrites.delete(guild.id, 'Lockdown lifted');
      }
      restored += 1;
    } catch (err) {
      remaining[channelId] = meta;
      failures.push({ id: channelId, name: meta.name, error: err.message });
    }
  }

  if (failures.length) {
    record.channels = remaining;
    record.failures = failures;
    writeState(state);
  } else {
    delete state[guild.id];
    writeState(state);
  }

  return { restored, failures, allRestored: failures.length === 0 };
}

module.exports = {
  LockdownError,
  CODES,
  getLockdownStatus,
  lockGuild,
  unlockGuild,
};