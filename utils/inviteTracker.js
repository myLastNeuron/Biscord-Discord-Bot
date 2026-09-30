// In-memory cache of each guild's invites, used to figure out which invite a
// new member used. Discord's GuildMemberAdd event doesn't say which invite
// was used, so this diffs the guild's invite list before vs. after the join
// to find the one whose "uses" went up (or, for a vanity URL, whose vanity
// use count went up).
//
// Kept in memory only (reset on restart, rebuilt by ready.js) - it's a
// working cache, not data worth persisting to disk.
//
// Fetching a guild's invites (and its vanity data) requires the bot to have
// the "Manage Server" permission in that guild - if it doesn't, caching
// fails gracefully and invite attribution just won't work there until it's
// granted.

const guildInviteCache = new Map(); // guildId -> { invites: Map(code -> snapshot), vanity: {code, uses} | null }

function snapshotInvite(invite) {
  return {
    code: invite.code,
    uses: invite.uses ?? 0,
    maxUses: invite.maxUses ?? 0,
    inviterId: invite.inviter?.id ?? null,
    channelId: invite.channel?.id ?? null,
    createdTimestamp: invite.createdTimestamp ?? null,
    expiresTimestamp: invite.expiresTimestamp ?? null,
    temporary: invite.temporary ?? false,
  };
}

async function cacheGuildInvites(guild) {
  let invites;
  try {
    const fetched = await guild.invites.fetch();
    invites = new Map();
    for (const invite of fetched.values()) invites.set(invite.code, snapshotInvite(invite));
  } catch (err) {
    console.error(`[inviteTracker] Failed to fetch invites for guild ${guild.id} (needs Manage Server permission):`, err.message);
    return null;
  }

  // Vanity URLs aren't in the regular invite list and need their own fetch -
  // only attempt it if the guild actually has one, and don't let a failure
  // here (e.g. permission edge cases) throw away the invites we just got.
  let vanity = null;
  if (guild.vanityURLCode) {
    try {
      const data = await guild.fetchVanityData();
      vanity = { code: data.code, uses: data.uses ?? 0 };
    } catch (err) {
      console.error(`[inviteTracker] Failed to fetch vanity data for guild ${guild.id}:`, err.message);
    }
  }

  const snapshot = { invites, vanity };
  guildInviteCache.set(guild.id, snapshot);
  return snapshot;
}

// Refetches the guild's current invites (+ vanity URL), compares against the
// last cached snapshot to find whichever one's use count went up, and
// updates the cache either way. Returns the full invite snapshot plus
// `isVanity`, or null if it couldn't be determined (missing permission, or a
// one-time-use invite that's already gone by the time we look).
async function resolveUsedInvite(guild) {
  const before = guildInviteCache.get(guild.id) || { invites: new Map(), vanity: null };
  const after = await cacheGuildInvites(guild);
  if (!after) return null;

  for (const [code, data] of after.invites.entries()) {
    const prevUses = before.invites.get(code)?.uses ?? 0;
    if (data.uses > prevUses) {
      return { ...data, isVanity: false };
    }
  }

  if (after.vanity && after.vanity.uses > (before.vanity?.uses ?? 0)) {
    return {
      code: after.vanity.code,
      uses: after.vanity.uses,
      maxUses: 0,
      inviterId: null,
      channelId: null,
      createdTimestamp: null,
      expiresTimestamp: null,
      temporary: false,
      isVanity: true,
    };
  }

  return null;
}

// How many invites a given inviter currently has, and how many of those are
// still "active" (not expired, not used up) - reads from whatever's already
// cached, so call this *after* resolveUsedInvite() for up-to-date numbers.
function getInviterInviteCounts(guildId, inviterId) {
  const cached = guildInviteCache.get(guildId);
  if (!cached) return { active: 0, total: 0 };

  const now = Date.now();
  let active = 0;
  let total = 0;
  for (const inv of cached.invites.values()) {
    if (inv.inviterId !== inviterId) continue;
    total += 1;
    const notExpired = !inv.expiresTimestamp || inv.expiresTimestamp > now;
    const notMaxedOut = !inv.maxUses || inv.uses < inv.maxUses;
    if (notExpired && notMaxedOut) active += 1;
  }
  return { active, total };
}

function clearGuildInviteCache(guildId) {
  guildInviteCache.delete(guildId);
}

module.exports = { cacheGuildInvites, resolveUsedInvite, getInviterInviteCounts, clearGuildInviteCache };
