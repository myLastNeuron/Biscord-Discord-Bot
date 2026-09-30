const { Events } = require('discord.js');
const { sendAuditLog } = require('../utils/auditLogger');

module.exports = {
  name: Events.MessageUpdate,
  async execute(oldMessage, newMessage) {
    // Skip partials, bots, and no-op edits
    if (oldMessage.partial) return;
    if (newMessage.author?.bot) return;
    if (oldMessage.content === newMessage.content) return;
    if (!oldMessage.guild) return;

    const author = oldMessage.author?.tag || 'Unknown';
    const channel = oldMessage.channel?.name || 'unknown';
    await sendAuditLog(oldMessage.guild, `✏️ ${author} edited message in #${channel}`);
  },
};
