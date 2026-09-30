// One active builder session per user at a time, kept in memory.
// A session is lost on bot restart - that's fine, it's a draft, not a saved template.

const sessions = new Map();

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
  const session = {
    userId,
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
  sessions.set(userId, session);
  return session;
}

function structuredCloneSafe(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function getSession(userId) {
  return sessions.get(userId) || null;
}

function updateSession(userId, updater) {
  const session = sessions.get(userId);
  if (!session) return null;
  updater(session);
  sessions.set(userId, session);
  return session;
}

function deleteSession(userId) {
  sessions.delete(userId);
}

module.exports = {
  createSession,
  getSession,
  updateSession,
  deleteSession,
  blankDraft,
};
