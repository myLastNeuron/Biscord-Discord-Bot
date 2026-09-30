const { getGuildSettings } = require('./db');

/** Sends an embed to the guild's configured mod-log channel, if one is set. */
async function logAction(guild, embed) {
  const settings = getGuildSettings(guild.id);
  if (!settings.logChannelId) return;
  const channel = await guild.channels.fetch(settings.logChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;
  await channel.send({ embeds: [embed] }).catch(() => null);
}

module.exports = { logAction };
