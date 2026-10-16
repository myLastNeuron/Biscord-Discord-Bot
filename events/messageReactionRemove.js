/**
 * events/messageReactionRemove.js
 * Removes a role when a member takes their reaction back off a reaction-role
 * message (only for messages saved with toggleOnRemove — see
 * utils/reactionRoleStore.js and utils/reactionRoleHandler.js).
 */
const { applyReactionRole } = require('../utils/reactionRoleHandler');

module.exports = {
  name: 'messageReactionRemove',
  async execute(reaction, user) {
    if (user.bot) return;

    if (reaction.partial) { try { await reaction.fetch(); } catch { return; } }
    if (!reaction.message.guildId) return; // DMs

    await applyReactionRole(reaction, user, { add: false });
  },
};
