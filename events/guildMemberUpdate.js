const { Events, AuditLogEvent } = require('discord.js');
const { sendAuditLog } = require('../utils/auditLogger');
const { findAuditLogExecutor } = require('../utils/auditLogLookup');

module.exports = {
  name: Events.GuildMemberUpdate,
  async execute(oldMember, newMember) {
    const changes = [];
    let actionType = null;

    // Timeout
    const wasTimedOut = oldMember.isCommunicationDisabled();
    const isTimedOut = newMember.isCommunicationDisabled();
    if (!wasTimedOut && isTimedOut) {
      const ends = Math.floor(newMember.communicationDisabledUntilTimestamp / 1000);
      changes.push(`timed out until <t:${ends}:R>`);
      actionType = AuditLogEvent.MemberUpdate;
    } else if (wasTimedOut && !isTimedOut) {
      changes.push('timeout removed');
      actionType = AuditLogEvent.MemberUpdate;
    }

    // Nickname
    if (oldMember.nickname !== newMember.nickname) {
      changes.push(`nickname: ${oldMember.nickname || '(none)'} → ${newMember.nickname || '(none)'}`);
      if (!actionType) actionType = AuditLogEvent.MemberUpdate;
    }

    // Roles added
    const addedRoles = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
    for (const role of addedRoles) changes.push(`gained role ${role}`);

    // Roles removed
    const removedRoles = oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id));
    for (const role of removedRoles) changes.push(`lost role ${role}`);

    if (addedRoles.size > 0 || removedRoles.size > 0) {
      actionType = AuditLogEvent.MemberRoleUpdate;
    }

    // Avatar
    if (oldMember.displayAvatarURL() !== newMember.displayAvatarURL()) {
      changes.push('changed their avatar');
      if (!actionType) actionType = AuditLogEvent.MemberUpdate;
    }

    if (changes.length === 0) return;

    // Look up who performed the action via Discord audit log
    let executor = null;
    if (actionType) {
      executor = await findAuditLogExecutor(newMember.guild, actionType, newMember.id);
    }

    const who = executor ? ` by ${executor}` : '';
    await sendAuditLog(newMember.guild, `👤 ${newMember.user.tag}${who}: ${changes.join(', ')}`);
  },
};
