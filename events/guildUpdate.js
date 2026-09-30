const { Events } = require('discord.js');
const { sendAuditLog } = require('../utils/auditLogger');

module.exports = {
  name: Events.GuildUpdate,
  async execute(oldGuild, newGuild) {
    const changes = [];

    if (oldGuild.name !== newGuild.name) {
      changes.push(`name: "${oldGuild.name}" → "${newGuild.name}"`);
    }
    if (oldGuild.iconURL() !== newGuild.iconURL()) {
      changes.push('icon changed');
    }
    if (oldGuild.afkChannelId !== newGuild.afkChannelId) {
      changes.push(`AFK channel: ${oldGuild.afkChannelId ? `<#${oldGuild.afkChannelId}>` : 'none'} → ${newGuild.afkChannelId ? `<#${newGuild.afkChannelId}>` : 'none'}`);
    }
    if (oldGuild.verificationLevel !== newGuild.verificationLevel) {
      changes.push(`verification level: ${oldGuild.verificationLevel} → ${newGuild.verificationLevel}`);
    }
    if (oldGuild.defaultMessageNotificationLevel !== newGuild.defaultMessageNotificationLevel) {
      changes.push(`default notifications: ${oldGuild.defaultMessageNotificationLevel} → ${newGuild.defaultMessageNotificationLevel}`);
    }
    if (oldGuild.mfaLevel !== newGuild.mfaLevel) {
      changes.push(`2FA requirement: ${oldGuild.mfaLevel} → ${newGuild.mfaLevel}`);
    }
    if (oldGuild.systemChannelId !== newGuild.systemChannelId) {
      changes.push(`system channel: ${oldGuild.systemChannelId ? `<#${oldGuild.systemChannelId}>` : 'none'} → ${newGuild.systemChannelId ? `<#${newGuild.systemChannelId}>` : 'none'}`);
    }

    if (changes.length === 0) return;
    await sendAuditLog(newGuild, `⚙️ Server updated: ${changes.join(', ')}`);
  },
};
