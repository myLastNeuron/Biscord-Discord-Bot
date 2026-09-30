const { Events } = require('discord.js');
const { sendAuditLog } = require('../utils/auditLogger');

module.exports = {
  name: Events.MessageDelete,
  async execute(message) {
    if (message.partial) return;
    if (message.author?.bot) return;
    if (!message.guild) return;

    const author = message.author?.tag || 'Unknown';
    const channel = message.channel?.name || 'unknown';
    await sendAuditLog(message.guild, `🗑️ Message by ${author} deleted in #${channel}`);
  },
};
