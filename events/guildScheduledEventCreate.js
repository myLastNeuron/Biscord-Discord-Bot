const { Events } = require('discord.js');
const { sendAuditLog } = require('../utils/auditLogger');

module.exports = {
  name: Events.GuildScheduledEventCreate,
  async execute(event) {
    const creator = event.creator?.tag || 'Unknown';
    await sendAuditLog(event.guild, `📅 Event created: ${event.name} by ${creator}`);
  },
};
