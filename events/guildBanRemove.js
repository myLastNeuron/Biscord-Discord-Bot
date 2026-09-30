const { Events } = require('discord.js');
const { sendAuditLog } = require('../utils/auditLogger');

module.exports = {
  name: Events.GuildBanRemove,
  async execute(ban) {
    const executor = ban.executor?.tag || 'Unknown';
    await sendAuditLog(ban.guild, `♻️ ${ban.user.tag} was unbanned by ${executor}`);
  },
};
