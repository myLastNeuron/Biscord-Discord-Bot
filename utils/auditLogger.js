const { getGuildSettings } = require('./db');

/**
 * Sends a plain-text audit log message to the guild's configured audit log channel.
 * No-op if audit logging is disabled or no channel is set.
 * Never throws — failures are silently logged so they don't break event handlers.
 */
function shortTime() {
  const now = new Date();
  return `[${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}]`;
}

async function sendAuditLog(guild, message) {
  try {
    const settings = getGuildSettings(guild.id);
    if (!settings.auditLogEnabled || !settings.auditLogChannelId) return;

    const channel = guild.channels.cache.get(settings.auditLogChannelId);
    if (!channel || !channel.isTextBased()) return;

    await channel.send(`${message} ${shortTime()}`);
  } catch (err) {
    console.error(`[auditLog] Failed to send audit message in guild ${guild.id}:`, err.message);
  }
}

module.exports = { sendAuditLog };
