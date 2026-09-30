// Resolves %placeholder% tokens used in the /panel > Giveaways > Message
// Template fields (title, description, footer, thumbnail/image URLs).
//
// Two families of placeholders:
//   - Giveaway-specific: data about the particular giveaway being rendered.
//   - Global: bot/server/time info, the same no matter which giveaway.
//
// Unrecognized %tokens% are left untouched rather than silently blanked, so
// a typo in a template is visible in the preview instead of just vanishing.

function giveawaySpecificValues(giveaway) {
  const winnerCount = giveaway.winnerCount ?? 0;
  const enteredCount = giveaway.entries?.length ?? 0;
  return {
    prize: giveaway.prize || '',
    // Discord renders <t:...:F> client-side in the viewer's own timezone —
    // this is what "Discord will automatically format the timestamp" means.
    endAtDiscordFormation: giveaway.endAt ? `<t:${Math.floor(giveaway.endAt / 1000)}:F>` : '',
    endAt: giveaway.endAt ? new Date(giveaway.endAt).toUTCString() : '',
    winners: `${winnerCount}`,
    // Reserved for a future sponsor-link field on the giveaway record
    // (not part of the data model yet) — always empty for now.
    sponsorLink: giveaway.sponsorLink || '',
    organiser: giveaway.organiserId ? `<@${giveaway.organiserId}>` : '',
    enteredCount: `${enteredCount}`,
    // Same as enteredCount until the requirements engine (blacklist/
    // whitelist channels, role requirements) can invalidate some entries.
    entryCount: `${enteredCount}`,
  };
}

function globalValues(guild) {
  const client = guild?.client;
  const bot = client?.user;
  const now = Math.floor(Date.now() / 1000);
  return {
    botName: bot?.username || '',
    botID: bot?.id || '',
    botAvatar: bot?.displayAvatarURL?.() || '',
    botTag: bot?.tag || '',
    botMention: bot ? `<@${bot.id}>` : '',
    guildName: guild?.name || '',
    guildID: guild?.id || '',
    guildIcon: guild?.iconURL?.() || '',
    timestamp: `<t:${now}:f>`,
    shortTime: `<t:${now}:t>`,
    longTime: `<t:${now}:T>`,
    shortDate: `<t:${now}:d>`,
    longDate: `<t:${now}:D>`,
    shortDateTime: `<t:${now}:f>`,
    longDateTime: `<t:${now}:F>`,
    relativeTime: `<t:${now}:R>`,
  };
}

/**
 * Replaces every %placeholder% in `text` with its resolved value.
 * `context.giveaway` is optional (omit for a template preview with no real
 * giveaway yet); `context.guild` is used for guild + bot info.
 */
function resolveGiveawayPlaceholders(text, { giveaway, guild } = {}) {
  if (!text) return text;
  const values = { ...(giveaway ? giveawaySpecificValues(giveaway) : {}), ...globalValues(guild) };
  return text.replace(/%([a-zA-Z]+)%/g, (match, key) => (key in values ? values[key] : match));
}

// Ordinal suffix for a member-count number, e.g. 42 -> "42nd".
function ordinalSuffix(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

// Member/join-specific values for the /panel > Welcome Settings embed
// builder. `inviterId` is optional (only known while Invite Tracker is on -
// see guildMemberAdd.js) and falls back to "Unknown" when absent.
function welcomeSpecificValues(member, { inviterId } = {}) {
  const user = member.user;
  const createdTs = Math.floor(user.createdTimestamp / 1000);
  return {
    user: `<@${user.id}>`,
    mention: `<@${user.id}>`,
    username: user.username,
    userTag: user.tag,
    userId: user.id,
    userAvatar: user.displayAvatarURL({ size: 256 }),
    server: member.guild.name,
    serverId: member.guild.id,
    serverImage: member.guild.iconURL({ size: 256 }) || '',
    memberCount: `${member.guild.memberCount}`,
    ordinal: ordinalSuffix(member.guild.memberCount),
    inviter: inviterId ? `<@${inviterId}>` : 'Unknown',
    boostCount: `${member.guild.premiumSubscriptionCount ?? 0}`,
    accountCreated: `<t:${createdTs}:F>`,
    accountAge: `<t:${createdTs}:R>`,
    joinDate: `<t:${Math.floor(Date.now() / 1000)}:F>`,
  };
}

/**
 * Replaces every %placeholder% in `text` for a welcome embed/button. `member`
 * is required for the member-specific values; `guild` defaults to
 * `member.guild` and only needs overriding for a preview with no real
 * member. `inviterId` is optional (see welcomeSpecificValues above).
 */
function resolveWelcomePlaceholders(text, { member, guild, inviterId } = {}) {
  if (!text) return text;
  const values = { ...(member ? welcomeSpecificValues(member, { inviterId }) : {}), ...globalValues(guild || member?.guild) };
  return text.replace(/%([a-zA-Z]+)%/g, (match, key) => (key in values ? values[key] : match));
}

module.exports = { resolveGiveawayPlaceholders, resolveWelcomePlaceholders };
