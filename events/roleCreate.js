const { Events } = require('discord.js');
const { sendAuditLog } = require('../utils/auditLogger');

module.exports = {
  name: Events.GuildRoleCreate,
  async execute(role) {
    await sendAuditLog(role.guild, `➕ Role created: @${role.name} (color: ${role.hexColor})`);
  },
};
