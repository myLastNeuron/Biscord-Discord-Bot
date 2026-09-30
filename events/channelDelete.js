const { Events } = require('discord.js');
const { sendAuditLog } = require('../utils/auditLogger');

module.exports = {
  name: Events.ChannelDelete,
  async execute(channel) {
    await sendAuditLog(channel.guild, `➖ Channel deleted: #${channel.name}`);
  },
};
