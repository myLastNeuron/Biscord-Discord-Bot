const { Events } = require('discord.js');
const { sendAuditLog } = require('../utils/auditLogger');

module.exports = {
  name: Events.GuildScheduledEventUpdate,
  async execute(oldEvent, newEvent) {
    await sendAuditLog(newEvent.guild, `📅 Event updated: ${newEvent.name}`);
  },
};
