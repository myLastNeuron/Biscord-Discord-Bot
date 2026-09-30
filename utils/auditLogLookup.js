const { AuditLogEvent } = require('discord.js');

/**
 * Looks up who performed a moderation action via Discord's audit log.
 * Returns the executor's tag or null if not found.
 *
 * @param {Guild} guild
 * @param {number} actionType - AuditLogEvent enum value (e.g. AuditLogEvent.MemberRoleUpdate)
 * @param {string} targetId - ID of the member/channel/role the action was performed on
 * @param {number} [maxAgeMs=10000] - Max age of audit log entry to consider (default 10s)
 * @returns {Promise<string|null>} executor tag or null
 */
async function findAuditLogExecutor(guild, actionType, targetId, maxAgeMs = 10000) {
  try {
    const logs = await guild.fetchAuditLogs({
      type: actionType,
      limit: 10,
    });

    const now = Date.now();
    for (const [, entry] of logs.entries) {
      // Must match the target user/channel/role
      if (entry.targetId !== targetId) continue;
      // Must be recent enough (Discord audit log entries can lag behind events)
      if (now - entry.createdTimestamp > maxAgeMs) continue;
      // Must have an executor
      if (!entry.executor) continue;

      return entry.executor.tag;
    }
  } catch (err) {
    // Audit log fetch can fail (permissions, API errors) — never crash
  }
  return null;
}

module.exports = { findAuditLogExecutor };
