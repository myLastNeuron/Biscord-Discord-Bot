const { Events } = require('discord.js');
const { sendAuditLog } = require('../utils/auditLogger');

module.exports = {
  name: Events.GuildBanAdd,
  async execute(ban) {
    const executor = ban.executor?.tag || 'Unknown';
    const reason = ban.reason ? ` — Reason: ${ban.reason}` : '';
    await sendAuditLog(ban.guild, `🔨 ${ban.user.tag} was banned by ${executor}${reason}`);
  },
};
