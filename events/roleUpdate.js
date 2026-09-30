const { Events, PermissionFlagsBits } = require('discord.js');
const { sendAuditLog } = require('../utils/auditLogger');

module.exports = {
  name: Events.GuildRoleUpdate,
  async execute(oldRole, newRole) {
    const changes = [];

    if (oldRole.name !== newRole.name) {
      changes.push(`name: "${oldRole.name}" → "${newRole.name}"`);
    }
    if (oldRole.color !== newRole.color) {
      changes.push(`color: ${oldRole.hexColor} → ${newRole.hexColor}`);
    }
    if (oldRole.hoist !== newRole.hoist) {
      changes.push(newRole.hoist ? 'now shown separately' : 'no longer shown separately');
    }
    if (oldRole.mentionable !== newRole.mentionable) {
      changes.push(newRole.mentionable ? 'now mentionable' : 'no longer mentionable');
    }
    if (oldRole.permissions.bitfield !== newRole.permissions.bitfield) {
      const added = newRole.permissions.toArray().filter(p => !oldRole.permissions.has(p));
      const removed = oldRole.permissions.toArray().filter(p => !newRole.permissions.has(p));
      if (added.length) changes.push(`gained permissions: ${added.join(', ')}`);
      if (removed.length) changes.push(`lost permissions: ${removed.join(', ')}`);
    }

    if (changes.length === 0) return;
    await sendAuditLog(newRole.guild, `🔧 Role @${newRole.name}: ${changes.join(', ')}`);
  },
};
