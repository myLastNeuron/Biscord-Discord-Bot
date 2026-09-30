const { Events } = require('discord.js');
const { sendAuditLog } = require('../utils/auditLogger');

module.exports = {
  name: Events.ChannelUpdate,
  async execute(oldChannel, newChannel) {
    // Skip DM channels
    if (!oldChannel.guild) return;

    const changes = [];

    if (oldChannel.name !== newChannel.name) {
      changes.push(`name: "${oldChannel.name}" → "${newChannel.name}"`);
    }
    if (oldChannel.topic !== newChannel.topic) {
      changes.push(`topic changed`);
    }
    if (oldChannel.nsfw !== newChannel.nsfw) {
      changes.push(newChannel.nsfw ? 'marked NSFW' : 'unmarked NSFW');
    }
    if (oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser) {
      changes.push(`slowmode: ${oldChannel.rateLimitPerUser}s → ${newChannel.rateLimitPerUser}s`);
    }

    if (changes.length === 0) return;
    await sendAuditLog(newChannel.guild, `🔧 Channel #${newChannel.name}: ${changes.join(', ')}`);
  },
};
