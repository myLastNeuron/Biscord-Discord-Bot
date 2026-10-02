// One active builder session per user *per embed purpose*, kept in memory.
// A session is lost on bot restart - that's fine, it's a draft, not a saved template.
//
// Sessions used to be keyed by user id alone, so opening (say) the welcome-embed
// builder while the ticket-panel-embed builder was still open silently replaced
// it: the old ticket panel's buttons then edited the welcome draft, which is how
// ticket content showed up in the welcome embed. Sessions are now keyed by user
// id + scope (purpose, or edit/template identity) and carry a short `token` that
// every builder customId includes, so a panel always resolves its own draft.
// (A token, not the scope itself: Discord caps custom_id at 100 chars and a
// long template name would blow past that.)

const sessions = new Map(); // key -> session
const sessionsByToken = new Map(); // short token -> session
let nextToken = 1;

function blankDraft() {
  return {
    title: null,
    description: null,
    url: null,
    color: 0x5865f2, // Discord blurple default
    author: { name: null, iconURL: null, url: null },
    footer: { text: null, iconURL: null },
    thumbnail: null,
    image: null,
    fields: [],
    timestamp: false,
    reactions: [],
    buttons: [], // { type: 'link'|'role', label, style, emoji, url?, roleId? }
  };
}

// Uniquely identifies which builder a session belongs to for a given user.
function scopeFor({ purpose, editMessageId, name }) {
  if (purpose) return purpose; // 'ticket:panel' | 'ticket:opened' | 'ticket:close' | 'welcome'
  if (editMessageId) return `edit:${editMessageId}`;
  if (name) return `template:${name.toLowerCase()}`;
  return 'default';
}

function keyFor(userId, scope) {
  return `${userId}|${scope}`;
}

function createSession(userId, {
  guildId,
  channelId,
  name = null,
  existingDraft = null,
  purpose = null,
  // When set, "Send Now" becomes "Update Message" and the builder patches
  // this existing message instead of posting a new one.
  editMessageId = null,
  editChannelId = null,
}) {
  const key = keyFor(userId, scopeFor({ purpose, editMessageId, name }));
  const token = `t${nextToken++}`;
  const session = {
    userId,
    key,
    token,
    guildId,
    channelId,
    name, // set if editing/saving as this template name
    // Null for the normal "build + send/save a message" flow. Set to
    // e.g. 'ticket:panel' / 'ticket:opened' / 'ticket:close' when this
    // session is instead editing one of the ticket system's embeds - see
    // embedInteractionHandler.js, which branches on this to swap "Send Now"
    // for a "Save & Use" action that writes into guildSettings instead of
    // posting a message.
    purpose,
    panelMessageId: null,
    draft: existingDraft ? structuredCloneSafe(existingDraft) : blankDraft(),
    // If set, the builder will EDIT this message instead of sending a new one.
    editMessageId,
    editChannelId,
  };
  // Replacing an earlier session for the same scope must drop its token too,
  // so a stale panel from the replaced session can't still resolve a draft.
  const previous = sessions.get(key);
  if (previous) sessionsByToken.delete(previous.token);

  sessions.set(key, session);
  sessionsByToken.set(token, session);
  return session;
}

function structuredCloneSafe(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// Resolves the session a builder customId belongs to (token embedded in the id).
function getSessionByToken(userId, token) {
  const session = sessionsByToken.get(token);
  return session && session.userId === userId ? session : null;
}

function updateSession(session, updater) {
  if (!session) return null;
  updater(session);
  sessions.set(session.key, session);
  return session;
}

function deleteSession(session) {
  if (!session) return;
  sessions.delete(session.key);
  sessionsByToken.delete(session.token);
}

module.exports = {
  createSession,
  getSessionByToken,
  updateSession,
  deleteSession,
  blankDraft,
};
