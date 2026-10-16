/**
 * events/messageReactionAdd.js
 * Grants a role when a member reacts to a reaction-role message.
 *
 * Registered separately from messageReactionAdd.level.js (which awards XP) —
 * the loader in index.js attaches both listeners to the same event.
 */
const { applyReactionRole } = require('../utils/reactionRoleHandler');

module.exports = {
  name: 'messageReactionAdd',
  async execute(reaction, user) {
    if (user.bot) return;

    // Partials: after a restart the reaction/message may arrive uncached.
    if (reaction.partial) { try { await reaction.fetch(); } catch { return; } }
    if (!reaction.message.guildId) return; // DMs

    await applyReactionRole(reaction, user, { add: true });
  },
};
