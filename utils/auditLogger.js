const { EmbedBuilder } = require('discord.js');
const { getGuildSettings } = require('./db');

/**
 * Sends an audit log embed to the guild's configured audit log channel.
 * Embeds never trigger mentions, so role/user pings in the text are neutralized.
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

    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setDescription(message)
          .setFooter({ text: shortTime() }),
      ],
      allowedMentions: { parse: [] },
    });
  } catch (err) {
    console.error(`[auditLog] Failed to send audit message in guild ${guild.id}:`, err.message);
  }
}

module.exports = { sendAuditLog };
