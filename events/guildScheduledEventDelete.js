const { Events } = require('discord.js');
const { sendAuditLog } = require('../utils/auditLogger');

module.exports = {
  name: Events.GuildScheduledEventDelete,
  async execute(event) {
    await sendAuditLog(event.guild, `📅 Event deleted: ${event.name}`);
  },
};
